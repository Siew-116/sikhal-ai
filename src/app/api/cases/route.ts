import { getRepository } from '@/lib/repo/repository';
import { runResolutionPipeline } from '@/lib/tools/pipeline';
import { hashProposal } from '@/lib/core/approval';
import { ok, handleError, fail } from '@/lib/api';
import type { Commitment } from '@/lib/core/conflict';
import { DEMO_COMMITMENTS } from '@/lib/fixtures';

/**
 * POST /api/cases
 *
 * Creates a case, runs the resolution agent, and persists the resulting
 * draft resolution. Returns the case id and the resolution for the UI.
 *
 * The pipeline runs server-side so the money math never executes in the
 * browser — a client could be tampered with; the server is the source of truth.
 */
export async function POST(request: Request) {
  try {
    const body = await request.json();
    const repo = await getRepository();

    const {
      supplierName,
      orderRef,
      cancellationReason,
      cancelledOn,
      orderLines,
      payments,
    } = body ?? {};

    if (!Array.isArray(orderLines) || orderLines.length === 0) {
      return fail('At least one affected order record is required.', 400);
    }
    if (!Array.isArray(payments)) {
      return fail('Payments must be an array.', 400);
    }

    const created = await repo.createCase({
      supplierName,
      orderRef,
      cancellationReason,
      cancelledOn,
      orderLines,
      payments,
    });

    // Academic commitments come from the database. For the demo path we seed
    // the fixture set when the founder has none recorded, so the Study
    // Protection feature has something real to check against.
    let commitments: Commitment[] = await repo.listCommitments();
    let seededDemoCommitments = false;
    if (commitments.length === 0) {
      for (const c of DEMO_COMMITMENTS) {
        await repo.saveCommitment(c);
      }
      commitments = await repo.listCommitments();
      seededDemoCommitments = true;
    }

    const result = await runResolutionPipeline({
      supplierName,
      orderRef,
      cancellationReason,
      cancelledOn,
      orderLines,
      payments,
      commitments,
    });

    const contentHash = hashProposal({
      total: result.totalRefundSen,
      affected: result.affected.map((a) => ({ id: a.customerId, amount: a.refundSen })),
    });

    const resolution = await repo.saveResolution({
      caseId: created.id,
      affected: result.affected,
      totalRefundSen: result.totalRefundSen,
      drafts: result.drafts,
      plan: result.plan,
      conflicts: result.conflicts,
      toolTrace: result.toolTrace,
      warnings: result.warnings,
      contentHash,
    });

    await repo.appendAudit({
      caseId: created.id,
      resolutionId: resolution.id,
      actor: 'agent',
      action: 'resolution.proposed',
      payload: {
        totalRefundSen: result.totalRefundSen,
        customers: result.affected.length,
        conflicts: result.conflicts.length,
      },
    });

    return ok({ case: created, resolution, seededDemoCommitments }, 201);
  } catch (error) {
    return handleError(error);
  }
}

/** GET /api/cases — list cases, most recent first. */
export async function GET() {
  try {
    const repo = await getRepository();
    const cases = await repo.listCases();
    return ok({ cases });
  } catch (error) {
    return handleError(error);
  }
}
