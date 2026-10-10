/**
 * pipeline.test.ts — the integrated agent pipeline on the demo case.
 *
 * Covers 严核明's T21–T28 (affected set + guards) and the end-to-end shape.
 * Uses the deterministic fallback drafter, so it needs NO credentials.
 */

import { describe, it, expect } from 'vitest';
import { runResolutionPipeline, type PipelineInput } from '@/lib/tools/pipeline';
import {
  DEMO_CASE,
  DEMO_COMMITMENTS,
  DEMO_TOTAL_COLLECTED_SEN,
} from '@/lib/fixtures';
import type { Commitment } from '@/lib/core/conflict';

function demoInput(overrides: Partial<PipelineInput> = {}): PipelineInput {
  return {
    supplierName: DEMO_CASE.supplierName,
    orderRef: DEMO_CASE.orderRef,
    cancellationReason: DEMO_CASE.cancellationReason,
    cancelledOn: DEMO_CASE.cancelledOn,
    orderLines: DEMO_CASE.orderLines,
    payments: DEMO_CASE.payments,
    commitments: DEMO_COMMITMENTS as Commitment[],
    ...overrides,
  };
}

describe('the demo case, end to end', () => {
  it('identifies all six customers as affected', async () => {
    const result = await runResolutionPipeline(demoInput());
    expect(result.affected).toHaveLength(6);
    expect(result.affected.every((a) => a.status === 'refundable')).toBe(true);
  });

  it('computes a refund total of RM428.40 — decimal-safe', async () => {
    const result = await runResolutionPipeline(demoInput());
    expect(result.totalRefundSen).toBe(DEMO_TOTAL_COLLECTED_SEN);
    expect(result.totalRefundSen).toBe(42840);
  });

  it('refunds each customer exactly what they paid (full cancellation)', async () => {
    const result = await runResolutionPipeline(demoInput());
    const byId = new Map(result.affected.map((a) => [a.customerId, a]));

    expect(byId.get('CUST-001')!.refundSen).toBe(8400); // Aisyah
    expect(byId.get('CUST-002')!.refundSen).toBe(4250); // Bala
    expect(byId.get('CUST-003')!.refundSen).toBe(12600); // Chen Wei
    expect(byId.get('CUST-004')!.refundSen).toBe(3890); // Nurul
    expect(byId.get('CUST-005')!.refundSen).toBe(9500); // Daniel (partial payment)
    expect(byId.get('CUST-006')!.refundSen).toBe(4200); // Farah
  });

  it('the refund total equals the sum of the individual refunds', async () => {
    const result = await runResolutionPipeline(demoInput());
    const sum = result.affected.reduce((acc, a) => acc + a.refundSen, 0);
    expect(sum).toBe(result.totalRefundSen);
  });

  it('produces one message draft per refundable customer', async () => {
    const result = await runResolutionPipeline(demoInput());
    expect(result.drafts).toHaveLength(6);
    expect(result.drafts.every((d) => d.body.length > 0)).toBe(true);
  });

  it('labels template drafts as fallback, not as AI', async () => {
    const result = await runResolutionPipeline(demoInput());
    expect(result.drafts.every((d) => d.generatedBy === 'fallback')).toBe(true);
  });

  it('includes the exact refund amount in each draft', async () => {
    const result = await runResolutionPipeline(demoInput());
    const aisyah = result.drafts.find((d) => d.customerId === 'CUST-001');
    expect(aisyah!.body).toContain('RM84.00');
  });

  it('detects exactly one academic conflict — the deliberate demo conflict', async () => {
    const result = await runResolutionPipeline(demoInput());
    expect(result.conflicts).toHaveLength(1);
    expect(result.conflicts[0].commitmentLabel).toMatch(/CS2040/);
  });

  it('marks the conflicting plan step as blocked and proposes an alternative', async () => {
    const result = await runResolutionPipeline(demoInput());
    const blocked = result.plan.filter((s) => s.blocked);
    expect(blocked.length).toBeGreaterThan(0);
    expect(blocked[0].alternative).toBeDefined();
    // The alternative must not itself be during the lecture.
    expect(blocked[0].alternative!.startMinute).toBeGreaterThanOrEqual(16 * 60);
  });

  it('leaves the messages step unblocked', async () => {
    const result = await runResolutionPipeline(demoInput());
    const messages = result.plan.find((s) => s.id === 'STEP-MESSAGES');
    expect(messages!.blocked).toBe(false);
  });

  it('emits a trace entry for every tool in the pipeline', async () => {
    const result = await runResolutionPipeline(demoInput());
    const tools = result.toolTrace.map((t) => t.tool);
    expect(tools).toEqual([
      'extractCase',
      'matchAffectedCustomers',
      'calculateRefunds',
      'draftMessages',
      'planResolution',
      'checkStudyConflicts',
    ]);
    expect(result.toolTrace.every((t) => t.status === 'ok')).toBe(true);
  });

  it('records a duration for each tool — the trace is real, not canned', async () => {
    const result = await runResolutionPipeline(demoInput());
    expect(result.toolTrace.every((t) => typeof t.durationMs === 'number')).toBe(true);
  });

  it('raises a warning when a conflict is present', async () => {
    const result = await runResolutionPipeline(demoInput());
    expect(result.warnings.some((w) => /class or study time/i.test(w))).toBe(true);
  });
});

describe('T21 missing payment — never silently dropped', () => {
  it('records a customer with no payment and excludes them from the total', async () => {
    const input = demoInput({
      payments: DEMO_CASE.payments.filter((p) => p.customerId !== 'CUST-004'),
    });
    const result = await runResolutionPipeline(input);

    const nurul = result.affected.find((a) => a.customerId === 'CUST-004');
    expect(nurul).toBeDefined();
    expect(nurul!.status).toBe('no_payment');
    expect(nurul!.refundSen).toBe(0);

    // Total excludes the RM38.90 that was never recorded as received.
    expect(result.totalRefundSen).toBe(42840 - 3890);
    expect(result.warnings.some((w) => /no recorded payment/i.test(w))).toBe(true);
  });
});

describe('T22 partial cancellation', () => {
  it('refunds only customers on cancelled lines', async () => {
    const lines = DEMO_CASE.orderLines.map((l) =>
      l.customerId === 'CUST-006' ? { ...l, isCancelled: false } : l,
    );
    const result = await runResolutionPipeline(demoInput({ orderLines: lines }));

    expect(result.affected.some((a) => a.customerId === 'CUST-006')).toBe(false);
    expect(result.totalRefundSen).toBe(42840 - 4200);
  });
});

describe('T26 order with no customers', () => {
  it('rejects a case with no order lines before touching money', async () => {
    await expect(runResolutionPipeline(demoInput({ orderLines: [] }))).rejects.toThrow(
      /at least one order line/i,
    );
  });

  it('returns an empty affected set when no lines are cancelled', async () => {
    const lines = DEMO_CASE.orderLines.map((l) => ({ ...l, isCancelled: false }));
    const result = await runResolutionPipeline(demoInput({ orderLines: lines }));
    expect(result.affected).toHaveLength(0);
    expect(result.totalRefundSen).toBe(0);
    expect(result.drafts).toHaveLength(0);
  });
});

describe('T23 no payments recorded for affected lines', () => {
  it('refunds nothing and warns rather than inventing an amount', async () => {
    const result = await runResolutionPipeline(demoInput({ payments: [] }));
    expect(result.totalRefundSen).toBe(0);
    expect(result.affected.every((a) => a.status === 'no_payment')).toBe(true);
  });
});

describe('validation catches malformed input before money is computed', () => {
  it('rejects a missing supplier name', async () => {
    await expect(runResolutionPipeline(demoInput({ supplierName: '  ' }))).rejects.toThrow(
      /supplier name/i,
    );
  });

  it('rejects a missing cancellation reason', async () => {
    await expect(runResolutionPipeline(demoInput({ cancellationReason: '' }))).rejects.toThrow(
      /reason/i,
    );
  });

  it('rejects a non-integer quantity', async () => {
    const lines = DEMO_CASE.orderLines.map((l) =>
      l.customerId === 'CUST-001' ? { ...l, quantity: 1.5 } : l,
    );
    await expect(runResolutionPipeline(demoInput({ orderLines: lines }))).rejects.toThrow(
      /whole number/i,
    );
  });

  it('rejects a fractional sen unit price — float contamination is caught', async () => {
    const lines = DEMO_CASE.orderLines.map((l) =>
      l.customerId === 'CUST-001' ? { ...l, unitPriceSen: 42.5 } : l,
    );
    await expect(runResolutionPipeline(demoInput({ orderLines: lines }))).rejects.toThrow();
  });
});

describe('pipeline with no academic commitments', () => {
  it('reports no conflicts when the founder has no commitments recorded', async () => {
    const result = await runResolutionPipeline(demoInput({ commitments: [] }));
    expect(result.conflicts).toHaveLength(0);
    expect(result.plan.every((s) => !s.blocked)).toBe(true);
  });
});

describe('determinism of the whole pipeline', () => {
  it('two identical runs produce identical refund numbers', async () => {
    const a = await runResolutionPipeline(demoInput());
    const b = await runResolutionPipeline(demoInput());
    expect(a.totalRefundSen).toBe(b.totalRefundSen);
    expect(a.affected).toEqual(b.affected);
  });
});

describe('AI drafting path', () => {
  it('uses the injected AI drafter and labels the draft as AI-generated', async () => {
    const result = await runResolutionPipeline(
      demoInput({
        draftWithAI: async () => 'AI-written message body.',
      }),
    );
    expect(result.drafts.every((d) => d.generatedBy === 'ai')).toBe(true);
    expect(result.drafts[0].body).toBe('AI-written message body.');
  });

  it('falls back to the template when the AI drafter throws', async () => {
    const result = await runResolutionPipeline(
      demoInput({
        draftWithAI: async () => {
          throw new Error('LLM unavailable');
        },
      }),
    );
    expect(result.drafts.every((d) => d.generatedBy === 'fallback')).toBe(true);
    expect(result.drafts[0].body.length).toBeGreaterThan(0);
  });
});
