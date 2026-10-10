/**
 * refundkey.test.ts — the deterministic identity of a refund.
 *
 * The key is what makes cross-resolution duplicate prevention possible. If it
 * were not stable across runs, the guard would either never fire (keys always
 * differ) or fire on everything (keys collide).
 */

import { describe, it, expect } from 'vitest';
import { refundKey } from '@/lib/core/refundkey';

const base = {
  orderRef: 'GB-2024-014',
  customerId: 'CUST-001',
  supplierUpdateId: 'Kuching Harvest Trading|2024-08-12',
  lines: [
    { itemName: 'Sarawak white pepper (200g)', quantity: 2, unitPriceSen: 4200 },
  ],
};

describe('refundKey', () => {
  it('is stable across identical inputs', () => {
    expect(refundKey(base)).toBe(refundKey(base));
  });

  it('is a 64-character sha256 hex digest', () => {
    expect(refundKey(base)).toMatch(/^[0-9a-f]{64}$/);
  });

  it('does not depend on the order of the lines', () => {
    const twoLines = {
      ...base,
      lines: [
        { itemName: 'Laksa paste (500g)', quantity: 1, unitPriceSen: 4250 },
        { itemName: 'Sarawak white pepper (200g)', quantity: 2, unitPriceSen: 4200 },
      ],
    };
    const reversed = { ...twoLines, lines: [...twoLines.lines].reverse() };
    expect(refundKey(twoLines)).toBe(refundKey(reversed));
  });

  it('changes when the customer changes', () => {
    expect(refundKey({ ...base, customerId: 'CUST-002' })).not.toBe(refundKey(base));
  });

  it('changes when the order changes', () => {
    expect(refundKey({ ...base, orderRef: 'GB-2024-015' })).not.toBe(refundKey(base));
  });

  // The crucial property: the SAME customer refunded for a DIFFERENT supplier
  // cancellation must produce a different key, otherwise the duplicate guard
  // would block legitimate repeat business.
  it('changes when the supplier event changes', () => {
    expect(refundKey({ ...base, supplierUpdateId: 'Kuching Harvest Trading|2024-09-01' }))
      .not.toBe(refundKey(base));
  });

  it('changes when the refunded lines change', () => {
    const different = {
      ...base,
      lines: [{ itemName: 'Sarawak white pepper (200g)', quantity: 3, unitPriceSen: 4200 }],
    };
    expect(refundKey(different)).not.toBe(refundKey(base));
  });

  it('changes when only the unit price changes', () => {
    const different = {
      ...base,
      lines: [{ itemName: 'Sarawak white pepper (200g)', quantity: 2, unitPriceSen: 4300 }],
    };
    expect(refundKey(different)).not.toBe(refundKey(base));
  });

  it('rejects non-integer sen in the line', () => {
    expect(() =>
      refundKey({
        ...base,
        lines: [{ itemName: 'x', quantity: 1, unitPriceSen: 42.5 }],
      }),
    ).toThrow();
  });
});
