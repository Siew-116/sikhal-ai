/**
 * repository.supabase.ts — real Postgres persistence via Supabase.
 *
 * Implements the SAME Repository interface as the in-memory adapter, with the
 * guarantees enforced at the DATABASE level rather than in application code:
 *
 *   - `refund_once_per_customer` unique constraint  → duplicate refunds impossible
 *   - `refund_not_exceed_paid` check constraint     → over-refund impossible
 *   - approval compare-and-swap on status           → double-execution impossible
 *   - append-only `audit_log`                       → tamper-evident trail
 *
 * The schema lives in `supabase/schema.sql`. Applying it is the one manual step
 * required to switch persistence on.
 *
 * NOTE ON VERIFICATION: the repository-level guarantees here are implemented and
 * type-checked, but they have NOT been executed against a live Supabase instance
 * because no credentials were supplied during development. The in-memory adapter
 * is what the test suite exercises. Verifying this adapter against real Postgres
 * is listed as an explicit remaining item in the Phase 4 report.
 */

import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import type { AuditEntry, CreateCaseInput, Repository } from './repository';
import type { CaseRecord, Resolution, AffectedCustomer, MessageDraft, PlanStep } from '@/lib/types';
import type { Conflict, Commitment } from '@/lib/core/conflict';
import type { FixtureOrderLine, FixturePayment } from '@/lib/fixtures';
import { ApprovalError, PersistenceError } from './errors';
import type { SupabaseConfig } from '@/lib/env';

interface CaseRow {
  id: string;
  supplier_name: string;
  order_ref: string;
  cancellation_reason: string;
  cancelled_on: string;
  raw_input: string | null;
  created_at: string;
}

interface ResolutionRow {
  id: string;
  case_id: string;
  status: Resolution['status'];
  total_refund_sen: number;
  content_hash: string;
  affected: AffectedCustomer[];
  drafts: MessageDraft[];
  plan: PlanStep[];
  conflicts: Conflict[];
  tool_trace: Resolution['toolTrace'];
  warnings: string[];
  created_at: string;
  approved_at: string | null;
}

export class SupabaseRepository implements Repository {
  readonly kind = 'supabase' as const;
  private client: SupabaseClient;

  constructor(config: SupabaseConfig) {
    // Service-role key: this is a single-founder MVP with no login, so the
    // server is the only writer and there is no per-user RLS to honour yet.
    this.client = createClient(config.url, config.serviceRoleKey, {
      auth: { persistSession: false },
    });
  }

  describe() {
    return { kind: 'supabase' as const, label: 'Supabase Postgres — durable storage' };
  }

  async createCase(input: CreateCaseInput): Promise<CaseRecord> {
    const { data, error } = await this.client
      .from('cases')
      .insert({
        supplier_name: input.supplierName,
        order_ref: input.orderRef,
        cancellation_reason: input.cancellationReason,
        cancelled_on: input.cancelledOn,
        raw_input: input.rawInput ?? null,
      })
      .select()
      .single();

    if (error) throw new PersistenceError(`Failed to create case: ${error.message}`);
    const row = data as CaseRow;

    const lineRows = input.orderLines.map((l) => ({
      case_id: row.id,
      customer_id: l.customerId,
      customer_name: l.customerName,
      item_name: l.itemName,
      quantity: l.quantity,
      unit_price_sen: l.unitPriceSen,
      is_cancelled: l.isCancelled,
    }));
    if (lineRows.length > 0) {
      const { error: lineError } = await this.client.from('order_lines').insert(lineRows);
      if (lineError) {
        throw new PersistenceError(`Failed to save order lines: ${lineError.message}`);
      }
    }

    const paymentRows = input.payments.map((p) => ({
      case_id: row.id,
      customer_id: p.customerId,
      customer_name: p.customerName,
      amount_sen: p.amountSen,
      status: p.status,
      reference: p.reference,
    }));
    if (paymentRows.length > 0) {
      const { error: payError } = await this.client.from('payments').insert(paymentRows);
      if (payError) {
        throw new PersistenceError(`Failed to save payments: ${payError.message}`);
      }
    }

    return this.mapCase(row);
  }

  async getCase(caseId: string): Promise<CaseRecord | null> {
    const { data, error } = await this.client
      .from('cases')
      .select()
      .eq('id', caseId)
      .maybeSingle();
    if (error) throw new PersistenceError(`Failed to load case: ${error.message}`);
    return data ? this.mapCase(data as CaseRow) : null;
  }

  async listCases(): Promise<CaseRecord[]> {
    const { data, error } = await this.client
      .from('cases')
      .select()
      .order('created_at', { ascending: false });
    if (error) throw new PersistenceError(`Failed to list cases: ${error.message}`);
    return (data as CaseRow[]).map((r) => this.mapCase(r));
  }

  async getOrderLines(caseId: string): Promise<FixtureOrderLine[]> {
    const { data, error } = await this.client
      .from('order_lines')
      .select()
      .eq('case_id', caseId);
    if (error) throw new PersistenceError(`Failed to load order lines: ${error.message}`);
    return (data ?? []).map((r) => ({
      customerId: r.customer_id,
      customerName: r.customer_name,
      itemName: r.item_name,
      quantity: r.quantity,
      unitPriceSen: r.unit_price_sen,
      isCancelled: r.is_cancelled,
    }));
  }

  async getPayments(caseId: string): Promise<FixturePayment[]> {
    const { data, error } = await this.client
      .from('payments')
      .select()
      .eq('case_id', caseId);
    if (error) throw new PersistenceError(`Failed to load payments: ${error.message}`);
    return (data ?? []).map((r) => ({
      customerId: r.customer_id,
      customerName: r.customer_name,
      amountSen: r.amount_sen,
      status: r.status,
      reference: r.reference ?? '',
    }));
  }

  async saveResolution(
    input: Parameters<Repository['saveResolution']>[0],
  ): Promise<Resolution> {
    const existing = await this.getResolutionForCase(input.caseId);
    if (existing && existing.status !== 'draft') {
      throw new ApprovalError(
        'This resolution has already been approved or executed and cannot be replaced by a new agent run.',
      );
    }

    const payload = {
      case_id: input.caseId,
      status: 'draft' as const,
      total_refund_sen: input.totalRefundSen,
      content_hash: input.contentHash,
      affected: input.affected,
      drafts: input.drafts,
      plan: input.plan,
      conflicts: input.conflicts,
      tool_trace: input.toolTrace,
      warnings: input.warnings,
    };

    // Upsert on the case: one resolution per case while in draft.
    const { data, error } = existing
      ? await this.client.from('resolutions').update(payload).eq('id', existing.id).select().single()
      : await this.client.from('resolutions').insert(payload).select().single();

    if (error) throw new PersistenceError(`Failed to save resolution: ${error.message}`);
    const resolution = this.mapResolution(data as ResolutionRow);

    // Refund lines are written with the unique (resolution_id, customer_id)
    // constraint enforcing duplicate prevention at the database level.
    if (input.affected.length > 0) {
      const { error: lineError } = await this.client.from('refund_lines').upsert(
        input.affected.map((a) => ({
          resolution_id: resolution.id,
          customer_id: a.customerId,
          customer_name: a.customerName,
          amount_sen: a.refundSen,
          paid_sen: a.paidSen,
          status: 'proposed',
        })),
        { onConflict: 'resolution_id,customer_id' },
      );
      if (lineError) {
        throw new PersistenceError(`Failed to save refund lines: ${lineError.message}`);
      }
    }

    return resolution;
  }

  async getResolution(resolutionId: string): Promise<Resolution | null> {
    const { data, error } = await this.client
      .from('resolutions')
      .select()
      .eq('id', resolutionId)
      .maybeSingle();
    if (error) throw new PersistenceError(`Failed to load resolution: ${error.message}`);
    return data ? this.mapResolution(data as ResolutionRow) : null;
  }

  async getResolutionForCase(caseId: string): Promise<Resolution | null> {
    const { data, error } = await this.client
      .from('resolutions')
      .select()
      .eq('case_id', caseId)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();
    if (error) throw new PersistenceError(`Failed to load resolution: ${error.message}`);
    return data ? this.mapResolution(data as ResolutionRow) : null;
  }

  async approveResolution(
    resolutionId: string,
    approvedBy: string,
    contentHash: string,
  ): Promise<Resolution> {
    const resolution = await this.getResolution(resolutionId);
    if (!resolution) throw new ApprovalError('Resolution not found.');
    if (resolution.status === 'approved') return resolution;

    if (resolution.status !== 'draft' && resolution.status !== 'failed') {
      throw new ApprovalError(`Cannot approve a resolution in status "${resolution.status}".`);
    }
    if (resolution.contentHash !== contentHash) {
      throw new ApprovalError(
        'The proposal has changed since you reviewed it. Please re-review before approving.',
      );
    }

    // Compare-and-swap: the WHERE clause makes concurrent approvals safe — the
    // second loses the race and matches no row.
    const { data, error } = await this.client
      .from('resolutions')
      .update({ status: 'approved', approved_at: new Date().toISOString(), approved_by: approvedBy })
      .eq('id', resolutionId)
      .eq('status', 'draft')
      .select()
      .maybeSingle();

    if (error) throw new PersistenceError(`Failed to approve resolution: ${error.message}`);

    if (!data) {
      // Someone else won the race — return the current state.
      const current = await this.getResolution(resolutionId);
      if (!current) throw new ApprovalError('Resolution not found after approval race.');
      return current;
    }
    return this.mapResolution(data as ResolutionRow);
  }

  async markExecuted(resolutionId: string): Promise<Resolution> {
    const { data, error } = await this.client
      .from('resolutions')
      .update({ status: 'executed', executed_at: new Date().toISOString() })
      .eq('id', resolutionId)
      .eq('status', 'approved') // CAS: only an approved resolution may execute
      .select()
      .maybeSingle();

    if (error) throw new PersistenceError(`Failed to execute resolution: ${error.message}`);

    if (!data) {
      const current = await this.getResolution(resolutionId);
      if (current?.status === 'executed') return current; // idempotent double-click
      throw new ApprovalError(
        `Refusing to execute: resolution is "${current?.status ?? 'missing'}", not approved.`,
      );
    }
    return this.mapResolution(data as ResolutionRow);
  }

  async listCommitments(): Promise<Commitment[]> {
    const { data, error } = await this.client
      .from('commitments')
      .select()
      .order('day_of_week')
      .order('start_minute');
    if (error) throw new PersistenceError(`Failed to load commitments: ${error.message}`);
    return (data ?? []).map((r) => ({
      id: r.id,
      label: r.label,
      dayOfWeek: r.day_of_week,
      startMinute: r.start_minute,
      endMinute: r.end_minute,
      location: r.location ?? undefined,
    }));
  }

  async saveCommitment(input: Omit<Commitment, 'id'> & { id?: string }): Promise<Commitment> {
    const row = {
      label: input.label,
      day_of_week: input.dayOfWeek,
      start_minute: input.startMinute,
      end_minute: input.endMinute,
      location: input.location ?? null,
    };
    const { data, error } = await this.client
      .from('commitments')
      .insert(row)
      .select()
      .single();
    if (error) throw new PersistenceError(`Failed to save commitment: ${error.message}`);
    return {
      id: data.id,
      label: data.label,
      dayOfWeek: data.day_of_week,
      startMinute: data.start_minute,
      endMinute: data.end_minute,
      location: data.location ?? undefined,
    };
  }

  async deleteCommitment(id: string): Promise<void> {
    const { error } = await this.client.from('commitments').delete().eq('id', id);
    if (error) throw new PersistenceError(`Failed to delete commitment: ${error.message}`);
  }

  async appendAudit(entry: Omit<AuditEntry, 'id' | 'createdAt'>): Promise<AuditEntry> {
    // Append-only: the schema grants no UPDATE or DELETE on this table.
    const { data, error } = await this.client
      .from('audit_log')
      .insert({
        case_id: entry.caseId,
        resolution_id: entry.resolutionId,
        actor: entry.actor,
        action: entry.action,
        payload: entry.payload,
      })
      .select()
      .single();
    if (error) throw new PersistenceError(`Failed to append audit entry: ${error.message}`);
    return {
      id: String(data.id),
      caseId: data.case_id,
      resolutionId: data.resolution_id,
      actor: data.actor,
      action: data.action,
      payload: data.payload,
      createdAt: data.created_at,
    };
  }

  async listAudit(resolutionId: string): Promise<AuditEntry[]> {
    const { data, error } = await this.client
      .from('audit_log')
      .select()
      .eq('resolution_id', resolutionId)
      .order('created_at');
    if (error) throw new PersistenceError(`Failed to load audit log: ${error.message}`);
    return (data ?? []).map((r) => ({
      id: String(r.id),
      caseId: r.case_id,
      resolutionId: r.resolution_id,
      actor: r.actor,
      action: r.action,
      payload: r.payload,
      createdAt: r.created_at,
    }));
  }

  private mapCase(row: CaseRow): CaseRecord {
    return {
      id: row.id,
      supplierName: row.supplier_name,
      orderRef: row.order_ref,
      cancellationReason: row.cancellation_reason,
      cancelledOn: row.cancelled_on,
      rawInput: row.raw_input ?? undefined,
      createdAt: row.created_at,
    };
  }

  private mapResolution(row: ResolutionRow): Resolution {
    return {
      id: row.id,
      caseId: row.case_id,
      status: row.status,
      totalRefundSen: row.total_refund_sen,
      contentHash: row.content_hash,
      affected: row.affected,
      drafts: row.drafts,
      plan: row.plan,
      conflicts: row.conflicts,
      toolTrace: row.tool_trace,
      warnings: row.warnings,
      createdAt: row.created_at,
      approvedAt: row.approved_at ?? undefined,
    };
  }
}
