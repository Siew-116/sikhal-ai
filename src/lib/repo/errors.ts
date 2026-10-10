/** Shared repository errors. */

export class ApprovalError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ApprovalError';
  }
}

export class PersistenceError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PersistenceError';
  }
}

/**
 * A data-integrity rule refused the write: the lines did not sum to the total,
 * the refund exceeded what was collected, or this refund already exists.
 *
 * Distinct from PersistenceError because it maps to HTTP 409, not 500. The
 * request conflicted with existing state — the server did not fail. A client
 * seeing 500 would reasonably retry; retrying a duplicate refund is exactly
 * what must NOT happen.
 */
export class IntegrityError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'IntegrityError';
  }
}
