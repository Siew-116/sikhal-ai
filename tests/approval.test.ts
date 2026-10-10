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
  proposalHashOf,
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

  it('produces a 64-character SHA-256 hex string', () => {
    // Deliberately stronger than the previous 8-character assertion. A 32-bit
    // digest is collidable, and a collision here would let a different proposal
    // satisfy an approval — the exact failure this control exists to prevent.
    expect(hashProposal({ any: 'thing' })).toMatch(/^[0-9a-f]{64}$/);
  });
});

describe('proposalHashOf — the single canonical hash source', () => {
  const base = {
    totalRefundSen: 42840,
    affected: [
      { customerId: 'CUST-001', refundSen: 8400 },
      { customerId: 'CUST-002', refundSen: 4250 },
    ],
  };

  it('is stable regardless of the order the customers arrive in', () => {
    const reversed = { ...base, affected: [...base.affected].reverse() };
    expect(proposalHashOf(base)).toBe(proposalHashOf(reversed));
  });

  it('changes when an amount changes', () => {
    const changed = {
      ...base,
      affected: [
        { customerId: 'CUST-001', refundSen: 8401 },
        { customerId: 'CUST-002', refundSen: 4250 },
      ],
    };
    expect(proposalHashOf(changed)).not.toBe(proposalHashOf(base));
  });

  it('changes when the total changes even if the lines do not', () => {
    expect(proposalHashOf({ ...base, totalRefundSen: 42841 })).not.toBe(proposalHashOf(base));
  });
});

describe('the tamper defence is not a tautology', () => {
  // REGRESSION for the defect this review found.
  //
  // The execute route previously passed `resolution.contentHash` as BOTH the
  // approved hash and the "current" hash, so the comparison compared a value to
  // itself and could never fail. These tests reproduce the shape of that bug
  // directly: approve one proposal, then ask whether a DIFFERENT proposal may
  // execute against that approval.
  const approvedContent = {
    totalRefundSen: 42840,
    affected: [
      { customerId: 'CUST-001', refundSen: 8400 },
      { customerId: 'CUST-002', refundSen: 4250 },
    ],
  };

  const approvedHash = proposalHashOf(approvedContent);

  const approval: Approval = {
    resolutionId: 'RES-TAMPER',
    approvedAt: '2026-01-01T00:00:00.000Z',
    approvedBy: 'founder',
    contentHash: approvedHash,
  };

  it('permits execution when the content is unchanged', () => {
    // Same content -> same hash -> allowed. This is the happy path.
    const current = proposalHashOf(approvedContent);
    const decision = canExecute('approved', approval, current);
    expect(decision.allowed).toBe(true);
  });

  it('refuses execution when a refund amount was mutated after approval', () => {
    // The founder approved RM42.50 for CUST-002; someone changed it to RM400.
    const tampered = proposalHashOf({
      ...approvedContent,
      affected: [
        { customerId: 'CUST-001', refundSen: 8400 },
        { customerId: 'CUST-002', refundSen: 40000 },
      ],
    });

    const decision = canExecute('approved', approval, tampered);
    expect(decision.allowed).toBe(false);
    expect(decision.reason).toMatch(/changed since it was approved/i);
  });

  it('refuses execution when a customer was added after approval', () => {
    const tampered = proposalHashOf({
      ...approvedContent,
      affected: [
        ...approvedContent.affected,
        { customerId: 'CUST-999', refundSen: 9999 },
      ],
    });
    expect(canExecute('approved', approval, tampered).allowed).toBe(false);
  });

  it('refuses execution when the total was inflated after approval', () => {
    const tampered = proposalHashOf({ ...approvedContent, totalRefundSen: 99999 });
    expect(canExecute('approved', approval, tampered).allowed).toBe(false);
  });

  it('would have passed the old tautological check — proving the test is meaningful', () => {
    // Simulate the old bug: pass the stored hash as the "current" hash.
    // This must be allowed (which is precisely why the bug was invisible), so
    // the assertion documents that the new tests above are catching something
    // the old call shape could not.
    const tautological = canExecute('approved', approval, approval.contentHash);
    expect(tautological.allowed).toBe(true);

    // And the correct computation for modified content must disagree.
    const correct = proposalHashOf({
      ...approvedContent,
      affected: [{ customerId: 'CUST-001', refundSen: 999999 }],
    });
    expect(canExecute('approved', approval, correct).allowed).toBe(false);
  });
});
