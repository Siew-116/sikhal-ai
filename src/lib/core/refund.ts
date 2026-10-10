/**
 * refund.ts — deterministic refund allocation for supplier cancellations.
 *
 * THE CENTRAL PROBLEM this module solves:
 *
 * When a supplier cancels, the founder holds an amount of money that must be
 * returned to affected customers. Dividing that amount across N customers
 * almost never divides evenly. Integer division discards a remainder, which
 * means the sum of per-customer refunds would not equal the total refundable
 * amount — money would silently appear or vanish.
 *
 * The invariant that must hold is exact:
 *
 *     Σ lines[i].amountSen === totalRefundSen
 *
 * We enforce it with the **largest-remainder method** (Hamilton apportionment):
 *
 *   1. Compute each customer's exact proportional share as a rational.
 *   2. Give everyone their floor share.
 *   3. Distribute the leftover sen, one each, to the customers with the largest
 *      fractional remainders.
 *   4. Break ties deterministically by customer id (lexicographic ascending),
 *      so the same input always produces the same output.
 *
 * Step 4 is what makes this deterministic. Without a defined tie-break, two
 * runs on identical data could produce different refunds — which is
 * unacceptable for money.
 *
 * This module is pure: no I/O, no dependencies, no clock, no randomness.
 */

import { assertSen, assertNonNegativeSen, sumSen, type Sen } from './money';

export interface RefundInput {
  customerId: string;
  customerName: string;
  /** What this customer actually paid, in sen. */
  paidSen: Sen;
}

export interface RefundLine {
  customerId: string;
  customerName: string;
  /** The refund owed to this customer, in sen. */
  amountSen: Sen;
  /** What they paid, in sen. Invariant: amountSen <= paidSen. */
  paidSen: Sen;
}

export interface RefundAllocation {
  lines: RefundLine[];
  /** Invariant: sum(lines[].amountSen) === totalRefundSen */
  totalRefundSen: Sen;
}

export class RefundError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'RefundError';
  }
}

/**
 * Allocate a total refund amount across affected customers proportionally to
 * what each paid, distributing the indivisible remainder deterministically.
 *
 * @param customers  affected customers with their paid amounts
 * @param totalRefundSen  the total amount to refund, in sen.
 *                        Must not exceed the sum of what customers paid —
 *                        refunding more than was collected is impossible.
 */
export function allocateRefund(
  customers: RefundInput[],
  totalRefundSen: Sen,
): RefundAllocation {
  assertNonNegativeSen(totalRefundSen, 'totalRefundSen');

  if (customers.length === 0) {
    if (totalRefundSen !== 0) {
      throw new RefundError(
        `Cannot allocate ${totalRefundSen} sen across zero customers. ` +
          `There is nobody to refund.`,
      );
    }
    return { lines: [], totalRefundSen: 0 };
  }

  // Validate inputs up front — a bad input should never reach the arithmetic.
  for (const c of customers) {
    assertNonNegativeSen(c.paidSen, `paidSen for customer ${c.customerId}`);
  }

  const seen = new Set<string>();
  for (const c of customers) {
    if (seen.has(c.customerId)) {
      throw new RefundError(
        `Duplicate customer id "${c.customerId}" in refund input. ` +
          `Each customer must appear exactly once.`,
      );
    }
    seen.add(c.customerId);
  }

  const totalPaidSen = sumSen(customers.map((c) => c.paidSen));

  // The hard guard: you cannot refund more than was collected. This is also
  // enforced by a database check constraint — defence in depth, because this
  // is a money-loss bug if it ever slips through.
  if (totalRefundSen > totalPaidSen) {
    throw new RefundError(
      `Refund total ${totalRefundSen} sen exceeds total collected ${totalPaidSen} sen. ` +
        `Refunding more than was paid is not possible.`,
    );
  }

  // Nothing to refund — return zero lines so the case is still recorded.
  if (totalRefundSen === 0) {
    return {
      lines: customers.map((c) => ({
        customerId: c.customerId,
        customerName: c.customerName,
        amountSen: 0,
        paidSen: c.paidSen,
      })),
      totalRefundSen: 0,
    };
  }

  // Degenerate case: total collected is zero but a refund was requested.
  if (totalPaidSen === 0) {
    throw new RefundError(
      `Cannot allocate a refund of ${totalRefundSen} sen when no payments were recorded.`,
    );
  }

  // ── Step 1 & 2: exact proportional share, then floor ─────────────────
  // Work in scaled integers only. `paidSen * totalRefundSen` is exact integer
  // arithmetic; dividing by totalPaidSen gives an exact rational whose integer
  // part is the floor share, and whose fractional part we track explicitly.
  interface Scored {
    customer: RefundInput;
    share: Sen;
    remainder: number; // numerator of the fractional part: (paid * total) % totalPaid
  }

  const scored: Scored[] = customers.map((customer) => {
    const numerator = customer.paidSen * totalRefundSen;
    const share = Math.floor(numerator / totalPaidSen);
    const remainder = numerator % totalPaidSen;
    assertNonNegativeSen(share, `floor share for ${customer.customerId}`);
    return { customer, share, remainder };
  });

  const allocated = sumSen(scored.map((s) => s.share));
  let leftover = totalRefundSen - allocated;
  assertSen(leftover, 'leftover');

  // ── Step 3 & 4: distribute leftover by largest remainder ──────────────
  // Sorting is total and stable. Tie-break order per the finance spec §1.4:
  //   1. remainder descending  (largest fractional claim first)
  //   2. weight descending     (larger payer before smaller, so a tie is
  //                             settled in favour of the bigger stake)
  //   3. customerId ascending  (final deterministic disambiguator)
  // A fully specified comparator matters because Array.prototype.sort is only
  // stable for elements that compare EQUAL — without a total order, two runs
  // could disagree and the same input would produce different refunds.
  const byRemainder = [...scored].sort((a, b) => {
    if (b.remainder !== a.remainder) return b.remainder - a.remainder;
    if (b.customer.paidSen !== a.customer.paidSen) {
      return b.customer.paidSen - a.customer.paidSen;
    }
    return a.customer.customerId < b.customer.customerId ? -1 : 1;
  });

  const bonus = new Map<string, number>();
  for (let i = 0; i < leftover; i++) {
    const target = byRemainder[i];
    if (!target) {
      // Cannot happen: leftover < number of customers because each floor
      // discards strictly less than 1 sen. Guard anyway — fail loudly.
      throw new RefundError(
        `Internal error: leftover ${leftover} sen exceeded customer count ${customers.length}.`,
      );
    }
    bonus.set(target.customer.customerId, 1);
  }

  const lines: RefundLine[] = customers.map((customer) => {
    const entry = scored.find((s) => s.customer.customerId === customer.customerId)!;
    const amountSen = entry.share + (bonus.get(customer.customerId) ?? 0);
    assertNonNegativeSen(amountSen, `refund amount for ${customer.customerId}`);

    // Per-line guard: never refund an individual more than they paid.
    if (amountSen > customer.paidSen) {
      throw new RefundError(
        `Refund for ${customer.customerId} (${amountSen} sen) exceeds what they paid ` +
          `(${customer.paidSen} sen).`,
      );
    }

    return {
      customerId: customer.customerId,
      customerName: customer.customerName,
      amountSen,
      paidSen: customer.paidSen,
    };
  });

  // ── THE INVARIANT ────────────────────────────────────────────────────
  // Assert the money balances exactly. If this ever throws, a refund has been
  // mis-allocated and must not be persisted.
  const finalTotal = sumSen(lines.map((l) => l.amountSen));
  if (finalTotal !== totalRefundSen) {
    throw new RefundError(
      `Allocation invariant violated: distributed ${finalTotal} sen but ` +
        `expected ${totalRefundSen} sen. Refusing to return an unbalanced allocation.`,
    );
  }

  // Keep output ordering stable and human-friendly: descending refund amount,
  // tie-broken by customer id.
  lines.sort((a, b) => {
    if (b.amountSen !== a.amountSen) return b.amountSen - a.amountSen;
    return a.customerId < b.customerId ? -1 : 1;
  });

  return { lines, totalRefundSen };
}

/**
 * Compute the maximum refundable amount given recorded payments.
 *
 * A supplier cancellation refunds what customers paid for the cancelled lines.
 * This helper exists so the orchestration layer never has to invent the total.
 */
export function refundableTotal(customers: RefundInput[]): Sen {
  for (const c of customers) {
    assertNonNegativeSen(c.paidSen, `paidSen for customer ${c.customerId}`);
  }
  return sumSen(customers.map((c) => c.paidSen));
}
