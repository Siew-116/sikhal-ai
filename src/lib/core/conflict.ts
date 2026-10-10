/**
 * conflict.ts — academic-hour conflict detection for Study Protection.
 *
 * SikHal's Study Protection feature exists to stop the agent proposing a
 * business action during the founder's class or study time.
 *
 * TIMEZONE DECISION: Malaysia is UTC+8, a single zone, with no daylight saving.
 * Rather than drag a timezone library into the money-critical path, we store a
 * commitment as (dayOfWeek, startMinute, endMinute) where minute is measured
 * from local midnight. Proposed actions are converted to the same local
 * representation before comparison. This removes an entire class of bug and is
 * correct for the single-zone deployment.
 *
 * BOUNDARY RULING: a proposed action that ends exactly when a commitment
 * begins, or begins exactly when one ends, is NOT a conflict. The intervals are
 * half-open: [start, end). Back-to-back is allowed, because requiring a gap
 * would falsely block a founder who is perfectly free at 14:00 when their
 * lecture ends at 14:00. This matches how calendars conventionally behave.
 *
 * This module is pure: no I/O, no dependencies, no clock, no randomness.
 */

export type DayOfWeek = 0 | 1 | 2 | 3 | 4 | 5 | 6; // 0 = Sunday

export interface Commitment {
  id: string;
  label: string;
  dayOfWeek: DayOfWeek;
  /** minutes from local midnight, inclusive start */
  startMinute: number;
  /** minutes from local midnight, exclusive end */
  endMinute: number;
  location?: string;
}

export interface ProposedAction {
  id: string;
  label: string;
  dayOfWeek: DayOfWeek;
  startMinute: number;
  endMinute: number;
}

export interface Conflict {
  actionId: string;
  actionLabel: string;
  commitmentId: string;
  commitmentLabel: string;
  reason: 'overlap';
  detail: string;
}

export class ConflictError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ConflictError';
  }
}

function assertTimeRange(start: number, end: number, label: string): void {
  if (!Number.isInteger(start) || start < 0 || start > 1439) {
    throw new ConflictError(`${label}: startMinute must be an integer 0..1439, got ${start}`);
  }
  if (!Number.isInteger(end) || end < 1 || end > 1440) {
    throw new ConflictError(`${label}: endMinute must be an integer 1..1440, got ${end}`);
  }
  if (end <= start) {
    throw new ConflictError(`${label}: endMinute (${end}) must exceed startMinute (${start})`);
  }
}

/**
 * Do two half-open intervals on the same day overlap?
 *
 * [aStart, aEnd) overlaps [bStart, bEnd) iff aStart < bEnd && bStart < aEnd.
 * Note the strict inequality: touching endpoints (aEnd === bStart) do NOT
 * overlap, per the boundary ruling above.
 */
export function intervalsOverlap(
  aStart: number,
  aEnd: number,
  bStart: number,
  bEnd: number,
): boolean {
  return aStart < bEnd && bStart < aEnd;
}

/**
 * Detect conflicts between proposed actions and academic commitments.
 *
 * @returns one Conflict per (action, commitment) overlapping pair.
 */
export function detectConflicts(
  actions: ProposedAction[],
  commitments: Commitment[],
): Conflict[] {
  const conflicts: Conflict[] = [];

  for (const c of commitments) {
    assertTimeRange(c.startMinute, c.endMinute, `commitment ${c.id}`);
  }
  for (const a of actions) {
    assertTimeRange(a.startMinute, a.endMinute, `action ${a.id}`);
  }

  for (const action of actions) {
    for (const commitment of commitments) {
      if (action.dayOfWeek !== commitment.dayOfWeek) continue;

      if (
        intervalsOverlap(
          action.startMinute,
          action.endMinute,
          commitment.startMinute,
          commitment.endMinute,
        )
      ) {
        conflicts.push({
          actionId: action.id,
          actionLabel: action.label,
          commitmentId: commitment.id,
          commitmentLabel: commitment.label,
          reason: 'overlap',
          detail:
            `"${action.label}" runs ${formatMinute(action.startMinute)}–${formatMinute(action.endMinute)}, ` +
            `which overlaps "${commitment.label}" at ${formatMinute(commitment.startMinute)}–${formatMinute(commitment.endMinute)}.`,
        });
      }
    }
  }

  return conflicts;
}

/** Is this action free of conflicts? */
export function isActionClear(action: ProposedAction, commitments: Commitment[]): boolean {
  return detectConflicts([action], commitments).length === 0;
}

/**
 * Find the earliest free slot on or after a preferred time that can hold an
 * action of the given duration, within a working window.
 *
 * Used to propose a safe alternative when the preferred slot conflicts.
 * Returns null when the day has no room — the caller must then surface that to
 * the founder rather than silently dropping the action.
 */
export function findAlternativeSlot(
  dayOfWeek: DayOfWeek,
  durationMinutes: number,
  commitments: Commitment[],
  windowStart = 8 * 60, // 08:00
  windowEnd = 22 * 60, // 22:00
  preferredStart?: number,
): { startMinute: number; endMinute: number } | null {
  if (!Number.isInteger(durationMinutes) || durationMinutes <= 0) {
    throw new ConflictError(`durationMinutes must be a positive integer, got ${durationMinutes}`);
  }

  const dayCommitments = commitments
    .filter((c) => c.dayOfWeek === dayOfWeek)
    .sort((a, b) => a.startMinute - b.startMinute);

  let cursor = Math.max(windowStart, preferredStart ?? windowStart);

  // Walk forward past each blocking commitment until a gap fits.
  for (const commitment of dayCommitments) {
    if (commitment.endMinute <= cursor) continue; // already past it

    // Does the action fit between the cursor and this commitment?
    if (cursor + durationMinutes <= commitment.startMinute) {
      return { startMinute: cursor, endMinute: cursor + durationMinutes };
    }

    // Otherwise advance past the commitment and keep looking.
    cursor = Math.max(cursor, commitment.endMinute);
  }

  if (cursor + durationMinutes <= windowEnd) {
    return { startMinute: cursor, endMinute: cursor + durationMinutes };
  }

  return null; // no room in the window
}

/** Format minutes-from-midnight as HH:MM (24-hour, Malaysian convention). */
export function formatMinute(minute: number): string {
  const h = Math.floor(minute / 60);
  const m = minute % 60;
  return `${h.toString().padStart(2, '0')}:${m.toString().padStart(2, '0')}`;
}

/**
 * SikHal operates entirely in Malaysia Time (MYT, UTC+8), a single zone with no
 * daylight saving. Rather than depend on the host machine's timezone — which on
 * a server is usually UTC and would silently shift every comparison — we work
 * in explicit wall-clock minutes and carry the offset as a constant.
 */
export const MYT_OFFSET_MINUTES = 8 * 60;

/** Convert a UTC instant (ms since epoch) to MYT minutes-of-week (0..10079). */
export function utcToMyMinutesOfWeek(epochMs: number): number {
  const mytMs = epochMs + MYT_OFFSET_MINUTES * 60_000;
  const dayMs = 86_400_000;
  const dayIndex = Math.floor(mytMs / dayMs); // days since epoch, UTC-based shift applied
  const msIntoDay = ((mytMs % dayMs) + dayMs) % dayMs;
  // Epoch day 0 = Thursday. Shift so that 0 = Sunday.
  const dayOfWeek = (((dayIndex + 4) % 7) + 7) % 7;
  const minuteOfDay = Math.floor(msIntoDay / 60_000);
  return dayOfWeek * 1440 + minuteOfDay;
}

/** Convert a commitment to minutes-of-week. */
export function commitmentToMinutesOfWeek(c: Commitment): {
  start: number;
  end: number;
} {
  return { start: c.dayOfWeek * 1440 + c.startMinute, end: c.dayOfWeek * 1440 + c.endMinute };
}

/** Convert a proposed action to minutes-of-week. */
export function actionToMinutesOfWeek(a: ProposedAction): {
  start: number;
  end: number;
} {
  return { start: a.dayOfWeek * 1440 + a.startMinute, end: a.dayOfWeek * 1440 + a.endMinute };
}

export const DAY_NAMES = [
  'Sunday',
  'Monday',
  'Tuesday',
  'Wednesday',
  'Thursday',
  'Friday',
  'Saturday',
] as const;
