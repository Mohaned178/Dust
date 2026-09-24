import { useCallback, useState } from 'react';
import type { DustApi } from '../../../src/shared/ipc';
import { CleanDialog } from './CleanDialog';

export interface SettingsDialogProps {
  api: DustApi;
  onClose: () => void;
}

export function SettingsDialog({ api, onClose }: SettingsDialogProps) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const relaunch = useCallback(async () => {
    setBusy(true);
    setError(null);
    try {
      await api.relaunchElevated();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(false);
    }
  }, [api]);

  return (
    <CleanDialog label="Settings" onClose={onClose}>
      <h2 className="text-base font-semibold text-ink">Settings</h2>

      <dl className="mt-5 divide-y divide-hairline">
        <div className="flex items-start justify-between gap-4 py-3.5">
          <div>
            <dt className="text-sm font-medium text-ink">Theme</dt>
            <dd className="mt-0.5 text-xs text-ink-muted">Light-first. A dark theme is planned.</dd>
          </div>
          <span className="shrink-0 rounded-full border border-accent-border bg-accent-soft px-2.5 py-0.5 text-xs font-medium text-accent-strong">
            Light
          </span>
        </div>

        <div className="flex items-start justify-between gap-4 py-3.5">
          <div>
            <dt className="text-sm font-medium text-ink">Administrator access</dt>
            <dd className="mt-0.5 text-xs text-ink-muted">
              Some system temp locations can only be cleaned when Dust runs as administrator.
            </dd>
          </div>
          <button
            type="button"
            aria-label="Relaunch as administrator"
            disabled={busy}
            onClick={() => void relaunch()}
            className="shrink-0 rounded-lg border border-hairline bg-surface px-3.5 py-1.5 text-sm font-medium text-ink transition-colors hover:border-hairline-strong hover:bg-surface-hover disabled:cursor-not-allowed disabled:opacity-45 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
          >
            {busy ? 'Relaunching…' : 'Relaunch'}
          </button>
        </div>

        <div className="py-3.5">
          <dt className="text-sm font-medium text-ink">About</dt>
          <dd className="mt-0.5 text-xs text-ink-muted">
            Dust finds what is safe to delete. It runs entirely on this machine, and nothing is deleted without your
            confirmation.
          </dd>
        </div>
      </dl>

      {error !== null && (
        <p role="alert" className="mt-4 rounded-lg border border-notice-border bg-notice px-3 py-2 text-sm text-ink">
          {error}
        </p>
      )}
    </CleanDialog>
  );
}
