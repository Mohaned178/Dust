import { useEffect, useRef } from 'react';
import type { ReactNode } from 'react';
import { CloseIcon } from './icons';
import { FOCUS } from './ui';

export interface CleanDialogProps {
  label: string;
  onClose: () => void;
  children: ReactNode;
  dismissible?: boolean;
  /** `lg` widens the panel for multi-step flows with long lists. */
  size?: 'md' | 'lg';
  /** Fixed bar above the scrolling body; leaves room for the close button. */
  header?: ReactNode;
}

const WIDTH = { md: 'max-w-[34rem]', lg: 'max-w-2xl' } as const;

const FOCUSABLE =
  'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

export function CleanDialog({ label, onClose, children, dismissible = true, size = 'md', header }: CleanDialogProps) {
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
      const dialog = dialogRef.current;
      if (dialog === null) return;
      const focusable = dialog.querySelectorAll<HTMLElement>(FOCUSABLE);
      // Steps that swap their buttons out can leave focus on <body>; pull it back in.
      if (focusable.length === 0 || !dialog.contains(document.activeElement)) {
        event.preventDefault();
        (focusable[0] ?? dialog).focus();
        return;
      }
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
      className="dust-backdrop fixed inset-0 z-50 flex items-center justify-center bg-backdrop p-4 backdrop-blur-sm sm:p-6"
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
        className={`dust-dialog dust-panel relative flex max-h-[calc(100vh-2rem)] w-full ${WIDTH[size]} flex-col overflow-hidden rounded-2xl border border-hairline bg-surface shadow-pop focus:outline-none`}
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
        {header !== undefined && <div className="shrink-0 border-b border-hairline px-7 pb-4 pr-16 pt-6">{header}</div>}
        <div className={`min-h-0 flex-1 overflow-y-auto px-7 pb-7 ${header === undefined ? 'pt-8' : 'pt-6'}`}>
          {children}
        </div>
      </div>
    </div>
  );
}
