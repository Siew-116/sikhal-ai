'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import { Plus, Trash2, ArrowRight, Loader2, Check, ShieldCheck, BookOpen } from 'lucide-react';
import { toast } from 'sonner';

import { AppHeader } from '@/components/app-header';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Input, Label, Textarea } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Alert } from '@/components/ui/alert';
import { AgentRunPanel } from '@/components/agent-run-panel';
import { formatMYR, formatMYRPlain, parseMYR, MoneyError } from '@/lib/core/money';
import { DEMO_CASE } from '@/lib/fixtures';
import { cn } from '@/lib/utils';

interface RecordRow {
  key: string;
  customerId: string;
  customerName: string;
  itemName: string;
  quantity: string;
  paid: string;
  status: 'paid' | 'partial' | 'unpaid';
}

let rowCounter = 0;
function newRow(): RecordRow {
  rowCounter += 1;
  return {
    key: `row-${rowCounter}`,
    customerId: `CUST-${String(rowCounter).padStart(3, '0')}`,
    customerName: '',
    itemName: '',
    quantity: '1',
    paid: '',
    status: 'paid',
  };
}

const EMPTY_ROW = newRow();

/**
 * Screen 1 — New Case.
 *
 * The founder records a supplier cancellation and runs the agent. Every control
 * here has a real handler; there are no mock buttons.
 */
export function NewCaseScreen({ storageLabel, storageKind }: { storageLabel?: string; storageKind?: 'supabase' | 'memory' }) {
  const router = useRouter();

  const [supplierName, setSupplierName] = React.useState('');
  const [orderRef, setOrderRef] = React.useState('');
  const [cancelledOn, setCancelledOn] = React.useState('');
  const [reason, setReason] = React.useState('');
  const [rows, setRows] = React.useState<RecordRow[]>([EMPTY_ROW]);

  const [sampleLoaded, setSampleLoaded] = React.useState(false);
  const [loadingSample, setLoadingSample] = React.useState(false);
  const [running, setRunning] = React.useState(false);
  const [runSteps, setRunSteps] = React.useState<
    Array<{ label: string; status: 'pending' | 'running' | 'ok' | 'error'; summary?: string; durationMs?: number }>
  >([]);
  const [formError, setFormError] = React.useState<string | null>(null);

  const requiredFilled =
    supplierName.trim() !== '' &&
    orderRef.trim() !== '' &&
    cancelledOn !== '' &&
    reason.trim() !== '' &&
    rows.every(
      (r) => r.customerName.trim() !== '' && r.quantity.trim() !== '' && r.paid.trim() !== '',
    );

  // Live, decimal-safe sub-total of what has been entered. Never computed from
  // a float, and never the basis of the authoritative total (the server owns that).
  const subTotal = React.useMemo(() => {
    let total = 0;
    for (const r of rows) {
      if (!r.paid.trim()) continue;
      try {
        total += parseMYR(r.paid);
      } catch {
        return { value: null, invalid: true };
      }
    }
    return { value: total, invalid: false };
  }, [rows]);

  function loadSample() {
    setLoadingSample(true);
    setFormError(null);
    // A real state transition, not a fake delay: the sample is populated and the
    // badge marks it as sample data.
    try {
      setSupplierName(DEMO_CASE.supplierName);
      setOrderRef(DEMO_CASE.orderRef);
      setCancelledOn(DEMO_CASE.cancelledOn);
      setReason(DEMO_CASE.cancellationReason);
      setRows(
        DEMO_CASE.orderLines.map((line, i) => {
          const payment = DEMO_CASE.payments.find((p) => p.customerId === line.customerId);
          return {
            key: `sample-${i}`,
            customerId: line.customerId,
            customerName: line.customerName,
            itemName: line.itemName,
            quantity: String(line.quantity),
            // formatMYRPlain is integer-only and round-trips through parseMYR.
            // Never use (sen / 100).toFixed(2) — that puts a float in the money path.
            paid: formatMYRPlain(payment?.amountSen ?? 0),
            status: payment?.status ?? 'paid',
          };
        }),
      );
      setSampleLoaded(true);
    } catch (error) {
      setFormError(error instanceof Error ? error.message : 'Could not load the sample case.');
    } finally {
      setLoadingSample(false);
    }
  }

  function clearSample() {
    setSupplierName('');
    setOrderRef('');
    setCancelledOn('');
    setReason('');
    setRows([newRow()]);
    setSampleLoaded(false);
  }

  function updateRow(key: string, patch: Partial<RecordRow>) {
    setRows((prev) => prev.map((r) => (r.key === key ? { ...r, ...patch } : r)));
  }

  function addRow() {
    setRows((prev) => [...prev, newRow()]);
  }

  function removeRow(key: string) {
    // Never remove the last record — the screen always has somewhere to type.
    setRows((prev) => (prev.length === 1 ? prev : prev.filter((r) => r.key !== key)));
  }

  async function runAgent() {
    setFormError(null);

    // Validate money strings before sending anything to the server.
    const orderLines = [];
    const payments = [];
    for (const r of rows) {
      let paidSen: number;
      try {
        paidSen = r.paid.trim() ? parseMYR(r.paid) : 0;
      } catch (error) {
        setFormError(
          error instanceof MoneyError
            ? `${r.customerName || 'A record'}: ${error.message}`
            : 'One of the amounts is not a valid MYR value.',
        );
        return;
      }
      if (!Number.isInteger(Number(r.quantity)) || Number(r.quantity) < 1) {
        setFormError(`${r.customerName || 'A record'}: quantity must be a whole number of at least 1.`);
        return;
      }
      orderLines.push({
        customerId: r.customerId,
        customerName: r.customerName.trim(),
        itemName: r.itemName.trim() || 'Group-buy item',
        quantity: Number(r.quantity),
        unitPriceSen: paidSen,
        isCancelled: true,
      });
      payments.push({
        customerId: r.customerId,
        customerName: r.customerName.trim(),
        amountSen: paidSen,
        status: r.status,
        reference: 'ENTERED',
      });
    }

    // Show the tool pipeline immediately so the founder sees real work.
    const initialSteps = [
      { label: 'Parsing the case', status: 'running' as const },
      { label: 'Matching payments to customers', status: 'pending' as const },
      { label: 'Computing refunds in MYR', status: 'pending' as const },
      { label: 'Drafting customer messages', status: 'pending' as const },
      { label: 'Planning the resolution', status: 'pending' as const },
      { label: 'Checking your academic calendar', status: 'pending' as const },
    ];
    setRunSteps(initialSteps);
    setRunning(true);

    try {
      const response = await fetch('/api/cases', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          supplierName: supplierName.trim(),
          orderRef: orderRef.trim(),
          cancellationReason: reason.trim(),
          cancelledOn,
          orderLines,
          payments,
        }),
      });

      const payload = await response.json();

      if (!response.ok) {
        // If the server returned a partial trace, show exactly which step failed.
        if (payload.toolTrace) {
          setRunSteps(
            payload.toolTrace.map((t: { label: string; status: string; summary?: string; durationMs: number }) => ({
              label: t.label,
              status: t.status as 'ok' | 'error',
              summary: t.summary,
              durationMs: t.durationMs,
            })),
          );
        } else {
          setRunSteps((prev) => prev.map((s) => ({ ...s, status: 'error' as const })));
        }
        setFormError(payload.error ?? 'Something needs attention.');
        setRunning(false);
        return;
      }

      // Render the real trace returned by the server.
      setRunSteps(
        payload.resolution.toolTrace.map(
          (t: { label: string; status: string; summary?: string; durationMs: number }) => ({
            label: t.label,
            status: t.status as 'ok' | 'error',
            summary: t.summary,
            durationMs: t.durationMs,
          }),
        ),
      );

      toast.success(`Resolution prepared for ${orderRef.trim()}.`);
      router.push(`/cases/${payload.case.id}/resolution`);
    } catch (error) {
      setRunSteps((prev) => prev.map((s) => (s.status === 'running' ? { ...s, status: 'error' as const } : s)));
      setFormError(
        error instanceof Error
          ? `The agent run failed: ${error.message}`
          : 'The agent run failed.',
      );
      setRunning(false);
    }
  }

  return (
    <>
      <AppHeader screenTitle="New Case" storageLabel={storageLabel} storageKind={storageKind} />

      <main className="sikhal-container py-6 md:py-10">
        <section className="grid gap-10 border-b border-border-strong pb-12 pt-9 lg:grid-cols-[minmax(0,1fr)_minmax(320px,.86fr)] lg:items-stretch lg:gap-14">
          <div className="flex flex-col justify-center">
            <p className="sikhal-eyebrow mb-6">01 / THE PROBLEM — START HERE</p>
            <h1 className="sikhal-display max-w-[700px] text-[clamp(3.6rem,7.5vw,7.2rem)]">
              ORDER<br/>CANCELLED<span className="text-accent">.</span><br/>MOVE FORWARD.
            </h1>
            <p className="mt-7 max-w-[520px] text-base leading-7 text-text-primary">
              Turn a supplier cancellation into a clear refund plan. Know who is owed what, avoid class-time clashes, and keep every decision on record.
            </p>
            <p className="mt-6 max-w-[520px] font-mono text-[11px] leading-5 text-text-secondary">
              EXACT MYR REFUNDS / HUMAN APPROVAL / NO AUTOMATIC PAYMENTS OR MESSAGES
            </p>
          </div>
          <aside className="flex flex-col border border-border-strong bg-[#F8F5EA]">
            <div className="flex items-center justify-between gap-4 border-b border-border-strong px-5 py-4">
              <p className="sikhal-eyebrow">EXAMPLE CASE / 014</p>
              <span className="font-mono text-[11px] text-text-secondary">SARAWAK</span>
            </div>
            <div className="flex flex-1 flex-col justify-center p-6 sm:p-9">
              <p className="font-mono text-[11px] uppercase tracking-wider text-text-secondary">SIX CUSTOMERS. ONE CANCELLED ORDER.</p>
              <h2 className="sikhal-display mt-6 text-[clamp(2.8rem,4vw,4.8rem)]">SEE THE<br/>RESOLUTION.</h2>
              <p className="mt-5 max-w-[340px] text-sm leading-6 text-text-secondary">
                Test SikHal with fictional payments, refund calculations, and an academic calendar conflict.
              </p>
              <Button className="mt-8 w-full justify-between" onClick={loadSample} disabled={loadingSample || running}>
                {sampleLoaded ? 'Reload sample case' : 'Load sample case'}
                {loadingSample ? <Loader2 className="h-4 w-4 animate-spin" /> : <ArrowRight className="h-4 w-4" />}
              </Button>
              {sampleLoaded && <p className="mt-4 font-mono text-[11px] text-text-secondary">Sample records are ready below.</p>}
            </div>
            <div className="border-t border-border-strong px-5 py-3 font-mono text-[10px] text-text-secondary">
              DEMONSTRATION DATA — NOTHING PAID OR SENT
            </div>
          </aside>
        </section>
        <div className="mb-6 mt-10 flex flex-wrap items-end justify-between gap-3">
          <div>
            <p className="sikhal-eyebrow">01 — CASE DETAILS</p>
            <h2 className="mt-2 text-[clamp(1.8rem,3vw,2.7rem)] font-semibold tracking-[-0.045em]">What happened?</h2>
            <p className="mt-1 text-sm text-text-secondary">Start with the supplier and order details.</p>
          </div>
          {sampleLoaded && <Button variant="outline" size="sm" onClick={clearSample} disabled={running}>Clear example</Button>}
        </div>
        <div className="max-w-[840px]">
          {/* ── Case details ──────────────────────────────────────────── */}
          <Card>
            <CardHeader>
              <CardTitle className="text-subheading">Case details</CardTitle>
            </CardHeader>
            <CardContent className="grid gap-4">
              <div>
                <Label htmlFor="supplier">Supplier name</Label>
                <Input
                  id="supplier"
                  className="mt-1.5"
                  value={supplierName}
                  onChange={(e) => setSupplierName(e.target.value)}
                  placeholder="e.g. Kuching Harvest Trading"
                  disabled={running}
                  aria-invalid={supplierName.trim() === '' ? undefined : false}
                />
              </div>

              <div className="grid gap-4 sm:grid-cols-2">
                <div>
                  <Label htmlFor="orderRef">Order / group-buy reference</Label>
                  <Input
                    id="orderRef"
                    className="mt-1.5"
                    value={orderRef}
                    onChange={(e) => setOrderRef(e.target.value)}
                    placeholder="e.g. GB-2024-014"
                    disabled={running}
                  />
                </div>
                <div>
                  <Label htmlFor="cancelledOn">Cancellation date</Label>
                  <Input
                    id="cancelledOn"
                    type="date"
                    className="mt-1.5"
                    value={cancelledOn}
                    onChange={(e) => setCancelledOn(e.target.value)}
                    disabled={running}
                  />
                </div>
              </div>

              <div>
                <Label htmlFor="reason">Reason for cancellation</Label>
                <Textarea
                  id="reason"
                  className="mt-1.5"
                  rows={3}
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                  placeholder="What did the supplier say?"
                  disabled={running}
                  maxLength={500}
                />
                <p className="mt-1 text-caption text-text-muted">
                  {reason.length} / 500 characters
                </p>
              </div>
            </CardContent>
          </Card>
        </div>

        {/* ── Affected order records ────────────────────────────────── */}
        <div className="mb-4 mt-10"><p className="text-xs font-semibold uppercase tracking-wider text-accent">02 — ORDER RECORDS</p><h2 className="mt-1 text-2xl font-semibold tracking-tight">Who paid for the cancelled items?</h2><p className="mt-1 text-sm text-text-secondary">Enter one row per cancelled order item.</p></div>
        <Card className="mt-5">
          <CardHeader className="flex-row items-center justify-between">
            <div>
              <CardTitle className="text-subheading">
                Affected order records ({rows.length})
              </CardTitle>
              <CardDescription>
                One record per customer on a cancelled line. Enter what each actually paid.
              </CardDescription>
            </div>
            <Button variant="outline" size="sm" onClick={addRow} disabled={running}>
              <Plus className="h-4 w-4" aria-hidden="true" />
              Add customer
            </Button>
          </CardHeader>

          <CardContent>
            {/* Desktop table */}
            <div className="hidden lg:block">
              <table className="w-full border-collapse text-body-sm">
                <caption className="sr-only">Affected order records</caption>
                <thead>
                  <tr className="border-b border-border-strong text-left">
                    <th scope="col" className="pb-2 pr-3 font-medium text-text-secondary">Customer</th>
                    <th scope="col" className="pb-2 pr-3 font-medium text-text-secondary">Item</th>
                    <th scope="col" className="w-20 pb-2 pr-3 font-medium text-text-secondary">Qty</th>
                    <th scope="col" className="w-32 pb-2 pr-3 font-medium text-text-secondary">Paid (MYR)</th>
                    <th scope="col" className="w-28 pb-2 pr-3 font-medium text-text-secondary">Status</th>
                    <th scope="col" className="w-12 pb-2">
                      <span className="sr-only">Remove</span>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r, idx) => (
                    <tr key={r.key} className="border-b border-border last:border-0">
                      <td className="py-2 pr-3">
                        <Input
                          aria-label={`Customer name, record ${idx + 1}`}
                          value={r.customerName}
                          onChange={(e) => updateRow(r.key, { customerName: e.target.value })}
                          disabled={running}
                          className="h-10"
                        />
                      </td>
                      <td className="py-2 pr-3">
                        <Input
                          aria-label={`Item, record ${idx + 1}`}
                          value={r.itemName}
                          onChange={(e) => updateRow(r.key, { itemName: e.target.value })}
                          disabled={running}
                          className="h-10"
                        />
                      </td>
                      <td className="py-2 pr-3">
                        <Input
                          aria-label={`Quantity, record ${idx + 1}`}
                          type="number"
                          min={1}
                          inputMode="numeric"
                          value={r.quantity}
                          onChange={(e) => updateRow(r.key, { quantity: e.target.value })}
                          disabled={running}
                          className="h-10"
                        />
                      </td>
                      <td className="py-2 pr-3">
                        <Input
                          aria-label={`Amount paid in MYR, record ${idx + 1}`}
                          inputMode="decimal"
                          value={r.paid}
                          onChange={(e) => updateRow(r.key, { paid: e.target.value })}
                          disabled={running}
                          className="h-10 tabular"
                          placeholder="0.00"
                        />
                      </td>
                      <td className="py-2 pr-3">
                        <select
                          aria-label={`Payment status, record ${idx + 1}`}
                          value={r.status}
                          onChange={(e) =>
                            updateRow(r.key, { status: e.target.value as RecordRow['status'] })
                          }
                          disabled={running}
                          className="h-10 w-full rounded-sm border border-border bg-surface px-2 text-body-sm text-text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--focus-ring)] focus-visible:ring-offset-2"
                        >
                          <option value="paid">Paid</option>
                          <option value="partial">Partial</option>
                          <option value="unpaid">Unpaid</option>
                        </select>
                      </td>
                      <td className="py-2 text-right">
                        <Button
                          variant="ghost"
                          size="icon"
                          onClick={() => removeRow(r.key)}
                          disabled={running || rows.length === 1}
                          aria-label={`Remove record for ${r.customerName || `record ${idx + 1}`}`}
                        >
                          <Trash2 className="h-4 w-4" aria-hidden="true" />
                        </Button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {/* Mobile cards — the records never scroll horizontally */}
            <div className="grid gap-3 lg:hidden">
              {rows.map((r, idx) => (
                <div key={r.key} className="rounded-md border border-border p-3">
                  <div className="grid gap-3">
                    <div>
                      <Label htmlFor={`m-name-${r.key}`}>Customer name</Label>
                      <Input
                        id={`m-name-${r.key}`}
                        className="mt-1"
                        value={r.customerName}
                        onChange={(e) => updateRow(r.key, { customerName: e.target.value })}
                        disabled={running}
                      />
                    </div>
                    <div>
                      <Label htmlFor={`m-item-${r.key}`}>Item</Label>
                      <Input
                        id={`m-item-${r.key}`}
                        className="mt-1"
                        value={r.itemName}
                        onChange={(e) => updateRow(r.key, { itemName: e.target.value })}
                        disabled={running}
                      />
                    </div>
                    <div className="grid grid-cols-2 gap-3">
                      <div>
                        <Label htmlFor={`m-qty-${r.key}`}>Quantity</Label>
                        <Input
                          id={`m-qty-${r.key}`}
                          className="mt-1"
                          type="number"
                          min={1}
                          inputMode="numeric"
                          value={r.quantity}
                          onChange={(e) => updateRow(r.key, { quantity: e.target.value })}
                          disabled={running}
                        />
                      </div>
                      <div>
                        <Label htmlFor={`m-paid-${r.key}`}>Paid (MYR)</Label>
                        <Input
                          id={`m-paid-${r.key}`}
                          className="mt-1 tabular"
                          inputMode="decimal"
                          value={r.paid}
                          onChange={(e) => updateRow(r.key, { paid: e.target.value })}
                          disabled={running}
                          placeholder="0.00"
                        />
                      </div>
                    </div>
                    <div className="flex items-end justify-between gap-3">
                      <div className="flex-1">
                        <Label htmlFor={`m-status-${r.key}`}>Payment status</Label>
                        <select
                          id={`m-status-${r.key}`}
                          value={r.status}
                          onChange={(e) =>
                            updateRow(r.key, { status: e.target.value as RecordRow['status'] })
                          }
                          disabled={running}
                          className="mt-1 h-11 w-full rounded-sm border border-border bg-surface px-2 text-body-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--focus-ring)] focus-visible:ring-offset-2"
                        >
                          <option value="paid">Paid</option>
                          <option value="partial">Partial</option>
                          <option value="unpaid">Unpaid</option>
                        </select>
                      </div>
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => removeRow(r.key)}
                        disabled={running || rows.length === 1}
                        aria-label={`Remove record for ${r.customerName || `record ${idx + 1}`}`}
                      >
                        Remove
                      </Button>
                    </div>
                  </div>
                </div>
              ))}
              <Button variant="outline" onClick={addRow} disabled={running}>
                <Plus className="h-4 w-4" aria-hidden="true" />
                Add customer
              </Button>
            </div>

            <div className="mt-4 flex items-baseline justify-between border-t border-border pt-3">
              <span className="text-body-sm text-text-secondary">Sub-total collected</span>
              <span className="tabular text-money">
                {subTotal.invalid || subTotal.value === null
                  ? '—'
                  : formatMYR(subTotal.value)}
              </span>
            </div>
            <p className="mt-2 text-caption text-text-muted">
              This is your locally entered sub-total. The refund figures on the next screen are
              computed server-side, in exact sen, and are the authoritative amounts.
            </p>
          </CardContent>
        </Card>

        {formError && (
          <Alert variant="danger" title="The agent could not complete the run" className="mt-5">
            {formError}
          </Alert>
        )}

        {running && (
          <div className="mt-5">
            <AgentRunPanel steps={runSteps} />
          </div>
        )}

        {/* ── Action bar ────────────────────────────────────────────── */}
        <div className="sticky bottom-0 mt-6 border-t border-border bg-bg/95 py-4 backdrop-blur">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <Button
              size="lg"
              onClick={runAgent}
              disabled={!requiredFilled || running}
              className={cn('w-full sm:w-auto')}
            >
              {running ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
                  Running…
                </>
              ) : (
                <>
                  Prepare resolution
                  <ArrowRight className="h-4 w-4" aria-hidden="true" />
                </>
              )}
            </Button>
            <p className="text-caption text-text-muted sm:text-right">
              {requiredFilled
                ? 'Nothing is sent or refunded until you approve on the next screen.'
                : 'Fill in the supplier, reference, date, reason and every customer record to continue.'}
            </p>
          </div>
        </div>
      </main>
    </>
  );
}
