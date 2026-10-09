import { memo } from 'react';
import type { StartupEntry } from '../../../../src/shared/ipc';
import { cn } from '../../lib/cn';
import { sourceLabel, verdictOf } from '../../lib/startup';
import { Tag } from '../../ui/Badge';
import { LockIcon } from '../../ui/icons';
import { Switch } from '../../ui/Switch';

export interface StartupRowProps {
  entry: StartupEntry;
  busy: boolean;
  onToggle: (entry: StartupEntry, next: boolean) => void;
}

/** Why a switch cannot be moved, or null when it can. */
export function lockReason(entry: StartupEntry): string | null {
  return entry.protected ? 'Dust protects this entry, so it cannot be turned off.' : null;
}

export const StartupRow = memo(function StartupRow({ entry, busy, onToggle }: StartupRowProps) {
  const on = entry.state === 'enabled';
  const reason = lockReason(entry);
  const verdict = verdictOf(entry);
  return (
    <li className="flex min-h-14 items-center gap-3 px-4 py-2">
      {entry.iconDataUrl !== null ? (
        <img
          src={entry.iconDataUrl}
          alt=""
          draggable={false}
          className={cn('size-8 shrink-0 object-contain', !on && 'opacity-60')}
        />
      ) : (
        <span
          aria-hidden="true"
          className="flex size-8 shrink-0 items-center justify-center rounded-control bg-surface-pressed text-body font-semibold text-ink-2"
        >
          {entry.name.trim().charAt(0).toUpperCase() || '?'}
        </span>
      )}
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <p className={cn('truncate text-body font-semibold', !on && 'text-ink-2')} title={entry.name}>
            {entry.name}
          </p>
          {verdict !== null ? <Tag>{verdict}</Tag> : null}
        </div>
        <p className="flex flex-wrap items-center gap-x-2 text-caption text-ink-2">
          {entry.publisher !== null ? <span className="truncate">{entry.publisher}</span> : null}
          <span>{sourceLabel(entry.source)}</span>
          {entry.requiresAdmin ? <span>Needs administrator rights</span> : null}
          {entry.disabledKind === 'windows' ? <span>Turned off in Windows settings</span> : null}
          {reason !== null ? <span>{reason}</span> : null}
        </p>
      </div>
      {reason !== null ? <LockIcon className="size-5 shrink-0 text-ink-2" aria-hidden="true" /> : null}
      <Switch
        checked={on}
        disabled={reason !== null || busy}
        label={reason !== null ? `${entry.name} is locked` : `${on ? 'Turn off' : 'Turn on'} ${entry.name}`}
        onCheckedChange={(next) => onToggle(entry, next)}
      />
    </li>
  );
});
