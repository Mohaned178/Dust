import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { CategoryId } from '@dust/core';
import { CATEGORY_LABELS } from '../../../src/shared/categories';
import type { BrowseRow, DustApi, ScanEvent, ScanProgressPayload } from '../../../src/shared/ipc';
import { CategoryStrip } from '../components/CategoryStrip';
import { GradePill } from '../components/GradePill';
import { FolderIcon, InfoIcon } from '../components/icons';
import { formatBytes, formatClock, formatCount } from '../format';
import {
  selectContributorRows,
  selectFolderRows,
  selectSafeTotals,
  useLiveScan,
} from '../live-scan';
import type { TrayContributor } from '../live-scan';
import { pathParent } from '../tree';
import { ResultsView } from './ResultsView';

export interface ScanViewProps {
  api: DustApi;
  root: string;
  runId: string;
  event: ScanEvent | null;
  onBack: () => void;
  mode?: 'analyze' | 'browse';
  onBrowseComplete?: (root: string) => void;
}

const FOCUS = 'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent';
const OUTLINE_BUTTON = `inline-flex items-center justify-center rounded-lg border border-hairline bg-surface px-3.5 py-1.5 text-sm font-medium text-ink transition-colors hover:border-hairline-strong hover:bg-surface-hover disabled:cursor-not-allowed disabled:opacity-45 ${FOCUS}`;
const PATH_OPACITY = [1, 0.6, 0.3] as const;
const PATH_SAMPLE_MS = 200;
const STATS_SAMPLE_MS = 500;
const STATS_ANNOUNCE_MS = 4000;
const TRAY_ANNOUNCE_MS = 1200;

interface PathLine {
  id: number;
  path: string;
}

export function ScanView({
  api,
  root,
  runId,
  event,
  onBack,
  mode = 'analyze',
  onBrowseComplete,
}: ScanViewProps) {
  const browse = mode === 'browse';
  const [cancelFailed, setCancelFailed] = useState(false);
  const [lastProgress, setLastProgress] = useState<ScanProgressPayload | null>(null);
  const [pathLines, setPathLines] = useState<PathLine[]>([]);
  const [stats, setStats] = useState<ScanProgressPayload | null>(null);
  const [statsAnnouncement, setStatsAnnouncement] = useState('');
  const [categoryFilter, setCategoryFilter] = useState<CategoryId | null>(null);
  const [trayAnnouncement, setTrayAnnouncement] = useState('');
  const progressRef = useRef<ScanProgressPayload | null>(null);
  const lineIdRef = useRef(0);
  const trayAnnounceAtRef = useRef(Number.NEGATIVE_INFINITY);

  const live = useLiveScan(api, root, runId, mode);

  const current = event !== null && 'runId' in event && event.runId === runId ? event : null;
  const finished = current?.type === 'finished' ? current : null;
  const browseFinished = current?.type === 'browse-finished' ? current : null;
  const done = finished ?? browseFinished;
  const failed = current?.type === 'failed' ? current : null;
  const progress = current?.type === 'progress' ? current.progress : lastProgress;
  const finalizing = current?.type === 'finalizing';
  const active = done === null && failed === null;

  const trayCategory = browse ? null : categoryFilter;
  const contributorTray = useMemo(
    () => selectContributorRows(live.matches, trayCategory),
    [live.matches, live.version, trayCategory],
  );
  const safeTotals = useMemo(() => selectSafeTotals(live.matches), [live.matches, live.version]);
  const folderTray = useMemo(() => selectFolderRows(live.folders, root), [live.folders, live.version, root]);

  useEffect(() => {
    progressRef.current = progress;
  }, [progress]);

  useEffect(() => {
    setLastProgress(null);
    setPathLines([]);
    setStats(null);
    setStatsAnnouncement('');
    setCategoryFilter(null);
    setTrayAnnouncement('');
    setCancelFailed(false);
    lineIdRef.current = 0;
    trayAnnounceAtRef.current = Number.NEGATIVE_INFINITY;
  }, [runId]);

  useEffect(() => {
    if (!active || browse) return;
    if (safeTotals.count === 0) return;
    const now = performance.now();
    if (now - trayAnnounceAtRef.current < TRAY_ANNOUNCE_MS) return;
    trayAnnounceAtRef.current = now;
    setTrayAnnouncement(`${formatCount(safeTotals.count)} safe · ${formatBytes(safeTotals.bytes)} so far.`);
  }, [active, browse, live.version, safeTotals.bytes, safeTotals.count]);

  useEffect(() => {
    if (event !== null && 'runId' in event && event.runId === runId && event.type === 'progress') {
      setLastProgress(event.progress);
    }
  }, [event, runId]);

  const pushPath = useCallback((raw: string) => {
    const path = raw.trim();
    if (path === '') return;
    setPathLines((lines) => {
      if (lines[0]?.path === path) return lines;
      lineIdRef.current += 1;
      return [{ id: lineIdRef.current, path }, ...lines].slice(0, 3);
    });
  }, []);

  useEffect(() => {
    if (progress === null) return;
    setStats((previous) => previous ?? progress);
    setPathLines((lines) => {
      if (lines.length > 0) return lines;
      const path = progress.currentPath.trim();
      if (path === '') return lines;
      lineIdRef.current += 1;
      return [{ id: lineIdRef.current, path }];
    });
  }, [progress]);

  useEffect(() => {
    if (!active || finalizing) return;
    const pathTimer = setInterval(() => {
      const next = progressRef.current;
      if (next !== null) pushPath(next.currentPath);
    }, PATH_SAMPLE_MS);
    const statsTimer = setInterval(() => {
      const next = progressRef.current;
      if (next !== null) setStats(next);
    }, STATS_SAMPLE_MS);
    const announceTimer = setInterval(() => {
      const next = progressRef.current;
      if (next === null) return;
      setStatsAnnouncement(
        `Scanned ${formatCount(next.filesScanned)} files, ${formatBytes(next.bytesSeen)}, ${formatClock(next.elapsedMs)} elapsed, ${formatCount(next.errors)} ${
          next.errors === 1 ? 'error' : 'errors'
        }.`,
      );
    }, STATS_ANNOUNCE_MS);
    return () => {
      clearInterval(pathTimer);
      clearInterval(statsTimer);
      clearInterval(announceTimer);
    };
  }, [active, finalizing, pushPath]);

  useEffect(() => {
    if (browseFinished !== null && onBrowseComplete !== undefined) onBrowseComplete(root);
  }, [browseFinished, onBrowseComplete, root]);

  const cancel = async () => {
    try {
      await api.cancelScan();
    } catch {
      setCancelFailed(true);
    }
  };

  const doneTitle =
    done === null
      ? ''
      : done.status === 'complete'
        ? browse
          ? 'Browse complete'
          : 'Scan complete'
        : browse
          ? 'Browse cancelled'
          : 'Scan cancelled';

  return (
    <main className="dust-dashboard min-h-screen bg-canvas text-ink">
      <div className="mx-auto max-w-6xl px-6 py-10 sm:px-8 sm:py-12">
        {active && (
          <>
            <header className="flex items-start justify-between gap-6">
              <h1 className="text-2xl font-semibold tracking-tight text-ink">
                {browse ? 'Browsing' : 'Analyzing'} <span className="font-mono">{root}</span>
              </h1>
              <button
                type="button"
                aria-label="Cancel scan"
                autoFocus
                disabled={finalizing}
                onClick={() => void cancel()}
                className={OUTLINE_BUTTON}
              >
                Cancel
              </button>
            </header>

            <section
              aria-label="Scan progress"
              className="mt-8 rounded-2xl border border-hairline bg-surface p-7 shadow-card sm:p-9"
            >
              <div className="min-h-[5.25rem]">
                <PathLog lines={pathLines} />
              </div>
              {finalizing && <p className="mt-4 text-sm text-ink-muted">Analyzing results…</p>}
            </section>

            <div className="mt-5">
              <StatsLine progress={stats} />
              <p role="status" aria-live="polite" aria-atomic="true" className="sr-only">
                {statsAnnouncement}
              </p>
            </div>

            {cancelFailed && (
              <div className="mt-5 flex items-start gap-2.5 rounded-xl border border-notice-border bg-notice px-3.5 py-2.5 text-sm text-ink">
                <InfoIcon className="mt-0.5 h-4 w-4 shrink-0 text-accent" />
                <p className="min-w-0">Couldn’t cancel the scan. It may still be running.</p>
              </div>
            )}

            {!browse && (
              <section aria-label="Reclaimable by category" className="mt-12">
                <SectionDivider label="Categories" />
                <div className="mt-5">
                  <CategoryStrip
                    categories={live.categories}
                    active={categoryFilter}
                    onSelect={(category) => setCategoryFilter(category)}
                  />
                </div>
              </section>
            )}

            <section aria-label="Live results" className="mt-12">
              <SectionDivider label="Results" />
              {browse ? (
                <BrowseTray
                  rows={folderTray.rows}
                  total={folderTray.total}
                  bytes={folderTray.bytes}
                />
              ) : (
                <ContributorTray
                  rows={contributorTray.rows}
                  total={contributorTray.total}
                  safe={safeTotals}
                  category={categoryFilter}
                  announcement={trayAnnouncement}
                />
              )}
            </section>
          </>
        )}

        {failed !== null && (
          <>
            <header className="flex items-start justify-between gap-6">
              <h1 className="text-2xl font-semibold tracking-tight text-ink">
                {browse ? 'Browse failed' : 'Scan failed'}
              </h1>
              <button type="button" onClick={onBack} className={OUTLINE_BUTTON}>
                Back to dashboard
              </button>
            </header>
            <div className="mt-6 flex items-start gap-3 rounded-2xl border border-notice-border bg-notice p-5 text-sm text-ink">
              <InfoIcon className="mt-0.5 h-4 w-4 shrink-0 text-accent" />
              <p className="min-w-0">The scan stopped before it finished.</p>
            </div>
          </>
        )}

        {done !== null && (
          <>
            <header className="flex items-start justify-between gap-6">
              <div className="min-w-0">
                <h1 className="text-2xl font-semibold tracking-tight text-ink">{doneTitle}</h1>
                <p className="mt-1.5 text-sm text-ink-muted">
                  <span className="font-mono text-ink">{root}</span>
                  <span className="mx-2 text-ink-muted/60" aria-hidden="true">
                    ·
                  </span>
                  <span className="font-mono text-ink">{formatCount(done.filesScanned)}</span> files
                  <span className="mx-2 text-ink-muted/60" aria-hidden="true">
                    ·
                  </span>
                  <span className="font-mono text-ink">{formatBytes(done.bytesSeen)}</span>
                  <span className="mx-2 text-ink-muted/60" aria-hidden="true">
                    ·
                  </span>
                  <span className="font-mono text-ink">{formatClock(done.finishedAt - done.startedAt)}</span> elapsed
                  {finished !== null && (
                    <>
                      <span className="mx-2 text-ink-muted/60" aria-hidden="true">
                        ·
                      </span>
                      <span className="font-mono text-ink">{formatBytes(finished.reclaimableBytes)}</span> reclaimable
                    </>
                  )}
                </p>
                {finished !== null && !finished.saved && (
                  <p className="mt-2 text-sm text-ink-muted">
                    Snapshot could not be saved — these results are for this session only.
                  </p>
                )}
              </div>
              <button type="button" onClick={onBack} className={OUTLINE_BUTTON}>
                Back to dashboard
              </button>
            </header>

            {!browse && (
              <div className="mt-8">
                <ResultsView api={api} root={root} runId={runId} key={runId} headingLevel={2} />
              </div>
            )}
          </>
        )}
      </div>
    </main>
  );
}

function PathLog({ lines }: { lines: PathLine[] }) {
  if (lines.length === 0) {
    return <p className="text-sm text-ink-muted">Preparing…</p>;
  }
  return (
    <ol aria-label="Paths being scanned" className="space-y-1.5">
      {lines.map((line, index) => (
        <li
          key={line.id}
          className={`dust-path-line min-w-0 ${index === 0 ? 'dust-path-enter' : ''}`}
          style={{ opacity: PATH_OPACITY[index] ?? PATH_OPACITY[PATH_OPACITY.length - 1] }}
        >
          <PathText path={line.path} />
        </li>
      ))}
    </ol>
  );
}

function PathText({ path }: { path: string }) {
  const { head, tail } = splitPathTail(path);
  return (
    <div className="flex min-w-0 font-mono text-sm leading-relaxed text-ink" title={path}>
      {head !== '' && <span className="min-w-0 truncate">{head}</span>}
      <span className="shrink-0">{tail}</span>
    </div>
  );
}

function splitPathTail(path: string): { head: string; tail: string } {
  const parts = path
    .replace(/[\\/]+$/, '')
    .split(/[\\/]+/)
    .filter((part) => part !== '');
  if (parts.length <= 2) return { head: '', tail: path };
  return { head: `${parts.slice(0, -2).join('\\')}\\`, tail: parts.slice(-2).join('\\') };
}

function StatsLine({ progress }: { progress: ScanProgressPayload | null }) {
  const files = progress?.filesScanned ?? 0;
  const bytes = progress?.bytesSeen ?? 0;
  const errors = progress?.errors ?? 0;
  const elapsed = progress?.elapsedMs ?? 0;
  return (
    <p className="text-sm text-ink-muted">
      <span className="font-mono text-ink">{formatCount(files)}</span> files
      <span className="mx-2 text-ink-muted/60" aria-hidden="true">
        ·
      </span>
      <span className="font-mono text-ink">{formatBytes(bytes)}</span>
      <span className="mx-2 text-ink-muted/60" aria-hidden="true">
        ·
      </span>
      <span className="font-mono text-ink">{formatClock(elapsed)}</span> elapsed
      <span className="mx-2 text-ink-muted/60" aria-hidden="true">
        ·
      </span>
      <span className={`font-mono ${errors > 0 ? 'text-ink' : 'text-ink-muted'}`}>{formatCount(errors)}</span> errors
    </p>
  );
}

function SectionDivider({ label }: { label: string }) {
  return (
    <div className="flex items-center gap-4">
      <h2 className="text-xs font-semibold uppercase tracking-[0.16em] text-ink-muted">{label}</h2>
      <div className="h-px flex-1 bg-hairline" />
    </div>
  );
}

function ContributorTray({
  rows,
  total,
  safe,
  category,
  announcement,
}: {
  rows: TrayContributor[];
  total: number;
  safe: { count: number; bytes: number };
  category: CategoryId | null;
  announcement: string;
}) {
  return (
    <div className="mt-5 overflow-hidden rounded-2xl border border-hairline bg-surface">
      <div className="flex items-center justify-between gap-3 border-b border-hairline px-4 py-2.5">
        <p className="font-mono text-xs text-ink">
          {formatCount(safe.count)} safe
          <span className="mx-1.5 text-ink-muted/60" aria-hidden="true">
            ·
          </span>
          {formatBytes(safe.bytes)} so far
        </p>
        {category !== null && <p className="text-xs text-ink-muted">{CATEGORY_LABELS[category]}</p>}
      </div>
      <p role="status" aria-live="polite" aria-atomic="true" className="sr-only">
        {announcement}
      </p>
      {rows.length === 0 ? (
        <p className="px-4 py-14 text-center text-sm text-ink-muted">
          {category !== null ? `No ${CATEGORY_LABELS[category]} items yet.` : 'Waiting for first results…'}
        </p>
      ) : (
        <ul className="divide-y divide-hairline">
          {rows.map((row) => (
            <li key={row.path} className="dust-disclose flex items-center gap-3 px-4 py-2.5">
              <FolderIcon className="h-4 w-4 shrink-0 text-ink-muted" />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-medium text-ink">{row.name}</span>
                {pathParent(row.path) !== null && (
                  <span className="mt-0.5 block truncate font-mono text-xs text-ink-muted">
                    {pathParent(row.path)}
                  </span>
                )}
              </span>
              <span className="shrink-0 font-mono text-sm tabular-nums text-ink">{formatBytes(row.bytes)}</span>
              <GradePill grade={row.grade} />
            </li>
          ))}
        </ul>
      )}
      {total > rows.length && (
        <p className="border-t border-hairline px-4 py-2.5 text-xs text-ink-muted">
          +{formatCount(total - rows.length)} more
        </p>
      )}
    </div>
  );
}

function BrowseTray({ rows, total, bytes }: { rows: BrowseRow[]; total: number; bytes: number }) {
  return (
    <div className="mt-5 overflow-hidden rounded-2xl border border-hairline bg-surface">
      <div className="border-b border-hairline px-4 py-2.5">
        <p className="font-mono text-xs text-ink">
          {formatCount(total)} {total === 1 ? 'folder' : 'folders'}
          <span className="mx-1.5 text-ink-muted/60" aria-hidden="true">
            ·
          </span>
          {formatBytes(bytes)} so far
        </p>
      </div>
      {rows.length === 0 ? (
        <p className="px-4 py-14 text-center text-sm text-ink-muted">Waiting for first results…</p>
      ) : (
        <ul className="divide-y divide-hairline">
          {rows.map((row) => (
            <li key={row.path} className="dust-disclose flex items-center gap-3 px-4 py-2.5">
              <FolderIcon className="h-4 w-4 shrink-0 text-ink-muted" />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-medium text-ink">{row.name}</span>
                {pathParent(row.path) !== null && (
                  <span className="mt-0.5 block truncate font-mono text-xs text-ink-muted">
                    {pathParent(row.path)}
                  </span>
                )}
              </span>
              <span className="shrink-0 font-mono text-sm tabular-nums text-ink">{formatBytes(row.bytes)}</span>
            </li>
          ))}
        </ul>
      )}
      {total > rows.length && (
        <p className="border-t border-hairline px-4 py-2.5 text-xs text-ink-muted">
          +{formatCount(total - rows.length)} more
        </p>
      )}
    </div>
  );
}
