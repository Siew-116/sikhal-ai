# SikHal — Product truth

## What SikHal does
SikHal helps a Malaysian student entrepreneur resolve a disrupted group buy without making incorrect refund promises or sacrificing class time. A founder supplies supplier-cancellation details and verified customer/payment records; SikHal generates a reviewable resolution with deterministic MYR refund proposals, affected buyers, draft notifications, and a study-aware action plan. Founder approval is required.

## Audience and real usage
One student founder, often on a laptop or phone between classes, dealing with customers who have already paid. Working context: Malaysia / Sarawak, MYR, local academic schedules; a short hackathon demonstration and real SME-style operations.

## Jobs to be done
1. Record a supplier cancellation with enough factual context and customer/payment evidence.
2. See who is affected and exactly how much each customer may be refunded.
3. Resolve calendar conflicts without creating a new one.
4. Review unsent customer communications and approve a proposal.
5. Preserve an auditable record in Supabase.

## Trust and product constraints
- Refund calculations are deterministic, use integer sen, and are never delegated to an LLM.
- AI may draft wording, but fallback templates must be visibly identified; AI failures must not falsify financial status.
- No real payment transfer or live message delivery is integrated. Never suggest otherwise.
- Current database status `executed` means internal workflow recorded, **not paid/sent**.
- Approval is deliberate and impossible while an academic conflict remains unresolved.
- Only factual status is presented; never fabricate customers, financial figures, calendar events, reviews, or activity.
- Preserve GitHub CI, server-only credentials, Supabase persistence and demo access protection.

## Scope
Two operational surfaces: / (new cancellation case) and /cases/[id]/resolution (review & approval). Avoid introducing an unrelated marketing site, analytics dashboard, or fake chatbot.

## Success criteria
A first-time user can load a safe example, understand the refund totals, resolve the blocked time slot, review drafts and approve without confusion. A mobile viewport remains usable. The UI distinguishes proposals from completed external actions.
