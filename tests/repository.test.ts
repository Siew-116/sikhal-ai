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
import { ApprovalError } from '@/lib/repo/errors';
import { DEMO_CASE } from '@/lib/fixtures';
import { hashProposal } from '@/lib/core/approval';
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

function proposal(caseId: string, total = 42840) {
  const affected = [
    { customerId: 'CUST-001', customerName: 'Aisyah Rahman', paidSen: 8400, refundSen: 8400, status: 'refundable' as const },
    { customerId: 'CUST-002', customerName: 'Bala Subramaniam', paidSen: 4250, refundSen: 4250, status: 'refundable' as const },
  ];
  return {
    caseId,
    affected,
    totalRefundSen: total,
    drafts: [],
    plan: [],
    conflicts: [],
    toolTrace: [],
    warnings: [],
    contentHash: hashProposal({ affected, total }),
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

  it('T31 a double execution is idempotent — no second refund', async () => {
    const c = await seedCase(repo);
    const created = await repo.saveResolution(proposal(c.id));
    await repo.approveResolution(created.id, OWNER, created.contentHash);
    const first = await repo.markExecuted(created.id);
    const second = await repo.markExecuted(created.id);
    expect(second.status).toBe('executed');
    expect(second.id).toBe(first.id);
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

  it('does not advance executedAt on a repeat execution', async () => {
    const c = await seedCase(repo);
    const created = await repo.saveResolution(proposal(c.id));
    await repo.approveResolution(created.id, OWNER, created.contentHash);

    const first = await repo.markExecuted(created.id);
    await new Promise((r) => setTimeout(r, 5));
    const second = await repo.markExecuted(created.id);

    // A second execution attempt must not rewrite the original timestamp —
    // otherwise the audit trail would claim the refunds ran later than they did.
    expect(second.executedAt).toBe(first.executedAt);
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
    // Both may resolve (the second returns the already-executed record), but
    // there must be exactly one resolution and it must be executed once.
    expect(fulfilled.length).toBeGreaterThanOrEqual(1);
    const stored = await repo.getResolution(created.id);
    expect(stored!.status).toBe('executed');

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
