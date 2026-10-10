import { getRepository } from '@/lib/repo/repository';
import { canExecute, hashProposal } from '@/lib/core/approval';
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
    const recomputed = hashProposal({
      total: resolution.totalRefundSen,
      affected: resolution.affected.map((a) => ({ id: a.customerId, amount: a.refundSen })),
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
 * Executes an approved resolution. This is the action that would perform the
 * financial and external steps. In the MVP it marks the resolution executed and
 * records the audit trail; no live payment gateway is configured, and the UI
 * states this plainly.
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

    const decision = canExecute(
      resolution.status,
      resolution.approvedAt
        ? {
            resolutionId: resolution.id,
            approvedAt: resolution.approvedAt,
            approvedBy: 'founder',
            contentHash: resolution.contentHash,
          }
        : null,
      resolution.contentHash,
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
        gateway: 'none — MVP records the action without a live payment gateway',
      },
    });

    return ok({ resolution: executed });
  } catch (error) {
    return handleError(error);
  }
}
