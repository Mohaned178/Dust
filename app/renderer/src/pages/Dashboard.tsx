import { useCallback, useEffect, useState } from 'react';
import type { ReactNode } from 'react';
import type { CategoryId } from '@dust/core';
import type { CategorySummaryRow, DashboardState, DashboardVolumeCard, DustApi, StartAnalyzeResult } from '../../../src/shared/ipc';
import { CATEGORY_DESCRIPTIONS, CATEGORY_LABELS, RECLAIMABLE_SCOPE_NOTE } from '../../../src/shared/categories';
import { CleanDialog } from '../components/CleanDialog';
import { UsageBar } from '../components/UsageBar';
import { ArrowRightIcon, ChevronRightIcon, CloseIcon, InfoIcon, PackageIcon } from '../components/icons';
import { formatBytes, formatCount, formatRelativeTime } from '../format';

export interface DashboardProps {
  api: DustApi;
  onAnalyze: (root: string) => Promise<StartAnalyzeResult>;
  onViewResults: (root: string, category?: CategoryId | null) => void;
  onQuickClean: () => void;
  onOpenDevCleanup: (root: string) => void;
  onSystemDrive?: (root: string | null) => void;
  shortcutsEnabled?: boolean;
}

const FOCUS = 'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent';
const PRIMARY = `inline-flex items-center justify-center rounded-lg bg-accent px-6 py-3 text-sm font-semibold text-white transition-colors hover:bg-accent-strong disabled:cursor-not-allowed disabled:opacity-45 ${FOCUS}`;
const SECONDARY = `inline-flex items-center justify-center rounded-lg border border-hairline bg-surface px-6 py-3 text-sm font-semibold text-ink transition-colors hover:border-hairline-strong hover:bg-surface-hover disabled:cursor-not-allowed disabled:opacity-45 ${FOCUS}`;
const TERTIARY = `inline-flex items-center justify-center rounded-lg px-3 py-2 text-sm font-medium text-accent transition-colors hover:bg-accent-soft disabled:cursor-not-allowed disabled:opacity-45 ${FOCUS}`;
const COMPACT_SECONDARY = `rounded-lg border border-hairline bg-surface px-3.5 py-1.5 text-sm font-medium text-ink transition-colors hover:border-hairline-strong hover:bg-surface-hover ${FOCUS}`;
const COMPACT_PRIMARY = `rounded-lg bg-accent px-3.5 py-1.5 text-sm font-semibold text-white transition-colors hover:bg-accent-strong ${FOCUS}`;

const CATEGORY_CARDS: CategoryId[] = ['temp', 'npm-cache', 'app-caches', 'recycle-bin'];
const SHORTCUT_HINT_KEY = 'dust.dashboard.shortcuts';
const CLOCK_TICK_MS = 60_000;

function findSystem(volumes: DashboardVolumeCard[]): DashboardVolumeCard | null {
  return volumes.find((volume) => volume.role === 'system') ?? null;
}

function readShortcutHintDismissed(): boolean {
  try {
    return window.localStorage.getItem(SHORTCUT_HINT_KEY) === '1';
  } catch {
    /* localStorage can be unavailable; show the hint and let the session dismiss it */
    return false;
  }
}

export function Dashboard({
  api,
  onAnalyze,
  onViewResults,
  onQuickClean,
  onOpenDevCleanup,
  onSystemDrive,
  shortcutsEnabled = true,
}: DashboardProps) {
  const [state, setState] = useState<DashboardState | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [startError, setStartError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [pending, setPending] = useState(false);
  const [categories, setCategories] = useState<CategorySummaryRow[] | null>(null);
  const [categoryError, setCategoryError] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);
  const [categoryReloadKey, setCategoryReloadKey] = useState(0);
  const [now, setNow] = useState(() => Date.now());
  const [dismissedNotices, setDismissedNotices] = useState<ReadonlySet<string>>(() => new Set());
  const [hintDismissed, setHintDismissed] = useState(readShortcutHintDismissed);

  useEffect(() => {
    let active = true;
    setError(null);
    setState(null);
    api
      .getDashboard()
      .then((next) => {
        if (active) setState(next);
      })
      .catch((cause: unknown) => {
        if (active) setError(cause instanceof Error ? cause.message : String(cause));
      });
    return () => {
      active = false;
    };
  }, [api, reloadKey]);

  const system = state === null ? null : findSystem(state.volumes);
  const systemRoot = system?.root ?? null;
  const locked = state !== null && state.scan !== null;
  const analyzed = system !== null && system.lastAnalyzedAt !== null;

  useEffect(() => {
    onSystemDrive?.(systemRoot);
  }, [onSystemDrive, systemRoot]);

  useEffect(() => {
    if (systemRoot === null || system === null || system.lastAnalyzedAt === null) {
      setCategories(null);
      setCategoryError(null);
      return;
    }
    let active = true;
    setCategories(null);
    setCategoryError(null);
    api
      .getResults(systemRoot)
      .then((result) => {
        if (active) setCategories(result.categories);
      })
      .catch((cause: unknown) => {
        if (active) setCategoryError(cause instanceof Error ? cause.message : String(cause));
      });
    return () => {
      active = false;
    };
  }, [api, system, systemRoot, categoryReloadKey]);

  const retryLoad = useCallback(() => {
    setError(null);
    setState(null);
    setReloadKey((key) => key + 1);
  }, []);

  const retryCategories = useCallback(() => {
    setCategoryReloadKey((key) => key + 1);
  }, []);

  const start = useCallback(
    async (root: string) => {
      setBusy(true);
      setStartError(null);
      try {
        const result = await onAnalyze(root);
        if (!result.ok) {
          if (result.reason === 'busy') setPending(true);
          else if (result.reason === 'start-failed' || result.reason === 'not-system-drive') {
            setStartError(result.message);
          }
        }
      } catch (cause) {
        setStartError(cause instanceof Error ? cause.message : String(cause));
      } finally {
        setBusy(false);
      }
    },
    [onAnalyze],
  );

  const cancelAndRetry = useCallback(async () => {
    setPending(false);
    if (systemRoot === null) return;
    try {
      await api.cancelScan();
    } catch (cause) {
      setStartError(cause instanceof Error ? cause.message : String(cause));
      return;
    }
    await start(systemRoot);
  }, [api, start, systemRoot]);

  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), CLOCK_TICK_MS);
    return () => clearInterval(id);
  }, []);

  const dismissNotice = useCallback((key: string) => {
    setDismissedNotices((current) => {
      const next = new Set(current);
      next.add(key);
      return next;
    });
  }, []);

  const dismissHint = useCallback(() => {
    setHintDismissed(true);
    try {
      window.localStorage.setItem(SHORTCUT_HINT_KEY, '1');
    } catch {
      /* localStorage can be unavailable; the hint stays dismissed for this session */
    }
  }, []);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.repeat || event.isComposing || event.ctrlKey || event.metaKey || event.altKey) return;
      const target = event.target as HTMLElement | null;
      if (target !== null) {
        const tag = target.tagName;
        if (target.isContentEditable || tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
      }
      if (!shortcutsEnabled || pending || systemRoot === null) return;
      const key = event.key.toLowerCase();
      if (key === 'a' && !busy && !locked) {
        event.preventDefault();
        void start(systemRoot);
      } else if (key === 'r' && analyzed) {
        event.preventDefault();
        onViewResults(systemRoot, null);
      } else if (key === 'q' && !locked) {
        event.preventDefault();
        onQuickClean();
      } else if (key === 'd') {
        event.preventDefault();
        onOpenDevCleanup(systemRoot);
      }
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [
    analyzed,
    busy,
    locked,
    onOpenDevCleanup,
    onQuickClean,
    onViewResults,
    pending,
    shortcutsEnabled,
    start,
    systemRoot,
  ]);

  if (error !== null) {
    return (
      <main className="dust-dashboard flex min-h-screen items-center justify-center bg-canvas p-8">
        <div className="w-full max-w-md rounded-2xl border border-hairline bg-surface p-8 text-center shadow-card">
          <h1 className="text-lg font-semibold text-ink">Couldn't load your drives.</h1>
          <p className="mt-2 text-sm text-ink-muted">
            Dust couldn't read the drive list from this machine. Try again — if it keeps failing, restart Dust.
          </p>
          <button type="button" onClick={retryLoad} className={`mt-6 ${PRIMARY}`}>
            Try again
          </button>
          <details className="mt-5 text-left">
            <summary className="cursor-pointer text-xs font-medium text-ink-muted transition-colors hover:text-ink">
              Technical details
            </summary>
            <p className="mt-2 break-words rounded-lg border border-hairline bg-canvas px-3 py-2 font-mono text-xs text-ink-muted">
              {error}
            </p>
          </details>
        </div>
      </main>
    );
  }
  if (state === null) {
    return <DashboardLoading />;
  }

  const notices: ReactNode[] = [];
  if (state.snapshot.status === 'corrupt' && !dismissedNotices.has('corrupt')) {
    notices.push(
      <Notice key="corrupt" onDismiss={() => dismissNotice('corrupt')}>
        Snapshot unreadable ({state.snapshot.reason}) — run an Analyze to rebuild it.
      </Notice>,
    );
  }
  if (state.snapshot.status === 'ok' && state.snapshot.rulesStale && !dismissedNotices.has('stale')) {
    notices.push(
      <Notice
        key="stale"
        onDismiss={() => dismissNotice('stale')}
        action={
          <button
            type="button"
            disabled={busy || locked}
            onClick={() => {
              if (systemRoot !== null) void start(systemRoot);
            }}
            className={COMPACT_SECONDARY}
          >
            Rescan
          </button>
        }
      >
        Rules updated — rescan for accuracy.
      </Notice>,
    );
  }
  const cancelledKey = `cancelled:${state.snapshot.finishedAt ?? 'unknown'}`;
  if (
    state.snapshot.status === 'ok' &&
    state.snapshot.scanStatus === 'cancelled' &&
    !dismissedNotices.has(cancelledKey)
  ) {
    notices.push(
      <Notice key={cancelledKey} onDismiss={() => dismissNotice(cancelledKey)}>
        The last scan was cancelled — its results are partial.
      </Notice>,
    );
  }
  if (system?.sessionOnly === true && !dismissedNotices.has('session-only')) {
    notices.push(
      <Notice key="session-only" onDismiss={() => dismissNotice('session-only')}>
        Snapshot could not be saved — these results are for this session only.
      </Notice>,
    );
  }
  if (locked && state.scan !== null) {
    notices.push(
      <Notice key="running">
        A scan is already running on <span className="font-mono">{state.scan.root}</span>.
      </Notice>,
    );
  }
  if (startError !== null) {
    notices.push(
      <Notice key="start-error" alert>
        Could not start the scan: <span className="font-mono">{startError}</span>
      </Notice>,
    );
  }
  if (categoryError !== null) {
    notices.push(
      <Notice
        key="category-error"
        alert
        action={
          <button type="button" onClick={retryCategories} className={COMPACT_SECONDARY}>
            Try again
          </button>
        }
      >
        Couldn't load category details: <span className="font-mono">{categoryError}</span>
      </Notice>,
    );
  }

  return (
    <main className="dust-dashboard min-h-screen bg-canvas text-ink">
      <div className="mx-auto max-w-6xl px-6 py-10 sm:px-8 sm:py-12">
        <h1 className="sr-only">Dashboard</h1>

        {notices.length > 0 && (
          <div aria-live="polite" className="mb-8 space-y-2.5">
            {notices}
          </div>
        )}

        {system !== null ? (
          <SystemHero
            volume={system}
            now={now}
            analyzed={analyzed}
            busy={busy}
            locked={locked}
            onAnalyze={() => void start(system.root)}
            onViewResults={() => onViewResults(system.root, null)}
            onQuickClean={onQuickClean}
          />
        ) : (
          <NoSystemDrive />
        )}

        {system !== null && !hintDismissed && <ShortcutHint analyzed={analyzed} onDismiss={dismissHint} />}

        {system !== null && !analyzed && <FirstRunHint />}

        {system !== null && analyzed && categoryError === null &&
          (categories === null ? (
            <EvidenceLoading />
          ) : (
            <div className="dust-evidence-in">
              <CategorySection
                categories={categories}
                onSelect={(category) => {
                  if (systemRoot !== null) onViewResults(systemRoot, category);
                }}
              />
              <DeveloperSection
                categories={categories}
                onOpen={() => {
                  if (systemRoot !== null) onOpenDevCleanup(systemRoot);
                }}
              />
            </div>
          ))}
      </div>

      {pending && (
        <CleanDialog label="Scan already running" onClose={() => setPending(false)}>
          <p className="text-sm text-ink">
            {state.scan !== null ? (
              <>
                A scan is already running on <span className="font-mono">{state.scan.root}</span>. Cancel it
                first?
              </>
            ) : (
              'A scan is already running. Cancel it first?'
            )}
          </p>
          <div className="mt-5 flex justify-end gap-2">
            <button type="button" onClick={() => setPending(false)} className={COMPACT_SECONDARY}>
              Wait
            </button>
            <button type="button" onClick={() => void cancelAndRetry()} className={COMPACT_PRIMARY}>
              Cancel it
            </button>
          </div>
        </CleanDialog>
      )}
    </main>
  );
}

function capacityLine(volume: DashboardVolumeCard): string | null {
  if (volume.totalBytes === null || volume.freeBytes === null) return null;
  const used = Math.max(volume.totalBytes - volume.freeBytes, 0);
  return `${formatBytes(used)} used · ${formatBytes(volume.freeBytes)} free`;
}

function SystemHero({
  volume,
  now,
  analyzed,
  busy,
  locked,
  onAnalyze,
  onViewResults,
  onQuickClean,
}: {
  volume: DashboardVolumeCard;
  now: number;
  analyzed: boolean;
  busy: boolean;
  locked: boolean;
  onAnalyze: () => void;
  onViewResults: () => void;
  onQuickClean: () => void;
}) {
  const disabled = busy || locked;
  const capacity = capacityLine(volume);
  const usedBytes =
    volume.totalBytes !== null && volume.freeBytes !== null ? Math.max(volume.totalBytes - volume.freeBytes, 0) : null;
  const capacityBar =
    usedBytes !== null && volume.totalBytes !== null ? (
      <div className="mt-3 max-w-sm">
        <UsageBar usedBytes={usedBytes} totalBytes={volume.totalBytes} label={`${volume.root} disk usage`} />
      </div>
    ) : null;
  return (
    <section
      aria-labelledby="system-drive-label"
      className="dust-rise rounded-2xl border border-hairline bg-surface p-7 shadow-card sm:p-9"
    >
      <div className="grid gap-x-10 gap-y-8 sm:grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)] sm:items-center">
        <div className="min-w-0">
          <h2
            id="system-drive-label"
            className="text-xs font-semibold uppercase tracking-[0.14em] text-ink-muted"
          >
            System drive
          </h2>

          <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1">
            <span className="font-mono text-2xl font-medium tracking-tight text-ink">{volume.root}</span>
            <span className="rounded-full border border-accent-border bg-accent-soft px-2.5 py-0.5 text-xs font-medium text-accent-strong">
              System
            </span>
          </div>

          {analyzed ? (
            <>
              <div className="mt-7 flex flex-wrap items-baseline gap-x-5 gap-y-2">
                <p className="font-mono text-[2.5rem] font-semibold leading-none tracking-tight text-ink">
                  {formatBytes(volume.reclaimableBytes)}
                </p>
                {capacity !== null && <p className="font-mono text-xs text-ink-muted">{capacity}</p>}
              </div>
              {capacityBar}
              <p className="mt-2.5 text-sm text-ink-muted">
                Reclaimable · Last analyzed {formatRelativeTime(volume.lastAnalyzedAt, now)}
                {volume.lastCleanedAt !== null && <> · Last cleaned {formatRelativeTime(volume.lastCleanedAt, now)}</>}
              </p>
              <p className="mt-1.5 text-xs text-ink-muted">{RECLAIMABLE_SCOPE_NOTE}</p>
            </>
          ) : (
            <>
              <p className="mt-7 text-lg font-semibold tracking-tight text-ink">Not analyzed yet</p>
              <p className="mt-2 text-sm text-ink-muted">
                Analyze this drive to see what is safe to delete.
              </p>
              {capacity !== null && <p className="mt-2.5 font-mono text-xs text-ink-muted">{capacity}</p>}
              {capacityBar}
            </>
          )}
        </div>

        <div className="flex flex-wrap items-center gap-3 sm:justify-end">
          {analyzed ? (
            <>
              <button
                type="button"
                aria-label={`View results for ${volume.root}`}
                onClick={onViewResults}
                className={`${PRIMARY} gap-1.5`}
              >
                View results
                <ArrowRightIcon className="h-4 w-4" />
              </button>
              <button
                type="button"
                aria-label={`Re-analyze ${volume.root}`}
                disabled={disabled}
                onClick={onAnalyze}
                className={SECONDARY}
              >
                {busy ? 'Starting…' : 'Re-analyze'}
              </button>
            </>
          ) : (
            <button
              type="button"
              aria-label={`Analyze ${volume.root}`}
              disabled={disabled}
              onClick={onAnalyze}
              className={PRIMARY}
            >
              {busy ? 'Starting…' : 'Analyze'}
            </button>
          )}
          <button
            type="button"
            aria-label={`Quick Clean for ${volume.root}`}
            disabled={disabled}
            onClick={onQuickClean}
            className={TERTIARY}
          >
            Quick Clean
          </button>
        </div>
      </div>
    </section>
  );
}

function NoSystemDrive() {
  return (
    <section className="rounded-2xl border border-hairline bg-surface p-8 text-center shadow-card">
      <p className="text-sm text-ink-muted">
        No system drive detected. Analyze and Quick Clean need the Windows system drive.
      </p>
      <button type="button" aria-label="Quick Clean" disabled className={`mt-6 ${TERTIARY}`}>
        Quick Clean
      </button>
    </section>
  );
}

function CategorySection({
  categories,
  onSelect,
}: {
  categories: CategorySummaryRow[];
  onSelect: (category: CategoryId) => void;
}) {
  const total = CATEGORY_CARDS.reduce((sum, category) => {
    const row = categories.find((entry) => entry.category === category) ?? null;
    return sum + (row?.bytes ?? 0);
  }, 0);

  return (
    <section className="mt-10" aria-labelledby="categories-label">
      <div className="flex items-center gap-4">
        <h2
          id="categories-label"
          className="text-xs font-semibold uppercase tracking-[0.14em] text-ink-muted"
        >
          Reclaimable by category
        </h2>
        <div className="h-px flex-1 bg-hairline" />
      </div>
      <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
        {CATEGORY_CARDS.map((category) => {
          const row = categories.find((entry) => entry.category === category) ?? null;
          const known = row !== null;
          const label = CATEGORY_LABELS[category];
          const description = CATEGORY_DESCRIPTIONS[category];
          const share = known && row !== null && total > 0 ? (row.bytes / total) * 100 : 0;
          const reveal = `opacity-0 transition-opacity duration-200 ease-[cubic-bezier(0.16,1,0.3,1)] group-hover:opacity-100 group-focus-visible:opacity-100 motion-reduce:transition-none`;
          return (
            <button
              key={category}
              type="button"
              disabled={!known}
              aria-label={`${label} — ${
                known && row !== null ? `${formatBytes(row.bytes)} reclaimable. ${description}` : 'no data'
              }`}
              onClick={() => onSelect(category)}
              className={`group flex flex-col items-start gap-1.5 rounded-xl border border-hairline bg-surface px-4 py-3.5 text-left transition-colors ${FOCUS} ${
                known
                  ? 'hover:border-hairline-strong hover:bg-surface-hover'
                  : 'cursor-not-allowed opacity-55'
              }`}
            >
              <span className="flex w-full items-center justify-between gap-2">
                <span className="min-w-0 truncate text-sm font-medium text-ink">{label}</span>
                <ChevronRightIcon
                  className={`h-3.5 w-3.5 shrink-0 text-ink-muted ${reveal}`}
                />
              </span>
              <span
                className={`font-mono text-lg font-semibold tracking-tight ${known ? 'text-ink' : 'text-ink-muted'}`}
              >
                {known && row !== null ? formatBytes(row.bytes) : '—'}
              </span>
              <span
                aria-hidden="true"
                className="mt-0.5 h-1 w-full overflow-hidden rounded-full transition-colors duration-200 ease-[cubic-bezier(0.16,1,0.3,1)] group-hover:bg-track group-focus-visible:bg-track motion-reduce:transition-none"
              >
                {share > 0 && (
                  <span className={`block h-full rounded-full bg-accent ${reveal}`} style={{ width: `${share}%` }} />
                )}
              </span>
              <span className={`text-xs text-ink-muted ${reveal}`}>{description}</span>
            </button>
          );
        })}
      </div>
    </section>
  );
}

function DeveloperSection({
  categories,
  onOpen,
}: {
  categories: CategorySummaryRow[];
  onOpen: () => void;
}) {
  const row = categories.find((entry) => entry.category === 'npm-projects') ?? null;
  const detail =
    row !== null
      ? `${formatCount(row.items)} projects · ${formatBytes(row.bytes)} reclaimable`
      : 'Project list unavailable';

  return (
    <section className="mt-10" aria-labelledby="dev-label">
      <div className="flex items-center gap-4">
        <h2 id="dev-label" className="text-xs font-semibold uppercase tracking-[0.14em] text-ink-muted">
          Developer cleanup
        </h2>
        <div className="h-px flex-1 bg-hairline" />
      </div>
      <button
        type="button"
        onClick={onOpen}
        className={`mt-4 flex w-full items-center gap-4 rounded-xl border border-hairline bg-surface px-5 py-4 text-left transition-colors hover:border-hairline-strong hover:bg-surface-hover ${FOCUS}`}
      >
        <PackageIcon className="h-5 w-5 shrink-0 text-ink-muted" />
        <span className="min-w-0 flex-1">
          <span className="block text-sm font-medium text-ink">npm projects</span>
          <span className="mt-0.5 block truncate text-sm text-ink-muted">{detail}</span>
        </span>
        <ChevronRightIcon className="h-4 w-4 shrink-0 text-ink-muted" />
      </button>
    </section>
  );
}

function ShortcutHint({ analyzed, onDismiss }: { analyzed: boolean; onDismiss: () => void }) {
  return (
    <div className="mt-3 flex items-center justify-between gap-3 text-xs text-ink-muted">
      <p className="min-w-0">
        Shortcuts — <Kbd>A</Kbd> {analyzed ? 're-analyze' : 'analyze'}
        {analyzed && (
          <>
            {' · '}
            <Kbd>R</Kbd> results
          </>
        )}{' '}
        · <Kbd>Q</Kbd> quick clean · <Kbd>D</Kbd> dev cleanup
      </p>
      <button
        type="button"
        aria-label="Dismiss keyboard shortcuts"
        onClick={onDismiss}
        className={`inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-md text-ink-muted transition-colors hover:bg-canvas hover:text-ink ${FOCUS}`}
      >
        <CloseIcon className="h-3.5 w-3.5" />
      </button>
    </div>
  );
}

function Kbd({ children }: { children: ReactNode }) {
  return (
    <kbd className="rounded border border-hairline bg-canvas px-1 py-0.5 font-sans text-xs font-medium leading-none text-ink">
      {children}
    </kbd>
  );
}

function DashboardLoading() {
  return (
    <main className="dust-dashboard min-h-screen bg-canvas text-ink">
      <div className="mx-auto max-w-6xl px-6 py-10 sm:px-8 sm:py-12">
        <div role="status" aria-busy="true" className="animate-pulse motion-reduce:animate-none">
          <span className="sr-only">Loading volumes…</span>
          <div aria-hidden="true">
            <div className="rounded-2xl border border-hairline bg-surface p-7 sm:p-9">
              <div className="h-3 w-24 rounded bg-track/70" />
              <div className="mt-4 h-6 w-20 rounded bg-track" />
              <div className="mt-7 h-10 w-44 rounded bg-track" />
              <div className="mt-3 h-3.5 w-56 rounded bg-track/70" />
              <div className="mt-7 flex gap-3">
                <div className="h-11 w-32 rounded-lg bg-track" />
                <div className="h-11 w-28 rounded-lg bg-track" />
              </div>
            </div>

            <div className="mt-10">
              <div className="flex items-center gap-4">
                <div className="h-3 w-40 rounded bg-track/70" />
                <div className="h-px flex-1 bg-hairline" />
              </div>
              <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
                {Array.from({ length: 4 }, (_, index) => (
                  <div key={index} className="rounded-xl border border-hairline bg-surface px-4 py-3.5">
                    <div className="h-3.5 w-16 rounded bg-track/70" />
                    <div className="mt-2.5 h-5 w-20 rounded bg-track" />
                  </div>
                ))}
              </div>
            </div>

            <EvidenceSkeleton />
          </div>
        </div>
      </div>
    </main>
  );
}

function FirstRunHint() {
  return (
    <section className="mt-10" aria-labelledby="categories-label">
      <div className="flex items-center gap-4">
        <h2
          id="categories-label"
          className="text-xs font-semibold uppercase tracking-[0.14em] text-ink-muted"
        >
          Reclaimable by category
        </h2>
        <div className="h-px flex-1 bg-hairline" />
      </div>
      <p className="mt-4 text-sm text-ink-muted">Analyze to fill these in.</p>
    </section>
  );
}

function EvidenceLoading() {
  return (
    <div role="status" aria-busy="true" className="animate-pulse motion-reduce:animate-none">
      <span className="sr-only">Loading category details…</span>
      <EvidenceSkeleton />
    </div>
  );
}

function EvidenceSkeleton() {
  return (
    <div aria-hidden="true" className="mt-10">
      <div className="flex items-center gap-4">
        <div className="h-3 w-32 rounded bg-track/70" />
        <div className="h-px flex-1 bg-hairline" />
      </div>
      <div className="mt-4 flex items-center gap-4 rounded-xl border border-hairline bg-surface px-5 py-4">
        <div className="h-5 w-5 rounded bg-track" />
        <div className="flex-1">
          <div className="h-3.5 w-24 rounded bg-track/70" />
          <div className="mt-2 h-3.5 w-48 rounded bg-track/70" />
        </div>
      </div>
    </div>
  );
}

function Notice({
  children,
  alert = false,
  action,
  onDismiss,
}: {
  children: ReactNode;
  alert?: boolean;
  action?: ReactNode;
  onDismiss?: () => void;
}) {
  return (
    <div
      role={alert ? 'alert' : undefined}
      className="flex items-start gap-2.5 rounded-xl border border-notice-border bg-notice px-3.5 py-2.5 text-sm text-ink"
    >
      <InfoIcon className="mt-0.5 h-4 w-4 shrink-0 text-accent" />
      <p className="min-w-0 flex-1">{children}</p>
      {action !== undefined && <span className="shrink-0">{action}</span>}
      {onDismiss !== undefined && (
        <button
          type="button"
          aria-label="Dismiss"
          onClick={onDismiss}
          className={`-mr-1 inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-md text-ink-muted transition-colors hover:bg-canvas hover:text-ink ${FOCUS}`}
        >
          <CloseIcon className="h-3.5 w-3.5" />
        </button>
      )}
    </div>
  );
}
