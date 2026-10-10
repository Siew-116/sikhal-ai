/**
 * refundkey.ts — the deterministic identity of a refund.
 *
 * WHY A KEY AT ALL
 *
 * Uniqueness on (resolution_id, customer_id) only prevents a duplicate refund
 * *within one proposal*. The dangerous case is a *second proposal* for the same
 * supplier cancellation — the founder re-runs the agent, approves the new
 * proposal, and the same customer is refunded twice for one cancelled order.
 * Nothing in the per-resolution constraint catches that.
 *
 * The fix is to give every refund a deterministic identity derived from the
 * business facts, not from the surrounding proposal. Two runs over the same
 * cancellation produce the same key, so the database can refuse the second one
 * while still allowing the same customer to be refunded for a *different*
 * cancellation.
 *
 * The key is a SHA-256 over:
 *   order reference | customer id | supplier event | the cancelled line facts
 *
 * It deliberately excludes anything that varies between runs (timestamps,
 * resolution ids, proposal totals) so that re-running the agent is idempotent
 * by construction.
 */

import { sha256Hex } from './sha256';
import { assertSen, type Sen } from './money';

export interface RefundKeyInput {
  /** The business order reference, e.g. "GB-2024-014". */
  orderRef: string;
  customerId: string;
  /**
   * Identifies the supplier-cancellation event. Two refunds for the same
   * customer are duplicates only if they belong to the same event.
   */
  supplierUpdateId: string;
  /** The cancelled lines this refund covers, in any order. */
  lines: ReadonlyArray<{ itemName: string; quantity: number; unitPriceSen: Sen }>;
}

/**
 * Compute the deterministic refund key.
 *
 * Lines are sorted and canonicalised before hashing so that a different
 * iteration order over the same set of lines yields the same key.
 */
export function refundKey(input: RefundKeyInput): string {
  for (const line of input.lines) {
    assertSen(line.unitPriceSen, `unitPriceSen for ${line.itemName}`);
  }

  const canonicalLines = [...input.lines]
    .map((l) => `${l.itemName}\u0000${l.quantity}\u0000${l.unitPriceSen}`)
    .sort();

  const canonical = [
    `order:${input.orderRef}`,
    `customer:${input.customerId}`,
    `event:${input.supplierUpdateId}`,
    `lines:${canonicalLines.join('\u0001')}`,
  ].join('\u0002');

  return sha256Hex(canonical);
}
