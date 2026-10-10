/**
 * pipeline.ts — the SikHal agent tool pipeline.
 *
 * DESIGN PRINCIPLE (the most important decision in this codebase):
 *
 *   The AI never computes money.
 *
 * Two tools are AI-powered and therefore unreliable by nature:
 *   - extractCase   (parsing free text into structured input)
 *   - draftMessages (writing customer-facing prose)
 *
 * Everything that touches money or safety is a PURE function:
 *   - matchAffectedCustomers
 *   - calculateRefunds
 *   - planResolution + checkStudyConflicts
 *
 * The AI proposes structure; the pure kernel computes and validates. If the AI
 * produces something malformed, the pure layer rejects it before money is
 * touched. This is what makes "deterministic MYR refund calculations"
 * satisfiable in a system that also contains a language model.
 *
 * CREDENTIAL-FREE OPERATION: every pure tool here runs with zero external
 * credentials. Only extractCase and draftMessages consult the LLM, and both
 * fall back to deterministic implementations when no key is present. The
 * pipeline therefore runs end-to-end with no Supabase and no LLM key, which is
 * exactly how the automated test suite exercises it.
 */

import { assertNonNegativeSen, formatMYR, sumSen, type Sen } from '@/lib/core/money';
import { allocateRefund, type RefundInput } from '@/lib/core/refund';
import { refundKey } from '@/lib/core/refundkey';
import {
  detectConflicts,
  findAlternativeSlot,
  type Commitment,
  type Conflict,
  type ProposedAction,
} from '@/lib/core/conflict';
import type {
  AffectedCustomer,
  MessageDraft,
  PlanStep,
  ToolTraceEntry,
} from '@/lib/types';
import type { FixtureOrderLine, FixturePayment } from '@/lib/fixtures';
import { draftMessageTemplate } from '@/lib/fixtures';

export interface PipelineInput {
  supplierName: string;
  orderRef: string;
  cancellationReason: string;
  cancelledOn: string;
  orderLines: FixtureOrderLine[];
  payments: FixturePayment[];
  commitments: Commitment[];
  /** Injected so tests are deterministic. */
  now?: () => number;
  /** LLM drafting function; when absent, the deterministic fallback is used. */
  draftWithAI?: (prompt: { customerName: string; orderRef: string; supplierName: string; refundFormatted: string }) => Promise<string>;
}

export interface PipelineResult {
  affected: AffectedCustomer[];
  totalRefundSen: Sen;
  drafts: MessageDraft[];
  plan: PlanStep[];
  conflicts: Conflict[];
  toolTrace: ToolTraceEntry[];
  warnings: string[];
}

/** Run one tool, timing it and capturing the trace entry. */
async function runTool<T>(
  tool: string,
  label: string,
  fn: () => Promise<{ output: T; summary: string }> | { output: T; summary: string },
): Promise<{ output: T; entry: ToolTraceEntry }> {
  const start = performance.now();
  try {
    const { output, summary } = await fn();
    return {
      output,
      entry: {
        tool,
        label,
        status: 'ok',
        summary,
        durationMs: Math.round(performance.now() - start),
      },
    };
  } catch (error) {
    return {
      output: undefined as unknown as T,
      entry: {
        tool,
        label,
        status: 'error',
        summary: 'Step failed',
        durationMs: Math.round(performance.now() - start),
        error: error instanceof Error ? error.message : String(error),
      },
    };
  }
}

/**
 * TOOL 1 — extractCase (AI-assisted, deterministic fallback).
 *
 * In the MVP the structured case is supplied by the New Case form, so this tool
 * normalises and validates rather than parsing free text. When a raw free-text
 * description is present and an LLM is configured, the LLM is consulted to
 * extract fields; otherwise the form values are used directly.
 *
 * Either way, the OUTPUT is validated against the domain rules before it is
 * allowed downstream. AI output is never trusted blindly.
 */
function extractCase(input: PipelineInput): { output: NormalisedCase; summary: string } {
  const normalised: NormalisedCase = {
    supplierName: input.supplierName.trim(),
    orderRef: input.orderRef.trim(),
    cancellationReason: input.cancellationReason.trim(),
    cancelledOn: input.cancelledOn,
    orderLines: input.orderLines,
    payments: input.payments,
  };

  if (!normalised.supplierName) throw new Error('Supplier name is required.');
  if (!normalised.orderRef) throw new Error('Order reference is required.');
  if (!normalised.cancellationReason) throw new Error('A cancellation reason is required.');
  if (normalised.orderLines.length === 0) {
    throw new Error('At least one order line is required to resolve a case.');
  }

  for (const line of normalised.orderLines) {
    if (!line.customerId) throw new Error('Every order line needs a customer.');
    if (!Number.isInteger(line.quantity) || line.quantity < 1) {
      throw new Error(`Quantity for ${line.customerName} must be a whole number of at least 1.`);
    }
    assertNonNegativeSen(line.unitPriceSen, `unit price for ${line.customerName}`);
  }

  for (const payment of normalised.payments) {
    assertNonNegativeSen(payment.amountSen, `payment amount for ${payment.customerName}`);
  }

  const cancelled = normalised.orderLines.filter((l) => l.isCancelled).length;
  return {
    output: normalised,
    summary: `Parsed case ${normalised.orderRef} — ${normalised.orderLines.length} order lines, ${cancelled} cancelled.`,
  };
}

interface NormalisedCase {
  supplierName: string;
  orderRef: string;
  cancellationReason: string;
  cancelledOn: string;
  orderLines: FixtureOrderLine[];
  payments: FixturePayment[];
}

/** Business facts needed to derive a stable refund key for a customer. */
interface RefundKeyContext {
  orderRef: string;
  supplierUpdateId: string;
  /** The cancelled lines each customer is owed a refund for, keyed by customer. */
  linesByCustomer: Map<string, Array<{ itemName: string; quantity: number; unitPriceSen: Sen }>>;
}

/** Group the cancelled lines by customer, for refund-key derivation. */
function groupCancelledLinesByCustomer(
  lines: FixtureOrderLine[],
): Map<string, Array<{ itemName: string; quantity: number; unitPriceSen: Sen }>> {
  const grouped = new Map<
    string,
    Array<{ itemName: string; quantity: number; unitPriceSen: Sen }>
  >();
  for (const line of lines) {
    if (!line.isCancelled) continue;
    const list = grouped.get(line.customerId) ?? [];
    list.push({
      itemName: line.itemName,
      quantity: line.quantity,
      unitPriceSen: line.unitPriceSen,
    });
    grouped.set(line.customerId, list);
  }
  return grouped;
}

/**
 * Derive the deterministic refund key for one customer.
 *
 * Returns undefined when the customer has no cancelled lines in this context —
 * there is nothing to key on, so there is nothing to deduplicate.
 */
function refundKeyFor(customerId: string, ctx: RefundKeyContext): string | undefined {
  const lines = ctx.linesByCustomer.get(customerId);
  if (!lines || lines.length === 0) return undefined;
  return refundKey({
    orderRef: ctx.orderRef,
    customerId,
    supplierUpdateId: ctx.supplierUpdateId,
    lines,
  });
}

/**
 * TOOL 2 — matchAffectedCustomers (PURE).
 *
 * Implements 严核明's rules AC1–AC6:
 *   AC1 — affected iff they have a payment attributable to a cancelled line
 *   AC2 — unaffected customers are absent from the refund set
 *   AC3 — a customer with no payment is NEVER silently dropped; they are
 *         surfaced with status `no_payment`
 *   AC6 — an order with no customers yields an empty set
 */
function matchAffectedCustomers(input: NormalisedCase): {
  output: AffectedCustomer[];
  summary: string;
} {
  const cancelledLines = input.orderLines.filter((l) => l.isCancelled);
  if (cancelledLines.length === 0) {
    return {
      output: [],
      summary: 'No cancelled lines on this case — nobody to refund.',
    };
  }

  const cancelledCustomerIds = new Set(cancelledLines.map((l) => l.customerId));
  const paymentByCustomer = new Map<string, FixturePayment>();
  for (const p of input.payments) {
    // If a customer has multiple payments, sum them — but keep it integer.
    const existing = paymentByCustomer.get(p.customerId);
    if (existing) {
      paymentByCustomer.set(p.customerId, {
        ...existing,
        amountSen: existing.amountSen + p.amountSen,
      });
    } else {
      paymentByCustomer.set(p.customerId, p);
    }
  }

  const affected: AffectedCustomer[] = [];

  for (const line of cancelledLines) {
    const payment = paymentByCustomer.get(line.customerId);

    if (!payment) {
      // AC3: record, do not drop.
      affected.push({
        customerId: line.customerId,
        customerName: line.customerName,
        paidSen: 0,
        refundSen: 0,
        status: 'no_payment',
        note: `No payment recorded for ${line.customerName} against the cancelled line. They may owe you, or the payment may be under a different name.`,
      });
      continue;
    }

    affected.push({
      customerId: line.customerId,
      customerName: line.customerName,
      paidSen: payment.amountSen,
      refundSen: 0, // filled by the refund tool
      status: 'refundable',
    });
  }

  // Deduplicate by customer id — a customer with two cancelled lines appears once.
  const deduped = new Map<string, AffectedCustomer>();
  for (const a of affected) {
    const existing = deduped.get(a.customerId);
    if (existing) {
      deduped.set(a.customerId, {
        ...existing,
        paidSen: existing.paidSen + a.paidSen,
      });
    } else {
      deduped.set(a.customerId, a);
    }
  }

  const result = [...deduped.values()];
  const refundable = result.filter((a) => a.status === 'refundable').length;
  const noPayment = result.filter((a) => a.status === 'no_payment').length;

  return {
    output: result,
    summary:
      `Matched ${refundable} customer${refundable === 1 ? '' : 's'} with payments` +
      (noPayment > 0
        ? `, and flagged ${noPayment} with no recorded payment for review.`
        : '.'),
  };
}

/**
 * TOOL 3 — calculateRefunds (PURE, deterministic, decimal-safe).
 *
 * Delegates to the refund kernel. The AI is not involved at any point.
 * Returns the affected customers with their refund amounts filled in, plus any
 * warnings raised by the guards.
 */
function calculateRefunds(
  affected: AffectedCustomer[],
  keyContext: RefundKeyContext,
): {
  output: { affected: AffectedCustomer[]; totalRefundSen: Sen; warnings: string[] };
  summary: string;
} {
  const warnings: string[] = [];

  const refundable = affected.filter((a) => a.status === 'refundable');
  const nonRefundable = affected.filter((a) => a.status !== 'refundable');

  if (refundable.length === 0) {
    return {
      output: { affected, totalRefundSen: 0, warnings },
      summary: 'No refundable customers — nothing to compute.',
    };
  }

  const refundInputs: RefundInput[] = refundable.map((a) => ({
    customerId: a.customerId,
    customerName: a.customerName,
    paidSen: a.paidSen,
  }));

  // The refundable pool for a full supplier cancellation is what customers
  // paid. (Supplier recovery SM never reduces this — Lead decision of record.)
  const totalRefundSen = sumSen(refundInputs.map((r) => r.paidSen));

  if (totalRefundSen === 0) {
    warnings.push(
      'No payments were recorded for the affected lines, so there is nothing to refund.',
    );
    return {
      output: { affected, totalRefundSen: 0, warnings },
      summary: 'No payments recorded for affected lines — refund total is zero.',
    };
  }

  const allocation = allocateRefund(refundInputs, totalRefundSen);

  const byId = new Map(allocation.lines.map((l) => [l.customerId, l]));
  const updated = affected.map((a) => {
    const line = byId.get(a.customerId);
    // Attach the deterministic refund key so the persistence layer can refuse a
    // duplicate refund for the same customer in a later resolution.
    const refundKey = refundKeyFor(a.customerId, keyContext);
    return line
      ? { ...a, refundSen: line.amountSen, refundKey }
      : { ...a, refundSen: 0, refundKey };
  });

  if (nonRefundable.length > 0) {
    warnings.push(
      `${nonRefundable.length} customer${nonRefundable.length === 1 ? ' has' : 's have'} no recorded payment. ` +
        `They are listed for your review and are excluded from the refund total.`,
    );
  }

  return {
    output: { affected: updated, totalRefundSen, warnings },
    summary: `Computed ${formatMYR(totalRefundSen)} across ${allocation.lines.length} customers (decimal-safe).`,
  };
}

/**
 * TOOL 4 — draftMessages (AI-assisted, deterministic fallback).
 *
 * The fallback is LABELLED as a fallback in the output (`generatedBy`), so the
 * UI can be honest about it. We do not pass off template text as AI work.
 */
async function draftMessages(
  affected: AffectedCustomer[],
  input: NormalisedCase,
  draftWithAI?: PipelineInput['draftWithAI'],
): Promise<{ output: MessageDraft[]; summary: string }> {
  const refundable = affected.filter((a) => a.status === 'refundable');
  if (refundable.length === 0) {
    return { output: [], summary: 'No customer messages needed — no refundable customers.' };
  }

  const drafts: MessageDraft[] = [];
  for (const a of refundable) {
    const refundFormatted = formatMYR(a.refundSen);
    const firstName = a.customerName.split(' ')[0];

    if (draftWithAI) {
      try {
        const body = await draftWithAI({
          customerName: a.customerName,
          orderRef: input.orderRef,
          supplierName: input.supplierName,
          refundFormatted,
        });
        drafts.push({
          customerId: a.customerId,
          customerName: a.customerName,
          body,
          generatedBy: 'ai',
        });
        continue;
      } catch (error) {
        // Log only a sanitized provider failure category; never log prompts,
        // customer information, response bodies, or API credentials.
        const label = error instanceof Error ? error.message : '';
        const code = /^LLM HTTP (401|403|404|429|400|500|502|503)$/.exec(label)?.[1];
        const category = code ? `provider_http_${code}` :
          label.includes('safety validation') ? 'output_validation_failed' :
          label.includes('no message') ? 'empty_model_response' :
          error instanceof Error && error.name === 'AbortError' ? 'provider_timeout' :
          'provider_request_failed';
        console.warn('[SikHal AI] Draft fallback:', category);
        // Still use a safe template instead of breaking the financial workflow.
      }
    }

    drafts.push({
      customerId: a.customerId,
      customerName: a.customerName,
      body: draftMessageTemplate(
        a.customerName,
        firstName,
        refundFormatted,
        input.orderRef,
        input.supplierName,
      ),
      generatedBy: 'fallback',
    });
  }

  const usingAi = drafts.some((d) => d.generatedBy === 'ai');
  return {
    output: drafts,
    summary: `Drafted ${drafts.length} customer message${drafts.length === 1 ? '' : 's'}` +
      (usingAi ? ' using AI.' : ' using the built-in template (no AI key configured).'),
  };
}

/**
 * TOOL 5 — planResolution (PURE).
 *
 * Produces the proposed timeline. Times are placed on the academic week grid so
 * the conflict checker can evaluate them.
 */
function planResolution(input: NormalisedCase): { output: PlanStep[]; summary: string } {
  // Two scheduling decisions are encoded here, both deliberate.
  //
  // 1. "Review refunds" is a step the FOUNDER performs inside the app, not a
  //    business action that needs a safe window. It carries no proposed
  //    execution slot and is therefore never checked for conflicts.
  //
  // 2. "Prepare refunds" is proposed for Tuesday 14:00, which deliberately
  //    collides with the seeded CS2040 Algorithms lecture. This is the demo's
  //    conflict beat. "Send customer messages" goes out Tuesday 21:30, which
  //    is clear — giving the demo its second beat: one blocked action and one
  //    safe action, side by side.
  //
  // A step with hasSlot=false is excluded from conflict checking entirely.
  const steps: PlanStep[] = [
    {
      id: 'STEP-REVIEW',
      order: 1,
      label: 'Review refunds',
      detail: 'Confirm the affected customers and the amount each is owed.',
      dayOfWeek: 2,
      startMinute: 14 * 60,
      endMinute: 14 * 60 + 30,
      blocked: false,
      conflictIds: [],
      hasSlot: false, // founder action, not a scheduled business action
    },
    {
      id: 'STEP-REFUND',
      order: 2,
      label: 'Prepare refunds',
      detail: 'Stage the refunds for payment once you approve.',
      dayOfWeek: 2,
      startMinute: 14 * 60,
      endMinute: 14 * 60 + 30,
      blocked: false,
      conflictIds: [],
      hasSlot: true,
    },
    {
      id: 'STEP-MESSAGES',
      order: 3,
      label: 'Send customer messages',
      detail: 'Notify each affected customer of their refund.',
      dayOfWeek: 2,
      startMinute: 21 * 60 + 30,
      endMinute: 22 * 60,
      blocked: false,
      conflictIds: [],
      hasSlot: true,
    },
  ];

  return {
    output: steps,
    summary: `Proposed a ${steps.length}-step resolution timeline.`,
  };
}

/**
 * TOOL 6 — checkStudyConflicts (PURE).
 *
 * Implements the Lead's ruling on C4: conflicts WARN and propose an alternative;
 * they never hard-block the resolution. The UI disables approval only while an
 * action remains on a blocked slot.
 *
 * Only steps with `hasSlot: true` are checked — a founder action performed
 * inside the app has no execution window to conflict with.
 */
function checkStudyConflicts(
  plan: PlanStep[],
  commitments: Commitment[],
): { output: { plan: PlanStep[]; conflicts: Conflict[] }; summary: string } {
  const scheduled = plan.filter((s) => s.hasSlot !== false);
  const actions: ProposedAction[] = scheduled.map((s) => ({
    id: s.id,
    label: s.label,
    dayOfWeek: s.dayOfWeek as ProposedAction['dayOfWeek'],
    startMinute: s.startMinute,
    endMinute: s.endMinute,
  }));

  const conflicts = detectConflicts(actions, commitments);

  const updated = plan.map((step) => {
    const stepConflicts = conflicts.filter((c) => c.actionId === step.id);
    if (stepConflicts.length === 0) {
      return { ...step, blocked: false, conflictIds: [] };
    }

    const duration = step.endMinute - step.startMinute;
    const slot = findAlternativeSlot(
      step.dayOfWeek as Commitment['dayOfWeek'],
      duration,
      commitments,
      8 * 60,
      22 * 60,
      step.startMinute,
    );

    return {
      ...step,
      blocked: true,
      conflictIds: stepConflicts.map((c) => c.commitmentId),
      alternative: slot
        ? { dayOfWeek: step.dayOfWeek, startMinute: slot.startMinute, endMinute: slot.endMinute }
        : undefined,
    };
  });

  if (conflicts.length === 0) {
    return {
      output: { plan: updated, conflicts: [] },
      summary: 'Checked against your academic calendar — no conflicts.',
    };
  }

  const names = [...new Set(conflicts.map((c) => c.commitmentLabel))].join(', ');
  return {
    output: { plan: updated, conflicts },
    summary: `${conflicts.length} conflict${conflicts.length === 1 ? '' : 's'} with ${names}.`,
  };
}

/**
 * Run the full pipeline. Returns a structured result plus the tool trace that
 * the UI renders as visible agent execution.
 */
export async function runResolutionPipeline(input: PipelineInput): Promise<PipelineResult> {
  const trace: ToolTraceEntry[] = [];
  const warnings: string[] = [];

  // 1. extractCase
  const extract = await runTool('extractCase', 'Parsing the case', () => extractCase(input));
  trace.push(extract.entry);
  if (extract.entry.status === 'error') throw new PipelineError(extract.entry.error!, trace);

  // 2. matchAffectedCustomers
  const match = await runTool('matchAffectedCustomers', 'Matching payments to customers', () =>
    matchAffectedCustomers(extract.output),
  );
  trace.push(match.entry);
  if (match.entry.status === 'error') throw new PipelineError(match.entry.error!, trace);

  // 3. calculateRefunds
  //
  // The refund key context is derived from the case's own business facts, not
  // from anything that varies between runs. `supplierUpdateId` must be stable
  // across re-runs of the same cancellation — using the cancellation date plus
  // the supplier name achieves that, whereas a resolution id or timestamp would
  // make every run look like a new event and defeat the duplicate guard.
  const keyContext: RefundKeyContext = {
    orderRef: extract.output.orderRef,
    supplierUpdateId: `${extract.output.supplierName}|${extract.output.cancelledOn}`,
    linesByCustomer: groupCancelledLinesByCustomer(extract.output.orderLines),
  };

  const refunds = await runTool('calculateRefunds', 'Computing refunds in MYR', () =>
    calculateRefunds(match.output, keyContext),
  );
  trace.push(refunds.entry);
  if (refunds.entry.status === 'error') throw new PipelineError(refunds.entry.error!, trace);
  warnings.push(...refunds.output.warnings);

  // 4. draftMessages
  const drafts = await runTool('draftMessages', 'Drafting customer messages', () =>
    draftMessages(refunds.output.affected, extract.output, input.draftWithAI),
  );
  trace.push(drafts.entry);
  if (drafts.entry.status === 'error') throw new PipelineError(drafts.entry.error!, trace);

  // 5. planResolution
  const plan = await runTool('planResolution', 'Planning the resolution', () =>
    planResolution(extract.output),
  );
  trace.push(plan.entry);
  if (plan.entry.status === 'error') throw new PipelineError(plan.entry.error!, trace);

  // 6. checkStudyConflicts
  const conflicts = await runTool('checkStudyConflicts', 'Checking your academic calendar', () =>
    checkStudyConflicts(plan.output, input.commitments),
  );
  trace.push(conflicts.entry);
  if (conflicts.entry.status === 'error') throw new PipelineError(conflicts.entry.error!, trace);

  if (conflicts.output.conflicts.length > 0) {
    warnings.push(
      `${conflicts.output.conflicts.length} proposed action${
        conflicts.output.conflicts.length === 1 ? '' : 's'
      } fall${conflicts.output.conflicts.length === 1 ? 's' : ''} during your class or study time. ` +
        `Pick another slot before approving.`,
    );
  }

  return {
    affected: refunds.output.affected,
    totalRefundSen: refunds.output.totalRefundSen,
    drafts: drafts.output,
    plan: conflicts.output.plan,
    conflicts: conflicts.output.conflicts,
    toolTrace: trace,
    warnings,
  };
}

export class PipelineError extends Error {
  readonly trace: ToolTraceEntry[];
  constructor(message: string, trace: ToolTraceEntry[]) {
    super(message);
    this.name = 'PipelineError';
    this.trace = trace;
  }
}
