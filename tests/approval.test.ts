/**
 * approval.test.ts — the human-approval gate.
 *
 * Covers 严核明's H1–H5 invariants. The theme throughout: fail closed.
 * These run with no credentials — the gate is pure logic.
 */

import { describe, it, expect } from 'vitest';
import {
  canExecute,
  canApprove,
  linesAreSafeToExecute,
  hashProposal,
  type Approval,
} from '@/lib/core/approval';

const HASH = 'abc12345';

const validApproval: Approval = {
  resolutionId: 'RES-1',
  approvedAt: '2024-08-13T10:00:00+08:00',
  approvedBy: 'founder',
  contentHash: HASH,
};

describe('canExecute — fail closed', () => {
  it('H1 refuses a draft that was never approved', () => {
    const decision = canExecute('draft', null, HASH);
    expect(decision.allowed).toBe(false);
    expect(decision.reason).toMatch(/not been approved/i);
  });

  it('allows an approved resolution whose content is unchanged', () => {
    expect(canExecute('approved', validApproval, HASH).allowed).toBe(true);
  });

  it('refuses when the proposal changed since approval (content-hash mismatch)', () => {
    const decision = canExecute('approved', validApproval, 'different-hash');
    expect(decision.allowed).toBe(false);
    expect(decision.reason).toMatch(/changed since it was approved/i);
  });

  it('refuses an approved status with no approval record', () => {
    const decision = canExecute('approved', null, HASH);
    expect(decision.allowed).toBe(false);
    expect(decision.reason).toMatch(/no approval record/i);
  });

  it('refuses to execute twice — already executing', () => {
    expect(canExecute('executing', validApproval, HASH).allowed).toBe(false);
  });

  it('refuses to execute twice — already executed', () => {
    const decision = canExecute('executed', validApproval, HASH);
    expect(decision.allowed).toBe(false);
    expect(decision.reason).toMatch(/already been executed/i);
  });

  it('refuses a failed resolution until it is reviewed', () => {
    const decision = canExecute('failed', validApproval, HASH);
    expect(decision.allowed).toBe(false);
    expect(decision.reason).toMatch(/failed/i);
  });

  it('refuses an unrecognised status', () => {
    expect(canExecute('wat' as never, validApproval, HASH).allowed).toBe(false);
  });
});

describe('canApprove', () => {
  it('allows approval of a draft', () => {
    expect(canApprove('draft').allowed).toBe(true);
  });

  it('refuses a double approval', () => {
    expect(canApprove('approved').allowed).toBe(false);
  });

  it('refuses approval while executing or after execution', () => {
    expect(canApprove('executing').allowed).toBe(false);
    expect(canApprove('executed').allowed).toBe(false);
  });

  it('allows re-approval after a failure', () => {
    expect(canApprove('failed').allowed).toBe(true);
  });
});

describe('linesAreSafeToExecute — A5 at the application layer', () => {
  it('accepts lines within recorded payments', () => {
    const decision = linesAreSafeToExecute([
      { customerId: 'A', amountSen: 8400, paidSen: 8400 },
      { customerId: 'B', amountSen: 4250, paidSen: 4250 },
    ]);
    expect(decision.allowed).toBe(true);
  });

  it('refuses a line that refunds more than was paid', () => {
    const decision = linesAreSafeToExecute([{ customerId: 'A', amountSen: 9000, paidSen: 8400 }]);
    expect(decision.allowed).toBe(false);
    expect(decision.reason).toMatch(/exceeds what they paid/i);
  });

  it('refuses a negative refund', () => {
    expect(
      linesAreSafeToExecute([{ customerId: 'A', amountSen: -100, paidSen: 8400 }]).allowed,
    ).toBe(false);
  });

  it('accepts an empty line set', () => {
    expect(linesAreSafeToExecute([]).allowed).toBe(true);
  });
});

describe('hashProposal — binds approval to content', () => {
  it('is stable for identical content', () => {
    const proposal = { total: 42840, lines: [{ id: 'A', amount: 8400 }] };
    expect(hashProposal(proposal)).toBe(hashProposal(proposal));
  });

  it('is insensitive to key ordering', () => {
    const a = { total: 42840, count: 6 };
    const b = { count: 6, total: 42840 };
    expect(hashProposal(a)).toBe(hashProposal(b));
  });

  it('changes when a monetary value changes', () => {
    const before = { lines: [{ id: 'A', amount: 8400 }] };
    const after = { lines: [{ id: 'A', amount: 8401 }] };
    expect(hashProposal(before)).not.toBe(hashProposal(after));
  });

  it('changes when a line is added', () => {
    const before = { lines: [{ id: 'A', amount: 8400 }] };
    const after = {
      lines: [
        { id: 'A', amount: 8400 },
        { id: 'B', amount: 4250 },
      ],
    };
    expect(hashProposal(before)).not.toBe(hashProposal(after));
  });

  it('produces an 8-character hex string', () => {
    expect(hashProposal({ any: 'thing' })).toMatch(/^[0-9a-f]{8}$/);
  });
});
