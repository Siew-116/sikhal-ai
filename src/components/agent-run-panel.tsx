'use client';

import * as React from 'react';
import { Check, Loader2, Circle, AlertOctagon } from 'lucide-react';
import { cn } from '@/lib/utils';

export interface RunStep {
  label: string;
  status: 'pending' | 'running' | 'ok' | 'error';
  summary?: string;
  durationMs?: number;
}

/**
 * AgentRunPanel — visible agent tool execution.
 *
 * Requirement: the founder must SEE real tool execution, not a spinner over an
 * empty panel. Each row is a real tool call with a plain-language label, its own
 * state icon, and its actual elapsed time.
 *
 * Accessibility (design spec §7.3): the current step is announced through a
 * single polite live region; the visual list is aria-hidden so a screen reader
 * does not read the steps twice.
 */
export function AgentRunPanel({ steps }: { steps: RunStep[] }) {
  const currentIndex = steps.findIndex((s) => s.status === 'running');
  const currentLabel = currentIndex >= 0 ? steps[currentIndex].label : null;

  // Derive the displayed step index ONCE. The visible text and the screen-reader
  // announcement previously computed this independently and could disagree by
  // one, which is exactly the kind of drift a sighted and a non-sighted user
  // would experience as two different products.
  const completedCount = steps.filter((s) => s.status === 'ok').length;
  const displayStep = currentLabel
    ? Math.min(completedCount + 1, steps.length)
    : completedCount;

  return (
    <div className="rounded-md border border-border bg-surface p-4 md:p-5">
      {/* Announce progress once, politely, without duplicating the visual list. */}
      <div className="sr-only" aria-live="polite" role="status">
        {currentLabel
          ? `Step ${displayStep} of ${steps.length}: ${currentLabel}`
          : `Run complete. ${completedCount} of ${steps.length} steps finished.`}
      </div>

      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <Loader2 className="h-4 w-4 animate-spin text-accent" aria-hidden="true" />
          <span className="text-subheading font-semibold text-text-primary">
            Running resolution agent
          </span>
        </div>
        <span className="text-caption text-text-muted">
          step {displayStep} of {steps.length}
        </span>
      </div>

      <ul className="mt-4 grid gap-2.5" aria-hidden="true">
        {steps.map((step, i) => (
          <li key={`${step.label}-${i}`} className="flex items-start gap-3">
            <span className="mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center">
              {step.status === 'ok' && <Check className="h-4 w-4" style={{ color: 'var(--success)' }} />}
              {step.status === 'running' && (
                <Loader2 className="h-4 w-4 animate-spin" style={{ color: 'var(--accent)' }} />
              )}
              {step.status === 'pending' && <Circle className="h-3 w-3" style={{ color: 'var(--text-muted)' }} />}
              {step.status === 'error' && (
                <AlertOctagon className="h-4 w-4" style={{ color: 'var(--danger)' }} />
              )}
            </span>
            <div className="min-w-0 flex-1">
              <div className="flex items-baseline justify-between gap-3">
                <span
                  className={cn(
                    'text-body-sm',
                    step.status === 'pending' ? 'text-text-muted' : 'text-text-primary',
                  )}
                >
                  {step.label}
                </span>
                {typeof step.durationMs === 'number' && step.status !== 'pending' && (
                  <span className="tabular shrink-0 text-caption text-text-muted">
                    {step.durationMs}ms
                  </span>
                )}
              </div>
              {step.summary && step.status !== 'pending' && (
                <p
                  className="mt-0.5 text-caption"
                  style={{ color: step.status === 'error' ? 'var(--danger)' : 'var(--text-secondary)' }}
                >
                  {step.summary}
                </p>
              )}
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}
