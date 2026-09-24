import { useEffect, useRef } from 'react';
import type { ReactNode } from 'react';
import { CloseIcon } from './icons';

const FOCUS = 'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent';

export interface CleanDialogProps {
  label: string;
  onClose: () => void;
  children: ReactNode;
  dismissible?: boolean;
}

export function CleanDialog({ label, onClose, children, dismissible = true }: CleanDialogProps) {
  const dialogRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const previouslyFocused = document.activeElement as HTMLElement | null;
    dialogRef.current?.focus();
    return () => {
      if (previouslyFocused !== null && typeof previouslyFocused.focus === 'function') {
        previouslyFocused.focus();
      }
    };
  }, []);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        if (!dismissible) return;
        event.preventDefault();
        onClose();
        return;
      }
      if (event.key !== 'Tab') return;
      const focusable = dialogRef.current?.querySelectorAll<HTMLElement>(
        'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])',
      );
      if (focusable === undefined || focusable.length === 0) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [onClose, dismissible]);

  return (
    <div
      className="dust-backdrop fixed inset-0 z-50 flex items-center justify-center bg-ink/25 p-4 backdrop-blur-sm sm:p-6"
      onClick={(event) => {
        if (dismissible && event.target === event.currentTarget) onClose();
      }}
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-label={label}
        tabIndex={-1}
        className="dust-dialog dust-panel relative flex max-h-[calc(100vh-2rem)] w-full max-w-[34rem] flex-col overflow-hidden rounded-2xl border border-hairline bg-surface shadow-pop focus:outline-none"
      >
        {dismissible && (
          <button
            type="button"
            aria-label="Close"
            onClick={onClose}
            className={`absolute right-4 top-4 z-10 inline-flex h-8 w-8 items-center justify-center rounded-lg text-ink-muted transition-colors hover:bg-canvas hover:text-ink ${FOCUS}`}
          >
            <CloseIcon className="h-[18px] w-[18px]" />
          </button>
        )}
        <div className="min-h-0 flex-1 overflow-y-auto px-7 pb-7 pt-8">{children}</div>
      </div>
    </div>
  );
}
