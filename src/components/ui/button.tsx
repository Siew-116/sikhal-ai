import * as React from 'react';
import { Slot } from '@radix-ui/react-slot';
import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from '@/lib/utils';

const buttonVariants = cva(
  'inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-sm text-label font-medium transition-colors ' +
    'duration-[120ms] ease-standard focus-visible:outline-none disabled:pointer-events-none disabled:opacity-50',
  {
    variants: {
      variant: {
        default: 'bg-primary text-primary-fg hover:bg-primary-hover',
        outline: 'border border-border bg-surface text-text-primary hover:bg-surface-sunken',
        ghost: 'text-text-secondary hover:bg-surface-sunken hover:text-text-primary',
        danger: 'bg-danger text-white hover:opacity-90',
      },
      size: {
        // Touch targets are >= 44px tall on mobile per the design spec.
        default: 'h-11 px-5',
        sm: 'h-9 px-3 text-body-sm',
        lg: 'h-12 px-6',
        icon: 'h-11 w-11',
      },
    },
    defaultVariants: { variant: 'default', size: 'default' },
  },
);

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {
  asChild?: boolean;
}

const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, asChild = false, ...props }, ref) => {
    const Comp = asChild ? Slot : 'button';
    return (
      <Comp className={cn(buttonVariants({ variant, size, className }))} ref={ref} {...props} />
    );
  },
);
Button.displayName = 'Button';

export { Button, buttonVariants };
