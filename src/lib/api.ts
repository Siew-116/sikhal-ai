/**
 * api.ts — shared helpers for route handlers.
 *
 * Centralises error handling so every route returns a consistent, informative
 * JSON error shape rather than leaking a stack trace or failing opaquely.
 */

import { NextResponse } from 'next/server';
import { ApprovalError, PersistenceError } from '@/lib/repo/errors';
import { PipelineError } from '@/lib/tools/pipeline';

export function ok<T>(data: T, init?: number) {
  return NextResponse.json(data, { status: init ?? 200 });
}

export function fail(message: string, status = 400, detail?: unknown) {
  return NextResponse.json({ error: message, detail }, { status });
}

/**
 * Map a thrown error to an HTTP response with a useful status code.
 *
 * The distinction matters to the UI: a validation problem is the user's to fix
 * (400), an approval violation is a safety refusal (409), and an unexpected
 * failure is a server error (500).
 */
export function handleError(error: unknown) {
  if (error instanceof ApprovalError) {
    return fail(error.message, 409);
  }
  if (error instanceof PersistenceError) {
    return fail(error.message, 500);
  }
  if (error instanceof PipelineError) {
    return NextResponse.json(
      {
        error: error.message,
        toolTrace: error.trace,
      },
      { status: 422 },
    );
  }
  if (error instanceof Error) {
    return fail(error.message, 400);
  }
  return fail('An unexpected error occurred.', 500, String(error));
}
