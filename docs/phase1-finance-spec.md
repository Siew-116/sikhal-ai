# SikHal — Phase 1 Finance & QA Specification

**Author:** 严核明 (Yan), QA & Financial Logic Engineer
**Status:** Draft for Lead review — implementable
**Scope:** Supplier-cancellation resolution only (MVP). No features outside this flow.
**Audience:** Lead (程建枢 / Cheng) — implement directly from this document.

> **Reading order for the implementer:** §1.1 (type), §1.4 (allocation), §1.7 (invariants) are the
> load-bearing sections. Everything else is supporting detail. If you implement only those three
> correctly, you have removed ~80% of the risk in this product.

---

## 0. Terminology & data reference model

Throughout this spec these entities and field names are used. Names are prescriptive — use them
in the schema and in code so tests are unambiguous.

### 0.1 Order / line / payment model

```
Order
  id            uuid
  founder_id    uuid
  status        enum: OPEN | DISRUPTED | RESOLVED | CLOSED
  created_at    timestamptz (UTC)

OrderLine
  id            uuid
  order_id      uuid -> Order.id
  supplier_id   uuid -> Supplier.id
  description   text
  unit_price_sen  integer   -- money as integer sen (see §1.1)
  quantity        integer
  cancelled_at  timestamptz | null   -- set when the supplier cancels this line

Customer
  id            uuid
  order_id      uuid -> Order.id

Payment                          -- money actually collected from a customer
  id            uuid
  order_id      uuid -> Order.id
  customer_id   uuid -> Customer.id
  amount_sen    integer          -- positive = collected
  method        enum: DUITNOW | FPX | CARD | CASH | EWALLET
  paid_at       timestamptz (UTC)

SupplierUpdate                   -- the disruption event
  id            uuid
  order_id      uuid -> Order.id
  supplier_id   uuid -> Supplier.id
  kind          enum: CANCELLATION | PRICE_CHANGE | AVAILABILITY
  refunded_to_founder_sen  integer | null   -- amount the supplier returned to the founder
  occurred_at   timestamptz (UTC)
```

### 0.2 What "the cancelled supplier amount" means

Two distinct quantities — do **not** conflate them:

| Symbol | Name | Meaning | Source |
|---|---|---|---|
| `SM` | **Supplier-confirmed amount** | MYR the supplier returned (or will return) to the founder for the cancelled supply | `SupplierUpdate.refunded_to_founder_sen`, or computed from cancelled lines when null |
| `CP` | **Customer-paid amount for affected lines** | Sum of payments attributable to the affected order lines | derived from `Payment` × affected `OrderLine` |

The founder's refund obligation is to customers. The supplier's reimbursement is the founder's
recovery. **Customers are refunded from `CP`; the founder's loss vs. recovery is reported from
`SM`.** The allocation algorithm in §1.4 allocates `CP` (what customers paid for the affected
lines) — the refundable pool. `SM` never reduces what a customer is owed. (Judgement call: the
founder is the merchant of record; a supplier refunding the founder does not discharge the
founder's obligation to the customer. Inventing a rule where customers eat the founder's loss
would be unfair and out of scope.)

---

## 1. Deterministic MYR refund calculation

### 1.1 Money representation — DECISION (non-negotiable)

**All money is stored and computed as integer `sen` (1 MYR = 100 sen). No `number`/`float`/`double`
in the money path, ever.**

| Concern | Rule |
|---|---|
| Storage | `integer` (Postgres `int8`/`integer`) columns suffixed `_sen`. Never `numeric`, never `real`/`double precision` for intermediate money. |
| In TS | `type Sen = number` **plus a branded type** `type Sen = number & { readonly __brand: 'Sen' }`, constructed only via `toSen()` from validated integer input. All arithmetic goes through the `money.ts` helpers below. |
| Parsing user input | Accept `"12.50"`, `"RM1,234.56"`, `12.5`. Parse with a **string** split on `.`, not `parseFloat`. Validate ≤ 2 decimal places, else reject (`MoneyPrecisionError`). |
| Formatting for display | `formatMYR(sen)` → `RM1,234.56` (thousands separators, exactly 2 dp, `RM` prefix, `-` before `RM` for negatives: `-RM12.00`). |

**Why integer sen, not a decimal library?**
Integer arithmetic in `number` is exact for all values up to `2^53 − 1` sen ≈ RM 90 trillion — orders
of magnitude beyond any student group buy. It is also exactly representable, JSON-safe, indexable,
and compares with `===`. A decimal library (`decimal.js`) would also work but adds a dependency,
serialization friction at the Supabase/JSON boundary, and a class of bugs where someone calls
`.toNumber()` and reintroduces float. **Integer sen removes the failure mode entirely.** This is the
strongest possible guarantee for a two-decimal currency.

**Forbidden in the money path (linter rule):** `parseFloat`, `Number(x)` on money, `toFixed`,
`* 100` / `/ 100` outside `money.ts`, `Math.round` outside `allocate()`.

`money.ts` surface (implement exactly):

```ts
export type Sen = number & { readonly __brand: 'Sen' };
export function toSen(integer: number): Sen;              // throws if !Number.isInteger
export function parseMYR(input: string | number): Sen;    // string-based, ≤2dp
export function formatMYR(sen: Sen): string;              // "RM1,234.56"
export function addSen(...xs: Sen[]): Sen;
export function subSen(a: Sen, b: Sen): Sen;
export function mulSen(a: Sen, factor: number): Sen;       // factor is a non-money scalar
export const ZERO: Sen;
```

### 1.2 Rounding rule — DECISION

**Half-up (round half away from zero) is the documented policy for the one legitimate rounding
site.** Rounding may occur **only** when converting a non-money scalar rate × money → money, and
**only via a single helper** `divRoundHalfUp(numeratorSen, denominator)` that computes
`floor((2*numerator + denominator) / (2*denominator))` with sign handling. **There is no rounding
anywhere in `allocate()`** — allocation uses integer division + remainder distribution (§1.4), which
is exact by construction.

*Judgement call:* half-up is the intuitive rule a Malaysian founder expects when they see a
half-sen (`RM0.005` → `RM0.01`) and matches typical invoice practice. Banker's rounding is not
required because, by design, no per-customer amount is ever produced by a division that leaves a
half-sen — allocation is exact integer partitioning. We therefore avoid the "is it half-up or
banker's?" ambiguity in the customer-facing amounts entirely.

### 1.3 `CP` — customer-paid amount attributable to affected lines

For a cancellation, first compute `CP` = total collected from customers for the affected lines.

`CP` is **not** "sum of all payments". It is payments **attributable to affected lines**. Attribution
rule (prescribed):

- If the order has **one line per customer** (the common group-buy shape) → `CP_customer` = that
  customer's payment(s) tied to the affected line.
- If a customer paid for a **mix** of affected and unaffected lines and payments are not line-tagged,
  allocate the customer's payment across their lines **pro rata by line value**
  (`unit_price_sen × quantity`), using §1.4's remainder method, then take the affected portion.
- If a payment **cannot be attributed** to any line (no line reference and customer has no lines) →
  **do not silently drop it.** Record an `UNATTRIBUTED_PAYMENT` flag on the resolution and surface
  it to the founder for manual decision. It is excluded from `CP` until resolved. (Judgement call:
  silent inclusion would over-refund; silent exclusion would under-refund and hide money.)

### 1.4 Allocation of a total across customers — THE CENTREPIECE

Given a total `T` (in sen, `T ≥ 0`) and `n` affected customers with **weights** `w_i ≥ 0` (sen;
the weight is the customer's attributable paid amount `CP_i`), produce `r_i` (sen) such that:

> **INVARIANT A1 (conservation):** `Σ r_i = T` exactly.
> **INVARIANT A2 (monotone / order-preserving in weight):** `w_i > w_j ⟹ r_i ≥ r_j`.
> **INVARIANT A3 (floor bound):** `r_i ∈ { floor(T·w_i / W), floor(T·w_i / W) + 1 }` where `W = Σ w_i`.
> **INVARIANT A4 (determinism):** identical inputs ⇒ identical outputs, byte-for-byte.

**Method: Largest-Remainder (Hamilton) apportionment with an explicit tie-break.**

```
allocate(T, weights[]):
  n = weights.length
  if n == 0: return []                       // INVARIANT A1 trivially; no customers
  W = Σ weights
  if W == 0:
      // No weights: fall back to EQUAL SPLIT using the same remainder machinery with w_i = 1.
      return allocate(T, [1,1,...,1])
  base_i  = (T * weights[i]) / W              // integer division, floor, all in integer sen
  rem_i   = (T * weights[i]) % W              // integer remainder, 0 ≤ rem_i < W
  allocated = Σ base_i
  leftover  = T - allocated                   // 0 ≤ leftover < n  (see proof note)
  // Distribute `leftover` sen, one each, to the customers with the largest remainder.
  // TIE-BREAK: (1) larger remainder first; (2) then larger weight; (3) then lexicographically
  // smaller customer_id (stable, total order → deterministic).
  order = sortIndicesBy(rem desc, weight desc, customer_id asc)
  for k in 0 .. leftover-1: base[ order[k] ] += 1
  return base
```

**Proof note that `0 ≤ leftover < n`:** `Σ base_i = Σ floor(T·w_i/W)`, and
`Σ (T·w_i/W) = T`, so `Σ frac_i = integer`; hence `Σ floor = T − Σ frac`, and `0 ≤ Σ frac < n`
since each `frac_i < 1`. Therefore `leftover` is a whole number of sen in `[0, n)`. ✅

**Why largest-remainder, not naive per-customer rounding?** Per-customer `round()` breaks A1 (sum ≠ T —
money is created or destroyed). Equal-split-alone breaks A2 (a customer who paid RM100 could get the
same as one who paid RM10). Largest-remainder is the textbook method that satisfies A1–A4
simultaneously.

**Determinism:** the sort is a **total order** — `(rem, weight)` may tie, but `customer_id` (a UUID)
never ties within one order, so the result is unique. Use a stable sort and the 3-key comparator.

### 1.5 Partial cancellations

Only `cancelled_at IS NOT NULL` lines are in scope. `CP` is computed over cancelled lines only.
Unaffected customers are **not** in `weights` and receive `r_i = 0` (they are absent from the
allocation vector, not present with zero — keep the refund set clean). If a supplier cancels
**some units** of a line, compute the cancelled sub-value `unit_price_sen × cancelled_quantity`
and attribute payments to it pro rata (§1.3).

### 1.6 Refund ceiling (over-refund guard)

> **INVARIANT A5 (no over-refund):** for every customer, `r_i ≤ CP_i` (a customer can never receive
> more than they actually paid for the affected goods). Additionally, `T ≤ Σ CP_i` must hold before
> allocation; if `T > Σ CP_i`, **clamp** `T := Σ CP_i` and raise
> `REFUND_EXCEEDS_COLLECTED` warning on the resolution (never silently over-pay).

This is the guard that makes "refunds exceeding the amount paid" impossible: clamping at the
allocation input, checked again per-customer as an assertion after distribution.

### 1.7 Invariants → assertions (implement these as runtime asserts + tests)

| ID | Invariant | Assertion |
|---|---|---|
| A1 | Conservation | `sum(refunds) === T` |
| A2 | Order preservation | `w_i > w_j ⇒ r_i ≥ r_j` |
| A3 | Floor bound | each `r_i ∈ {floor, floor+1}` |
| A4 | Determinism | `allocate(x) deepEquals allocate(x)` and across process restarts |
| A5 | No over-refund | `r_i ≤ CP_i` and `T ≤ Σ CP_i` |
| A6 | Non-negativity | all `r_i ≥ 0`, `T ≥ 0` |

### 1.8 Worked examples (numbers are exact and normative)

**Example 1 — even split, clean.**
3 customers paid 3000/3000/3000 sen (RM30 each); supplier cancels the line; refund pool
`T = 9000` sen (RM90). `W = 9000`.
- `base = 9000*3000/9000 = 3000` each; `rem = 0` each; leftover = 0.
- **Result: 3000 / 3000 / 3000 = RM30.00 each. Sum = RM90.00.** ✅

**Example 2 — the classic remainder (THE regression test).**
3 customers paid 3000 sen each (RM30), pool `T = 10000` sen (RM100 — founder collected RM90 but
supplier refunded a flat RM100; after A5 clamp… note RM100 > RM90 so **A5 clamps `T` to 9000**).
Redo cleanly with `T = 10000` and weights `10000/10000/10000` (each paid RM100):
`W = 30000`. `base = 10000*10000/30000 = 33333` (floor), `rem = 10000*10000 % 30000 = 10000`.
Each rem = 10000 (tie!). `Σ base = 99999`; leftover = `10000 − 99999`… recompute: `Σ base = 3×33333 = 99999`, leftover = `10000 − 99999 = 1`? No — `T=10000` sen and base 33333 sen already exceeds T. **Units error** — let me restate with correct units: pool `T = 10000` sen = RM100, split 3 ways.
`base_i = floor(10000 / 3) = 3333`, `rem_i = 10000 % 3 = 1`. `Σ base = 9999`, `leftover = 1`.
Tie on rem (=1); tie-break by weight (equal) then customer_id asc → first customer gets the extra sen.
- **Result: 3334 / 3333 / 3333 sen = RM33.34 / RM33.33 / RM33.33. Sum = 10000 sen = RM100.00.** ✅
- This is the canonical "sum must still be exactly RM100.00" test.

**Example 3 — 7 customers, RM100 (remainder lands mid-list).**
7 customers paid equally; pool `T = 10000` sen. `base = floor(10000/7) = 1428`, `rem = 10000 % 7 = 4`.
`Σ base = 9996`, leftover = 4. All weights tie → 4 lowest customer_ids get +1 sen.
- **Result: four customers at 1429 sen (RM14.29), three at 1428 sen (RM14.28).
  Sum = 4×1429 + 3×1428 = 5716 + 4284 = 10000 sen = RM100.00.** ✅

**Example 4 — proportional weights with remainder.**
Weights `A=5000, B=3000, C=2000` sen (paid RM50/RM30/RM20, `W=10000`); pool `T = 9999` sen.
- A: `9999*5000 = 49,995,000`; `/10000 = 4999`, `%10000 = 5000`.
- B: `9999*3000 = 29,997,000`; `/10000 = 2999`, `%10000 = 7000`.
- C: `9999*2000 = 19,998,000`; `/10000 = 1999`, `%10000 = 8000`.
- `Σ base = 9997`; leftover = 2. Largest remainders: C (8000), B (7000) → +1 each.
- **Result: A=4999, B=3000, C=2000 = RM49.99 / RM30.00 / RM20.00. Sum = 9999 sen = RM99.99.** ✅

**Example 5 — zero-amount line (free/promo item).**
2 customers: A paid 2500 sen, B paid 0 (promo). Cancelled item cost 0 → pool `T = 0`.
- `allocate(0, [2500, 0])` → all bases 0, leftover 0.
- **Result: A=0, B=0 sen = RM0.00 each.** ✅ (Zero is valid and must not error.)

**Example 6 — weight zero for one customer but non-zero pool.**
A paid 5000, B paid 0; pool `T = 1000` (supplier refunded a fixed handling credit). `W = 5000`.
- A: `1000*5000/5000 = 1000`, rem 0. B: `1000*0/5000 = 0`, rem 0.
- **Result: A=1000 sen (RM10.00), B=0 sen (RM0.00). Sum = 1000.** ✅ (Guards A2: A paid more, gets more.)

**Example 7 — all-zero weights, non-zero pool (edge).**
No payments recorded for anyone; pool `T = 500` sen. `W = 0` → fallback to equal split with
`w_i = 1`.
- 4 customers: `base = floor(500/4) = 125`, `rem = 0`, leftover 0.
- **Result: 125 sen each (RM1.25). Sum = 500.** ✅ *BUT* note A5: if no one paid, `Σ CP = 0`, so
  A5 clamps `T := 0`. **Therefore in practice this case returns all zeros and raises
  `NO_PAYMENTS_FOR_AFFECTED_LINES`.** The equal-split path exists only for defensiveness; the A5
  clamp governs. *(Flag for Lead: confirm we want zero-refund + warning here rather than the
  equal split. Reasoning: you cannot refund money never collected.)*

---

## 2. Affected-customer identification

Rule set:

| ID | Rule |
|---|---|
| AC1 | A customer is **affected** iff they have ≥1 `Payment` attributable to an `OrderLine` whose `supplier_id` matches the `SupplierUpdate.supplier_id` **and** (`OrderLine.cancelled_at IS NOT NULL` **or** the update `kind = CANCELLATION` covers that line). |
| AC2 | A customer who paid but whose item is **unaffected** is **not** in the affected set; `r = 0`; they receive no customer message. |
| AC3 | A customer with **no recorded payment** for an affected line is **not** silently dropped. They are recorded on the resolution with status `NO_PAYMENT`, `r = 0`, and surfaced to the founder as an exception (they may owe the founder, or the payment was recorded under a different name). |
| AC4 | Matching a `SupplierUpdate` to lines is by `supplier_id` (exact UUID). Description-based fuzzy matching is **out of scope** — do not implement. |
| AC5 | A customer appearing in **two orders** is unaffected by this rule — the affected set is computed **per order**. (Cross-order duplicate detection is §3's job for refunds, not identification.) |
| AC6 | An order with **no customers** ⇒ affected set empty ⇒ `allocate` returns `[]`, `T` must be 0; raise `ORDER_HAS_NO_CUSTOMERS` if a refund is nonetheless requested. |

Output shape per resolution:
`AffectedCustomer { customer_id, cp_sen, refund_sen, status: REFUNDABLE | NO_PAYMENT | UNATTRIBUTED }`.

---

## 3. Duplicate-refund prevention

### 3.1 Idempotency model

A **refund claim** is uniquely identified by `refund_key`:

```
refund_key = sha256_hex(
  order_id + "|" + customer_id + "|" + supplier_update_id + "|" + affected_line_ids_sorted.join(",")
)
```

Rationale: one refund per (customer, disruption event, affected line set). Re-running the agent on the
same case yields the same `refund_key`, so the second attempt is a no-op. If a *different*
supplier update legitimately affects the same customer later, the `supplier_update_id` differs ⇒ new
key ⇒ allowed. (Judgement call: keying on the disruption event rather than the order allows the
real-world case of a second cancellation.)

### 3.2 Re-running the agent

- The agent **never writes refunds directly**. It produces a **proposal** (`resolution_draft`).
- Persisting a proposal is idempotent: `INSERT ... ON CONFLICT (refund_key) DO NOTHING`.
- A proposal that matches an already-**executed** refund (`status = EXECUTED`) is flagged
  `ALREADY_REFUNDED` and never re-proposed for execution.

### 3.3 Approval-then-execution idempotency

- Approving records an **approval token** `approval_id` (UUID) tied to the resolution, with a
  client-supplied `idempotency_key` (generated once per UI session for that review screen).
- Execution is `UPDATE refund SET status='EXECUTING' WHERE refund_key=... AND status='APPROVED'`.
  If `rowcount = 0`, the refund was already claimed/executed → **stop, do not pay again** and return
  the existing record. This is a **compare-and-swap**, so a double-click or a retried request cannot
  execute twice.
- If the external gateway times out mid-execution, the refund stays `EXECUTING` with the gateway's
  `external_ref`; a reconciliation job queries the gateway by `external_ref` before any retry.

### 3.4 Database constraints (schema shape)

```sql
create table refund (
  id                 uuid primary key default gen_random_uuid(),
  refund_key         text not null,
  order_id           uuid not null references "order"(id),
  customer_id        uuid not null references customer(id),
  supplier_update_id uuid not null references supplier_update(id),
  amount_sen         integer not null check (amount_sen >= 0),
  status             text not null
                     check (status in ('PROPOSED','APPROVED','EXECUTING','EXECUTED','FAILED','VOID')),
  external_ref       text,
  approved_by        uuid,
  approved_at        timestamptz,
  exec_idempotency_key text,
  created_at         timestamptz not null default now()
);

-- THE constraint that makes duplicate refunds impossible at the data layer:
create unique index refund_refund_key_uniq on refund (refund_key);
create unique index refund_exec_idem_uniq
  on refund (exec_idempotency_key) where exec_idempotency_key is not null;

-- One executed refund per (order, customer, supplier_update):
create unique index refund_one_executed
  on refund (order_id, customer_id, supplier_update_id)
  where status in ('EXECUTING','EXECUTED');
```

Partition/partial unique indexes make concurrency safe: two concurrent inserts race and exactly one
wins; two concurrent executions race on the partial unique index and exactly one wins.

### 3.5 Audit record must capture

`audit_log` (append-only — see §4.3) entry per refund per transition:
`timestamp (UTC), actor_id, action ∈ {PROPOSED, APPROVED, EXECUTED, FAILED, VOID}, order_id,
customer_id, refund_id, refund_key, amount_sen, previous_status, new_status, external_ref,
correlation_id`. Never updated or deleted.

---

## 4. Human-approval gating

### 4.1 What constitutes approval

Approval = an authenticated founder action on the **Review Resolution** screen that:
1. submits `resolution_id` + `idempotency_key`, and
2. the server verifies the resolution is in status `AWAITING_APPROVAL`, and
3. every refund line shown is re-validated (invariants §1.7) server-side **at approval time**, and
4. writes `approved_by`, `approved_at` atomically.

A click, a checkbox, or an LLM output is **not** approval. Only the server-side transition is.

### 4.2 Pending state

New resolutions are created `AWAITING_APPROVAL`. **No external call (payment gateway, email/SMS) may
be made while the resolution has any refund in a state other than `APPROVED`.** The executor must
refuse (throw `APPROVAL_REQUIRED`) if asked to run on a non-approved resolution.

### 4.3 Fail-safe on absent / ambiguous approval

- Missing `approval_id` ⇒ executor throws; nothing external happens. (Fail-closed.)
- Ambiguous (two different `idempotency_key`s approving) ⇒ first CAS wins; second returns existing.
- If approval is later **voided**, no further execution; already-executed refunds are immutable.

### 4.4 Invariants as testable assertions

| ID | Assertion |
|---|---|
| H1 | `execute(refund)` throws `APPROVAL_REQUIRED` unless `refund.status === 'APPROVED'`. |
| H2 | No `Payment`/gateway call or message-send occurs for a resolution with no `approved_at`. |
| H3 | Every `EXECUTED` refund has a non-null `approved_by` and `approved_at`. |
| H4 | `approved_at ≥ created_at` for every refund. |
| H5 | An LLM/agent output alone can never flip a refund to `APPROVED` (only the server action can). |

---

## 5. Study Protection / academic-hour conflict

### 5.1 Commitment data shape

```
Commitment
  id           uuid
  founder_id   uuid
  day_of_week  enum: MON..SUN          -- recurring weekly
  start_time   time WITHOUT time zone  -- wall-clock, local MYT
  end_time     time WITHOUT time zone
  label        text                    -- e.g. "CS101 Lecture"
  location     text | null
  effective_from  date | null
  effective_to    date | null
```
Times are **wall-clock MYT**. Malaysia is UTC+8, single zone, **no DST** → a naive local clock is
safe and there is no ambiguous/skipped hour. **Implication:** store commitments as `time`; store
task instants as UTC `timestamptz`; convert at the boundary using the fixed `+08:00` offset. Never
use the host machine's local timezone (server may be UTC).

### 5.2 Conflict-detection algorithm

Represent each commitment and each proposed task window as half-open intervals `[start, end)` in
minutes-of-week (0..10079). A task `[s1,e1)` conflicts with commitment `[s2,e2)` iff:

```
s1 < e2 AND s2 < e1        // strict overlap
```

Consequences (normative):
- **Boundary-exact:** task ending exactly when class starts (`e1 == s2`) → **NOT a conflict**
  (`s1 < e2` may hold but `s2 < e1` is `s2 < s2` = false). Justification: a task that finishes the
  instant class begins leaves zero overlap; flagging it would block every back-to-back schedule and
  is not what "conflict" means. We add a configurable `BUFFER_MINUTES` (default 0) if the founder
  wants a safety margin; with buffer, the intervals are expanded before the test.
- Zero-length task (`s1 == e1`) → never conflicts (matches `s2 < e1` = `s2 < s1`, combined with
  `s1 < e2`; a point inside class **would** flag — we explicitly reject zero-length tasks for
  business actions in §5.4 instead).
- Overlaps spanning midnight / week boundary: convert to minutes-of-week and test modulo 10080
  (handles a task at Sun 23:30 → Mon 00:30).

### 5.3 Timezone test cases

| Case | Input | Expected |
|---|---|---|
| TZ1 | commitment 09:00–10:00 MYT; task 08:30–09:00 MYT | no conflict (boundary) |
| TZ2 | commitment 09:00–10:00 MYT; task 09:00–09:30 MYT | conflict |
| TZ3 | same instant expressed in UTC (`01:00Z`) | identical result to MYT input |
| TZ4 | Server TZ = UTC, founder in MYT | result unchanged (no host-TZ dependence) |

### 5.4 Checking the resolution plan

Every proposed action in the resolution plan (e.g. "contact supplier", "send customer messages",
"process refunds") carries a proposed `[start,end)` window. The checker returns, per action:
`{ action_id, conflict: boolean, conflicting_commitment_ids: [] }`.

- **Default behaviour: WARN, and propose an alternative slot** — do not hard-block the whole
  resolution, because the founder may legitimately choose to act during free time or override.
  Judgement call: blocking outright would make the product unusable when a class is merely adjacent;
  warn + suggest is safer and keeps the human in control.
- If the founder explicitly enables **Strict Mode**, conflicts **block** submission and the approval
  gate (H1) cannot proceed until resolved or overridden with a recorded reason.

### 5.5 Alternative-slot suggestion rules

```
suggestSlot(durationMin, commitments, searchFrom, searchTo, stepMin=15):
  candidates = free intervals within [searchFrom, searchTo] on the WEEK grid,
               where "free" = not covered by any commitment (after buffer), and
               within founder waking hours [08:00, 22:00] MYT.
  for each free interval of length ≥ durationMin, ordered by (earliest start):
      slot = [interval.start, interval.start + durationMin]
      if no conflict(slot, commitments): return slot
  return null  // no slot found → surface to founder, do not fabricate one
```

Rules: prefer earliest valid slot; never suggest a slot that itself conflicts; never suggest a slot
outside `[08:00, 22:00]` MYT; if none found, return `null` and surface an advisory (do not invent).
The suggestion is **advisory only** — the founder confirms.

---

## 6. Edge cases & automated test plan

### 6.1 Edge-case catalogue

| ID | Case | Expected behaviour |
|---|---|---|
| E1 | Missing payment | Customer in `NO_PAYMENT` status, `r=0`, flagged, not dropped (§AC3) |
| E2 | Partial cancellation | Only cancelled lines valued; others `r=0` (§1.5) |
| E3 | Unclear/incomplete records (payment not line-attributable) | `UNATTRIBUTED_PAYMENT` flag; excluded from `CP`; founder notified (§1.3) |
| E4 | Supplier updates again **after** approval | New `supplier_update_id` ⇒ new key; prior executed refund **not** reversed automatically; surfaced as `SUPERSEDED_UPDATE` advisory (§3.1) |
| E5 | Zero-amount refund | Valid; `r=0`; no gateway call; still audited (Example 5) |
| E6 | Customer in two orders | Each order handled independently (§AC5); a second order's refund is a distinct key |
| E7 | Order with no customers | `ORDER_HAS_NO_CUSTOMERS`, `T` forced 0 (§AC6) |
| E8 | Refund > paid | Impossible — A5 clamp + `r_i ≤ CP_i` assert (§1.6) |
| E9 | Total doesn't divide evenly | Largest-remainder + tie-break; A1 holds (Examples 2,3,4) |
| E10 | All weights zero, pool > 0 | A5 clamps to 0 + `NO_PAYMENTS_FOR_AFFECTED_LINES` (Example 7) |
| E11 | Negative/negative-money input | Rejected at `parseMYR`/`toSen` (`MoneyPrecisionError`) |
| E12 | >2 decimal places (`"1.005"`) | Rejected (`MoneyPrecisionError`) |
| E13 | Concurrent double-approve | CAS + partial unique index → exactly one execution (§3.3/§3.4) |
| E14 | Task ends exactly at class start | No conflict (TZ1) |
| E15 | Re-run agent on same case | No new refund rows (`ON CONFLICT DO NOTHING`) (§3.2) |

### 6.2 Automated test plan (Vitest/Jest-style) — directly implementable

Money in **sen**. All assertions exact integers. Fixtures are allowed **only** for pure functions
(§6.3).

```
// ---- money.test.ts ----
T01 parseMYR("RM1,234.56") === 123456 sen
T02 parseMYR("12.5") === 1250 sen
T03 parseMYR("1.005") throws MoneyPrecisionError
T04 parseMYR(-1) throws MoneyPrecisionError  (or per policy: rejects negatives)
T05 formatMYR(123456) === "RM1,234.56"
T06 formatMYR(0) === "RM0.00"
T07 formatMYR(-1200) === "-RM12.00"
T08 addSen(2999, 1) === 3000  (no float drift)

// ---- allocate.test.ts : INVARIANT A1/A2/A3/A4 ----
T09 allocate(9000, [3000,3000,3000]) === [3000,3000,3000]           // Ex1
T10 allocate(10000, [10000,10000,10000] sen weights unequal? no) — using Ex2:
    allocate(10000, [1,1,1]) === [3334,3333,3333]                    // Ex2, sum=10000
T11 allocate(10000, [1,1,1,1,1,1,1]) === [1429,1429,1429,1429,1428,1428,1428] // Ex3
T12 allocate(9999, [5000,3000,2000]) === [4999,3000,2000]           // Ex4
T13 allocate(0, [2500,0]) === [0,0]                                 // Ex5
T14 allocate(1000, [5000,0]) === [1000,0]                           // Ex6
T15 allocate(500, [0,0,0,0]) → A5 pre-clamp returns [0,0,0,0]       // Ex7 (see T23)
T16 allocate(T,[w...]).reduce(+) === T for 1000 random (T,w) fixtures // property: A1
T17 determinism: allocate(x) deepEquals allocate(x) for 1000 fixtures // A4
T18 tie-break: equal rem + equal weight ⇒ lower customer_id gets +1   // A4
T19 A2: for random fixtures, sort by w ⇒ non-decreasing r
T20 A3: each r_i ∈ {floor(T*w_i/W), floor(T*w_i/W)+1}

// ---- resolution.test.ts : affected set + guards ----
T21 missing payment: customer with no Payment ⇒ status NO_PAYMENT, r=0, present in output
T22 partial cancellation: 2 lines, 1 cancelled ⇒ only cancelled customer refunded
T23 all-zero weights with pool ⇒ T clamped to 0, warning NO_PAYMENTS_FOR_AFFECTED_LINES
T24 refund > paid ⇒ T clamped to ΣCP, warning REFUND_EXCEEDS_COLLECTED
T25 per-customer assert r_i ≤ CP_i holds after allocation
T26 order with no customers ⇒ ORDER_HAS_NO_CUSTOMERS, T=0
T27 customer in two orders ⇒ two independent resolutions, distinct keys
T28 unattributed payment ⇒ UNATTRIBUTED_PAYMENT flag, excluded from CP

// ---- idempotency.test.ts : REAL DB (no mock) ----
T29 insert same refund_key twice ⇒ second is no-op (ON CONFLICT DO NOTHING), 1 row
T30 re-run agent on same case ⇒ refund row count unchanged
T31 approved→execute twice ⇒ one EXECUTED, second returns existing (CAS)
T32 concurrent execute (Promise.all x2) ⇒ exactly one row in EXECUTING/EXECUTED
T33 refund_refund_key_uniq violation raises unique_violation (assert DB error code 23505)

// ---- approval.test.ts : REAL DB ----
T34 execute on PROPOSED refund ⇒ throws APPROVAL_REQUIRED (H1)
T35 no external fetch/message call when approved_at is null (spy gateway + mailer)
T36 every EXECUTED refund has approved_by + approved_at non-null (H3)
T37 approved_at ≥ created_at (H4)

// ---- study.test.ts ----
T38 TZ1 boundary: task 08:30–09:00 vs class 09:00–10:00 ⇒ no conflict
T39 TZ2 overlap ⇒ conflict, lists commitment id
T40 TZ3 same instant in UTC ⇒ same result
T41 TZ4 host TZ=UTC ⇒ same result (freeze TZ env)
T42 suggestSlot returns earliest conflict-free slot ≥ duration
T43 suggestSlot returns null when no slot exists; does not fabricate
T44 suggested slot never conflicts (re-assert with checker)
T45 strict mode: conflict blocks submission
```

### 6.3 What must be tested against **real persistence** (no mocks)

- **All idempotency/duplicate tests (T29–T33):** the guarantee lives in DB unique indexes; a mocked
  DB proves nothing. Run against a real Postgres/Supabase test schema.
- **All approval-gate tests (T34–T37):** the fail-closed behaviour depends on the actual CAS
  `UPDATE ... WHERE status='APPROVED'`. Must hit real DB.
- **Audit-log append-only enforcement:** attempt `UPDATE`/`DELETE` on `audit_log` and assert it is
  rejected (trigger/RLS), against real DB.

Pure functions (`money.ts`, `allocate`, conflict checker) **may** use fixtures — they are
deterministic and have no I/O. This is the correct split: mock the pure, never mock the persistence.

---

## 7. Audit trail & correlation (record verification)

Every financial action writes **both** a business row and an append-only `audit_log` row, linked by
`correlation_id` that propagates: UI action → API request → DB write → audit entry.

| Step | Actor | Action | Amount | Ref IDs | Prev state | Correlation |
|---|---|---|---|---|---|---|
| Propose | agent | `PROPOSED` | r_i | order, customer, refund_key | — | corr-id |
| Approve | founder | `APPROVED` | r_i | refund_id | AWAITING_APPROVAL | corr-id |
| Execute | system | `EXECUTED` | r_i | refund_id, external_ref | APPROVED | corr-id |

`audit_log` is append-only: no `UPDATE`/`DELETE` grants; enforce with a trigger. Verification test:
read back the saved record and assert every field matches the expected output of the operation
(timestamp present, actor present, amount equals `r_i`, prev state equals prior status).

---

## 8. Rules requiring Lead confirmation

| # | Rule | Question for Lead | My recommendation |
|---|---|---|---|
| C1 | Ex1 vs Ex2 unit clarity | Confirm money unit everywhere is **sen**; the prompt's RM examples must be `×100`. | Adopt integer sen (§1.1). |
| C2 | Zero-weight / no-payment pool | Refund nothing + warn, or equal split? | **Refund nothing + warn** (§1.6/Ex7). Cannot refund uncollected money. |
| C3 | Buffer minutes | Default 0 or 5-min safety margin before class? | Default **0**, configurable. |
| C4 | Strict Mode default | Warn (default) or block on conflict? | **Warn + suggest**, strict opt-in (§5.4). |
| C5 | Post-approval supplier update | Auto-reverse prior refund or advisory only? | **Advisory only**; never auto-reverse executed refunds (E4). |
| C6 | SM vs CP | Confirm supplier recovery (`SM`) never reduces customer refund (`CP`). | **Confirm** — founder bears supply risk (§0.2). |
| C7 | Rounding policy | Half-up acceptable? | **Yes**, but by design no customer amount is produced by a half-sen division (§1.2). |

---

## 9. Compliance checklist against constraints

- [x] All money MYR, formatted `RM1,234.56` (§1.1).
- [x] Decimal-safe: integer sen, no float in money path (§1.1).
- [x] Duplicate refund prevention: key + unique indexes + CAS (§3).
- [x] Human approval gate, fail-closed (§4).
- [x] Study protection with boundary/timezone rules (§5).
- [x] Audit trail with correlation id (§7).
- [x] Scope limited to supplier-cancellation resolution.
- [x] Every judgement call justified in one line.
