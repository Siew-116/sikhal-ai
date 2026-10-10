/**
 * approval.ts — human-approval gating for financial and external actions.
 *
 * THE RULE: nothing financial and nothing customer-facing happens without an
 * explicit, recorded human approval. This is a product requirement, and it is
 * enforced here as a pure predicate that the execution path must consult — not
 * as a UI convention that a direct API call could bypass.
 *
 * THE CONTENT-HASH DEFENCE:
 *
 * Approval binds to a hash of the exact proposal content that was approved.
 * This closes a real and subtle bug class: the founder approves a refund of
 * RM120 across three customers, the underlying records then change (a payment
 * is corrected, the agent re-runs), and execution proceeds against content that
 * was never approved.
 *
 * If the hash at execution time does not match the hash that was approved, the
 * action fails closed. The founder must re-approve.
 *
 * CRITICAL IMPLEMENTATION RULE — the hash must be computed from the SAME
 * canonical function at all three call sites (propose, approve, execute).
 * Passing a stored hash as the "current" hash makes the comparison a tautology,
 * which silently disables the entire defence. `proposalHashOf` exists to be the
 * single source of truth for that computation; callers must use it rather than
 * building the hash input inline.
 *
 * This module is pure: no I/O, no dependencies on the clock.
 */

import { assertSen, type Sen } from './money';
import { sha256Hex } from './sha256';

export type ResolutionStatus =
  | 'draft'
  | 'approved'
  | 'executing'
  | 'executed'
  | 'failed';

export interface Approval {
  resolutionId: string;
  approvedAt: string; // ISO-8601
  approvedBy: string;
  /** Hash of the proposal content that was approved. */
  contentHash: string;
}

export interface ApprovalDecision {
  allowed: boolean;
  reason: string;
}

/**
 * May this resolution be executed right now?
 *
 * Fails closed: any doubt — wrong status, missing approval, mismatched hash —
 * returns `allowed: false`.
 */
export function canExecute(
  status: ResolutionStatus,
  approval: Approval | null,
  currentContentHash: string,
): ApprovalDecision {
  if (status === 'draft') {
    return {
      allowed: false,
      reason: 'This resolution has not been approved yet.',
    };
  }

  if (status === 'executing') {
    return {
      allowed: false,
      reason: 'This resolution is already executing. Refusing to run it twice.',
    };
  }

  if (status === 'executed') {
    return {
      allowed: false,
      reason: 'This resolution has already been executed.',
    };
  }

  if (status === 'failed') {
    return {
      allowed: false,
      reason: 'This resolution previously failed and must be reviewed before retrying.',
    };
  }

  if (status !== 'approved') {
    return {
      allowed: false,
      reason: `Unrecognised resolution status "${status}".`,
    };
  }

  if (!approval) {
    return {
      allowed: false,
      reason: 'No approval record found for an approved resolution. Refusing to execute.',
    };
  }

  if (approval.contentHash !== currentContentHash) {
    return {
      allowed: false,
      reason:
        'The proposal has changed since it was approved. ' +
        'Re-review and approve the current version before executing.',
    };
  }

  return { allowed: true, reason: 'Approved and unchanged.' };
}

/**
 * May an approval be recorded for this resolution?
 *
 * Guards against approving something already in flight or finished, which would
 * otherwise reset state in a confusing way.
 */
export function canApprove(status: ResolutionStatus): ApprovalDecision {
  switch (status) {
    case 'draft':
      return { allowed: true, reason: 'Ready for review.' };
    case 'failed':
      return {
        allowed: true,
        reason: 'Previously failed; may be re-approved after review.',
      };
    case 'approved':
      return { allowed: false, reason: 'This resolution is already approved.' };
    case 'executing':
      return { allowed: false, reason: 'This resolution is currently executing.' };
    case 'executed':
      return { allowed: false, reason: 'This resolution has already been executed.' };
    default:
      return { allowed: false, reason: `Unrecognised status "${status}".` };
  }
}

/**
 * Is every proposed refund line within a resolution safe to act on?
 *
 * A resolution must not be executable while any line would over-refund. This is
 * the application-level counterpart to the database check constraint.
 */
export function linesAreSafeToExecute(
  lines: Array<{ customerId: string; amountSen: Sen; paidSen: Sen }>,
): ApprovalDecision {
  for (const line of lines) {
    assertSen(line.amountSen, `amountSen for ${line.customerId}`);
    assertSen(line.paidSen, `paidSen for ${line.customerId}`);

    if (line.amountSen < 0) {
      return {
        allowed: false,
        reason: `Refund for ${line.customerId} is negative (${line.amountSen} sen).`,
      };
    }
    if (line.amountSen > line.paidSen) {
      return {
        allowed: false,
        reason:
          `Refund for ${line.customerId} (${line.amountSen} sen) exceeds what they paid ` +
          `(${line.paidSen} sen).`,
      };
    }
  }
  return { allowed: true, reason: 'All refund lines are within recorded payments.' };
}

/**
 * Compute a stable content hash for a proposal.
 *
 * Uses SHA-256 over a canonical JSON serialisation. Earlier versions used a
 * 32-bit FNV-1a hash; that was the wrong primitive for an integrity control,
 * because a 2^32 output space is collidable and a collision would let a
 * different proposal satisfy an approval. SHA-256 makes that infeasible.
 *
 * Object keys are sorted so key ordering never affects the digest.
 */
export function hashProposal(input: unknown): string {
  return sha256Hex(canonicalise(input));
}

/**
 * The canonical hash input for a resolution proposal.
 *
 * This is the SINGLE source of truth for what "the approved content" means.
 * Every call site that hashes a proposal — when the agent proposes it, when the
 * founder approves it, and when we verify it before executing — must go through
 * this function. If the three sites ever disagree about the shape of the input,
 * approval either silently fails every time or, worse, silently succeeds against
 * content that was never reviewed.
 *
 * Keep this shape minimal and stable: the amount each customer is refunded, and
 * the total. Formatting, drafts and wording are deliberately excluded — a
 * typo fix in a message template must not invalidate an approved refund.
 */
export function proposalHashOf(input: {
  totalRefundSen: Sen;
  affected: ReadonlyArray<{ customerId: string; refundSen: Sen }>;
}): string {
  const affected = [...input.affected]
    .map((a) => ({ id: a.customerId, amount: a.refundSen }))
    // Sort by customer id so the digest does not depend on row order.
    .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  return hashProposal({ total: input.totalRefundSen, affected });
}

function canonicalise(value: unknown): string {
  if (value === null || typeof value !== 'object') {
    return JSON.stringify(value) ?? 'null';
  }
  if (Array.isArray(value)) {
    return `[${value.map(canonicalise).join(',')}]`;
  }
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, v]) => v !== undefined)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonicalise(v)}`).join(',')}}`;
}
