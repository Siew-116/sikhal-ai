'use client';

import * as React from 'react';
import * as DialogPrimitive from '@radix-ui/react-alert-dialog';
import { cn } from '@/lib/utils';
import { buttonVariants } from './button';

/**
 * AlertDialog — the approval confirmation.
 *
 * Design rationale (spec §8.2): approval is consequential but not
 * destructive-permanent, so a dialog that forces the founder to READ A RECAP is
 * the right weight. There is no "type APPROVE to confirm" theatre — the recap
 * itself is the friction.
 *
 * Focus lands on the dialog content (so a screen reader announces the title and
 * recap) rather than on the primary button, which is deliberately NOT
 * auto-focused: a reflexive Enter must not approve a refund.
 */

export const AlertDialog = DialogPrimitive.Root;
export const AlertDialogTrigger = DialogPrimitive.Trigger;
export const AlertDialogPortal = DialogPrimitive.Portal;
export const AlertDialogCancel = DialogPrimitive.Cancel;

export function AlertDialogContent({
  className,
  children,
  ...props
}: React.ComponentPropsWithoutRef<typeof DialogPrimitive.Content>) {
  return (
    <DialogPrimitive.Portal>
      <DialogPrimitive.Overlay
        className="fixed inset-0 z-50 animate-in fade-in-0"
        style={{ background: 'rgba(27, 38, 33, 0.55)' }}
      />
      <DialogPrimitive.Content
        className={cn(
          'fixed left-1/2 top-1/2 z-50 max-h-[90vh] w-[calc(100%-2rem)] max-w-lg -translate-x-1/2 -translate-y-1/2',
          'overflow-y-auto rounded-lg border border-border bg-surface p-6 shadow-elev2',
          'animate-in fade-in-0 zoom-in-95',
          className,
        )}
        style={{ boxShadow: 'var(--elev-2)' }}
        {...props}
      >
        {children}
      </DialogPrimitive.Content>
    </DialogPrimitive.Portal>
  );
}

export function AlertDialogTitle({
  className,
  ...props
}: React.ComponentPropsWithoutRef<typeof DialogPrimitive.Title>) {
  return (
    <DialogPrimitive.Title
      className={cn('text-title font-semibold text-text-primary', className)}
      {...props}
    />
  );
}

export function AlertDialogDescription({
  className,
  ...props
}: React.ComponentPropsWithoutRef<typeof DialogPrimitive.Description>) {
  return (
    <DialogPrimitive.Description
      className={cn('mt-2 text-body-sm text-text-secondary', className)}
      {...props}
    />
  );
}

export function AlertDialogFooter({
  className,
  ...props
}: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn('mt-6 flex flex-col-reverse gap-3 sm:flex-row sm:justify-end', className)}
      {...props}
    />
  );
}

export function AlertDialogAction({
  className,
  ...props
}: React.ComponentPropsWithoutRef<typeof DialogPrimitive.Action>) {
  return (
    <DialogPrimitive.Action
      className={cn(buttonVariants({ variant: 'default' }), className)}
      {...props}
    />
  );
}
