import { getRepository } from '@/lib/repo/repository';
import { getEnvStatus } from '@/lib/env';
import { ok, handleError, fail } from '@/lib/api';

/** GET /api/commitments — the founder's academic commitments. */
export async function GET() {
  try {
    const repo = await getRepository();
    const commitments = await repo.listCommitments();
    return ok({ commitments });
  } catch (error) {
    return handleError(error);
  }
}

/**
 * POST /api/commitments — add a class or study commitment.
 *
 * Master prompt requires Study Protection using MANUALLY ENTERED commitments,
 * so this endpoint is real: it validates and persists.
 */
export async function POST(request: Request) {
  try {
    const repo = await getRepository();
    const body = await request.json();

    const { label, dayOfWeek, startMinute, endMinute, location } = body ?? {};

    if (!label || typeof label !== 'string' || label.trim() === '') {
      return fail('A label is required (e.g. "CS2040 Algorithms — Lecture").', 400);
    }
    if (!Number.isInteger(dayOfWeek) || dayOfWeek < 0 || dayOfWeek > 6) {
      return fail('dayOfWeek must be an integer from 0 (Sunday) to 6 (Saturday).', 400);
    }
    if (!Number.isInteger(startMinute) || startMinute < 0 || startMinute > 1439) {
      return fail('startMinute must be an integer from 0 to 1439.', 400);
    }
    if (!Number.isInteger(endMinute) || endMinute < 1 || endMinute > 1440) {
      return fail('endMinute must be an integer from 1 to 1440.', 400);
    }
    if (endMinute <= startMinute) {
      return fail('The commitment must end after it starts.', 400);
    }

    const commitment = await repo.saveCommitment({
      label: label.trim(),
      dayOfWeek,
      startMinute,
      endMinute,
      location: location?.trim() || undefined,
    });

    return ok({ commitment }, 201);
  } catch (error) {
    return handleError(error);
  }
}

/** DELETE /api/commitments?id=... — remove a commitment. */
export async function DELETE(request: Request) {
  try {
    const repo = await getRepository();
    const id = new URL(request.url).searchParams.get('id');
    if (!id) return fail('An id query parameter is required.', 400);
    await repo.deleteCommitment(id);
    return ok({ deleted: id });
  } catch (error) {
    return handleError(error);
  }
}

/** Exposed for the UI status indicator. */
export async function OPTIONS() {
  return ok({ env: getEnvStatus() });
}
