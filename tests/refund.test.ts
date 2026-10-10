/**
 * refund.test.ts — the allocation kernel and its invariants.
 *
 * Covers 严核明's test plan T09–T20 and the worked examples §1.8.
 * The invariant asserted throughout is A1: Σ refunds === total, exactly.
 */

import { describe, it, expect } from 'vitest';
import { allocateRefund, refundableTotal, RefundError } from '@/lib/core/refund';
import type { RefundInput } from '@/lib/core/refund';

function customers(...paidSen: number[]): RefundInput[] {
  return paidSen.map((sen, i) => ({
    customerId: `CUST-${String(i + 1).padStart(3, '0')}`,
    customerName: `Customer ${i + 1}`,
    paidSen: sen,
  }));
}

function totalOf(lines: Array<{ amountSen: number }>): number {
  return lines.reduce((sum, l) => sum + l.amountSen, 0);
}

describe('worked examples from the finance spec', () => {
  it('Example 1 — even split, clean: 9000 across 3 equal payers', () => {
    const result = allocateRefund(customers(3000, 3000, 3000), 9000);
    expect(result.lines.map((l) => l.amountSen)).toEqual([3000, 3000, 3000]);
    expect(totalOf(result.lines)).toBe(9000);
  });

  it('T10 / Example 2 — the canonical remainder: RM100 across 3', () => {
    // Weights are 1 sen each so the split is even; T = 10000 sen.
    const result = allocateRefund(customers(1, 1, 1), 3);
    // Trivial: 1 sen each.
    expect(totalOf(result.lines)).toBe(3);

    // The real Example 2: three payers of RM100 each, pool RM100.
    const big = allocateRefund(customers(10000, 10000, 10000), 10000);
    expect(big.lines.map((l) => l.amountSen).sort((a, b) => b - a)).toEqual([3334, 3333, 3333]);
    expect(totalOf(big.lines)).toBe(10000);
  });

  it('Example 2 restated — RM100 split three ways must still sum to RM100.00', () => {
    const equal = allocateRefund(
      customers(10000, 10000, 10000).map((c, i) => ({ ...c, paidSen: 10000 })),
      10000,
    );
    expect(totalOf(equal.lines)).toBe(10000);
  });

  it('T11 / Example 3 — RM100 across 7 equal payers', () => {
    const seven = customers(...Array(7).fill(10000));
    const result = allocateRefund(seven, 10000);
    const amounts = result.lines.map((l) => l.amountSen).sort((a, b) => b - a);
    expect(amounts).toEqual([1429, 1429, 1429, 1429, 1428, 1428, 1428]);
    expect(totalOf(result.lines)).toBe(10000);
  });

  it('T12 / Example 4 — proportional weights with remainder', () => {
    const result = allocateRefund(customers(5000, 3000, 2000), 9999);
    const byId = new Map(result.lines.map((l) => [l.customerId, l.amountSen]));
    expect(byId.get('CUST-001')).toBe(4999);
    expect(byId.get('CUST-002')).toBe(3000);
    expect(byId.get('CUST-003')).toBe(2000);
    expect(totalOf(result.lines)).toBe(9999);
  });

  it('T13 / Example 5 — zero pool yields all zeros, no error', () => {
    const result = allocateRefund(customers(2500, 0), 0);
    expect(result.lines.map((l) => l.amountSen)).toEqual([0, 0]);
    expect(result.totalRefundSen).toBe(0);
  });

  it('T14 / Example 6 — one zero-weight customer, non-zero pool', () => {
    const result = allocateRefund(customers(5000, 0), 1000);
    const byId = new Map(result.lines.map((l) => [l.customerId, l.amountSen]));
    expect(byId.get('CUST-001')).toBe(1000);
    expect(byId.get('CUST-002')).toBe(0);
    expect(totalOf(result.lines)).toBe(1000);
  });
});

describe('invariant A1 — conservation (property test over many inputs)', () => {
  it('T16 sums exactly to the requested total across 1000 cases', () => {
    // Deterministic pseudo-random generator so the test is reproducible.
    let seed = 12345;
    const rand = (max: number) => {
      seed = (seed * 1103515245 + 12345) & 0x7fffffff;
      return seed % max;
    };

    for (let i = 0; i < 1000; i++) {
      const n = 1 + rand(8);
      const paid = Array.from({ length: n }, () => 1 + rand(20000));
      const totalPaid = paid.reduce((a, b) => a + b, 0);
      const T = rand(totalPaid + 1); // 0..totalPaid

      const result = allocateRefund(customers(...paid), T);
      expect(totalOf(result.lines)).toBe(T);
    }
  });
});

describe('invariant A4 — determinism', () => {
  it('T17 identical input produces identical output', () => {
    const input = customers(5000, 3000, 2000);
    const a = allocateRefund(input, 7777);
    const b = allocateRefund(input, 7777);
    expect(a).toEqual(b);
  });

  it('T18 tie-break is stable: equal remainder, equal weight, lower id wins', () => {
    // Three identical payers, pool that leaves 1 sen over.
    const result = allocateRefund(customers(100, 100, 100), 100);
    // 100/3 = 33 remainder 1 each; leftover 1 → CUST-001 gets it.
    const byId = new Map(result.lines.map((l) => [l.customerId, l.amountSen]));
    expect(byId.get('CUST-001')).toBe(34);
    expect(byId.get('CUST-002')).toBe(33);
    expect(byId.get('CUST-003')).toBe(33);
  });

  it('T18b exact weights divide cleanly with no leftover to allocate', () => {
    // Not a tie case — recorded to pin down the clean-division path so a future
    // change to the comparator cannot silently start redistributing a sen.
    const input = [
      { customerId: 'ZZZ-heavy', customerName: 'Heavy', paidSen: 200 },
      { customerId: 'AAA-light', customerName: 'Light', paidSen: 100 },
    ];
    const result = allocateRefund(input, 150);
    const byId = new Map(result.lines.map((l) => [l.customerId, l.amountSen]));
    expect(byId.get('ZZZ-heavy')).toBe(100);
    expect(byId.get('AAA-light')).toBe(50);
  });

  it('T18c larger remainder wins regardless of weight, and conservation holds', () => {
    // paid 300 and 200, pool 251:
    //   300/500*251 = 150.6 -> floor 150, remainder 3
    //   200/500*251 = 100.4 -> floor 100, remainder 2
    // The heavier payer also has the larger remainder, so remainder decides.
    const input = [
      { customerId: 'ZZZ-heavy', customerName: 'Heavy', paidSen: 300 },
      { customerId: 'AAA-light', customerName: 'Light', paidSen: 200 },
    ];
    const result = allocateRefund(input, 251);
    const byId = new Map(result.lines.map((l) => [l.customerId, l.amountSen]));
    expect(byId.get('ZZZ-heavy')).toBe(151);
    expect(byId.get('AAA-light')).toBe(100);
    // Conservation holds regardless of who wins the tie.
    expect((byId.get('ZZZ-heavy') ?? 0) + (byId.get('AAA-light') ?? 0)).toBe(251);
  });

  it('the tie-break is fully deterministic across shuffled input', () => {
    // Whatever the comparator decides, it must decide the SAME thing no matter
    // what order the customers arrive in. This is what A4 requires.
    const base = [
      { customerId: 'Z', customerName: 'Z', paidSen: 300 },
      { customerId: 'A', customerName: 'A', paidSen: 200 },
      { customerId: 'M', customerName: 'M', paidSen: 100 },
    ];
    const reference = allocateRefund(base, 501);
    const refById = new Map(reference.lines.map((l) => [l.customerId, l.amountSen]));

    for (const permutation of [
      [base[1], base[2], base[0]],
      [base[2], base[0], base[1]],
      [base[2], base[1], base[0]],
    ]) {
      const result = allocateRefund(permutation, 501);
      const byId = new Map(result.lines.map((l) => [l.customerId, l.amountSen]));
      expect(byId).toEqual(refById);
    }
  });

  it('result is identical regardless of input ordering', () => {
    const ordered = [
      { customerId: 'A', customerName: 'A', paidSen: 5000 },
      { customerId: 'B', customerName: 'B', paidSen: 3000 },
      { customerId: 'C', customerName: 'C', paidSen: 2000 },
    ];
    const shuffled = [ordered[2], ordered[0], ordered[1]];

    const a = allocateRefund(ordered, 9999);
    const b = allocateRefund(shuffled, 9999);
    const aById = new Map(a.lines.map((l) => [l.customerId, l.amountSen]));
    const bById = new Map(b.lines.map((l) => [l.customerId, l.amountSen]));

    expect(aById).toEqual(bById);
  });
});

describe('invariant A2 — order preservation', () => {
  it('T19 a customer who paid more never receives less', () => {
    let seed = 999;
    const rand = (max: number) => {
      seed = (seed * 1103515245 + 12345) & 0x7fffffff;
      return seed % max;
    };

    for (let i = 0; i < 200; i++) {
      const n = 2 + rand(6);
      const paid = Array.from({ length: n }, () => 1 + rand(10000));
      const totalPaid = paid.reduce((a, b) => a + b, 0);
      const T = rand(totalPaid + 1);

      const result = allocateRefund(customers(...paid), T);
      const sorted = [...result.lines].sort((a, b) => b.paidSen - a.paidSen);
      for (let k = 1; k < sorted.length; k++) {
        if (sorted[k - 1].paidSen > sorted[k].paidSen) {
          expect(sorted[k - 1].amountSen).toBeGreaterThanOrEqual(sorted[k].amountSen);
        }
      }
    }
  });
});

describe('invariant A3 — floor bound', () => {
  it('T20 each refund is floor share or floor share + 1', () => {
    const paid = [5000, 3000, 2000];
    const T = 9999;
    const W = paid.reduce((a, b) => a + b, 0);
    const result = allocateRefund(customers(...paid), T);

    result.lines.forEach((line) => {
      const floorShare = Math.floor((T * line.paidSen) / W);
      expect(line.amountSen === floorShare || line.amountSen === floorShare + 1).toBe(true);
    });
  });
});

describe('invariant A5 — no over-refund', () => {
  it('T24 refuses a total that exceeds what was collected', () => {
    expect(() => allocateRefund(customers(3000, 3000, 3000), 10000)).toThrow(RefundError);
  });

  it('never returns more to a customer than they paid', () => {
    const result = allocateRefund(customers(5000, 3000, 2000), 10000);
    result.lines.forEach((line) => {
      expect(line.amountSen).toBeLessThanOrEqual(line.paidSen);
    });
  });
});

describe('edge cases', () => {
  it('T26 an empty customer list with a zero total is valid', () => {
    const result = allocateRefund([], 0);
    expect(result.lines).toEqual([]);
    expect(result.totalRefundSen).toBe(0);
  });

  it('T26 an empty customer list with a non-zero total is rejected', () => {
    expect(() => allocateRefund([], 500)).toThrow(RefundError);
  });

  it('rejects duplicate customer ids', () => {
    const dupe: RefundInput[] = [
      { customerId: 'X', customerName: 'X', paidSen: 1000 },
      { customerId: 'X', customerName: 'X again', paidSen: 2000 },
    ];
    expect(() => allocateRefund(dupe, 1000)).toThrow(RefundError);
  });

  it('rejects a pool when nobody paid anything', () => {
    expect(() => allocateRefund(customers(0, 0), 500)).toThrow(RefundError);
  });

  it('rejects a negative or fractional total', () => {
    expect(() => allocateRefund(customers(1000), -1)).toThrow();
    expect(() => allocateRefund(customers(1000), 10.5)).toThrow();
  });
});

describe('refundableTotal', () => {
  it('sums recorded payments', () => {
    expect(refundableTotal(customers(8400, 4250, 12600))).toBe(25250);
  });
});

describe('the demo case allocation', () => {
  it('allocates RM428.40 across the six demo customers, each refunded what they paid', () => {
    const demo = customers(8400, 4250, 12600, 3890, 9500, 4200);
    const total = refundableTotal(demo);
    expect(total).toBe(42840);

    const result = allocateRefund(demo, total);
    expect(totalOf(result.lines)).toBe(42840);

    // With a full-cancellation refund of exactly what was collected, each
    // customer receives precisely their own payment back.
    result.lines.forEach((line) => {
      expect(line.amountSen).toBe(line.paidSen);
    });
  });
});
