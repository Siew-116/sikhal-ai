'use client';

import * as React from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import {
  AlertTriangle,
  CheckCircle2,
  Lock,
  Copy,
  Pencil,
  ArrowLeft,
  Loader2,
  ShieldCheck,
  CalendarClock,
} from 'lucide-react';
import { toast } from 'sonner';

import { AppHeader } from '@/components/app-header';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Alert } from '@/components/ui/alert';
import { Label, Textarea } from '@/components/ui/input';
import {
  AlertDialog,
  AlertDialogTrigger,
  AlertDialogContent,
  AlertDialogTitle,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogAction,
  AlertDialogCancel,
} from '@/components/ui/alert-dialog';
import { formatMYR } from '@/lib/core/money';
import type { CaseRecord, Resolution, Commitment } from '@/lib/types';
import { formatDayTime, cn } from '@/lib/utils';

interface Props {
  caseRecord: CaseRecord;
  initialResolution: Resolution;
  commitments: Commitment[];
  storageLabel?: string;
  storageKind?: 'supabase' | 'memory';
}

/**
 * Screen 2 — Review Resolution.
 *
 * The founder inspects the agent's output and explicitly approves. Two safety
 * rules dominate the layout:
 *
 *   1. An academic conflict is the loudest thing on the page (principle 2).
 *   2. Approval is a deliberate act with a recap — never a single tap (§8).
 */
export function ReviewResolutionScreen({
  caseRecord,
  initialResolution,
  commitments,
  storageLabel,
  storageKind,
}: Props) {
  const router = useRouter();
  const [resolution, setResolution] = React.useState(initialResolution);
  const [approving, setApproving] = React.useState(false);
  const [executing, setExecuting] = React.useState(false);
  const [reschedulingId, setReschedulingId] = React.useState<string | null>(null);
  const [dialogOpen, setDialogOpen] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  // Which draft is open for editing, and the working copy of its text.
  const [editingId, setEditingId] = React.useState<string | null>(null);
  const [editText, setEditText] = React.useState('');

  const refundable = resolution.affected.filter((a) => a.status === 'refundable');
  const noPayment = resolution.affected.filter((a) => a.status === 'no_payment');

  // Approval is blocked while any scheduled action still sits on a blocked slot,
  // and while a draft edit is unsaved. An unsaved edit means the text on screen
  // is not the text that would be sent, so approving it would approve a
  // proposal the founder has not actually seen.
  const blockedSteps = resolution.plan.filter((s) => s.blocked);
  const draftDirty = editingId !== null;
  const approvalBlocked = blockedSteps.length > 0 || draftDirty;
  const alreadyApproved = resolution.status === 'approved' || resolution.status === 'executed';

  async function useSuggestedSlot(stepId: string) {
    setReschedulingId(stepId);
    setError(null);
    try {
      const response = await fetch(`/api/resolutions/${resolution.id}/reschedule`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ stepId }),
      });
      const result = await response.json();
      if (!response.ok || !result.resolution) {
        setError(result.error ?? 'Unable to reschedule this action.');
        return;
      }
      setResolution(result.resolution);
      toast.success('Free slot selected. You can now review and approve the plan.');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to reschedule this action.');
    } finally {
      setReschedulingId(null);
    }
  }

  function beginEdit(draft: { customerId: string; body: string }) {
    setEditingId(draft.customerId);
    setEditText(draft.body);
  }

  function cancelEdit() {
    setEditingId(null);
    setEditText('');
  }

  /**
   * Save an edited draft.
   *
   * The edit is local to this review session by design. The message body is NOT
   * part of the approval content hash (which covers only the refund amounts and
   * total), so editing wording must not silently invalidate an approval of the
   * money. If the resolution is already approved, we refuse the edit outright
   * rather than let the founder change staged text behind an approval.
   */
  function saveEdit(customerId: string) {
    if (alreadyApproved) {
      toast.error('This resolution is already approved. Reopen the case to change messages.');
      return;
    }
    setResolution((prev) => ({
      ...prev,
      drafts: prev.drafts.map((d) =>
        d.customerId === customerId ? { ...d, body: editText } : d,
      ),
    }));
    setEditingId(null);
    setEditText('');
    toast.success('Message updated.');
  }

  async function approve() {
    setApproving(true);
    setError(null);
    try {
      const response = await fetch(`/api/resolutions/${resolution.id}/approve`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ contentHash: resolution.contentHash, approvedBy: 'founder' }),
      });
      const payload = await response.json();
      if (!response.ok) {
        setError(payload.error ?? 'Could not record your approval.');
        setApproving(false);
        return;
      }
      setResolution(payload.resolution);
      setDialogOpen(false);
      toast.success(
        `Resolution approved. ${refundable.length} refund${refundable.length === 1 ? '' : 's'} and ${resolution.drafts.length} message${resolution.drafts.length === 1 ? '' : 's'} staged.`,
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not record your approval.');
    } finally {
      setApproving(false);
    }
  }

  async function execute() {
    setExecuting(true);
    setError(null);
    try {
      const response = await fetch(`/api/resolutions/${resolution.id}/approve`, {
        method: 'PUT',
      });
      const payload = await response.json();
      if (!response.ok) {
        setError(payload.error ?? 'Could not complete the resolution.');
        setExecuting(false);
        return;
      }
      setResolution(payload.resolution);
      toast.success('Internal workflow recorded. No refunds were paid or messages sent.');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not complete the resolution.');
    } finally {
      setExecuting(false);
    }
  }

  function copyDraft(body: string) {
    navigator.clipboard.writeText(body).then(
      () => toast.success('Message copied to your clipboard.'),
      () => toast.error('Could not copy — select the text manually.'),
    );
  }

  return (
    <>
      <AppHeader
        screenTitle="Review Resolution"
        storageLabel={storageLabel}
        storageKind={storageKind}
      />

      <main className="sikhal-container py-6 md:py-10">
        <Link
          href="/"
          className="inline-flex items-center gap-1.5 text-body-sm text-accent hover:underline"
        >
          <ArrowLeft className="h-4 w-4" aria-hidden="true" />
          Back to new case
        </Link>

        <section className="mt-8 border-y border-border-strong bg-[#E1E3D4] px-5 py-8 sm:px-8 lg:py-11">
          <div className="flex flex-wrap items-center justify-between gap-4">
            <span className="sikhal-eyebrow">RESOLUTION / {caseRecord.orderRef}</span>
            <StatusPill status={resolution.status} />
          </div>
          <div className="mt-7 grid gap-8 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)] lg:items-start lg:gap-10">
            <div>
              <h1 className="sikhal-display text-[clamp(2.8rem,4.5vw,4.9rem)]">
                CUT TO THE<br/><span className="text-accent">RESOLUTION.</span>
              </h1>
              <p className="mt-6 max-w-[450px] text-base leading-7 text-text-primary">
                {caseRecord.supplierName} cancelled {caseRecord.orderRef}. Review the amounts, clear any class conflicts, then approve the proposed actions.
              </p>
              <p className="mt-5 font-mono text-[11px] leading-5 text-text-secondary">
                PROPOSAL ONLY — NO AUTOMATIC REFUNDS OR CUSTOMER MESSAGES
              </p>
            </div>
            <div className="border border-border-strong bg-[#F8F5EA]">
              <div className="flex items-center justify-between border-b border-border-strong px-5 py-4">
                <span className="sikhal-eyebrow">DECISION SUMMARY</span>
                <span className="font-mono text-[11px] text-text-secondary">MYR / VERIFIED PAYMENTS</span>
              </div>
              <div className="px-5 py-7 sm:px-7">
                <p className="font-mono text-[11px] uppercase tracking-wider text-text-secondary">Proposed refund total</p>
                <p className="tabular mt-3 text-[clamp(2.5rem,5vw,4.5rem)] font-bold leading-none tracking-[-0.065em] text-text-primary">
                  {formatMYR(resolution.totalRefundSen)}
                </p>
              </div>
              <div className="grid grid-cols-2 border-t border-border-strong">
                <div className="border-r border-border-strong p-5">
                  <p className="font-mono text-[10px] uppercase tracking-wider text-text-secondary">Affected customers</p>
                  <p className="tabular mt-2 text-3xl font-semibold">{refundable.length}</p>
                </div>
                <div className="p-5">
                  <p className="font-mono text-[10px] uppercase tracking-wider text-text-secondary">Academic conflicts</p>
                  <p className="tabular mt-2 text-3xl font-semibold">{blockedSteps.length}</p>
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* ── ACADEMIC CONFLICT — the loudest element on the page ─────── */}
        {blockedSteps.length > 0 && (
          <Alert
            variant="warning"
            title={`Academic conflict — ${blockedSteps.length} proposed action${
              blockedSteps.length === 1 ? '' : 's'
            } collides with your classes`}
            className="mt-6"
          >
            <ul className="grid gap-1.5">
              {blockedSteps.map((step) => {
                const conflict = resolution.conflicts.find((c) => c.actionId === step.id);
                return (
                  <li key={step.id}>
                    <span className="font-medium">{step.label}</span> at{' '}
                    <span className="tabular">
                      {formatDayTime(step.dayOfWeek, step.startMinute, step.endMinute)}
                    </span>{' '}
                    falls in {conflict?.commitmentLabel ?? 'a class'}.
                    {step.alternative && (
                      <>
                        {' '}
                        A free slot is{' '}
                        <span className="tabular font-medium">
                          {formatDayTime(
                            step.alternative.dayOfWeek,
                            step.alternative.startMinute,
                            step.alternative.endMinute,
                          )}
                        </span>
                        .
                      </>
                    )}
                  </li>
                );
              })}
            </ul>
            <p className="mt-3 font-mono text-[11px] font-semibold uppercase">Choose a free slot before approval.</p>
            <div className="mt-3 flex flex-wrap gap-2">
              {blockedSteps.filter((step) => step.alternative).map((step) => (
                <Button
                  key={step.id}
                  variant="outline"
                  size="sm"
                  disabled={reschedulingId !== null}
                  onClick={() => useSuggestedSlot(step.id)}
                  className="border-[#B43E2E] text-[#922F22] hover:bg-[#F7E5DE]"
                >
                  {reschedulingId === step.id ? <Loader2 className="h-4 w-4 animate-spin" /> : <CalendarClock className="h-4 w-4" />}
                  Use {formatDayTime(step.alternative!.dayOfWeek, step.alternative!.startMinute, step.alternative!.endMinute)} for {step.label}
                </Button>
              ))}
            </div>
          </Alert>
        )}

        {blockedSteps.length === 0 && (
          <Alert variant="success" title="No academic conflicts" className="mt-6">
            Your planned actions do not overlap your recorded study commitments.
          </Alert>
        )}

        {/* Non-refundable customers are surfaced, never silently dropped. */}
        {noPayment.length > 0 && (
          <Alert
            variant="warning"
            title={`${noPayment.length} customer${noPayment.length === 1 ? '' : 's'} with no recorded payment`}
            className="mt-4"
          >
            <ul className="grid gap-1">
              {noPayment.map((a) => (
                <li key={a.customerId}>
                  <span className="font-medium">{a.customerName}</span> — {a.note}
                </li>
              ))}
            </ul>
          </Alert>
        )}

        <div className="mt-8 grid gap-5 lg:grid-cols-[minmax(0,1.55fr)_minmax(0,1fr)]">
          {/* ── Refunds ───────────────────────────────────────────────── */}
          <Card>
            <CardHeader>
              <CardTitle className="text-subheading">Proposed refunds</CardTitle>
              <CardDescription>
                Based on recorded payments. Review every amount before approving.
              </CardDescription>
            </CardHeader>
            <CardContent>
              {refundable.length === 0 ? (
                <Alert variant="info" title="No affected customers identified">
                  There is nobody to refund on this case.{' '}
                  <Link href="/" className="underline">
                    Start a new case
                  </Link>
                  .
                </Alert>
              ) : (
                <>
                  {/* Desktop table */}
                  <div className="hidden sm:block">
                    <table className="w-full border-collapse text-body-sm">
                      <caption className="sr-only">
                        Refund amounts per affected customer
                      </caption>
                      <thead>
                        <tr className="border-b border-border-strong text-left">
                          <th scope="col" className="pb-2 pr-3 font-medium text-text-secondary">
                            Customer
                          </th>
                          <th scope="col" className="pb-2 pr-3 text-right font-medium text-text-secondary">
                            Paid
                          </th>
                          <th scope="col" className="pb-2 text-right font-medium text-text-secondary">
                            Refund
                          </th>
                        </tr>
                      </thead>
                      <tbody>
                        {refundable.map((a) => (
                          <tr key={a.customerId} className="border-b border-border last:border-0">
                            <td className="py-2.5 pr-3 text-text-primary">{a.customerName}</td>
                            <td className="tabular py-2.5 pr-3 text-right text-text-secondary">
                              {formatMYR(a.paidSen)}
                            </td>
                            <td className="tabular py-2.5 text-right font-medium text-text-primary">
                              {formatMYR(a.refundSen)}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                      <tfoot>
                        <tr className="border-t border-border-strong">
                          <th scope="row" className="pt-3 pr-3 text-left text-body-sm font-medium text-text-secondary">
                            Total
                          </th>
                          <td />
                          <td className="tabular pt-3 text-right text-money-lg font-semibold text-text-primary">
                            {formatMYR(resolution.totalRefundSen)}
                          </td>
                        </tr>
                      </tfoot>
                    </table>
                  </div>

                  {/* Mobile list */}
                  <div className="grid gap-3 sm:hidden">
                    {refundable.map((a) => (
                      <div key={a.customerId} className="rounded-md border border-border p-3">
                        <p className="font-medium text-text-primary">{a.customerName}</p>
                        <dl className="mt-2 grid grid-cols-2 gap-2 text-body-sm">
                          <div>
                            <dt className="text-text-secondary">Paid</dt>
                            <dd className="tabular text-text-primary">{formatMYR(a.paidSen)}</dd>
                          </div>
                          <div>
                            <dt className="text-text-secondary">Refund</dt>
                            <dd className="tabular font-medium text-text-primary">
                              {formatMYR(a.refundSen)}
                            </dd>
                          </div>
                        </dl>
                      </div>
                    ))}
                    <div className="flex items-baseline justify-between border-t border-border-strong pt-3">
                      <span className="text-body-sm text-text-secondary">Total</span>
                      <span className="tabular text-money-lg font-semibold">
                        {formatMYR(resolution.totalRefundSen)}
                      </span>
                    </div>
                  </div>
                </>
              )}
            </CardContent>
          </Card>

          {/* ── Timeline ─────────────────────────────────────────────── */}
          <Card>
            <CardHeader>
              <CardTitle className="text-subheading">Your action plan</CardTitle>
            </CardHeader>
            <CardContent>
              <ol className="grid gap-4">
                {resolution.plan.map((step) => (
                  <li key={step.id} className="flex gap-3">
                    <span
                      className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-caption font-semibold"
                      style={{
                        background: step.blocked ? 'var(--danger-bg)' : 'var(--surface-sunken)',
                        color: step.blocked ? 'var(--danger)' : 'var(--text-secondary)',
                      }}
                      aria-hidden="true"
                    >
                      {step.order}
                    </span>
                    <div className="min-w-0 flex-1">
                      <p className="text-body-sm font-medium text-text-primary">{step.label}</p>
                      <p className="mt-0.5 text-caption text-text-secondary">{step.detail}</p>

                      {step.hasSlot !== false && (
                        <div className="mt-1.5 flex flex-wrap items-center gap-2">
                          {step.blocked ? (
                            <>
                              <Badge variant="danger">
                                <AlertTriangle className="h-3 w-3" aria-hidden="true" />
                                BLOCKED
                              </Badge>
                              <span className="tabular text-caption text-text-secondary line-through">
                                {formatDayTime(step.dayOfWeek, step.startMinute, step.endMinute)}
                              </span>
                              <span className="text-caption text-text-secondary">
                                — unavailable (class)
                              </span>
                            </>
                          ) : (
                            <Badge variant="success">
                              <CheckCircle2 className="h-3 w-3" aria-hidden="true" />
                              Available
                            </Badge>
                          )}
                          {!step.blocked && (
                            <span className="tabular text-caption text-text-secondary">
                              {formatDayTime(step.dayOfWeek, step.startMinute, step.endMinute)}
                            </span>
                          )}
                        </div>
                      )}

                      {step.blocked && step.alternative && (
                        <p className="mt-1.5 text-caption text-text-secondary">
                          Suggested free slot:{' '}
                          <span className="tabular font-medium text-text-primary">
                            {formatDayTime(
                              step.alternative.dayOfWeek,
                              step.alternative.startMinute,
                              step.alternative.endMinute,
                            )}
                          </span>
                        </p>
                      )}
                    </div>
                  </li>
                ))}
              </ol>

              {resolution.plan.some((s) => s.hasSlot === false) && (
                <p className="mt-4 border-t border-border pt-3 text-caption text-text-muted">
                  Steps without a proposed time are actions you perform in this app, so they are not
                  checked against your timetable.
                </p>
              )}
            </CardContent>
          </Card>
        </div>

        {/* ── Message drafts ─────────────────────────────────────────── */}
        <Card className="mt-5">
          <CardHeader>
            <CardTitle className="text-subheading">
              Customer messages ({resolution.drafts.length})
            </CardTitle>
            <CardDescription>
              Drafts are for your review and copying. SikHal does not automatically send messages,
              even after approval.
            </CardDescription>
          </CardHeader>
          <CardContent className="grid gap-4">
            {resolution.drafts.some((draft) => draft.generatedBy === 'fallback') && (
              <Alert variant="info" title="Template fallback is active">
                {resolution.toolTrace.find((entry) => entry.tool === 'draftMessages')?.summary
                  ?? 'The AI did not produce a usable draft. The safe template was used instead.'}
                {' '}These messages were not sent.
              </Alert>
            )}
            {resolution.drafts.length === 0 ? (
              <Alert variant="info" title="No customer messages were generated">
                This happens when there are no refundable customers.
              </Alert>
            ) : (
              resolution.drafts.map((draft) => {
                const isEditing = editingId === draft.customerId;
                return (
                  <div key={draft.customerId} className="border-t border-border-strong py-5 first:border-t-0">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div className="flex items-center gap-2">
                        <span className="text-body-sm font-medium text-text-primary">
                          {draft.customerName}
                        </span>
                        <Badge variant={draft.generatedBy === 'ai' ? 'info' : 'neutral'}>
                          {draft.generatedBy === 'ai' ? 'AI drafted' : 'Template'}
                        </Badge>
                      </div>
                      <div className="flex items-center gap-2">
                        {isEditing ? (
                          <>
                            <Button variant="ghost" size="sm" onClick={cancelEdit}>
                              Cancel
                            </Button>
                            <Button size="sm" onClick={() => saveEdit(draft.customerId)}>
                              Save
                            </Button>
                          </>
                        ) : (
                          <>
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() => beginEdit(draft)}
                              disabled={alreadyApproved}
                              // Explain the refusal inline; a disabled control
                              // with no reason reads as a broken app.
                              title={
                                alreadyApproved
                                  ? 'This resolution is already approved.'
                                  : undefined
                              }
                            >
                              <Pencil className="h-3.5 w-3.5" aria-hidden="true" />
                              Edit
                            </Button>
                            <Button
                              variant="outline"
                              size="sm"
                              onClick={() => copyDraft(draft.body)}
                            >
                              <Copy className="h-3.5 w-3.5" aria-hidden="true" />
                              Copy
                            </Button>
                          </>
                        )}
                      </div>
                    </div>
                    {isEditing ? (
                      <div className="mt-3">
                        <Label htmlFor={`draft-${draft.customerId}`} className="sr-only">
                          Message for {draft.customerName}
                        </Label>
                        <Textarea
                          id={`draft-${draft.customerId}`}
                          value={editText}
                          onChange={(e) => setEditText(e.target.value)}
                          rows={6}
                          className="max-w-prose text-body-sm"
                        />
                      </div>
                    ) : (
                      <p
                        className="mt-3 max-w-prose whitespace-pre-wrap rounded-sm p-3 text-body-sm text-text-primary"
                        style={{ background: 'var(--surface-sunken)' }}
                      >
                        {draft.body}
                      </p>
                    )}
                  </div>
                );
              })
            )}
          </CardContent>
        </Card>

        {/* ── Agent trace + commitments (transparency) ───────────────── */}
        <div className="mt-10 grid gap-5 lg:grid-cols-2">
          <Card>
            <CardHeader>
              <CardTitle className="text-subheading">How this was worked out</CardTitle>
              <CardDescription>Each step is a real tool execution.</CardDescription>
            </CardHeader>
            <CardContent>
              <ul className="grid gap-2.5">
                {resolution.toolTrace.map((t, i) => (
                  <li key={`${t.tool}-${i}`} className="flex items-start justify-between gap-3">
                    <span className="text-body-sm text-text-primary">{t.label}</span>
                    <span className="tabular shrink-0 text-caption text-text-muted">
                      {t.durationMs}ms
                    </span>
                  </li>
                ))}
              </ul>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-subheading">Your study commitments</CardTitle>
              <CardDescription>
                Actions are checked against these. Entered by you, stored in the database.
              </CardDescription>
            </CardHeader>
            <CardContent>
              {commitments.length === 0 ? (
                <p className="text-body-sm text-text-muted">No commitments recorded.</p>
              ) : (
                <ul className="grid gap-2">
                  {commitments.map((c) => (
                    <li key={c.id} className="flex items-start gap-2.5">
                      <CalendarClock
                        className="mt-0.5 h-4 w-4 shrink-0"
                        style={{ color: 'var(--text-muted)' }}
                        aria-hidden="true"
                      />
                      <div>
                        <p className="text-body-sm text-text-primary">{c.label}</p>
                        <p className="tabular text-caption text-text-secondary">
                          {formatDayTime(c.dayOfWeek, c.startMinute, c.endMinute)}
                          {c.location ? ` · ${c.location}` : ''}
                        </p>
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </CardContent>
          </Card>
        </div>

        {error && (
          <Alert variant="danger" title="Something went wrong" className="mt-5">
            {error}
          </Alert>
        )}

        {/* ── Action bar ─────────────────────────────────────────────── */}
        <div className="lg:sticky lg:bottom-0 mt-6 border-t border-border-strong bg-bg/95 py-4 backdrop-blur">
          {alreadyApproved ? (
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <div className="flex items-center gap-2">
                <ShieldCheck className="h-5 w-5" style={{ color: 'var(--success)' }} aria-hidden="true" />
                <span className="text-body-sm font-medium text-text-primary">
                  {resolution.status === 'executed'
                    ? 'Internal workflow recorded — refunds and messages still need manual action.'
                    : 'Approved. Refunds and customer messages are ready for manual handling.'}
                </span>
              </div>
              {resolution.status === 'approved' && (
                <Button onClick={execute} disabled={executing}>
                  {executing ? (
                    <>
                      <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
                      Completing…
                    </>
                  ) : (
                    'Record internal workflow as complete'
                  )}
                </Button>
              )}
            </div>
          ) : (
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <AlertDialog open={dialogOpen} onOpenChange={setDialogOpen}>
                <AlertDialogTrigger asChild>
                  <Button
                    size="lg"
                    disabled={approvalBlocked}
                    className="w-full sm:w-auto bg-[#B43E2E] text-white hover:bg-[#922F22]"
                    // Tie the refusal reason to the control. A disabled button is
                    // not focusable, so without this a keyboard or screen-reader
                    // user reaches the control, finds it inert, and is told
                    // nothing about why. The reason is visible text; describedby
                    // makes it the button's accessible description too.
                    aria-describedby="approve-blocked-reason"
                  >
                    <Lock className="h-4 w-4" aria-hidden="true" />
                    Approve &amp; prepare resolution
                  </Button>
                </AlertDialogTrigger>

                <AlertDialogContent>
                  <AlertDialogTitle>Prepare this resolution?</AlertDialogTitle>
                  <AlertDialogDescription>
                    Nothing has happened yet. This prepares the refunds and stages the messages for
                    you to confirm.
                  </AlertDialogDescription>

                  {/* The recap IS the friction — no typing theatre. */}
                  <dl className="mt-5 grid gap-2.5 rounded-md border border-border p-4 text-body-sm">
                    <div className="flex justify-between gap-3">
                      <dt className="text-text-secondary">Refunds to issue</dt>
                      <dd className="tabular font-medium text-text-primary">{refundable.length}</dd>
                    </div>
                    <div className="flex justify-between gap-3">
                      <dt className="text-text-secondary">Total</dt>
                      <dd className="tabular font-medium text-text-primary">
                        {formatMYR(resolution.totalRefundSen)}
                      </dd>
                    </div>
                    <div className="flex justify-between gap-3">
                      <dt className="text-text-secondary">Messages to stage</dt>
                      <dd className="tabular font-medium text-text-primary">
                        {resolution.drafts.length}
                      </dd>
                    </div>
                  </dl>

                  <p className="mt-4 text-body-sm text-text-secondary">
                    This prepares the refunds and stages the messages. It does not move money — no
                    live payment gateway is connected in this MVP, and nothing is sent to your
                    customers.
                  </p>

                  <AlertDialogFooter>
                    <AlertDialogCancel asChild>
                      <Button variant="outline">Cancel</Button>
                    </AlertDialogCancel>
                    <AlertDialogAction
                      onClick={(e) => {
                        e.preventDefault();
                        approve();
                      }}
                      disabled={approving}
                    >
                      {approving ? 'Preparing…' : 'Prepare resolution'}
                    </AlertDialogAction>
                  </AlertDialogFooter>
                </AlertDialogContent>
              </AlertDialog>

              <p
                id="approve-blocked-reason"
                // Announced when it appears so a screen-reader user learns the
                // gate closed without having to hunt for the reason.
                role={approvalBlocked ? 'status' : undefined}
                className={cn(
                  'text-caption sm:text-right',
                  approvalBlocked ? 'text-danger' : 'text-text-muted',
                )}
                style={approvalBlocked ? { color: 'var(--danger)' } : undefined}
              >
                {draftDirty
                  ? 'You have an unsaved message edit. Save or cancel it before approving.'
                  : approvalBlocked
                    ? `Blocked: ${blockedSteps.length} action${
                        blockedSteps.length === 1 ? ' is' : 's are'
                      } scheduled during your classes. Resolve to approve.`
                    : 'Nothing is sent or refunded until you approve.'}
              </p>
            </div>
          )}
        </div>
      </main>
    </>
  );
}

function StatusPill({ status }: { status: Resolution['status'] }) {
  const map: Record<Resolution['status'], { label: string; variant: 'neutral' | 'warning' | 'success' | 'info' | 'danger' }> = {
    draft: { label: 'Draft — awaiting approval', variant: 'warning' },
    approved: { label: 'Approved', variant: 'info' },
    executing: { label: 'Executing', variant: 'info' },
    executed: { label: 'Workflow recorded · not paid/sent', variant: 'info' },
    failed: { label: 'Failed', variant: 'danger' },
  };
  const { label, variant } = map[status];
  return <Badge variant={variant}>{label}</Badge>;
}
