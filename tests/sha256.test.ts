/**
 * sha256.test.ts — proves the hash primitive is a real SHA-256.
 *
 * This matters more than it looks. The approval gate binds to this digest; if
 * the implementation were subtly wrong, approval would either fail for everyone
 * or (worse) two different proposals could agree. We verify against Node's own
 * crypto, so the test cannot agree with a buggy implementation by construction.
 */

import { describe, it, expect } from 'vitest';
import { createHash } from 'node:crypto';
import { sha256Hex } from '@/lib/core/sha256';

const reference = (s: string) => createHash('sha256').update(s, 'utf8').digest('hex');

describe('sha256Hex', () => {
  it('matches the published digest for "abc"', () => {
    expect(sha256Hex('abc')).toBe(
      'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad',
    );
  });

  it('matches the published digest for the empty string', () => {
    expect(sha256Hex('')).toBe(
      'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
    );
  });

  it('matches the published digest for the standard pangram', () => {
    expect(sha256Hex('The quick brown fox jumps over the lazy dog')).toBe(
      'd7a8fbb307d7809469ca9abcb0082e4f8d5651e46d3cdb762d02d0bf37c9e592',
    );
  });

  // The padding boundary is where naive implementations break: length 55 needs
  // one 0x80 byte plus 8 length bytes to fill a block, 56 forces a second block.
  it.each([0, 1, 54, 55, 56, 57, 63, 64, 65, 119, 120, 127, 128, 1000])(
    'matches Node crypto at the %i-byte padding boundary',
    (len) => {
      const input = 'a'.repeat(len);
      expect(sha256Hex(input)).toBe(reference(input));
    },
  );

  it.each([
    ['2-byte', '\u00e9\u00e8\u00ea'],
    ['3-byte', '\u4e2d\u6587\u6d4b\u8bd5'],
    ['4-byte surrogate pair', '\u{1F600}\u{1F601}'],
    ['mixed', 'RM428.40 \u2014 Kuching \u{1F600}'],
  ])('handles %s UTF-8 correctly', (_label, input) => {
    expect(sha256Hex(input)).toBe(reference(input));
  });

  it('is sensitive to a single-character change', () => {
    expect(sha256Hex('refund 8400')).not.toBe(sha256Hex('refund 8401'));
  });

  it('produces a 64-character lowercase hex digest', () => {
    expect(sha256Hex('anything')).toMatch(/^[0-9a-f]{64}$/);
  });
});
