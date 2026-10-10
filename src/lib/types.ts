/**
 * types.ts — shared domain types for the SikHal tool pipeline.
 *
 * Field naming is prescriptive and shared across the agent orchestration layer,
 * the API routes, and the UI. Mission-critical: `amountSen` is always integer
 * sen. There is no field in this system that holds money as a decimal.
 */

import type { Sen } from '@/lib/core/money';
import type { Conflict, Commitment } from '@/lib/core/conflict';
import type { ResolutionStatus, Approval } from '@/lib/core/approval';

export type { Sen, Conflict, Commitment, ResolutionStatus, Approval };

/** A customer's position on a case, after matching. */
export type AffectedStatus = 'refundable' | 'no_payment' | 'unattributed';

export interface AffectedCustomer {
  customerId: string;
  customerName: string;
  /** What they paid for affected lines, in sen. */
  paidSen: Sen;
  /** Proposed refund, in sen. Zero for non-refundable statuses. */
  refundSen: Sen;
  status: AffectedStatus;
  /** Human-readable explanation of the status, surfaced to the founder. */
  note?: string;
}

export interface MessageDraft {
  customerId: string;
  customerName: string;
  body: string;
  /** Was this produced by the AI, or by the deterministic fallback? */
  generatedBy: 'ai' | 'fallback';
}

export interface PlanStep {
  id: string;
  order: number;
  label: string;
  detail: string;
  /** Proposed execution window on the academic week grid. */
  dayOfWeek: number;
  startMinute: number;
  endMinute: number;
  /** Filled in by conflict checking. */
  blocked: boolean;
  conflictIds: string[];
  /**
   * Does this step occupy a proposed execution window that must be checked
   * against academic commitments? A step the founder performs inside the app
   * (e.g. "review refunds") has no execution slot and sets this to false.
   */
  hasSlot?: boolean;
  /** Suggested alternative when blocked, if one exists. */
  alternative?: { dayOfWeek: number; startMinute: number; endMinute: number };
}

export type ToolStatus = 'pending' | 'running' | 'ok' | 'error';

export interface ToolTraceEntry {
  tool: string;
  /** Plain-language label shown to the founder. */
  label: string;
  status: ToolStatus;
  /** Short human-readable summary of what the tool found. */
  summary?: string;
  durationMs: number;
  error?: string;
}

export interface Resolution {
  id: string;
  caseId: string;
  status: ResolutionStatus;
  totalRefundSen: Sen;
  contentHash: string;
  affected: AffectedCustomer[];
  drafts: MessageDraft[];
  plan: PlanStep[];
  conflicts: Conflict[];
  toolTrace: ToolTraceEntry[];
  warnings: string[];
  createdAt: string;
  approvedAt?: string;
}

export interface CaseRecord {
  id: string;
  supplierName: string;
  orderRef: string;
  cancellationReason: string;
  cancelledOn: string;
  rawInput?: string;
  createdAt: string;
}

/** The persisted shape of everything needed to render Screen 2. */
export interface CaseWithResolution {
  case: CaseRecord;
  resolution: Resolution | null;
}
