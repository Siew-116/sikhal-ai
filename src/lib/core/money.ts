/**
 * money.ts — deterministic MYR arithmetic in integer sen.
 *
 * THE RULE: money is never represented as a floating-point number anywhere in
 * this codebase. MYR has two decimal places (sen). We store and compute
 * exclusively in integer sen and convert to a display string only at the very
 * edge, in `formatMYR`.
 *
 * This module is pure: no I/O, no dependencies, no clock, no randomness.
 */

/** Integer number of sen. 1 MYR = 100 sen. */
export type Sen = number;

export class MoneyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'MoneyError';
  }
}

/**
 * Assert that a value is a valid integer sen amount.
 *
 * A fractional sen is never something to round away silently — it means a
 * float leaked into the money path somewhere upstream, and the correct
 * response is to fail loudly at the boundary rather than corrupt a refund.
 */
export function assertSen(value: number, label = 'value'): asserts value is Sen {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new MoneyError(`${label} must be a finite number, received ${String(value)}`);
  }
  if (!Number.isInteger(value)) {
    throw new MoneyError(
      `${label} must be an integer number of sen, received ${value}. ` +
        `A fractional sen indicates floating-point contamination in the money path.`,
    );
  }
}

/** Assert that sen is >= 0. */
export function assertNonNegativeSen(value: number, label = 'value'): asserts value is Sen {
  assertSen(value, label);
  if (value < 0) {
    throw new MoneyError(`${label} must be non-negative, received ${value}`);
  }
}

/**
 * Parse a human-entered MYR string into integer sen.
 *
 * Accepts "12.34", "RM12.34", "1,234.56", "12", "12.3".
 * Rejects anything with more than two decimal places — that is a user error we
 * surface, not a value we round, because silently rounding a user's money is
 * exactly the kind of bug this module exists to prevent.
 */
export function parseMYR(input: string): Sen {
  if (typeof input !== 'string') {
    throw new MoneyError(`parseMYR expects a string, received ${typeof input}`);
  }
  const cleaned = input.trim().replace(/^RM\s*/i, '').replace(/,/g, '');
  if (cleaned === '') throw new MoneyError('parseMYR received an empty string');

  const match = /^(-?)(\d+)(?:\.(\d{1,2}))?$/.exec(cleaned);
  if (!match) {
    throw new MoneyError(
      `Cannot parse "${input}" as MYR. Expected an amount with at most 2 decimal places.`,
    );
  }

  const [, sign, whole, frac = ''] = match;
  const padded = (frac + '00').slice(0, 2);
  const sen = Number(whole) * 100 + Number(padded);
  assertSen(sen, 'parsed amount');
  return sign === '-' ? -sen : sen;
}

/**
 * Format integer sen as a display string: RM1,234.56
 *
 * This is the ONLY place sen becomes a decimal string. Everything upstream of
 * this function works in integers.
 */
export function formatMYR(sen: Sen): string {
  assertSen(sen, 'formatMYR argument');
  const negative = sen < 0;
  const abs = Math.abs(sen);
  const whole = Math.floor(abs / 100);
  const frac = abs % 100;
  const grouped = whole.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return `${negative ? '-' : ''}RM${grouped}.${frac.toString().padStart(2, '0')}`;
}

/**
 * Format sen as a plain decimal string with no symbol and no grouping, e.g.
 * `1234.56`.
 *
 * This is the form that belongs in an editable money input: it round-trips
 * exactly through parseMYR, whereas `formatMYR`'s symbol and thousands
 * separators would have to be stripped before parsing. Used instead of
 * `(sen / 100).toFixed(2)`, which introduces a float into the money path.
 *
 * Integer arithmetic only — no division, so no float can appear.
 */
export function formatMYRPlain(sen: Sen): string {
  assertSen(sen, 'formatMYRPlain argument');
  const negative = sen < 0;
  const abs = Math.abs(sen);
  const whole = Math.floor(abs / 100);
  const frac = abs % 100;
  return `${negative ? '-' : ''}${whole}.${frac.toString().padStart(2, '0')}`;
}

/** Sum a list of sen amounts, asserting integer safety at each step. */
export function sumSen(values: Sen[]): Sen {
  let total = 0;
  for (const v of values) {
    assertSen(v, 'sumSen element');
    total += v;
    assertSen(total, 'sumSen running total');
  }
  return total;
}
