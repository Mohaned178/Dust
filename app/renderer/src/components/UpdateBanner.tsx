import { useEffect, useState } from 'react';
import type { DustApi, UpdateStatus } from '../../../src/shared/ipc';
import { CheckIcon, CloseIcon, InfoIcon } from './icons';

const FOCUS = 'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent';

export interface UpdateBannerProps {
  api: DustApi;
}

export function UpdateBanner({ api }: UpdateBannerProps) {
  const [status, setStatus] = useState<UpdateStatus | null>(null);
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    let active = true;
    api
      .getUpdateStatus()
      .then((next) => {
        if (active) setStatus(next);
      })
      .catch(() => {});
    const off = api.onUpdateEvent((next) => {
      setStatus(next);
      setDismissed(false);
    });
    return () => {
      active = false;
      off();
    };
  }, [api]);

  const phase = status?.phase ?? 'idle';
  const visible = phase === 'available' || phase === 'downloading' || phase === 'downloaded';
  if (dismissed || !visible) return null;

  const version = status?.version ?? null;
  const percent = status?.percent ?? null;
  const label =
    phase === 'downloaded'
      ? `Dust ${version ?? 'update'} is ready to install`
      : phase === 'downloading'
        ? `Downloading update${version === null ? '' : ` ${version}`}${percent === null ? '' : ` — ${percent}%`}`
        : `Downloading update${version === null ? '' : ` ${version}`}\u2026`;

  return (
    <div
      role="status"
      className="fixed right-5 bottom-5 z-50 w-80 rounded-xl border border-hairline bg-surface p-4 shadow-lg"
    >
      <div className="flex items-start gap-3">
        <span className="mt-0.5 text-accent">{phase === 'downloaded' ? <CheckIcon /> : <InfoIcon />}</span>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium text-ink">{label}</p>
          {phase === 'downloading' && percent !== null && (
            <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-surface-hover">
              <div
                className="h-full rounded-full bg-accent transition-[width] duration-300"
                style={{ width: `${percent}%` }}
              />
            </div>
          )}
          {phase === 'downloaded' && (
            <button
              type="button"
              onClick={() => void api.installUpdate()}
              className={`mt-3 rounded-lg bg-accent px-3 py-1.5 text-sm font-semibold text-white transition-colors hover:bg-accent-strong ${FOCUS}`}
            >
              Restart to update
            </button>
          )}
        </div>
        <button
          type="button"
          aria-label="Dismiss update notice"
          onClick={() => setDismissed(true)}
          className={`rounded-md p-1 text-ink-muted transition-colors hover:bg-surface-hover hover:text-ink ${FOCUS}`}
        >
          <CloseIcon />
        </button>
      </div>
    </div>
  );
}
