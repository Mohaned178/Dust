import type { StartupEntry } from '../../../src/shared/ipc';
import { AppWindowIcon, LockIcon } from './icons';

const FOCUS = 'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent';

export interface SwitchProps {
  checked: boolean;
  disabled?: boolean;
  busy?: boolean;
  label: string;
  title?: string;
  describedBy?: string;
  onToggle: (next: boolean) => void;
}

export function Switch({ checked, disabled = false, busy = false, label, title, describedBy, onToggle }: SwitchProps) {
  const inactive = disabled || busy;
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      aria-describedby={describedBy}
      aria-busy={busy || undefined}
      disabled={inactive}
      title={title}
      onClick={() => onToggle(!checked)}
      className={`relative inline-flex h-5 w-9 shrink-0 items-center rounded-full transition-colors motion-reduce:transition-none ${FOCUS} ${
        checked ? 'bg-accent' : 'bg-track'
      } ${inactive ? 'cursor-not-allowed opacity-45' : ''}`}
    >
      <span
        aria-hidden="true"
        className={`h-4 w-4 rounded-full bg-white shadow-[0_1px_2px_rgba(16,24,40,0.25)] transition-transform duration-150 ease-[cubic-bezier(0.16,1,0.3,1)] motion-reduce:transition-none ${
          checked ? 'translate-x-[18px]' : 'translate-x-0.5'
        }`}
      />
    </button>
  );
}

export interface StartupRowProps {
  entry: StartupEntry;
  busy: boolean;
  onToggle: (entry: StartupEntry, next: boolean) => void;
}

function lockDescription(entry: StartupEntry): string | null {
  if (entry.protected) return 'Protected by Dust. This entry cannot be disabled.';
  return null;
}

function switchLabel(entry: StartupEntry): string {
  if (entry.protected) return `${entry.name} is locked`;
  return `${entry.state === 'enabled' ? 'Disable' : 'Enable'} ${entry.name}`;
}

export function StartupRow({ entry, busy, onToggle }: StartupRowProps) {
  const disabled = entry.state === 'disabled';
  const description = lockDescription(entry);
  const descriptionId = description === null ? undefined : `startup-locked-${entry.id}`;

  return (
    <li className="flex min-h-[52px] items-center gap-3 px-4 py-2.5">
      <span className="flex h-5 w-5 shrink-0 items-center justify-center" aria-hidden="true">
        {entry.iconDataUrl !== null ? (
          <img src={entry.iconDataUrl} alt="" className={`h-5 w-5 rounded ${disabled ? 'opacity-60' : ''}`} />
        ) : (
          <AppWindowIcon className={`h-5 w-5 text-ink-muted ${disabled ? 'opacity-60' : ''}`} />
        )}
      </span>

      <div className="min-w-0 flex-1">
        <p className={`truncate text-sm ${disabled ? 'text-ink-muted' : 'text-ink'}`} title={entry.name}>
          {entry.name}
        </p>
        {(entry.publisher !== null || entry.disabledKind === 'windows') && (
          <p className="mt-0.5 flex min-w-0 items-center gap-2 text-xs text-ink-muted">
            {entry.publisher !== null && <span className="truncate">{entry.publisher}</span>}
            {entry.disabledKind === 'windows' && (
              <span
                title="Turned off in Windows startup settings."
                className="shrink-0 rounded-full border border-hairline bg-canvas px-2 py-px text-xs font-medium"
              >
                Disabled outside Dust
              </span>
            )}
          </p>
        )}
      </div>

      {entry.protected && <LockIcon className="h-4 w-4 shrink-0 text-ink-muted" />}
      {description !== null && descriptionId !== undefined && (
        <span id={descriptionId} className="sr-only">
          {description}
        </span>
      )}

      <Switch
        checked={entry.state === 'enabled'}
        disabled={description !== null}
        busy={busy}
        label={switchLabel(entry)}
        title={description ?? undefined}
        describedBy={descriptionId}
        onToggle={(next) => onToggle(entry, next)}
      />
    </li>
  );
}
