# SikHal

AI-powered resolution of disrupted group-buy orders for Malaysian student entrepreneurs — without forcing anyone to choose between their business and their studies.

# Presentation slides


# Demo link
https://sikhal-ai.vercel.app/
Sign in with credentials:
username: demo
Password: 123456789qwertyuiop

## The problem

Student entrepreneurs in Malaysia run group-buy (团购) orders alongside a full academic timetable. When a supplier cancels, a batch arrives damaged, or an order collapses midway, the founder is left holding a pile of manual reconciliation work: who paid, who is owed what, and how to refund in MYR without losing money on rounding. That work lands exactly when lectures and exams land.

SikHal closes that gap. It records orders and payments, detects the disruption, computes refunds with decimal-safe MYR arithmetic, and prepares customer messages — while refusing to schedule any business action that collides with the founder's unavailable academic hours.

## Core principles

- **Decimal-safe money.** Every MYR amount is computed with exact decimal arithmetic. No floating-point drift, ever.
- **Human approval on external actions.** No refund is issued and no customer message is sent until a human explicitly approves it.
- **Academic hours are protected.** Proposed business actions must not conflict with the student's unavailable academic hours.
- **No duplicate refunds.** Every refund is validated against recorded orders and payments before it is prepared.
- **Auditable.** Every financial action leaves a trace in the database and audit log.

## Scope (MVP)

The required demo workflow only:

1. Record a group-buy order and its payments.
2. Mark the order as disrupted (supplier update, cancellation, damage).
3. Compute each customer's refund entitlement in MYR with decimal-safe arithmetic.
4. Validate the refund set — no duplicates, no over-refund, no missing-payment cases silently dropped.
5. Surface every proposed refund and customer message for human approval.
6. Block any proposed action that conflicts with the founder's unavailable academic hours.
7. Write the outcome and an audit entry for every action taken.

Features outside this flow are out of scope until the MVP is verified end to end.

## Tech stack

| Layer | Choice |
|-------|--------|
| Framework | Next.js (App Router) |
| Language | TypeScript |
| UI | shadcn/ui + Tailwind CSS, mobile-first responsive |
| Database / Auth / Storage | Supabase |
| Money | Decimal-safe MYR arithmetic, server-side only |
| Agent orchestration | Server-side tool execution with structured outputs |
| Deployment | Vercel, with GitHub CI/CD |

## Getting started

```bash
git clone https://github.com/raccocoon/sikhal-ai.git
cd sikhal-ai
cp .env.example .env.local   # then fill in real values
npm install
npm run dev
```

The app runs at http://localhost:3000.

## Configuration

All secrets live in environment variables — see `.env.example`. Nothing is hard-coded in source. `.env.local` is git-ignored.

## Team

Built with the **SikHal Product Engineering Team** in Tencent WorkBuddy.

| Name | Role | Responsibility |
|------|------|----------------|
| 程建枢 (Cheng) | Lead / Chief Engineering Officer | Architecture, implementation, integration, deployment |
| 艾简白 (Ai) | Product UI/UX Designer | Design system, component patterns, accessibility, interaction states |
| 严核明 (Yan) | QA & Financial Logic Engineer | Refund validation, MYR decimal safety, test coverage, audit logs |

## Status

Repository scaffolded. Awaiting the application master prompt to begin architecture and implementation.
