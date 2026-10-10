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
  -- The business order this refund belongs to, denormalised from the case so
  -- the cross-resolution idempotency index below can key on it directly.
  order_id      text,
  customer_id   text not null,
  customer_name text not null,
  amount_sen    integer not null check (amount_sen >= 0),
  paid_sen      integer not null check (paid_sen >= 0),
  status        text not null default 'proposed'
                  check (status in ('proposed','approved','paid','failed')),
  -- Deterministic identity of a refund: sha256 of (order_id | customer_id |
  -- supplier_update_id | the cancelled line contents). Two agent runs over the
  -- same cancellation produce the same key, so the database can refuse to
  -- record the same refund twice even across resolutions.
  refund_key    text,
  -- Groups all refunds that belong to one supplier-cancellation event. A
  -- customer may be refunded once per event, and never twice for the same one.
  supplier_update_id text,
  created_at    timestamptz not null default now(),

  -- A customer can appear at most once per resolution. Re-running the agent
  -- cannot create a second refund row for the same person.
  constraint refund_once_per_customer unique (resolution_id, customer_id),

  -- Over-refunding is impossible: never refund more than was recorded as paid
  -- for that customer.
  constraint refund_not_exceed_paid check (amount_sen <= paid_sen)
);

-- CROSS-RESOLUTION double-refund guard.
--
-- The uniqueness above only stops a duplicate within one resolution. The real
-- risk is a *second resolution* being approved and executed for the same
-- cancellation, refunding the same customer again. This partial unique index
-- makes that impossible at the data layer: at most one row may exist with a
-- given refund_key while it is in an executed/paid state.
create unique index if not exists refund_key_executed_uniq
  on refund_lines (refund_key)
  where refund_key is not null and status in ('paid','approved');

-- One executed refund per (supplier event, customer), regardless of how the
-- refund_key was computed. This is the belt to the refund_key braces above.
create unique index if not exists refund_one_executed_per_event
  on refund_lines (supplier_update_id, customer_id)
  where supplier_update_id is not null and status = 'paid';

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
create index if not exists refund_lines_key_idx      on refund_lines (refund_key);
create index if not exists audit_log_resolution_idx  on audit_log (resolution_id);
create index if not exists resolutions_case_idx      on resolutions (case_id);

-- ── Atomic resolution write ───────────────────────────────────────────────
--
-- WHY THIS IS A FUNCTION AND NOT TWO CLIENT CALLS
--
-- Writing a resolution and then its refund lines as two separate round-trips is
-- not atomic. If the second write fails, the resolution row is already
-- committed: an orphaned proposal with a non-zero total, zero refund lines, and
-- nothing stopping it from later being approved and executed. The refunds would
-- then be recorded as done while no per-customer lines exist.
--
-- A plpgsql function body runs inside a single transaction, so either both
-- writes land or neither does.
--
-- It also enforces, at the data layer:
--   * Σ(amount_sen) over the lines === p_total_refund_sen  (no dropped/extra sen)
--   * Σ(paid_sen) over the lines      <= the case's total collected  (D3 cap)
--   * no duplicate customer_id within the batch
--
-- p_lines is a JSON array of {customer_id, customer_name, amount_sen, paid_sen,
-- refund_key, supplier_update_id}.
create or replace function write_resolution_atomic(
  p_case_id uuid,
  p_content_hash text,
  p_total_refund_sen integer,
  p_affected jsonb,
  p_drafts jsonb,
  p_plan jsonb,
  p_conflicts jsonb,
  p_tool_trace jsonb,
  p_warnings jsonb,
  p_lines jsonb
)
returns uuid
language plpgsql
as $$
declare
  v_resolution_id uuid;
  v_line_total    integer;
  v_paid_total    integer;
  v_case_total    integer;
  v_dup_count     integer;
begin
  -- 1. The sum of the lines must equal the resolution total exactly.
  select coalesce(sum((l->>'amount_sen')::integer), 0), coalesce(sum((l->>'paid_sen')::integer), 0)
    into v_line_total, v_paid_total
    from jsonb_array_elements(p_lines) as l;

  if v_line_total <> p_total_refund_sen then
    raise exception 'refund lines sum to % sen but resolution total is % sen',
      v_line_total, p_total_refund_sen;
  end if;

  -- 2. Never refund more than the case actually collected.
  select coalesce(sum(amount_sen), 0) into v_case_total
    from payments where case_id = p_case_id;

  if v_paid_total > v_case_total then
    raise exception 'total refundable paid (%) exceeds total collected (%) for case %',
      v_paid_total, v_case_total, p_case_id;
  end if;

  -- 3. No duplicate customer within this batch.
  select count(*) into v_dup_count from (
    select l->>'customer_id' as cid
      from jsonb_array_elements(p_lines) as l
     group by 1 having count(*) > 1
  ) d;
  if v_dup_count > 0 then
    raise exception 'refund batch contains a duplicate customer_id';
  end if;

  -- 4. Insert the resolution. The partial unique index on (case_id) for live
  --    statuses means a second active resolution for the case is rejected here.
  insert into resolutions (
    case_id, status, total_refund_sen, content_hash, affected,
    drafts, plan, conflicts, tool_trace, warnings
  ) values (
    p_case_id, 'draft', p_total_refund_sen, p_content_hash, p_affected,
    p_drafts, p_plan, p_conflicts, p_tool_trace, p_warnings
  )
  returning id into v_resolution_id;

  -- 5. Insert the lines. A cross-resolution duplicate refund_key is rejected by
  --    refund_key_executed_uniq / refund_one_executed_per_event when relevant,
  --    and a within-batch duplicate by refund_once_per_customer.
  insert into refund_lines (
    resolution_id, order_id, customer_id, customer_name,
    amount_sen, paid_sen, status, refund_key, supplier_update_id
  )
  select
    v_resolution_id,
    l->>'order_id',
    l->>'customer_id',
    l->>'customer_name',
    (l->>'amount_sen')::integer,
    (l->>'paid_sen')::integer,
    'proposed',
    l->>'refund_key',
    l->>'supplier_update_id'
  from jsonb_array_elements(p_lines) as l;

  return v_resolution_id;
end;
$$;
