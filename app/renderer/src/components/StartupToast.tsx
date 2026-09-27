import { useEffect, useRef } from 'react';

const FOCUS = 'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent';

export interface StartupToastAction {
  label: string;
  onClick: () => void;
}

export interface StartupToastProps {
  message: string;
  action?: StartupToastAction | undefined;
  durationMs: number;
  onDismiss: () => void;
}

export function StartupToast({ message, action, durationMs, onDismiss }: StartupToastProps) {
  const dismissRef = useRef(onDismiss);
  useEffect(() => {
    dismissRef.current = onDismiss;
  });

  useEffect(() => {
    const timer = window.setTimeout(() => dismissRef.current(), durationMs);
    return () => window.clearTimeout(timer);
  }, [durationMs]);

  return (
    <div
      role="status"
      aria-live="polite"
      className="dust-rise pointer-events-none fixed inset-x-0 bottom-6 z-40 flex justify-center px-4"
    >
      <div className="pointer-events-auto flex items-center gap-3 rounded-xl border border-hairline bg-surface px-4 py-2.5 shadow-pop">
        <span className="text-sm text-ink">{message}</span>
        {action !== undefined && (
          <button
            type="button"
            onClick={action.onClick}
            className={`rounded-lg px-2 py-1 text-sm font-medium text-accent transition-colors hover:bg-accent-soft ${FOCUS}`}
          >
            {action.label}
          </button>
        )}
      </div>
    </div>
  );
}
