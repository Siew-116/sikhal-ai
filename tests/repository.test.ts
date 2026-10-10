/**
 * repository.test.ts — persistence guarantees against the adapter.
 *
 * Covers 严核明's T29–T37 at the adapter level. These use the in-memory adapter,
 * which holds the same guarantees as the Supabase adapter. The finance spec
 * (§6.3) requires that the DATABASE-level constraints also be verified against
 * real Postgres; that is an explicit remaining item for Phase 4, and is
 * reported as such rather than claimed as done.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { MemoryRepository } from '@/lib/repo/repository.memory';
import { ApprovalError, IntegrityError } from '@/lib/repo/errors';
import { DEMO_CASE } from '@/lib/fixtures';
import { proposalHashOf } from '@/lib/core/approval';
import type { Resolution } from '@/lib/types';

const OWNER = 'founder';

async function seedCase(repo: MemoryRepository) {
  return repo.createCase({
    supplierName: DEMO_CASE.supplierName,
    orderRef: DEMO_CASE.orderRef,
    cancellationReason: DEMO_CASE.cancellationReason,
    cancelledOn: DEMO_CASE.cancelledOn,
    orderLines: DEMO_CASE.orderLines,
    payments: DEMO_CASE.payments,
  });
}

/**
 * Build a proposal for the demo case.
 *
 * The total is DERIVED from the lines rather than passed in independently. The
 * persistence layer asserts that Σ(lines) === total, and an earlier version of
 * this helper hard-coded 42840 while supplying only 12650 sen of lines — an
 * inconsistent proposal that only survived because nothing validated it. Using
 * the full six-customer set keeps the fixture honest.
 */
function proposal(caseId: string) {
  const affected = [
    { customerId: 'CUST-001', customerName: 'Aisyah Rahman', paidSen: 8400, refundSen: 8400, status: 'refundable' as const },
    { customerId: 'CUST-002', customerName: 'Bala Subramaniam', paidSen: 4250, refundSen: 4250, status: 'refundable' as const },
    { customerId: 'CUST-003', customerName: 'Chen Wei Ling', paidSen: 12600, refundSen: 12600, status: 'refundable' as const },
    { customerId: 'CUST-004', customerName: 'Nurul Izzah', paidSen: 3890, refundSen: 3890, status: 'refundable' as const },
    { customerId: 'CUST-005', customerName: 'Daniel Tan', paidSen: 9500, refundSen: 9500, status: 'refundable' as const },
    { customerId: 'CUST-006', customerName: 'Farah Adibah', paidSen: 4200, refundSen: 4200, status: 'refundable' as const },
  ];
  const total = affected.reduce((s, a) => s + a.refundSen, 0); // 42840
  return {
    caseId,
    affected,
    totalRefundSen: total,
    drafts: [],
    plan: [],
    conflicts: [],
    toolTrace: [],
    warnings: [],
    contentHash: proposalHashOf({ totalRefundSen: total, affected }),
  };
}

describe('case persistence', () => {
  let repo: MemoryRepository;
  beforeEach(() => {
    repo = new MemoryRepository();
  });

  it('creates and retrieves a case with its records', async () => {
    const created = await seedCase(repo);
    const loaded = await repo.getCase(created.id);
    expect(loaded).not.toBeNull();
    expect(loaded!.supplierName).toBe('Kuching Harvest Trading');

    const lines = await repo.getOrderLines(created.id);
    const payments = await repo.getPayments(created.id);
    expect(lines).toHaveLength(6);
    expect(payments).toHaveLength(6);
  });

  it('returns null for a case that does not exist', async () => {
    expect(await repo.getCase('no-such-id')).toBeNull();
  });
});

describe('T29/T30 — duplicate refund prevention', () => {
  let repo: MemoryRepository;
  beforeEach(() => {
    repo = new MemoryRepository();
  });

  it('T30 re-running the agent on the same case does not accumulate resolutions', async () => {
    const c = await seedCase(repo);
    const first = await repo.saveResolution(proposal(c.id));
    const second = await repo.saveResolution(proposal(c.id));
    expect(second.id).toBe(first.id);
  });

  it('refuses to replace a resolution that is already approved', async () => {
    const c = await seedCase(repo);
    const created = await repo.saveResolution(proposal(c.id));
    await repo.approveResolution(created.id, OWNER, created.contentHash);

    await expect(repo.saveResolution(proposal(c.id))).rejects.toThrow(ApprovalError);
  });
});

/**
 * Data-layer money invariants.
 *
 * These mirror the checks inside write_resolution_atomic() in schema.sql. They
 * exist because the earlier implementation trusted the caller: any proposal
 * whose lines did not add up to its own total could be persisted, and nothing
 * stopped a second resolution from refunding the same customer for the same
 * cancellation. Both are now refusals at the persistence boundary.
 */
describe('data-layer money invariants', () => {
  let repo: MemoryRepository;
  beforeEach(() => {
    repo = new MemoryRepository();
  });

  it('refuses a proposal whose lines do not sum to its declared total', async () => {
    const c = await seedCase(repo);
    const bad = proposal(c.id);
    // Drop a customer but keep the original total: the classic "lost a sen /
    // lost a line" bug that would otherwise be invisible until payout.
    bad.affected = bad.affected.slice(0, 3);
    await expect(repo.saveResolution(bad)).rejects.toBeInstanceOf(IntegrityError);
  });

  it('refuses a proposal that refunds more than the case collected', async () => {
    const c = await seedCase(repo);
    const bad = proposal(c.id);
    // Inflate every paidSen far beyond the recorded payments.
    bad.affected = bad.affected.map((a) => ({ ...a, paidSen: 999999, refundSen: 999999 }));
    bad.totalRefundSen = bad.affected.reduce((s, a) => s + a.refundSen, 0);
    bad.contentHash = 'irrelevant';
    await expect(repo.saveResolution(bad)).rejects.toBeInstanceOf(IntegrityError);
  });

  it('refuses a batch containing the same customer twice', async () => {
    const c = await seedCase(repo);
    const bad = proposal(c.id);
    bad.affected = [bad.affected[0], { ...bad.affected[0] }];
    bad.totalRefundSen = bad.affected.reduce((s, a) => s + a.refundSen, 0);
    await expect(repo.saveResolution(bad)).rejects.toBeInstanceOf(IntegrityError);
  });

  it('refuses a cross-resolution refund for the same supplier cancellation', async () => {
    // The scenario the per-resolution unique constraint cannot catch: the
    // founder opens a SECOND case for the SAME cancellation event and the agent
    // proposes refunds to the same customers again.
    const c1 = await seedCase(repo);
    const first = proposal(c1.id);
    first.affected = first.affected.map((a) => ({ ...a, refundKey: `KEY-${a.customerId}` }));
    const saved1 = await repo.saveResolution(first);
    await repo.approveResolution(saved1.id, OWNER, first.contentHash);

    // A second case, same refund keys => already refunded for this event.
    const c2 = await repo.createCase({
      supplierName: DEMO_CASE.supplierName,
      orderRef: 'GB-2024-014',
      cancellationReason: DEMO_CASE.cancellationReason,
      cancelledOn: DEMO_CASE.cancelledOn,
      orderLines: DEMO_CASE.orderLines,
      payments: DEMO_CASE.payments,
    });
    const dup = proposal(c2.id);
    dup.affected = dup.affected.map((a) => ({ ...a, refundKey: `KEY-${a.customerId}` }));

    await expect(repo.saveResolution(dup)).rejects.toBeInstanceOf(IntegrityError);
  });

  it('allows the same customer to be refunded for a DIFFERENT cancellation', async () => {
    // The guard must not be so broad that it blocks legitimate repeat business.
    const c1 = await seedCase(repo);
    const first = proposal(c1.id);
    first.affected = first.affected.map((a) => ({ ...a, refundKey: `EVENT-A-${a.customerId}` }));
    await repo.saveResolution(first);
    const r1 = await repo.getResolutionForCase(c1.id);
    await repo.approveResolution(r1!.id, OWNER, first.contentHash);

    const c2 = await seedCase(repo);
    const second = proposal(c2.id);
    second.affected = second.affected.map((a) => ({ ...a, refundKey: `EVENT-B-${a.customerId}` }));

    // Different event => different key => allowed.
    await expect(repo.saveResolution(second)).resolves.toBeDefined();
  });
});

describe('approval gating', () => {
  let repo: MemoryRepository;
  beforeEach(() => {
    repo = new MemoryRepository();
  });

  it('H3 approving records the approval time', async () => {
    const c = await seedCase(repo);
    const created = await repo.saveResolution(proposal(c.id));
    const approved = await repo.approveResolution(created.id, OWNER, created.contentHash);
    expect(approved.status).toBe('approved');
    expect(approved.approvedAt).toBeDefined();
  });

  it('T31b a double approval is idempotent — the second call is a no-op', async () => {
    const c = await seedCase(repo);
    const created = await repo.saveResolution(proposal(c.id));
    const first = await repo.approveResolution(created.id, OWNER, created.contentHash);
    const second = await repo.approveResolution(created.id, OWNER, created.contentHash);
    expect(second.status).toBe('approved');
    expect(second.approvedAt).toBe(first.approvedAt);
  });

  it('refuses an approval whose content hash does not match', async () => {
    const c = await seedCase(repo);
    const created = await repo.saveResolution(proposal(c.id));
    await expect(
      repo.approveResolution(created.id, OWNER, 'wrong-hash'),
    ).rejects.toThrow(/changed since you reviewed/i);
  });
});

describe('T31/T32 — execution is compare-and-swap', () => {
  let repo: MemoryRepository;
  beforeEach(() => {
    repo = new MemoryRepository();
  });

  it('H1 refuses to execute a draft that was never approved', async () => {
    const c = await seedCase(repo);
    const created = await repo.saveResolution(proposal(c.id));
    await expect(repo.markExecuted(created.id)).rejects.toThrow(/not approved/i);
  });

  it('executes an approved resolution', async () => {
    const c = await seedCase(repo);
    const created = await repo.saveResolution(proposal(c.id));
    await repo.approveResolution(created.id, OWNER, created.contentHash);
    const executed = await repo.markExecuted(created.id);
    expect(executed.status).toBe('executed');
  });

  it('T31 a second execution attempt is refused, not silently repeated', async () => {
    const c = await seedCase(repo);
    const created = await repo.saveResolution(proposal(c.id));
    await repo.approveResolution(created.id, OWNER, created.contentHash);
    const first = await repo.markExecuted(created.id);
    expect(first.status).toBe('executed');

    // The refusal is an error. Both adapters must behave identically here —
    // a silent success in one adapter would mask a double-execute.
    await expect(repo.markExecuted(created.id)).rejects.toThrow(/already been executed/i);

    // And the stored record is still the single execution.
    const stored = await repo.getResolution(created.id);
    expect(stored!.status).toBe('executed');
    expect(stored!.executedAt).toBe(first.executedAt);
  });

  // Regression: markExecuted originally flipped status to 'executed' without
  // recording WHEN. The Supabase adapter wrote executed_at but mapResolution had
  // no field to read it back into, so the timestamp was silently lost even in
  // production. These two tests pin the behaviour in both directions.
  it('records executedAt when a resolution is executed', async () => {
    const c = await seedCase(repo);
    const created = await repo.saveResolution(proposal(c.id));
    await repo.approveResolution(created.id, OWNER, created.contentHash);

    const executed = await repo.markExecuted(created.id);
    expect(executed.status).toBe('executed');
    expect(executed.executedAt).toBeDefined();
    expect(Number.isNaN(Date.parse(executed.executedAt!))).toBe(false);

    // The timestamp must survive a round-trip through storage, not just exist
    // on the returned object.
    const reloaded = await repo.getResolution(created.id);
    expect(reloaded!.executedAt).toBe(executed.executedAt);
  });

  it('does not advance executedAt on a repeat execution attempt', async () => {
    const c = await seedCase(repo);
    const created = await repo.saveResolution(proposal(c.id));
    await repo.approveResolution(created.id, OWNER, created.contentHash);

    const first = await repo.markExecuted(created.id);
    await new Promise((r) => setTimeout(r, 5));

    // The second attempt is refused. Critically, the refusal must not have
    // rewritten the stored timestamp — otherwise the audit trail would claim
    // the refunds ran later than they actually did.
    await expect(repo.markExecuted(created.id)).rejects.toThrow(/already been executed/i);

    const stored = await repo.getResolution(created.id);
    expect(stored!.executedAt).toBe(first.executedAt);
  });

  it('leaves executedAt undefined for a merely approved resolution', async () => {
    const c = await seedCase(repo);
    const created = await repo.saveResolution(proposal(c.id));
    const approved = await repo.approveResolution(created.id, OWNER, created.contentHash);
    expect(approved.status).toBe('approved');
    expect(approved.executedAt).toBeUndefined();
  });

  it('T32 concurrent execution attempts cannot both succeed', async () => {
    const c = await seedCase(repo);
    const created = await repo.saveResolution(proposal(c.id));
    await repo.approveResolution(created.id, OWNER, created.contentHash);

    const results = await Promise.allSettled([
      repo.markExecuted(created.id),
      repo.markExecuted(created.id),
    ]);
    const fulfilled = results.filter((r) => r.status === 'fulfilled');
    const rejected = results.filter((r) => r.status === 'rejected');

    // Exactly one attempt may win. The loser must be REFUSED, not silently
    // handed the winner's result — a silent success would mean the caller
    // cannot tell whether it caused the execution.
    expect(fulfilled.length).toBe(1);
    expect(rejected.length).toBe(1);

    const stored = await repo.getResolution(created.id);
    expect(stored!.status).toBe('executed');
    expect(stored!.executedAt).toBeDefined();

    const all = await repo.listAudit(created.id);
    expect(all.length).toBe(0); // no audit written by the adapter itself
  });
});

describe('commitments', () => {
  it('saves and lists commitments ordered by day then time', async () => {
    const repo = new MemoryRepository();
    await repo.saveCommitment({ label: 'Late', dayOfWeek: 3, startMinute: 900, endMinute: 1000 });
    await repo.saveCommitment({ label: 'Early', dayOfWeek: 1, startMinute: 540, endMinute: 660 });

    const list = await repo.listCommitments();
    expect(list[0].label).toBe('Early');
    expect(list[1].label).toBe('Late');
  });

  it('deletes a commitment', async () => {
    const repo = new MemoryRepository();
    const saved = await repo.saveCommitment({ label: 'X', dayOfWeek: 1, startMinute: 540, endMinute: 660 });
    await repo.deleteCommitment(saved.id);
    expect(await repo.listCommitments()).toHaveLength(0);
  });
});

describe('audit log', () => {
  it('appends and reads back entries for a resolution', async () => {
    const repo = new MemoryRepository();
    await repo.appendAudit({
      caseId: 'case-1',
      resolutionId: 'res-1',
      actor: OWNER,
      action: 'refund.proposed',
      payload: { amountSen: 8400 },
    });
    const entries = await repo.listAudit('res-1');
    expect(entries).toHaveLength(1);
    expect(entries[0].action).toBe('refund.proposed');
    expect(entries[0].payload).toEqual({ amountSen: 8400 });
    expect(entries[0].createdAt).toBeTruthy();
  });

  it('scopes entries to their resolution', async () => {
    const repo = new MemoryRepository();
    await repo.appendAudit({ caseId: null, resolutionId: 'res-1', actor: OWNER, action: 'a', payload: {} });
    await repo.appendAudit({ caseId: null, resolutionId: 'res-2', actor: OWNER, action: 'b', payload: {} });
    expect(await repo.listAudit('res-1')).toHaveLength(1);
    expect(await repo.listAudit('res-2')).toHaveLength(1);
  });
});

describe('adapter identity', () => {
  it('reports itself as the memory adapter so the UI can be honest about it', () => {
    const repo = new MemoryRepository();
    expect(repo.kind).toBe('memory');
    expect(repo.describe().label).toMatch(/session storage/i);
  });
});
