# SikHal — Execution Report

**Repository:** https://github.com/raccocoon/sikhal-ai (public, `main`)
**Head commit:** `ae7d444` — *fix(security): close 4 money-safety blockers found in finance review*
**Date:** 2026-10-11
**Scope delivered:** supplier-cancellation resolution + study-aware action planning (MVP)

---

## 1. What the product does

A student group-buy seller's supplier cancels an order. SikHal:

1. Extracts the case from the affected order records.
2. Matches payments to customers, so only genuinely affected people are refunded.
3. Computes each refund in integer sen — decimal-safe, deterministic.
4. Drafts a customer message per affected person.
5. Plans the resolution as scheduled steps.
6. Checks those steps against the seller's class and study commitments.
7. Requires an explicit human approval, bound to a content hash, before anything
   financial or customer-facing happens.

Two screens only: **New Case** and **Review Resolution**. No login, no generic
dashboard, no mock buttons.

---

## 2. Completed work

### Architecture and contracts (`docs/`)
- `phase1-architecture.md` — 6 principles, contracts, 7-table schema, tool pipeline
- `phase1-finance-spec.md` — money rules, invariants A1–A6, approval invariants H1–H5, test plan T01–T45
- `phase1-design-spec.md` — 24 colour tokens, both wireframes, 18-row anti-pattern guardrail table

### Calculation core (pure, credential-free)
| File | Responsibility |
|---|---|
| `src/lib/core/money.ts` | integer-sen primitives, `parseMYR`, `formatMYR`, `formatMYRPlain` |
| `src/lib/core/refund.ts` | largest-remainder apportionment, invariant A1 asserted at runtime |
| `src/lib/core/conflict.ts` | half-open interval overlap, MYT wall-clock minutes |
| `src/lib/core/approval.ts` | fail-closed gating, `proposalHashOf` single hash source |
| `src/lib/core/sha256.ts` | dependency-free SHA-256 for approval binding |
| `src/lib/core/refundkey.ts` | deterministic cross-resolution refund identity |

### Agent pipeline
`src/lib/tools/pipeline.ts` — six tools, each emitting a `ToolTraceEntry` rendered
as visible agent execution: `extractCase`, `matchAffectedCustomers`,
`calculateRefunds`, `draftMessages`, `planResolution`, `checkStudyConflicts`.

### Persistence
`src/lib/repo/repository.ts` — one interface, two adapters:
`SupabaseRepository` (real Postgres) and `MemoryRepository` (in-process).
The adapter is selected by environment configuration, never by a code change.

`supabase/schema.sql` — 7 tables, the invariants, and `write_resolution_atomic()`.

### UI
New Case (demo loader, live decimal-safe sub-total, desktop table / mobile cards),
Review Resolution (conflict banner first, refund table, timeline, editable
message drafts, agent trace, approval recap dialog).

---

## 3. Tests run — actual results

**183 unit tests, 8 files — all passing** (`npx vitest run`)

| File | Tests | Covers |
|---|---|---|
| `tests/money.test.ts` | 27 | integer arithmetic, `parseMYR`, both formatters |
| `tests/refund.test.ts` | 25 | invariants A1–A6, tie-break determinism |
| `tests/conflict.test.ts` | 20 | half-open intervals, boundary-exact cases |
| `tests/approval.test.ts` | 29 | H1–H5, tamper defence, non-tautology proof |
| `tests/pipeline.test.ts` | 26 | all six tools end to end |
| `tests/repository.test.ts` | 24 | persistence guarantees, duplicate guard |
| `tests/sha256.test.ts` | 23 | verified against Node `crypto` |
| `tests/refundkey.test.ts` | 9 | key stability and discrimination |

**17 live HTTP assertions — all passing** (`bash scripts/verify-approval-gate.sh`
against a running server)

| # | Scenario | Result |
|---|---|---|
| 0 | Create case, run pipeline | 42840 sen, 6 customers |
| 1 | Execute **before** approval | `409` fail-closed |
| 2 | Approve with tampered hash | `409` refused |
| 3 | Approve with correct hash | `200 approved` |
| 4 | Execute after approval | `200 executed` |
| 5 | Repeat execute | `409` no double refund |
| 6 | Reload persisted state | A1 holds, `executedAt` recorded |
| 7 | Duplicate refund, same cancellation | `409` refused |

**Typecheck:** `tsc --noEmit` clean.

**Demo outcome:** 6 customers, **RM428.40** total, invariant `Σ refunds === total`
holds, exactly **1** academic conflict detected (Prepare refunds → CS2040
Algorithms), alternative slot proposed (Tue 16:00).

---

## 4. Failures found, and what was done about them

**Phase 3 review found the product did not enforce its own guarantees.** Two
reviewers audited the implementation in parallel. The finance reviewer failed the
phase, correctly. I verified each finding by reading the code before fixing it.

### Blockers (fixed)

| # | Defect | Why it mattered | Fix |
|---|---|---|---|
| D1 | Approval hash compared a value to itself | The tamper defence was decorative — approved content could change and still execute | Recompute from live stored content; one shared `proposalHashOf()` across all three call sites |
| D2 | No `refund_key`, no cross-resolution uniqueness | A second resolution for the same cancellation could refund everyone again | Deterministic `refundKey()` + partial unique indexes, mirrored in both adapters |
| D3 | Refund total unbounded at the data layer | Only per-row `amount <= paid` was checked | Batch-total cap enforced in the atomic write |
| D4 | Resolution and lines written non-atomically | A failed line insert left an orphaned proposal that could later be "executed" | Single transactional `write_resolution_atomic()` |

### Should-fix (fixed)
- **D5** adapter divergence on double-execute — memory returned silently, Supabase threw. Both now throw identically.
- **D6** 32-bit FNV-1a replaced with real SHA-256. A 2^32 digest is collidable; a collision would let a different proposal satisfy an approval.
- **D7** float in the money path (`(sen / 100).toFixed(2)`) replaced with integer-only `formatMYRPlain()`.
- **D8** tie-break now matches spec: `(remainder desc, weight desc, id asc)`.

### Design findings (fixed)
- **V1** agent step counter could disagree with the screen-reader text by one
- **V3** drafts had Copy but no Edit, so nothing exercised the edit-invalidates-approval loop
- **V5** the disabled-approve reason was not wired to the control

### Earlier failures resolved during the build
- GitHub MCP token was read-only (403) → used `gh` CLI
- `EBUSY` on esbuild postinstall → explicit optional platform dependency
- `git push` hung on an interactive credential helper → configured `gh` as the helper
- `next build` `EPERM` on `.next/trace` → **sandbox limitation, unresolved** (see §5)

**Notable:** a new invariant caught a **bug in the test fixture itself** — the
shared `proposal()` helper declared a total of 42840 while supplying two lines
summing to 12650. It had been passing only because nothing validated it.

---

## 5. Remaining blockers — NOT done, not fabricated

### 1. Supabase credentials — absent
No `NEXT_PUBLIC_SUPABASE_URL` / key. Consequences, stated precisely:
- `SupabaseRepository` has **never executed** against real Postgres.
- The DB-level constraints (`refund_key_executed_uniq`, `refund_not_exceed_paid`,
  the append-only audit trigger) are **unproven on a real database**.
- Test plan items T29–T37 and the audit trigger test run only against the memory
  adapter, which mirrors the rules but is not the same engine.

**This is the largest remaining gap.** The memory adapter replicates the
invariants faithfully, but "two adapters implement the same rule" is weaker
evidence than "the database enforces it".

### 2. Vercel credentials — absent
No Vercel CLI, no `VERCEL_TOKEN`. **No deployment exists and no live link can be
produced.** The Dormathon Track 2 submission is therefore incomplete.

### 3. `next build` exits non-zero — sandbox only
`EPERM: operation not permitted` writing `.next/trace`. All 4 API routes and all
3 pages do compile. This is a sandbox filesystem restriction, not a code defect,
but it is unresolved and I am not claiming a clean production build.

### 4. Unverified by the review, listed honestly
- 200% zoom / 320px reflow not runtime-tested
- `UNATTRIBUTED_PAYMENT` is defined in the type but the pipeline never produces it
- Strict-mode timezone handling and midnight-spanning tasks are not exercised
  through the integration path
- `parseMYR` accepts negatives; no test pins the policy

---

## 6. What is needed from you

1. **Supabase** — create the project, run `supabase/schema.sql`, supply
   `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_ANON_KEY` as environment
   variables. The app then uses Postgres with no code change.
2. **Vercel** — connect the repo, or supply a token. Then I can deploy and verify
   the live URL.

Do not paste credentials into chat. Configure them as environment variables.

---

## 7. Bottom line

The MVP is built, tested (183 unit + 17 live assertions), and pushed. The money
kernel is genuinely sound, and after this round the approval and persistence
layers enforce — not merely describe — the product's guarantees.

**It is not deployable-complete**: no database has ever been exercised against it
and no public link exists. Both require credentials I do not have.
