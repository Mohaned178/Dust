import { Dialog as DialogPrimitive } from 'radix-ui';
import { useRef } from 'react';
import type { ReactNode } from 'react';
import { cn } from '../lib/cn';
import { Button } from './Button';
import { DismissIcon } from './icons';

export interface DialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description?: string;
  children?: ReactNode;
  /** Buttons for the bottom edge; the primary one goes last. */
  footer?: ReactNode;
  /** Hide the corner close button when the dialog must be answered, e.g. mid-deletion. */
  dismissible?: boolean;
  className?: string;
}

/** Focus is trapped while open, Escape closes, and focus returns to whatever opened it. */
export function Dialog({
  open,
  onOpenChange,
  title,
  description,
  children,
  footer,
  dismissible = true,
  className,
}: DialogProps) {
  // Radix only restores focus to a Dialog.Trigger, and ours are opened from ordinary buttons, so remember the opener.
  const openerRef = useRef<HTMLElement | null>(null);
  return (
    <DialogPrimitive.Root open={open} onOpenChange={onOpenChange}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className="dust-overlay fixed inset-0 z-40 bg-backdrop" />
        <DialogPrimitive.Content
          onOpenAutoFocus={() => {
            openerRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
          }}
          onCloseAutoFocus={() => {
            openerRef.current?.focus();
            openerRef.current = null;
          }}
          onEscapeKeyDown={(event) => {
            if (!dismissible) event.preventDefault();
          }}
          onPointerDownOutside={(event) => {
            if (!dismissible) event.preventDefault();
          }}
          className={cn(
            'dust-dialog fixed top-1/2 left-1/2 z-50 flex max-h-[85vh] w-[calc(100vw-2rem)] max-w-lg -translate-x-1/2 -translate-y-1/2 flex-col rounded-overlay border border-border bg-surface shadow-dialog',
            className,
          )}
        >
          <div className="flex items-start justify-between gap-4 px-6 pt-5">
            <DialogPrimitive.Title className="text-subtitle">{title}</DialogPrimitive.Title>
            {dismissible ? (
              <DialogPrimitive.Close
                aria-label="Close"
                className="dur-faster -mt-1 -mr-2 flex size-8 shrink-0 items-center justify-center rounded-control text-ink-2 hover:bg-surface-hover"
              >
                <DismissIcon className="size-5" aria-hidden="true" />
              </DialogPrimitive.Close>
            ) : null}
          </div>
          {description ? (
            <DialogPrimitive.Description className="px-6 pt-1 text-body text-ink-2">
              {description}
            </DialogPrimitive.Description>
          ) : (
            <DialogPrimitive.Description className="sr-only">{title}</DialogPrimitive.Description>
          )}
          {children ? (
            <div className="min-h-0 flex-1 overflow-y-auto px-6 py-4">{children}</div>
          ) : (
            <div className="h-4" />
          )}
          {footer ? <div className="flex justify-end gap-2 px-6 pt-2 pb-5">{footer}</div> : null}
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}

export interface ConfirmDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description?: string;
  /** States the action and its size, e.g. "Delete 4.2 GB". Never "OK". */
  confirmLabel: string;
  cancelLabel?: string;
  onConfirm: () => void;
  /** Red confirm button. Reserved for deletion. */
  destructive?: boolean;
  loading?: boolean;
  confirmDisabled?: boolean;
  children?: ReactNode;
}

export function ConfirmDialog({
  open,
  onOpenChange,
  title,
  description,
  confirmLabel,
  cancelLabel = 'Cancel',
  onConfirm,
  destructive = false,
  loading = false,
  confirmDisabled = false,
  children,
}: ConfirmDialogProps) {
  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title={title}
      description={description}
      dismissible={!loading}
      footer={
        <>
          <Button variant="secondary" onClick={() => onOpenChange(false)} disabled={loading}>
            {cancelLabel}
          </Button>
          <Button
            variant={destructive ? 'danger' : 'primary'}
            onClick={onConfirm}
            loading={loading}
            disabled={confirmDisabled}
          >
            {confirmLabel}
          </Button>
        </>
      }
    >
      {children}
    </Dialog>
  );
}
