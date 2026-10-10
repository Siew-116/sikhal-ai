/**
 * money.test.ts — integer-sen arithmetic.
 *
 * Covers 严核明's test plan T01–T08. These run with no credentials.
 */

import { describe, it, expect } from 'vitest';
import {
  parseMYR,
  formatMYR,
  sumSen,
  assertSen,
  assertNonNegativeSen,
  MoneyError,
} from '@/lib/core/money';

describe('parseMYR', () => {
  it('T01 parses "RM1,234.56" to 123456 sen', () => {
    expect(parseMYR('RM1,234.56')).toBe(123456);
  });

  it('T02 parses "12.5" to 1250 sen', () => {
    expect(parseMYR('12.5')).toBe(1250);
  });

  it('parses a bare integer as whole ringgit', () => {
    expect(parseMYR('12')).toBe(1200);
  });

  it('parses with the RM prefix and no space', () => {
    expect(parseMYR('RM42.00')).toBe(4200);
  });

  it('T03 rejects more than two decimal places', () => {
    expect(() => parseMYR('1.005')).toThrow(MoneyError);
  });

  it('rejects a malformed string', () => {
    expect(() => parseMYR('abc')).toThrow(MoneyError);
  });

  it('rejects an empty string', () => {
    expect(() => parseMYR('')).toThrow(MoneyError);
  });
});

describe('formatMYR', () => {
  it('T05 formats 123456 as "RM1,234.56"', () => {
    expect(formatMYR(123456)).toBe('RM1,234.56');
  });

  it('T06 formats 0 as "RM0.00"', () => {
    expect(formatMYR(0)).toBe('RM0.00');
  });

  it('T07 formats -1200 as "-RM12.00"', () => {
    expect(formatMYR(-1200)).toBe('-RM12.00');
  });

  it('always shows two decimal places', () => {
    expect(formatMYR(8400)).toBe('RM84.00');
    expect(formatMYR(4250)).toBe('RM42.50');
    expect(formatMYR(3890)).toBe('RM38.90');
  });

  it('groups thousands correctly', () => {
    expect(formatMYR(100000000)).toBe('RM1,000,000.00');
  });
});

describe('sumSen', () => {
  it('T08 adds without floating-point drift', () => {
    expect(sumSen([2999, 1])).toBe(3000);
  });

  it('sums the demo case to RM428.40', () => {
    // 84.00 + 42.50 + 126.00 + 38.90 + 95.00 + 42.00
    expect(sumSen([8400, 4250, 12600, 3890, 9500, 4200])).toBe(42840);
  });

  it('sums an empty list to zero', () => {
    expect(sumSen([])).toBe(0);
  });

  it('rejects a fractional sen anywhere in the list', () => {
    expect(() => sumSen([100, 1.5])).toThrow(MoneyError);
  });
});

describe('assertSen', () => {
  it('accepts integers', () => {
    expect(() => assertSen(4200)).not.toThrow();
  });

  it('rejects a float — the money path must never see one', () => {
    expect(() => assertSen(42.5)).toThrow(MoneyError);
  });

  it('rejects NaN and Infinity', () => {
    expect(() => assertSen(NaN)).toThrow(MoneyError);
    expect(() => assertSen(Infinity)).toThrow(MoneyError);
  });
});

describe('assertNonNegativeSen', () => {
  it('accepts zero', () => {
    expect(() => assertNonNegativeSen(0)).not.toThrow();
  });

  it('rejects a negative amount', () => {
    expect(() => assertNonNegativeSen(-1)).toThrow(MoneyError);
  });
});

describe('float contamination is caught, not silently tolerated', () => {
  it('a naive float calculation would drift — we detect it instead', () => {
    // The classic: 0.1 + 0.2 !== 0.3 in IEEE-754.
    const naive = 8400.1 + 4250.2;
    expect(Number.isInteger(naive)).toBe(false);
    expect(() => assertSen(naive)).toThrow(MoneyError);

    // The integer path is exact.
    expect(8400 + 4250).toBe(12650);
  });
});
