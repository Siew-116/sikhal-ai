import { getRepository } from '@/lib/repo/repository';
import { ok, handleError, fail } from '@/lib/api';

/** GET /api/cases/[id] — case plus its resolution, for Screen 2. */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    const repo = await getRepository();

    const caseRecord = await repo.getCase(id);
    if (!caseRecord) return fail('Case not found.', 404);

    const resolution = await repo.getResolutionForCase(id);
    const commitments = await repo.listCommitments();
    const audit = resolution ? await repo.listAudit(resolution.id) : [];

    return ok({
      case: caseRecord,
      resolution,
      commitments,
      audit,
      storage: repo.describe(),
    });
  } catch (error) {
    return handleError(error);
  }
}
