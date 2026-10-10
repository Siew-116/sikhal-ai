-- ---------------------------------------------------------------------------
-- SikHal — Supabase / PostgreSQL schema
--
-- Apply with:  supabase db execute --file supabase/schema.sql
--          or: psql <connection-string> -f supabase/schema.sql
--
-- MONEY RULE (enforced by convention throughout): every monetary column is an
-- integer count of SEN (1 MYR = 100 sen). There is no numeric, real, or double
-- precision column anywhere in this schema. This is what makes decimal-safe
-- arithmetic a schema-level guarantee rather than a hope.
--
-- SINGLE-FOUNDER MVP: there is no login (master prompt explicitly forbids it),
-- so there is no per-user RLS. The server writes with the service-role key.
-- ---------------------------------------------------------------------------

create extension if not exists "pgcrypto";

-- ── Academic commitments (Study Protection) ────────────────────────────────
create table if not exists commitments (
  id            uuid primary key default gen_random_uuid(),
  label         text        not null,
  day_of_week   smallint    not null check (day_of_week between 0 and 6),
  start_minute  smallint    not null check (start_minute between 0 and 1439),
  end_minute    smallint    not null check (end_minute   between 1 and 1440),
  location      text,
  created_at    timestamptz not null default now(),
  constraint commitment_time_order check (end_minute > start_minute)
);

-- ── Cases: one disrupted group buy ─────────────────────────────────────────
create table if not exists cases (
  id                  uuid primary key default gen_random_uuid(),
  supplier_name       text        not null,
  order_ref           text        not null,
  cancellation_reason text        not null,
  cancelled_on        date        not null,
  raw_input           text,
  created_at          timestamptz not null default now()
);

-- ── Order lines: what was ordered, and what the supplier cancelled ─────────
create table if not exists order_lines (
  id             uuid primary key default gen_random_uuid(),
  case_id        uuid not null references cases(id) on delete cascade,
  customer_id    text not null,
  customer_name  text not null,
  item_name      text not null,
  quantity       integer not null check (quantity > 0),
  unit_price_sen integer not null check (unit_price_sen >= 0),
  is_cancelled   boolean not null default false
);

-- ── Payments: what each customer actually paid ─────────────────────────────
create table if not exists payments (
  id             uuid primary key default gen_random_uuid(),
  case_id        uuid not null references cases(id) on delete cascade,
  customer_id    text not null,
  customer_name  text not null,
  amount_sen     integer not null check (amount_sen >= 0),
  status         text not null default 'paid' check (status in ('paid','partial','unpaid')),
  reference      text,
  paid_at        timestamptz not null default now()
);

-- ── Resolutions: the agent's proposal + the approval state ────────────────
create table if not exists resolutions (
  id               uuid primary key default gen_random_uuid(),
  case_id          uuid not null references cases(id) on delete cascade,
  status           text not null default 'draft'
                     check (status in ('draft','approved','executing','executed','failed')),
  total_refund_sen integer not null default 0 check (total_refund_sen >= 0),
  -- Binds approval to the exact proposal content the founder reviewed. If the
  -- content changes, the stored hash no longer matches and execution is refused.
  content_hash     text not null,
  affected         jsonb not null default '[]'::jsonb,
  drafts           jsonb not null default '[]'::jsonb,
  plan             jsonb not null default '[]'::jsonb,
  conflicts        jsonb not null default '[]'::jsonb,
  tool_trace       jsonb not null default '[]'::jsonb,
  warnings         jsonb not null default '[]'::jsonb,
  created_at       timestamptz not null default now(),
  approved_at      timestamptz,
  approved_by      text,
  executed_at      timestamptz
);

-- One live resolution per case. Partial indexes keep historical rows intact
-- while preventing a case from having two active resolutions.
create unique index if not exists resolutions_one_draft_per_case
  on resolutions (case_id) where status in ('draft','approved','executing');

-- ── Refund lines: the money, one row per customer ─────────────────────────
create table if not exists refund_lines (
  id            uuid primary key default gen_random_uuid(),
  resolution_id uuid not null references resolutions(id) on delete cascade,
  customer_id   text not null,
  customer_name text not null,
  amount_sen    integer not null check (amount_sen >= 0),
  paid_sen      integer not null check (paid_sen >= 0),
  status        text not null default 'proposed'
                  check (status in ('proposed','approved','paid','failed')),
  created_at    timestamptz not null default now(),

  -- THE constraint that makes duplicate refunds impossible at the data layer:
  -- a customer can appear at most once per resolution. Re-running the agent
  -- cannot create a second refund row for the same person.
  constraint refund_once_per_customer unique (resolution_id, customer_id),

  -- THE guard that makes over-refunding impossible: you can never refund a
  -- customer more than they were recorded as having paid.
  constraint refund_not_exceed_paid check (amount_sen <= paid_sen)
);

-- ── Audit log: append-only record of every financial / external action ────
create table if not exists audit_log (
  id            bigserial primary key,
  case_id       uuid references cases(id) on delete set null,
  resolution_id uuid references resolutions(id) on delete set null,
  actor         text not null,
  action        text not null,
  payload       jsonb not null default '{}'::jsonb,
  created_at    timestamptz not null default now()
);

-- Enforce append-only at the database level. An UPDATE or DELETE on the audit
-- log raises an exception, so the trail cannot be quietly rewritten.
create or replace function audit_log_immutable()
returns trigger
language plpgsql
as $$
begin
  raise exception 'audit_log is append-only; % is not permitted', tg_op;
end;
$$;

drop trigger if exists audit_log_no_update on audit_log;
create trigger audit_log_no_update
  before update or delete on audit_log
  for each row execute function audit_log_immutable();

-- ── Indexes ───────────────────────────────────────────────────────────────
create index if not exists order_lines_case_idx      on order_lines (case_id);
create index if not exists payments_case_customer_idx on payments (case_id, customer_id);
create index if not exists refund_lines_resolution_idx on refund_lines (resolution_id);
create index if not exists audit_log_resolution_idx  on audit_log (resolution_id);
create index if not exists resolutions_case_idx      on resolutions (case_id);
