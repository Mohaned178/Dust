import type { StartupEntry } from '../../../src/shared/ipc';
import { CleanDialog } from './CleanDialog';

const FOCUS = 'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent';
const PRIMARY = `inline-flex items-center justify-center rounded-lg bg-accent px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-accent-strong disabled:cursor-not-allowed disabled:opacity-45 ${FOCUS}`;
const SECONDARY = `inline-flex items-center justify-center rounded-lg border border-hairline bg-surface px-3.5 py-1.5 text-sm font-medium text-ink transition-colors hover:border-hairline-strong hover:bg-surface-hover disabled:cursor-not-allowed disabled:opacity-45 ${FOCUS}`;

export interface StartupAdminDialogProps {
  entry: StartupEntry;
  busy: boolean;
  error: string | null;
  onCancel: () => void;
  onRelaunch: () => void;
}

export function StartupAdminDialog({ entry, busy, error, onCancel, onRelaunch }: StartupAdminDialogProps) {
  return (
    <CleanDialog label="Administrator required" onClose={onCancel} dismissible={!busy}>
      <h2 className="text-xl font-semibold tracking-tight text-ink">Administrator required</h2>
      <p className="mt-3 text-sm leading-relaxed text-ink-muted">
        <span className="font-medium text-ink">{entry.name}</span> is a machine-wide startup entry. Dust needs
        administrator rights to change it.
      </p>
      {error !== null && (
        <p
          role="alert"
          className="mt-4 rounded-lg border border-notice-border bg-notice px-3.5 py-2.5 text-sm text-ink"
        >
          {error}
        </p>
      )}
      <div className="mt-7 flex justify-end gap-2">
        <button type="button" onClick={onCancel} disabled={busy} className={SECONDARY}>
          Cancel
        </button>
        <button type="button" onClick={onRelaunch} disabled={busy} className={PRIMARY}>
          {busy ? 'Relaunching…' : 'Relaunch as Administrator'}
        </button>
      </div>
    </CleanDialog>
  );
}
