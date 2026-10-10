import { getRepository } from '@/lib/repo/repository';
import { canExecute, proposalHashOf } from '@/lib/core/approval';
import { linesAreSafeToExecute } from '@/lib/core/approval';
import { ok, handleError, fail } from '@/lib/api';

/**
 * POST /api/resolutions/[id]/approve
 *
 * Records the founder's explicit approval. This is the ONLY route that can move
 * a resolution into the approved state, and it re-validates every refund line
 * server-side at approval time — the client's rendering is never trusted.
 *
 * Idempotent: approving an already-approved resolution returns the existing
 * record rather than creating a second approval.
 */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    const repo = await getRepository();

    const resolution = await repo.getResolution(id);
    if (!resolution) return fail('Resolution not found.', 404);

    const body = await request.json().catch(() => ({}));
    const { contentHash, approvedBy } = body ?? {};

    if (!contentHash) {
      return fail('A content hash is required so approval binds to what you reviewed.', 400);
    }

    // Server-side re-validation of every refund line before approval.
    const lineCheck = linesAreSafeToExecute(
      resolution.affected.map((a) => ({
        customerId: a.customerId,
        amountSen: a.refundSen,
        paidSen: a.paidSen,
      })),
    );
    if (!lineCheck.allowed) {
      return fail(`Cannot approve: ${lineCheck.reason}`, 409);
    }

    // Recompute the hash from stored content and compare. If the client's hash
    // disagrees with what is actually stored, something changed underneath.
    // Uses the same canonical function as the propose and execute paths.
    const recomputed = proposalHashOf({
      totalRefundSen: resolution.totalRefundSen,
      affected: resolution.affected.map((a) => ({
        customerId: a.customerId,
        refundSen: a.refundSen,
      })),
    });
    if (recomputed !== contentHash) {
      return fail(
        'This proposal has changed since it was displayed. Re-review before approving.',
        409,
      );
    }

    const approved = await repo.approveResolution(id, approvedBy ?? 'founder', contentHash);

    await repo.appendAudit({
      caseId: approved.caseId,
      resolutionId: approved.id,
      actor: approvedBy ?? 'founder',
      action: 'resolution.approved',
      payload: {
        totalRefundSen: approved.totalRefundSen,
        customers: approved.affected.length,
      },
    });

    return ok({ resolution: approved });
  } catch (error) {
    return handleError(error);
  }
}

/**
 * PUT /api/resolutions/[id]/approve
 *
 * Records an internal workflow milestone only. There is no live payment or
 * messaging gateway in this MVP. The legacy DB state 'executed' does NOT mean
 * money moved or messages were sent; display and audit must state this clearly.
 *
 * Guarantees:
 *   - fails closed unless the resolution is approved (H1)
 *   - compare-and-swap so a double-click cannot execute twice (T31/T32)
 *   - content-hash check so a changed proposal cannot be executed
 */
export async function PUT(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    const repo = await getRepository();

    const resolution = await repo.getResolution(id);
    if (!resolution) return fail('Resolution not found.', 404);

    // Recompute the hash from the content that is ACTUALLY STORED right now.
    //
    // This must not be `resolution.contentHash`. Passing the stored hash as both
    // the approved hash and the current hash makes the comparison below a
    // tautology (x === x), which silently disables the entire tamper defence:
    // an approved proposal could be mutated after approval and still execute.
    // Recomputing from live content is what makes the check real.
    const currentContentHash = proposalHashOf({
      totalRefundSen: resolution.totalRefundSen,
      affected: resolution.affected.map((a) => ({
        customerId: a.customerId,
        refundSen: a.refundSen,
      })),
    });

    const decision = canExecute(
      resolution.status,
      resolution.approvedAt
        ? {
            resolutionId: resolution.id,
            approvedAt: resolution.approvedAt,
            approvedBy: 'founder',
            // The hash the founder actually approved — the one stored at
            // approval time.
            contentHash: resolution.contentHash,
          }
        : null,
      // The hash of what we are about to execute.
      currentContentHash,
    );

    if (!decision.allowed) {
      return fail(`Cannot execute: ${decision.reason}`, 409);
    }

    const executed = await repo.markExecuted(id);

    await repo.appendAudit({
      caseId: executed.caseId,
      resolutionId: executed.id,
      actor: 'system',
      action: 'resolution.executed',
      payload: {
        totalRefundSen: executed.totalRefundSen,
        customers: executed.affected.length,
        gateway: 'none',
        paymentTransferred: false,
        messagesSent: false,
        meaning: 'internal_workflow_record_only',
      },
    });

    return ok({ resolution: executed });
  } catch (error) {
    return handleError(error);
  }
}
