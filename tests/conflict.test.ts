/**
 * conflict.test.ts — academic-hour conflict detection.
 *
 * Covers 严核明's test plan T38–T45 and the timezone rulings in §5.3.
 * The boundary ruling under test: an action ending EXACTLY when a commitment
 * begins is NOT a conflict (half-open intervals).
 */

import { describe, it, expect } from 'vitest';
import {
  detectConflicts,
  intervalsOverlap,
  findAlternativeSlot,
  isActionClear,
  formatMinute,
  utcToMyMinutesOfWeek,
  MYT_OFFSET_MINUTES,
  type Commitment,
  type ProposedAction,
} from '@/lib/core/conflict';

const TUESDAY = 2 as const;

const CS2040: Commitment = {
  id: 'C-ALGO',
  label: 'CS2040 Algorithms — Lecture',
  dayOfWeek: TUESDAY,
  startMinute: 14 * 60, // 14:00
  endMinute: 16 * 60, // 16:00
};

describe('intervalsOverlap — the boundary ruling', () => {
  it('detects a clear overlap', () => {
    expect(intervalsOverlap(13 * 60, 15 * 60, 14 * 60, 16 * 60)).toBe(true);
  });

  it('an interval fully inside another overlaps', () => {
    expect(intervalsOverlap(14 * 60 + 30, 15 * 60, 14 * 60, 16 * 60)).toBe(true);
  });

  it('an interval fully containing another overlaps', () => {
    expect(intervalsOverlap(13 * 60, 17 * 60, 14 * 60, 16 * 60)).toBe(true);
  });

  it('touching endpoints do NOT overlap — a task ending at class start is fine', () => {
    expect(intervalsOverlap(13 * 60, 14 * 60, 14 * 60, 16 * 60)).toBe(false);
  });

  it('touching endpoints do NOT overlap — a task starting at class end is fine', () => {
    expect(intervalsOverlap(16 * 60, 17 * 60, 14 * 60, 16 * 60)).toBe(false);
  });

  it('disjoint intervals do not overlap', () => {
    expect(intervalsOverlap(8 * 60, 9 * 60, 14 * 60, 16 * 60)).toBe(false);
  });
});

describe('detectConflicts', () => {
  it('T39 reports an overlapping action with the commitment id', () => {
    const action: ProposedAction = {
      id: 'A1',
      label: 'Prepare refunds',
      dayOfWeek: TUESDAY,
      startMinute: 14 * 60,
      endMinute: 14 * 60 + 30,
    };
    const conflicts = detectConflicts([action], [CS2040]);
    expect(conflicts).toHaveLength(1);
    expect(conflicts[0].commitmentId).toBe('C-ALGO');
    expect(conflicts[0].actionId).toBe('A1');
    expect(conflicts[0].reason).toBe('overlap');
  });

  it('T38 a task ending exactly at class start is not a conflict', () => {
    const action: ProposedAction = {
      id: 'A1',
      label: 'Send messages',
      dayOfWeek: TUESDAY,
      startMinute: 13 * 60 + 30,
      endMinute: 14 * 60, // ends exactly when CS2040 begins
    };
    expect(detectConflicts([action], [CS2040])).toHaveLength(0);
    expect(isActionClear(action, [CS2040])).toBe(true);
  });

  it('ignores commitments on other days', () => {
    const action: ProposedAction = {
      id: 'A1',
      label: 'Refund run',
      dayOfWeek: 5, // Friday
      startMinute: 14 * 60,
      endMinute: 15 * 60,
    };
    expect(detectConflicts([action], [CS2040])).toHaveLength(0);
  });

  it('reports one conflict per overlapping commitment', () => {
    const second: Commitment = {
      id: 'C-TUT',
      label: 'Tutorial',
      dayOfWeek: TUESDAY,
      startMinute: 14 * 60 + 15,
      endMinute: 15 * 60,
    };
    const action: ProposedAction = {
      id: 'A1',
      label: 'Refund run',
      dayOfWeek: TUESDAY,
      startMinute: 14 * 60,
      endMinute: 15 * 60 + 30,
    };
    expect(detectConflicts([action], [CS2040, second])).toHaveLength(2);
  });

  it('returns nothing when there are no commitments', () => {
    const action: ProposedAction = {
      id: 'A1',
      label: 'Anything',
      dayOfWeek: TUESDAY,
      startMinute: 0,
      endMinute: 1440,
    };
    expect(detectConflicts([action], [])).toHaveLength(0);
  });

  it('rejects an inverted time range', () => {
    const bad: Commitment = {
      id: 'C-BAD',
      label: 'Broken',
      dayOfWeek: TUESDAY,
      startMinute: 16 * 60,
      endMinute: 14 * 60,
    };
    const action: ProposedAction = {
      id: 'A1',
      label: 'x',
      dayOfWeek: TUESDAY,
      startMinute: 0,
      endMinute: 60,
    };
    expect(() => detectConflicts([action], [bad])).toThrow();
  });
});

describe('findAlternativeSlot', () => {
  it('T42 returns the earliest free slot of at least the given duration', () => {
    const slot = findAlternativeSlot(TUESDAY, 30, [CS2040], 8 * 60, 22 * 60, 14 * 60);
    expect(slot).not.toBeNull();
    // Must start at or after the lecture ends (16:00) since 14:00 is blocked.
    expect(slot!.startMinute).toBeGreaterThanOrEqual(16 * 60);
    expect(slot!.endMinute - slot!.startMinute).toBe(30);
  });

  it('T44 the suggested slot never itself conflicts', () => {
    const commitments: Commitment[] = [
      CS2040,
      { id: 'C-A', label: 'Morning', dayOfWeek: TUESDAY, startMinute: 9 * 60, endMinute: 11 * 60 },
      { id: 'C-B', label: 'Evening', dayOfWeek: TUESDAY, startMinute: 20 * 60, endMinute: 22 * 60 },
    ];
    const slot = findAlternativeSlot(TUESDAY, 45, commitments, 8 * 60, 22 * 60, 8 * 60);
    expect(slot).not.toBeNull();

    const action: ProposedAction = {
      id: 'ALT',
      label: 'Alternative',
      dayOfWeek: TUESDAY,
      startMinute: slot!.startMinute,
      endMinute: slot!.endMinute,
    };
    expect(isActionClear(action, commitments)).toBe(true);
  });

  it('T43 returns null when the day has no room', () => {
    const fullDay: Commitment[] = [
      { id: 'X', label: 'All day', dayOfWeek: TUESDAY, startMinute: 8 * 60, endMinute: 22 * 60 },
    ];
    expect(findAlternativeSlot(TUESDAY, 30, fullDay, 8 * 60, 22 * 60)).toBeNull();
  });

  it('respects the waking-hours window', () => {
    const slot = findAlternativeSlot(TUESDAY, 30, [], 8 * 60, 22 * 60);
    expect(slot!.startMinute).toBeGreaterThanOrEqual(8 * 60);
    expect(slot!.endMinute).toBeLessThanOrEqual(22 * 60);
  });

  it('rejects a non-positive duration', () => {
    expect(() => findAlternativeSlot(TUESDAY, 0, [])).toThrow();
    expect(() => findAlternativeSlot(TUESDAY, -30, [])).toThrow();
  });
});

describe('timezone handling', () => {
  it('T40 converts a UTC instant to the correct MYT minutes-of-week', () => {
    // 2024-08-13T06:00:00Z is Tuesday 14:00 in MYT (UTC+8).
    const epochMs = Date.parse('2024-08-13T06:00:00Z');
    const minutesOfWeek = utcToMyMinutesOfWeek(epochMs);
    const day = Math.floor(minutesOfWeek / 1440);
    const minuteOfDay = minutesOfWeek % 1440;
    expect(day).toBe(TUESDAY);
    expect(minuteOfDay).toBe(14 * 60);
  });

  it('T41 the conversion does not depend on the host timezone', () => {
    // The function uses an explicit +8 offset, never the host clock.
    expect(MYT_OFFSET_MINUTES).toBe(480);
    const epochMs = Date.parse('2024-08-13T00:00:00Z'); // Tuesday 08:00 MYT
    const minutesOfWeek = utcToMyMinutesOfWeek(epochMs);
    expect(minutesOfWeek % 1440).toBe(8 * 60);
  });
});

describe('formatMinute', () => {
  it('formats minutes-from-midnight as HH:MM', () => {
    expect(formatMinute(0)).toBe('00:00');
    expect(formatMinute(9 * 60)).toBe('09:00');
    expect(formatMinute(14 * 60 + 30)).toBe('14:30');
    expect(formatMinute(23 * 60 + 59)).toBe('23:59');
  });
});
