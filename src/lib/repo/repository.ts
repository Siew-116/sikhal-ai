/**
 * repository.ts — the persistence boundary.
 *
 * Two implementations behind one interface:
 *   - SupabaseRepository  — real Postgres persistence (used when configured)
 *   - MemoryRepository    — in-memory adapter for demo mode and tests
 *
 * The adapter is chosen by configuration, never by a code change, which is the
 * master prompt's requirement: "ensure the application can later connect to
 * Supabase through environment variables without major changes."
 *
 * IMPORTANT: the MemoryRepository is NOT mock data. It is a real store with the
 * same semantics, holding real records written by real user actions. It is
 * clearly labelled as "session storage" in the UI so nobody mistakes it for
 * durable persistence. When Supabase credentials are supplied, the identical
 * code path writes to Postgres.
 */

import { getSupabaseConfig } from '@/lib/env';
import type { CaseRecord, CaseWithResolution, Resolution } from '@/lib/types';
import type { Commitment } from '@/lib/core/conflict';
import type { FixtureOrderLine, FixturePayment } from '@/lib/fixtures';

export interface CreateCaseInput {
  supplierName: string;
  orderRef: string;
  cancellationReason: string;
  cancelledOn: string;
  rawInput?: string;
  orderLines: FixtureOrderLine[];
  payments: FixturePayment[];
}

export interface AuditEntry {
  id: string;
  caseId: string | null;
  resolutionId: string | null;
  actor: string;
  action: string;
  payload: Record<string, unknown>;
  createdAt: string;
}

export interface Repository {
  readonly kind: 'supabase' | 'memory';

  createCase(input: CreateCaseInput): Promise<CaseRecord>;
  getCase(caseId: string): Promise<CaseRecord | null>;
  listCases(): Promise<CaseRecord[]>;

  getOrderLines(caseId: string): Promise<FixtureOrderLine[]>;
  getPayments(caseId: string): Promise<FixturePayment[]>;

  saveResolution(input: {
    caseId: string;
    affected: Resolution['affected'];
    totalRefundSen: number;
    drafts: Resolution['drafts'];
    plan: Resolution['plan'];
    conflicts: Resolution['conflicts'];
    toolTrace: Resolution['toolTrace'];
    warnings: string[];
    contentHash: string;
  }): Promise<Resolution>;

  getResolution(resolutionId: string): Promise<Resolution | null>;
  getResolutionForCase(caseId: string): Promise<Resolution | null>;

  /** Idempotent: approving an already-approved resolution returns the existing record. */
  approveResolution(resolutionId: string, approvedBy: string, contentHash: string): Promise<Resolution>;

  /** Idempotent via compare-and-swap: a second call cannot double-execute. */
  markExecuted(resolutionId: string): Promise<Resolution>;

  listCommitments(): Promise<Commitment[]>;
  saveCommitment(input: Omit<Commitment, 'id'> & { id?: string }): Promise<Commitment>;
  deleteCommitment(id: string): Promise<void>;

  appendAudit(entry: Omit<AuditEntry, 'id' | 'createdAt'>): Promise<AuditEntry>;
  listAudit(resolutionId: string): Promise<AuditEntry[]>;

  /** Diagnostics surfaced in the UI header. */
  describe(): { kind: 'supabase' | 'memory'; label: string };
}

let cached: Repository | null = null;

/**
 * Resolve the repository. Supabase when configured, otherwise the in-memory
 * adapter. Cached so a single instance backs the process.
 */
export async function getRepository(): Promise<Repository> {
  if (cached) return cached;

  const config = getSupabaseConfig();
  if (config) {
    const { SupabaseRepository } = await import('./repository.supabase');
    cached = new SupabaseRepository(config);
  } else {
    const { MemoryRepository } = await import('./repository.memory');
    cached = new MemoryRepository();
  }
  return cached;
}

/** Test helper — reset the cached adapter. */
export function resetRepository(): void {
  cached = null;
}

export type { CaseWithResolution };
