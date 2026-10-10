# SikHal — MVP Architecture

**Status**: Phase 1 (architecture defined, pre-implementation)
**Scope**: Supplier cancellation resolution + study-aware action planning. Nothing else.
**Author**: 程建枢 (Cheng), Lead

---

## 1. Scope boundary

### In scope

The complete supplier-cancellation resolution loop:

1. Founder records a supplier cancellation against a group buy.
2. Agent parses the case and identifies affected customers.
3. Agent calculates proposed refunds in MYR — deterministically, decimal-safe.
4. Agent drafts customer messages and proposes a resolution plan.
5. Proposal is checked against the founder's academic commitments.
6. Founder reviews and **explicitly approves**.
7. Resolution is persisted with an audit trail.

### Explicitly out of scope

Per the master prompt: **no login, no generic dashboard, no additional modules, no mock-only buttons.** Two screens only — New Case and Review Resolution. There is exactly one user role: the student founder, operating their own cases.

Any feature request that does not serve the loop above is rejected in Phase 2.

---

## 2. Architectural principles

| # | Principle | Consequence |
|---|-----------|-------------|
| 1 | **Money never touches floating point** | All MYR values are integer sen in storage and in the calculation kernel. Conversion to `RM12.34` happens only at the render boundary. |
| 2 | **Approval is a state transition, not a UI flag** | An action's execution is gated by a persisted approval record. The UI cannot bypass it by calling the API directly. |
| 3 | **The agent is a tool-executing pipeline, not a black box** | Each step is a discrete, individually observable and individually testable tool invocation. The UI renders the trace. |
| 4 | **Persistence is real** | Supabase Postgres is the only store. Fixtures exist for tests and for the labelled demo seed — never as a production substitute. |
| 5 | **Pure core, thin shell** | The refund kernel and conflict detector are pure functions with no I/O. All I/O lives in repository/route layers. This is what makes the money path testable. |
| 6 | **Fail closed** | Missing approval, ambiguous state, or an unresolved conflict blocks the action rather than degrading gracefully. |

Principle 5 is the load-bearing one. The refund kernel and the academic-conflict detector are pure, synchronous, dependency-free modules. Everything that could make them non-deterministic — clocks, network, database — is pushed to the edges.

---

## 3. System shape

```
┌───────────────────────────────────────────────────────────────┐
│  Next.js App Router (client)                                   │
│                                                                │
│  /cases/new            → Screen 1: New Case                    │
│  /cases/[id]/review    → Screen 2: Review Resolution           │
│                                                                │
│  shadcn/ui + Tailwind, tokens from design spec                 │
└───────────────────────────┬───────────────────────────────────┘
                            │ fetch (JSON)
┌───────────────────────────▼───────────────────────────────────┐
│  Route Handlers (server)                                       │
│                                                                │
│  POST /api/cases              create case + records            │
│  POST /api/cases/[id]/run     run agent (streams tool trace)   │
│  GET  /api/cases/[id]         fetch case + resolution          │
│  POST /api/resolutions/[id]/approve    record approval         │
│  POST /api/resolutions/[id]/execute    execute (approval-gated)│
│  GET  /api/commitments        academic commitments             │
│  POST /api/commitments        add commitment                   │
└───────────────────────────┬───────────────────────────────────┘
                            │
┌───────────────────────────▼───────────────────────────────────┐
│  Agent Orchestration Layer                                     │
│                                                                │
│  ┌─────────────────────────────────────────────────────────┐  │
│  │ Tool registry — each tool: name, schema, execute()      │  │
│  │                                                          │  │
│  │  extractCase        (AI)   parse free text → case shape  │  │
│  │  matchOrders        (pure) order lines → affected set    │  │
│  │  calculateRefunds   (pure) affected set → refund lines   │  │
│  │  draftMessages      (AI)   refund lines → message drafts │  │
│  │  planResolution     (pure) refunds → proposed timeline   │  │
│  │  checkStudyConflict (pure) plan → conflicts              │  │
│  │  persistResolution  (I/O)  → DB                          │  │
│  └─────────────────────────────────────────────────────────┘  │
│                                                                │
│  Each invocation emits a structured ToolTraceEntry             │
│  { tool, status, input, output, durationMs, error }            │
│  → streamed to client, persisted with the resolution           │
└───────────────────────────┬───────────────────────────────────┘
                            │
┌───────────────────────────▼───────────────────────────────────┐
│  Pure Calculation Core  (no I/O, no deps, fully unit-testable) │
│                                                                │
│  money.ts        integer-sen arithmetic, formatting            │
│  refund.ts       allocation + largest-remainder distribution   │
│  conflict.ts     academic-hour overlap detection               │
│  approval.ts     approval-state invariants                     │
└───────────────────────────┬───────────────────────────────────┘
                            │
┌───────────────────────────▼───────────────────────────────────┐
│  Persistence — Supabase Postgres                               │
│  repository modules hide the client; swappable config          │
└───────────────────────────────────────────────────────────────┘
```

### Why the pure core matters

`refund.ts` and `conflict.ts` take plain data and return plain data. They import nothing from Supabase, Next.js, or the AI layer. This means:

- They run in the test suite with **no credentials at all** — directly serving the requirement to "implement code and tests that do not require external credentials."
- The AI layer can propose garbage without corrupting money math; the kernel validates and rejects.
- Two independent implementations must agree byte-for-byte, which is only verifiable if the kernel is pure.

---

## 4. Contract definitions

These are the interfaces between layers. They are the Lead's design decisions; the finance kernel implements exactly these shapes.

### 4.1 Money

```ts
/** MYR is stored and computed exclusively as integer sen. */
type Sen = number;          // integer, may be negative, never fractional

/** Format only at the render boundary. */
function formatMYR(sen: Sen): string;   // 1234567 → "RM12,345.67"
```

`money.ts` asserts `Number.isInteger(sen)` on every entry point. A fractional sen is a bug, not something to round silently.

### 4.2 Refund allocation contract

```ts
interface RefundLine {
  customerId: string;
  amountSen: Sen;        // the refund owed to this customer
  paidSen: Sen;          // what they actually paid (invariant: amountSen <= paidSen)
}

interface RefundAllocation {
  lines: RefundLine[];
  totalRefundSen: Sen;   // invariant: sum(lines[i].amountSen) === totalRefundSen
}
```

**The invariant `Σ lines === total` is the centrepiece.** Integer division across N customers leaves a remainder; that remainder must be distributed by a deterministic rule (largest-remainder with a defined tie-break), never dropped and never fudged. 严核明 (Yan) specifies the exact rule in `phase1-finance-spec.md`; the kernel implements it and the test suite asserts the invariant on every case.

### 4.3 Tool contract

```ts
interface ToolTraceEntry {
  tool: string;
  status: 'pending' | 'running' | 'ok' | 'error';
  input: unknown;
  output: unknown;
  durationMs: number;
  error?: string;
}
```

Tools are declared once in a registry with an input schema, so the orchestration layer can validate before executing and the UI can render a consistent trace. **Visible agent tool execution is a stated requirement** — every tool invocation produces one of these entries, and the client renders them live.

### 4.4 Approval contract

```ts
type ResolutionStatus =
  | 'draft'              // agent finished, nothing approved
  | 'approved'           // founder approved; execution not yet performed
  | 'executing'
  | 'executed'
  | 'failed';

interface Approval {
  resolutionId: string;
  approvedAt: string;      // ISO-8601
  approvedBy: string;      // founder identity (single-user MVP)
  // what exactly was approved — binds approval to a content hash so a
  // changed proposal invalidates the approval
  contentHash: string;
}
```

Binding approval to a **content hash** is the defence against the classic bug: founder approves a proposal, then the underlying data shifts, and execution proceeds against something that was never approved. If the hash no longer matches at execution time, the action fails closed.

`approval.ts` exposes the invariant as a pure predicate:

```ts
function canExecute(status: ResolutionStatus, approval: Approval | null,
                    currentHash: string): boolean
```

### 4.5 Study commitment contract

```ts
interface Commitment {
  id: string;
  label: string;          // e.g. "Data Structures lecture"
  dayOfWeek: 0|1|2|3|4|5|6;
  startMinute: number;    // minutes from midnight, 0..1439
  endMinute: number;      // exclusive
  location?: string;
}

interface Conflict {
  commitmentId: string;
  proposedStart: string;  // ISO-8601
  proposedEnd: string;
  reason: 'overlap' | 'boundary';
}
```

Times are stored as **minutes from midnight on a local day**, with Malaysia's single UTC+8 zone and no DST as an explicit simplification. This avoids timezone arithmetic entirely in the conflict path — a deliberate decision that removes an entire class of bug. `conflict.ts` handles the boundary case explicitly (see the finance spec for the ruling on a task ending exactly when class begins).

---

## 5. Database schema

Supabase Postgres. All money columns are `integer` sen — **no `numeric` for money, no `float`, ever.**

```sql
-- ── Academic commitments (Study Protection) ──────────────────────────
create table commitments (
  id            uuid primary key default gen_random_uuid(),
  owner_id      text        not null,
  label         text        not null,
  day_of_week   smallint    not null check (day_of_week between 0 and 6),
  start_minute  smallint    not null check (start_minute between 0 and 1439),
  end_minute    smallint    not null check (end_minute   between 1 and 1440),
  location      text,
  created_at    timestamptz not null default now(),
  constraint commitment_time_order check (end_minute > start_minute)
);

-- ── Cases: one disrupted group buy ───────────────────────────────────
create table cases (
  id              uuid primary key default gen_random_uuid(),
  owner_id        text        not null,
  supplier_name   text        not null,
  order_ref       text        not null,
  cancellation_reason text    not null,
  cancelled_on    date        not null,
  raw_input       text,                       -- founder's free-text description
  created_at      timestamptz not null default now()
);

-- ── Orders: line items in the group buy ──────────────────────────────
create table order_lines (
  id            uuid primary key default gen_random_uuid(),
  case_id       uuid not null references cases(id) on delete cascade,
  customer_id   text not null,
  customer_name text not null,
  item_name     text not null,
  quantity      integer not null check (quantity > 0),
  unit_price_sen integer not null check (unit_price_sen >= 0),
  is_cancelled  boolean not null default false   -- did the supplier cancel this line?
);

-- ── Payments: what each customer actually paid ───────────────────────
create table payments (
  id            uuid primary key default gen_random_uuid(),
  case_id       uuid not null references cases(id) on delete cascade,
  customer_id   text not null,
  amount_sen    integer not null check (amount_sen >= 0),
  paid_at       timestamptz not null default now(),
  reference     text
);

-- ── Resolutions: the agent's proposal + approval state ───────────────
create table resolutions (
  id             uuid primary key default gen_random_uuid(),
  case_id        uuid not null references cases(id) on delete cascade,
  status         text not null default 'draft'
                   check (status in ('draft','approved','executing','executed','failed')),
  total_refund_sen integer not null default 0,
  content_hash   text not null,            -- binds approval to proposal content
  plan           jsonb not null,           -- proposed timeline + message drafts
  conflicts      jsonb not null default '[]'::jsonb,
  tool_trace     jsonb not null default '[]'::jsonb,
  created_at     timestamptz not null default now(),
  approved_at    timestamptz,
  executed_at    timestamptz
);

-- ── Refund lines: the money, one row per customer ────────────────────
-- Duplicate prevention lives here: a refund can exist at most once
-- per (resolution, customer).
create table refund_lines (
  id             uuid primary key default gen_random_uuid(),
  resolution_id  uuid not null references resolutions(id) on delete cascade,
  customer_id    text not null,
  customer_name  text not null,
  amount_sen     integer not null check (amount_sen >= 0),
  paid_sen       integer not null check (paid_sen >= 0),
  status         text not null default 'proposed'
                   check (status in ('proposed','approved','paid','failed')),
  created_at     timestamptz not null default now(),
  constraint refund_once_per_customer unique (resolution_id, customer_id),
  constraint refund_not_exceed_paid    check (amount_sen <= paid_sen)
);

-- ── Audit log: append-only record of every financial/外部 action ──────
create table audit_log (
  id            bigserial primary key,
  case_id       uuid references cases(id) on delete set null,
  resolution_id uuid references resolutions(id) on delete set null,
  actor         text not null,
  action        text not null,       -- 'refund.proposed','refund.approved','message.sent',...
  payload       jsonb not null default '{}'::jsonb,
  created_at    timestamptz not null default now()
);

create index on order_lines (case_id);
create index on payments (case_id, customer_id);
create index on refund_lines (resolution_id);
create index on audit_log (resolution_id);
```

### The two constraints doing real work

- **`refund_once_per_customer unique (resolution_id, customer_id)`** — duplicate prevention at the database level, not merely in application logic. Re-running the agent on the same case cannot create a second refund row for the same customer in the same resolution.
- **`refund_not_exceed_paid check (amount_sen <= paid_sen)`** — the "must be impossible to refund more than was paid" guard, enforced by Postgres rather than trusted to the application layer.

Both are deliberate: the master prompt requires duplicate prevention and deterministic calculation, and enforcing them in the schema means a future code change cannot silently violate them.

---

## 6. Agent orchestration

### Tool pipeline

| # | Tool | Kind | Input | Output |
|---|------|------|-------|--------|
| 1 | `extractCase` | AI | free-text description | structured case draft |
| 2 | `matchOrders` | pure | case + order lines | affected customer set |
| 3 | `calculateRefunds` | pure | affected set + payments | `RefundAllocation` |
| 4 | `draftMessages` | AI | refund lines | per-customer message drafts |
| 5 | `planResolution` | pure | refund lines | proposed timeline |
| 6 | `checkStudyConflict` | pure | plan + commitments | `Conflict[]` |
| 7 | `persistResolution` | I/O | everything above | persisted resolution |

### The AI/pure split is the safety design

Tools 1 and 4 are AI-powered and therefore **unreliable by nature** — they may hallucinate, mis-parse, or produce malformed output. Tools 2, 3, 5, 6 are pure and deterministic.

The AI never computes money. It proposes structure; the pure kernel computes and validates. If the AI produces a malformed case, `matchOrders` rejects it before money is ever touched. This is the single most important architectural decision in the system, and it is why the requirement "deterministic MYR refund calculations" is satisfiable at all in a system that also contains a language model.

### Credential-free operation

Tools 2, 3, 5, 6 and the entire pure core run with **zero external credentials**. That covers:
- the whole refund calculation,
- the whole conflict detection,
- the whole approval-gating logic,
- the full automated test suite.

Only tools 1, 4 (AI) and 7 (persistence) require credentials. This directly satisfies the user's instruction to implement and test independently of Supabase/Vercel access.

### Graceful degradation

The AI tools degrade to a deterministic fallback parser/drafter when no LLM key is present. The application therefore runs end-to-end in demo mode without an LLM key, with the fallback clearly labelled in the UI — and upgrades to real AI extraction the moment a key is supplied. This is labelled behaviour, not a fake: the fallback is presented as a fallback.

---

## 7. Environment & configuration

Nothing is hard-coded. The app reads:

```
NEXT_PUBLIC_SUPABASE_URL
NEXT_PUBLIC_SUPABASE_ANON_KEY
SUPABASE_SERVICE_ROLE_KEY
LLM_API_KEY            (optional — fallback parser used when absent)
LLM_MODEL              (optional)
NEXT_PUBLIC_APP_URL
```

A `lib/env.ts` module validates presence at startup and reports precisely which variables are missing, rather than failing with an opaque error deep in a request. The persistence layer is reached only through repository modules, so switching from "no credentials, in-memory demo adapter" to "Supabase" is a configuration change, not a refactor — satisfying the requirement that the app "can later connect to Supabase through environment variables without major changes."

---

## 8. Testing strategy

| Layer | Test type | Credentials needed |
|-------|-----------|-------------------|
| `money.ts` | unit | none |
| `refund.ts` | unit — including the Σ-invariant property test | none |
| `conflict.ts` | unit — overlap + boundary cases | none |
| `approval.ts` | unit — fail-closed invariants | none |
| tool pipeline | integration with fixtures | none (AI tools stubbed) |
| repository | integration | Supabase |
| end-to-end | Playwright | full stack |

The first four rows are the bulk of the test suite and run unconditionally in CI. This is how "run automated tests" is satisfied before credentials exist.

---

## 9. Deployment

Vercel, connected to `raccocoon/sikhal-ai` on `main`. Preview deployments per PR, production on merge. Supabase credentials are configured as Vercel environment variables — never committed.

Deployment is **blocked pending Vercel authentication**, which the user will configure separately. The repository is structured so that connecting Vercel requires only linking the repo and setting environment variables.

---

## 10. Open items needing confirmation

| # | Item | Owner | Status |
|---|------|-------|--------|
| 1 | Largest-remainder tie-break rule | Yan | pending finance spec |
| 2 | Boundary-exact conflict ruling (task ends exactly when class starts) | Yan | pending finance spec |
| 3 | Academic conflict → block vs warn vs propose-alternative | Yan | pending finance spec |
| 4 | Approval UI confirmation pattern | Ai | pending design spec |
| 5 | Sarawak demo fixture content | Ai | pending design spec |
| 6 | Whether to require an LLM key for the Dormathon demo | Lead | Lead will ensure credential-free path works first |

Items 1-3 are resolved by the finance spec; 4-5 by the design spec. The Lead integrates both.
