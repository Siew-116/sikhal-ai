import * as React from 'react';
import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from '@/lib/utils';

/**
 * Badge / status pill.
 *
 * IMPORTANT (design spec §9): colour is never the sole carrier of meaning.
 * Every badge in this app pairs its colour with a text label, and the icons
 * used alongside them are decorative only. A grayscale screenshot must remain
 * comprehensible.
 */
const badgeVariants = cva(
  'inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-caption font-medium',
  {
    variants: {
      variant: {
        neutral: 'bg-surface-sunken text-text-secondary',
        success: 'bg-success-bg text-success',
        warning: 'bg-warning-bg text-warning',
        danger: 'bg-danger-bg text-danger',
        info: 'bg-info-bg text-info',
        primary: 'bg-primary text-primary-fg',
      },
    },
    defaultVariants: { variant: 'neutral' },
  },
);

export interface BadgeProps
  extends React.HTMLAttributes<HTMLSpanElement>,
    VariantProps<typeof badgeVariants> {}

export function Badge({ className, variant, ...props }: BadgeProps) {
  return <span className={cn(badgeVariants({ variant }), className)} {...props} />;
}
