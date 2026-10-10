import * as React from 'react';
import { AlertTriangle, AlertOctagon, CheckCircle2, Info } from 'lucide-react';
import { cn } from '@/lib/utils';

type Variant = 'warning' | 'danger' | 'success' | 'info';

/**
 * Alert — a full-width message block.
 *
 * ACADEMIC-CONFLICT RULE (design spec §9.1): an academic conflict must be
 * impossible to miss AND impossible to misread as mere colour. The warning
 * variant therefore carries THREE non-colour cues:
 *   1. a triangle icon,
 *   2. a 4px left rail with a visible border,
 *   3. the word "Academic conflict" in the heading text.
 * A colour-blind founder relying on any single one of these still sees it.
 */
const RAIL: Record<Variant, string> = {
  warning: 'var(--warning-border)',
  danger: 'var(--danger-border)',
  success: 'var(--success)',
  info: 'var(--info)',
};

const BG: Record<Variant, string> = {
  warning: 'var(--warning-bg)',
  danger: 'var(--danger-bg)',
  success: 'var(--success-bg)',
  info: 'var(--info-bg)',
};

const TEXT: Record<Variant, string> = {
  warning: 'var(--warning)',
  danger: 'var(--danger)',
  success: 'var(--success)',
  info: 'var(--info)',
};

const ICONS = {
  warning: AlertTriangle,
  danger: AlertOctagon,
  success: CheckCircle2,
  info: Info,
} as const;

export interface AlertProps extends React.HTMLAttributes<HTMLDivElement> {
  variant?: Variant;
  title?: string;
  /** Decorative — the heading text carries the meaning, not the icon. */
  icon?: boolean;
  role?: 'alert' | 'status';
}

export function Alert({
  className,
  variant = 'info',
  title,
  icon = true,
  children,
  role,
  ...props
}: AlertProps) {
  const Icon = ICONS[variant];
  return (
    <div
      role={role ?? (variant === 'warning' || variant === 'danger' ? 'alert' : undefined)}
      className={cn('rounded-md border px-4 py-3.5', className)}
      style={{
        background: BG[variant],
        borderColor: RAIL[variant],
        borderLeftWidth: '4px',
      }}
      {...props}
    >
      <div className="flex gap-3">
        {icon && (
          <Icon
            className="mt-0.5 h-5 w-5 shrink-0"
            style={{ color: TEXT[variant] }}
            aria-hidden="true"
          />
        )}
        <div className="min-w-0 flex-1">
          {title && (
            <p className="text-subheading font-semibold" style={{ color: TEXT[variant] }}>
              {title}
            </p>
          )}
          {children && (
            <div
              className={cn('text-body-sm', title && 'mt-1')}
              style={{ color: 'var(--text-primary)' }}
            >
              {children}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
