import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type {
  DustApi,
  UninstallAppSummary,
  UninstallLaunchHint,
  UninstallListResult,
} from '../../../src/shared/ipc';
import { StartupToast } from '../components/StartupToast';
import { UninstallFlow } from '../components/UninstallFlow';
import { formatBytes } from '../format';

const FOCUS = 'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent';

export interface UninstallViewProps {
  api: DustApi;
  hint: UninstallLaunchHint | null;
  onHintShown: () => void;
}

type SortKey = 'name' | 'size';

function badgesFor(app: UninstallAppSummary): string[] {
  const badges: string[] = [];
  if (app.kind === 'msi') badges.push('MSI');
  if (app.hive === 'hkcu') badges.push('Per-user');
  if (app.requiresAdmin) badges.push('Needs admin');
  if (!app.hasUninstaller) badges.push('No uninstaller');
  return badges;
}

export function UninstallView({ api, hint, onHintShown }: UninstallViewProps) {
  const [list, setList] = useState<UninstallListResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [sort, setSort] = useState<SortKey>('name');
  const [flow, setFlow] = useState<{ appId: string | null; adoptJobId: string | null } | null>(null);
  const [toast, setToast] = useState<{ key: number; message: string; durationMs: number } | null>(null);
  const toastKey = useRef(0);
  const hintShown = useRef(false);

  const load = useCallback(
    (force: boolean) => {
      api
        .listUninstallApps(force)
        .then((result) => {
          setList(result);
          setError(result.ok ? null : result.message);
        })
        .catch((cause: unknown) => setError(cause instanceof Error ? cause.message : String(cause)));
    },
    [api],
  );

  useEffect(() => {
    load(false);
  }, [load]);

  useEffect(() => {
    if (hint === null || hintShown.current) return;
    hintShown.current = true;
    onHintShown();
    if (hint.runningJobId !== null) {
      setFlow({ appId: null, adoptJobId: hint.runningJobId });
      return;
    }
    if (hint.appId !== null) {
      setFlow({ appId: hint.appId, adoptJobId: null });
      return;
    }
    if (hint.stalePending) {
      toastKey.current += 1;
      setToast({
        key: toastKey.current,
        message: "The last uninstall didn't start. Nothing was changed.",
        durationMs: 5000,
      });
    }
  }, [hint, onHintShown]);

  const visible = useMemo(() => {
    const apps = list !== null && list.ok ? list.apps : [];
    const needle = query.trim().toLowerCase();
    const filtered =
      needle.length === 0
        ? apps
        : apps.filter((app) =>
            `${app.displayName} ${app.publisher} ${app.installLocation}`.toLowerCase().includes(needle),
          );
    return [...filtered].sort((a, b) =>
      sort === 'size'
        ? (b.estimatedSizeKb ?? 0) - (a.estimatedSizeKb ?? 0) || a.displayName.localeCompare(b.displayName)
        : a.displayName.localeCompare(b.displayName, undefined, { sensitivity: 'base' }),
    );
  }, [list, query, sort]);

  const total = list !== null && list.ok ? list.apps.length : 0;

  return (
    <main className="dust-dashboard min-h-screen bg-canvas text-ink">
      <header className="mx-auto w-full max-w-4xl px-6 pt-10 sm:px-8 sm:pt-12">
        <h1 className="text-2xl font-semibold tracking-tight text-ink">Deep Uninstall</h1>
        <p className="mt-1.5 text-sm text-ink-muted">
          Removes an app with its own uninstaller, then clears what it leaves behind.
        </p>
      </header>

      <div className="mx-auto w-full max-w-4xl px-6 pb-24 pt-8 sm:px-8">
        {error !== null && (
          <p role="alert" className="mb-6 rounded-lg border border-notice-border bg-notice px-3.5 py-2.5 text-sm text-ink">
            {error}
          </p>
        )}

        <div className="mb-5 flex flex-wrap items-center gap-3">
          <input
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search apps"
            aria-label="Search installed apps"
            className={`min-w-0 flex-1 rounded-lg border border-hairline bg-surface px-3 py-2 text-sm text-ink placeholder:text-ink-muted ${FOCUS}`}
          />
          <div className="flex items-center gap-1" role="group" aria-label="Sort apps">
            {(['name', 'size'] as const).map((key) => (
              <button
                key={key}
                type="button"
                aria-pressed={sort === key}
                onClick={() => setSort(key)}
                className={`rounded-lg px-3 py-1.5 text-sm font-medium transition-colors ${FOCUS} ${
                  sort === key ? 'bg-accent-soft text-accent-strong' : 'text-ink-muted hover:bg-canvas hover:text-ink'
                }`}
              >
                {key === 'name' ? 'Name' : 'Size'}
              </button>
            ))}
          </div>
        </div>

        {list === null ? (
          <p className="rounded-xl border border-hairline bg-surface px-4 py-14 text-center text-sm text-ink-muted">
            Reading installed apps.
          </p>
        ) : list.ok && list.trusted === false ? (
          <p className="rounded-xl border border-hairline bg-surface px-4 py-14 text-center text-sm text-ink-muted">
            Couldn&apos;t read installed apps.
          </p>
        ) : total === 0 ? (
          <p className="rounded-xl border border-hairline bg-surface px-4 py-14 text-center text-sm text-ink-muted">
            No uninstallable apps found.
          </p>
        ) : visible.length === 0 ? (
          <p className="rounded-xl border border-hairline bg-surface px-4 py-14 text-center text-sm text-ink-muted">
            No apps match this search.
          </p>
        ) : (
          <section
            aria-label="Installed apps"
            className="overflow-hidden rounded-2xl border border-hairline bg-surface shadow-[0_1px_2px_rgba(16,24,40,0.04)]"
          >
            <div className="flex items-center justify-between gap-3 px-4 py-3.5">
              <h2 className="text-sm font-semibold text-ink">Installed apps</h2>
              <span className="text-sm text-ink-muted">
                {total} {total === 1 ? 'app' : 'apps'}
              </span>
            </div>
            <div className="h-px w-full bg-hairline" aria-hidden="true" />
            <ul className="divide-y divide-hairline">
              {visible.map((app) => (
                <li key={app.id} className="flex items-start justify-between gap-4 px-4 py-3.5">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                      <p className="text-sm font-medium text-ink">{app.displayName}</p>
                      {badgesFor(app).map((badge) => (
                        <span
                          key={badge}
                          className="shrink-0 rounded-full border border-hairline bg-canvas px-2 py-px text-xs font-medium text-ink-muted"
                        >
                          {badge}
                        </span>
                      ))}
                    </div>
                    <p className="mt-0.5 text-sm text-ink-muted">
                      {app.publisher.length > 0 ? app.publisher : 'Unknown publisher'}
                      {app.version.length > 0 ? ` · ${app.version}` : ''}
                    </p>
                    {app.installLocation.length > 0 && (
                      <p className="mt-0.5 break-all font-mono text-xs text-ink-muted">{app.installLocation}</p>
                    )}
                  </div>
                  <div className="flex shrink-0 items-center gap-3">
                    <span className="font-mono text-xs tabular-nums text-ink-muted">
                      {app.estimatedSizeKb === null ? '—' : formatBytes(app.estimatedSizeKb * 1024)}
                    </span>
                    <button
                      type="button"
                      aria-label={`Remove ${app.displayName}`}
                      onClick={() => setFlow({ appId: app.id, adoptJobId: null })}
                      className={`rounded-lg border border-hairline bg-surface px-3 py-1 text-sm font-medium text-ink transition-colors hover:border-hairline-strong hover:bg-surface-hover ${FOCUS}`}
                    >
                      Remove
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          </section>
        )}
      </div>

      {flow !== null && (
        <UninstallFlow
          api={api}
          appId={flow.appId}
          adoptJobId={flow.adoptJobId}
          elevated={list !== null && list.ok && list.elevated}
          onClose={() => setFlow(null)}
          onFinished={() => load(true)}
        />
      )}

      {toast !== null && (
        <StartupToast
          key={toast.key}
          message={toast.message}
          durationMs={toast.durationMs}
          onDismiss={() => setToast(null)}
        />
      )}
    </main>
  );
}
