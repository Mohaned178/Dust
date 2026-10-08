import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { DustApi, UninstallAppSummary, UninstallLaunchHint, UninstallListResult } from '../../../src/shared/ipc';
import { StartupToast } from '../components/StartupToast';
import { UninstallFlow } from '../components/UninstallFlow';
import { UninstallWizard } from '../components/UninstallWizard';
import { Alert, Badge, Button, FOCUS, PageHeader } from '../components/ui';
import { RefreshIcon, SearchIcon } from '../components/icons';
import { formatBytes } from '../format';

export interface UninstallViewProps {
  api: DustApi;
  hint: UninstallLaunchHint | null;
  onHintShown: () => void;
}

type SortKey = 'name' | 'size';

const CAUTION_LABEL: Record<NonNullable<UninstallAppSummary['caution']>, string> = {
  hardware: 'Driver',
  security: 'Security',
  runtime: 'Runtime',
};

function sizeOf(app: UninstallAppSummary): number | null {
  if (app.sizeBytes !== null) return app.sizeBytes;
  return app.estimatedSizeKb === null ? null : app.estimatedSizeKb * 1024;
}

export function UninstallView({ api, hint, onHintShown }: UninstallViewProps) {
  const [list, setList] = useState<UninstallListResult | null>(null);
  const [loading, setLoading] = useState(true);
  const [sizes, setSizes] = useState<ReadonlyMap<string, number>>(new Map());
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [sort, setSort] = useState<SortKey>('name');
  const [removing, setRemoving] = useState<UninstallAppSummary | null>(null);
  const [adoptJobId, setAdoptJobId] = useState<string | null>(null);
  // Set by the elevated relaunch hint. The removal flow only opens once the app
  // list says whether this instance really is elevated.
  const [pendingAppId, setPendingAppId] = useState<string | null>(null);
  const [flowAppId, setFlowAppId] = useState<string | null>(null);
  const [toast, setToast] = useState<{ key: number; message: string; durationMs: number } | null>(null);
  const toastKey = useRef(0);
  const hintShown = useRef(false);

  const showToast = useCallback((message: string) => {
    toastKey.current += 1;
    setToast({ key: toastKey.current, message, durationMs: 5000 });
  }, []);

  const load = useCallback(
    (force: boolean) => {
      setLoading(true);
      api
        .listUninstallApps(force)
        .then((result) => {
          setList(result);
          setError(result.ok ? null : result.message);
        })
        .catch((cause: unknown) => setError(cause instanceof Error ? cause.message : String(cause)))
        .finally(() => setLoading(false));
    },
    [api],
  );

  useEffect(() => {
    load(false);
  }, [load]);

  // Install-folder sizes are measured in the background and arrive one by one.
  useEffect(
    () =>
      api.onUninstallEvent((event) => {
        if (event.type !== 'app-size') return;
        setSizes((current) => new Map(current).set(event.appId, event.bytes));
      }),
    [api],
  );

  useEffect(() => {
    if (hint === null || hintShown.current) return;
    hintShown.current = true;
    onHintShown();
    if (hint.runningJobId !== null) {
      setAdoptJobId(hint.runningJobId);
      return;
    }
    if (hint.appId !== null) {
      setPendingAppId(hint.appId);
      return;
    }
    if (hint.stalePending) showToast("The last uninstall didn't start. Nothing was changed.");
  }, [hint, onHintShown, showToast]);

  useEffect(() => {
    if (pendingAppId === null || list === null) return;
    setPendingAppId(null);
    if (!list.ok) return; // The error banner already explains why nothing opened.
    if (list.apps.some((app) => app.id === pendingAppId)) setFlowAppId(pendingAppId);
    else showToast('That app is no longer installed. Nothing was changed.');
  }, [pendingAppId, list, showToast]);

  const apps = useMemo(() => {
    const raw = list !== null && list.ok ? list.apps : [];
    return raw.map((app) => (sizes.has(app.id) ? { ...app, sizeBytes: sizes.get(app.id)! } : app));
  }, [list, sizes]);

  const visible = useMemo(() => {
    const needle = query.trim().toLowerCase();
    const filtered =
      needle.length === 0
        ? apps
        : apps.filter((app) => `${app.displayName} ${app.publisher}`.toLowerCase().includes(needle));
    return [...filtered].sort((a, b) =>
      sort === 'size'
        ? (sizeOf(b) ?? 0) - (sizeOf(a) ?? 0) || a.displayName.localeCompare(b.displayName)
        : a.displayName.localeCompare(b.displayName, undefined, { sensitivity: 'base' }),
    );
  }, [apps, query, sort]);

  const elevated = list !== null && list.ok && list.elevated;
  const totalBytes = apps.reduce((sum, app) => sum + (sizeOf(app) ?? 0), 0);

  return (
    <main className="min-h-full bg-canvas text-ink">
      <div className="mx-auto max-w-4xl px-6 py-10 sm:px-10">
        <PageHeader
          title="Uninstall apps"
          subtitle="Remove an app with its own uninstaller, then clear the folders and settings it leaves behind."
          actions={
            <Button size="sm" onClick={() => load(true)} aria-label="Refresh app list">
              <RefreshIcon className="h-4 w-4" />
              Refresh
            </Button>
          }
        />

        {error !== null && (
          <Alert
            tone="danger"
            className="mt-6"
            action={
              <Button size="sm" disabled={loading} onClick={() => load(true)}>
                Try again
              </Button>
            }
          >
            {error}
          </Alert>
        )}

        <div className="mt-8 flex flex-wrap items-center gap-3">
          <label className="relative min-w-0 flex-1">
            <SearchIcon className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-muted" />
            <input
              type="search"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search apps"
              aria-label="Search installed apps"
              className={`w-full rounded-xl border border-hairline bg-surface py-2.5 pl-9 pr-3 text-sm text-ink placeholder:text-ink-muted ${FOCUS}`}
            />
          </label>
          <div
            className="inline-flex rounded-xl border border-hairline bg-surface p-1"
            role="group"
            aria-label="Sort apps"
          >
            {(['name', 'size'] as const).map((key) => (
              <button
                key={key}
                type="button"
                aria-pressed={sort === key}
                onClick={() => setSort(key)}
                className={`rounded-lg px-3 py-1.5 text-sm font-medium transition-colors ${FOCUS} ${
                  sort === key ? 'bg-accent-soft text-accent-strong' : 'text-ink-muted hover:text-ink'
                }`}
              >
                {key === 'name' ? 'Name' : 'Size'}
              </button>
            ))}
          </div>
        </div>

        {loading && apps.length === 0 ? (
          <div className="mt-5 space-y-2">
            {[0, 1, 2, 3, 4].map((index) => (
              <div key={index} className="h-16 animate-pulse rounded-xl border border-hairline bg-surface" />
            ))}
          </div>
        ) : error !== null && apps.length === 0 ? null : list !== null && list.ok && list.trusted === false ? (
          <Empty
            text="Couldn't read installed apps."
            action={
              <Button size="sm" onClick={() => load(true)}>
                Try again
              </Button>
            }
          />
        ) : apps.length === 0 ? (
          <Empty text="No apps found." />
        ) : visible.length === 0 ? (
          <Empty text="No apps match this search." />
        ) : (
          <section
            aria-label="Installed apps"
            className="mt-5 overflow-hidden rounded-2xl border border-hairline bg-surface shadow-card"
          >
            <div className="flex items-center justify-between gap-3 border-b border-hairline px-5 py-3 text-sm">
              <span className="font-semibold text-ink">
                {apps.length} {apps.length === 1 ? 'app' : 'apps'}
              </span>
              {totalBytes > 0 && <span className="text-ink-muted">{formatBytes(totalBytes)} in total</span>}
            </div>
            <ul className="divide-y divide-hairline">
              {visible.map((app) => (
                <AppRow key={app.id} app={app} elevated={elevated} onRemove={() => setRemoving(app)} />
              ))}
            </ul>
          </section>
        )}
      </div>

      {removing !== null && (
        <UninstallWizard
          api={api}
          app={removing}
          elevated={elevated}
          onClose={() => setRemoving(null)}
          onChanged={() => load(true)}
        />
      )}

      {adoptJobId !== null && (
        <UninstallFlow
          api={api}
          appId={null}
          adoptJobId={adoptJobId}
          elevated={elevated}
          onClose={() => setAdoptJobId(null)}
          onFinished={() => load(true)}
        />
      )}

      {flowAppId !== null && (
        <UninstallFlow
          api={api}
          appId={flowAppId}
          elevated={elevated}
          onClose={() => setFlowAppId(null)}
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

function AppRow({ app, elevated, onRemove }: { app: UninstallAppSummary; elevated: boolean; onRemove: () => void }) {
  const size = sizeOf(app);
  const initial = app.displayName.trim().charAt(0).toUpperCase() || '?';
  return (
    <li className="flex items-center gap-4 px-5 py-3.5 hover:bg-surface-hover">
      <span
        aria-hidden
        className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-accent-soft text-sm font-semibold text-accent-strong"
      >
        {initial}
      </span>
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <p className="truncate text-sm font-medium text-ink">{app.displayName}</p>
          {app.caution !== null && <Badge tone="review">{CAUTION_LABEL[app.caution]}</Badge>}
          {!app.hasUninstaller && <Badge>Leftovers only</Badge>}
          {!elevated && app.requiresAdmin && <Badge>Needs admin</Badge>}
        </div>
        <p className="mt-0.5 truncate text-xs text-ink-muted">
          {app.publisher.length > 0 ? app.publisher : 'Unknown publisher'}
          {app.version.length > 0 ? ` · ${app.version}` : ''}
        </p>
      </div>
      <span className="w-20 shrink-0 text-right font-mono text-xs tabular-nums text-ink-muted">
        {size === null ? '—' : formatBytes(size)}
      </span>
      <Button size="sm" aria-label={`Remove ${app.displayName}`} onClick={onRemove}>
        Uninstall
      </Button>
    </li>
  );
}

function Empty({ text, action }: { text: string; action?: React.ReactNode }) {
  return (
    <div className="mt-5 rounded-2xl border border-hairline bg-surface px-4 py-14 text-center text-sm text-ink-muted">
      <p>{text}</p>
      {action !== undefined && <div className="mt-4 flex justify-center">{action}</div>}
    </div>
  );
}
