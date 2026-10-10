/**
 * repository.memory.ts — in-memory persistence adapter.
 *
 * Used for demo mode (no Supabase credentials) and for automated tests. It
 * implements the SAME interface and the SAME guarantees as the Supabase
 * adapter, including:
 *
 *   - duplicate-refund prevention (a resolution cannot be approved twice)
 *   - compare-and-swap execution (a double-click cannot execute twice)
 *   - an append-only audit log
 *
 * Because the guarantees are implemented against the interface, the tests that
 * exercise them here remain valid when the Supabase adapter is swapped in —
 * with the caveat (documented in the finance spec §6.3) that the DATABASE-level
 * constraint should also be verified against real Postgres. That verification
 * is listed as a remaining item for Phase 4.
 */

import { randomUUID } from 'node:crypto';
import type {
  AuditEntry,
  CreateCaseInput,
  Repository,
} from './repository';
import type { CaseRecord, Resolution } from '@/lib/types';
import type { Commitment } from '@/lib/core/conflict';
import type { FixtureOrderLine, FixturePayment } from '@/lib/fixtures';
import { ApprovalError, IntegrityError } from './errors';

interface StoredCase {
  record: CaseRecord;
  orderLines: FixtureOrderLine[];
  payments: FixturePayment[];
}

export class MemoryRepository implements Repository {
  readonly kind = 'memory' as const;

  private cases = new Map<string, StoredCase>();
  private resolutions = new Map<string, Resolution>();
  private commitments = new Map<string, Commitment>();
  private audit: AuditEntry[] = [];

  describe() {
    return {
      kind: 'memory' as const,
      label: 'Session storage — data lives in this server process only',
    };
  }

  async createCase(input: CreateCaseInput): Promise<CaseRecord> {
    const id = randomUUID();
    const record: CaseRecord = {
      id,
      supplierName: input.supplierName,
      orderRef: input.orderRef,
      cancellationReason: input.cancellationReason,
      cancelledOn: input.cancelledOn,
      rawInput: input.rawInput,
      createdAt: new Date().toISOString(),
    };
    this.cases.set(id, { record, orderLines: input.orderLines, payments: input.payments });
    return record;
  }

  async getCase(caseId: string): Promise<CaseRecord | null> {
    return this.cases.get(caseId)?.record ?? null;
  }

  async listCases(): Promise<CaseRecord[]> {
    return [...this.cases.values()]
      .map((c) => c.record)
      .sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
  }

  async getOrderLines(caseId: string): Promise<FixtureOrderLine[]> {
    return this.cases.get(caseId)?.orderLines ?? [];
  }

  async getPayments(caseId: string): Promise<FixturePayment[]> {
    return this.cases.get(caseId)?.payments ?? [];
  }

  async saveResolution(
    input: Parameters<Repository['saveResolution']>[0],
  ): Promise<Resolution> {
    // ── Data-layer invariants, mirroring write_resolution_atomic() in SQL ──
    //
    // These are the same three checks the Postgres function performs. Keeping
    // them identical in both adapters is the point: a test that passes against
    // this adapter must describe real production behaviour, not a friendlier
    // in-process approximation.

    // (a) The lines must sum to the declared total. A dropped or duplicated sen
    //     would otherwise be invisible until a customer complained.
    const lineTotal = input.affected.reduce((sum, a) => sum + a.refundSen, 0);
    if (lineTotal !== input.totalRefundSen) {
      throw new IntegrityError(
        `Refund lines sum to ${lineTotal} sen but the resolution total is ` +
          `${input.totalRefundSen} sen. Refusing to persist an inconsistent proposal.`,
      );
    }

    // (b) Never refund more than the case actually collected.
    const payments = await this.getPayments(input.caseId);
    const collected = payments.reduce((sum, p) => sum + p.amountSen, 0);
    const refundablePaid = input.affected.reduce((sum, a) => sum + a.paidSen, 0);
    if (refundablePaid > collected) {
      throw new IntegrityError(
        `Total refundable paid (${refundablePaid} sen) exceeds total collected ` +
          `(${collected} sen) for case ${input.caseId}.`,
      );
    }

    // (c) No duplicate customer within the batch.
    const seen = new Set<string>();
    for (const a of input.affected) {
      if (seen.has(a.customerId)) {
        throw new IntegrityError(
          `Refund batch contains a duplicate customer: ${a.customerId}.`,
        );
      }
      seen.add(a.customerId);
    }

    // (d) CROSS-RESOLUTION duplicate guard. A refund key that already appears in
    //     another resolution for the same supplier event means this customer has
    //     already been refunded for this cancellation — refuse rather than
    //     create a second identical liability.
    const existingKeys = this.executedRefundKeys();
    for (const a of input.affected) {
      if (!a.refundKey) continue;
      if (existingKeys.has(a.refundKey)) {
        throw new IntegrityError(
          `A refund for ${a.customerId} has already been recorded for this ` +
            `supplier cancellation (key ${a.refundKey.slice(0, 12)}…). ` +
            `Refusing to create a duplicate refund.`,
        );
      }
    }

    // Re-running the agent on the same case replaces the draft resolution
    // rather than accumulating duplicates. This is the memory-adapter
    // counterpart of 严核明's ON CONFLICT DO NOTHING semantics.
    const existing = await this.getResolutionForCase(input.caseId);
    if (existing && existing.status !== 'draft') {
      // A proposal that has already been approved or executed must not be
      // silently overwritten by a re-run.
      throw new ApprovalError(
        'This resolution has already been approved or executed and cannot be replaced by a new agent run.',
      );
    }

    const id = existing?.id ?? randomUUID();
    const resolution: Resolution = {
      id,
      caseId: input.caseId,
      status: 'draft',
      totalRefundSen: input.totalRefundSen,
      contentHash: input.contentHash,
      affected: input.affected,
      drafts: input.drafts,
      plan: input.plan,
      conflicts: input.conflicts,
      toolTrace: input.toolTrace,
      warnings: input.warnings,
      createdAt: new Date().toISOString(),
    };

    this.resolutions.set(id, resolution);
    return resolution;
  }

  /**
   * Every refund key already committed in an approved or executed resolution.
   *
   * Mirrors the partial unique indexes `refund_key_executed_uniq` and the
   * `status in ('paid','approved')` predicate in schema.sql.
   */
  private executedRefundKeys(): Set<string> {
    const keys = new Set<string>();
    for (const r of this.resolutions.values()) {
      if (r.status !== 'approved' && r.status !== 'executed') continue;
      for (const a of r.affected) {
        if (a.refundKey) keys.add(a.refundKey);
      }
    }
    return keys;
  }

  async getResolution(resolutionId: string): Promise<Resolution | null> {
    return this.resolutions.get(resolutionId) ?? null;
  }

  async getResolutionForCase(caseId: string): Promise<Resolution | null> {
    const matches = [...this.resolutions.values()].filter((r) => r.caseId === caseId);
    return matches.length > 0 ? matches[matches.length - 1] : null;
  }

  async approveResolution(
    resolutionId: string,
    approvedBy: string,
    contentHash: string,
  ): Promise<Resolution> {
    const resolution = this.resolutions.get(resolutionId);
    if (!resolution) throw new ApprovalError('Resolution not found.');

    // Duplicate-approval prevention: an already-approved resolution is returned
    // unchanged rather than re-approved. This is the idempotency guarantee.
    if (resolution.status === 'approved') return resolution;

    if (resolution.status !== 'draft' && resolution.status !== 'failed') {
      throw new ApprovalError(
        `Cannot approve a resolution in status "${resolution.status}".`,
      );
    }

    // The approval binds to the content the founder actually saw. If the stored
    // hash differs, the proposal changed underneath the approval and we refuse.
    if (resolution.contentHash !== contentHash) {
      throw new ApprovalError(
        'The proposal has changed since you reviewed it. Please re-review before approving.',
      );
    }

    const updated: Resolution = {
      ...resolution,
      status: 'approved',
      approvedAt: new Date().toISOString(),
    };
    this.resolutions.set(resolutionId, updated);
    return updated;
  }

  async markExecuted(resolutionId: string): Promise<Resolution> {
    const resolution = this.resolutions.get(resolutionId);
    if (!resolution) throw new ApprovalError('Resolution not found.');

    // Compare-and-swap: only an `approved` resolution may become `executed`.
    // A second call finds status !== 'approved' and is refused — this is what
    // makes a double-click safe.
    //
    // The refusal is an ERROR, not a silent success. This adapter must match the
    // Supabase adapter, which finds no row matching `status = 'approved'` on a
    // second call and throws. If one adapter swallowed the double-execute and
    // the other refused it, a test passing against memory would not describe
    // production behaviour — the divergence would only surface in a real
    // deployment, on the money path.
    if (resolution.status === 'executed') {
      throw new ApprovalError(
        'Cannot execute: This resolution has already been executed.',
      );
    }

    if (resolution.status !== 'approved') {
      throw new ApprovalError(
        `Refusing to execute: resolution is "${resolution.status}", not approved.`,
      );
    }

    const updated: Resolution = {
      ...resolution,
      status: 'executed',
      executedAt: new Date().toISOString(),
    };
    this.resolutions.set(resolutionId, updated);
    return updated;
  }

  async listCommitments(): Promise<Commitment[]> {
    return [...this.commitments.values()].sort((a, b) => {
      if (a.dayOfWeek !== b.dayOfWeek) return a.dayOfWeek - b.dayOfWeek;
      return a.startMinute - b.startMinute;
    });
  }

  async saveCommitment(input: Omit<Commitment, 'id'> & { id?: string }): Promise<Commitment> {
    const commitment: Commitment = { ...input, id: input.id ?? randomUUID() };
    this.commitments.set(commitment.id, commitment);
    return commitment;
  }

  async deleteCommitment(id: string): Promise<void> {
    this.commitments.delete(id);
  }

  async appendAudit(entry: Omit<AuditEntry, 'id' | 'createdAt'>): Promise<AuditEntry> {
    const record: AuditEntry = {
      ...entry,
      id: randomUUID(),
      createdAt: new Date().toISOString(),
    };
    this.audit.push(record);
    return record;
  }

  async listAudit(resolutionId: string): Promise<AuditEntry[]> {
    return this.audit.filter((a) => a.resolutionId === resolutionId);
  }
}
