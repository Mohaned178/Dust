import type { CategoryId } from '@dust/core';
import { useMemo } from 'react';
import type { ScanProgressPayload } from '../../../../src/shared/ipc';
import { categoryName } from '../../lib/categories';
import { formatBytes, formatCount } from '../../lib/format';
import { Button } from '../../ui/Button';
import { Card } from '../../ui/Card';
import { RelativeTime } from '../../ui/Display';
import { ErrorState } from '../../ui/EmptyState';
import { Notice } from '../../ui/Notice';
import { ProgressBar } from '../../ui/ProgressBar';
import { Skeleton } from '../../ui/Skeleton';
import { UsageBar } from '../../ui/UsageBar';
import type { UsageSegment } from '../../ui/UsageBar';

export interface CleanableRow {
  category: CategoryId;
  bytes: number;
}

/** What the hero card shows. Each kind is one of the states in the plan. */
export type HeroState =
  | { kind: 'loading' }
  | { kind: 'error'; onRetry: () => void }
  | { kind: 'no-drive' }
  | {
      kind: 'scanning';
      root: string;
      progress: ScanProgressPayload | null;
      usedBytes: number | null;
      /** Opens the scan screen. Null when the run id is not known (a scan that began before Dust opened). */
      onOpen: (() => void) | null;
    }
  | { kind: 'never'; root: string; usedBytes: number | null; totalBytes: number | null }
  | {
      /** The drive has been scanned, but its totals have not arrived yet (or could not be read). */
      kind: 'checking';
      root: string;
      finishedAt: number | null;
      usedBytes: number | null;
      totalBytes: number | null;
      failed: boolean;
    }
  | {
      kind: 'results';
      root: string;
      rows: ReadonlyArray<CleanableRow>;
      finishedAt: number | null;
      usedBytes: number | null;
      totalBytes: number | null;
      notes: ReadonlyArray<string>;
      onSelectCategory: (category: CategoryId) => void;
      onOpen: () => void;
    };

export interface HeroProps {
  state: HeroState;
  onScan: () => void;
  scanStarting: boolean;
  onQuickClean: () => void;
}

function UsageLine({ usedBytes, totalBytes }: { usedBytes: number | null; totalBytes: number | null }) {
  if (usedBytes === null || totalBytes === null) return null;
  return (
    <p className="text-caption text-ink-2">
      {formatBytes(usedBytes)} of {formatBytes(totalBytes)} used
    </p>
  );
}

function ResultsHero({
  state,
  onScan,
  scanStarting,
  onQuickClean,
}: {
  state: Extract<HeroState, { kind: 'results' }>;
  onScan: () => void;
  scanStarting: boolean;
  onQuickClean: () => void;
}) {
  const { rows, usedBytes, totalBytes, root, onSelectCategory } = state;
  // The headline is the sum of the rows in the bar's legend, so every figure can be traced to a line.
  const total = rows.reduce((sum, row) => sum + row.bytes, 0);
  const segments = useMemo(() => {
    const parts: UsageSegment[] = rows.map((row) => ({
      id: row.category,
      label: categoryName(row.category),
      bytes: row.bytes,
      onSelect: () => onSelectCategory(row.category),
    }));
    if (usedBytes !== null && usedBytes > total) {
      parts.push({ id: 'other', label: 'Everything else', bytes: usedBytes - total, muted: true });
    }
    return parts;
  }, [rows, usedBytes, total, onSelectCategory]);

  const notes = state.notes.map((note) => <Notice key={note}>{note}</Notice>);

  if (total === 0) {
    return (
      <Card className="flex flex-col gap-4 p-6">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <h2 className="text-subtitle">{root} is in good shape.</h2>
            <p className="mt-1 text-body text-ink-2">
              Nothing to clean right now. Last checked <RelativeTime ms={state.finishedAt} />.
            </p>
          </div>
          <Button size="lg" onClick={onScan} loading={scanStarting}>
            Scan again
          </Button>
        </div>
        {notes}
        <UsageLine usedBytes={usedBytes} totalBytes={totalBytes} />
      </Card>
    );
  }

  return (
    <Card className="flex flex-col gap-4 p-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h2>
            <span className="text-hero font-semibold">{formatBytes(total)}</span>{' '}
            <span className="text-subtitle font-normal">can be freed safely</span>
          </h2>
          <p className="mt-1 text-body text-ink-2">
            {root} · last checked <RelativeTime ms={state.finishedAt} />
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="subtle" size="lg" onClick={onQuickClean}>
            Quick clean
          </Button>
          <Button variant="subtle" size="lg" onClick={onScan} loading={scanStarting}>
            Scan again
          </Button>
          <Button variant="primary" size="lg" onClick={state.onOpen}>
            Clean up {formatBytes(total)}
          </Button>
        </div>
      </div>
      {notes}
      <div className="flex flex-col gap-2">
        {totalBytes !== null ? (
          <UsageBar segments={segments} totalBytes={totalBytes} label={`Space used on ${root}`} />
        ) : null}
        <UsageLine usedBytes={usedBytes} totalBytes={totalBytes} />
      </div>
    </Card>
  );
}

export function Hero({ state, onScan, scanStarting, onQuickClean }: HeroProps) {
  switch (state.kind) {
    case 'loading':
      return (
        <Card className="flex flex-col gap-4 p-6" aria-busy="true">
          <Skeleton className="h-12 w-72" />
          <Skeleton className="h-4 w-56" />
          <Skeleton className="h-2 w-full" />
        </Card>
      );
    case 'error':
      return (
        <Card>
          <ErrorState title="Dust could not read your drives" onRetry={state.onRetry} />
        </Card>
      );
    case 'no-drive':
      return (
        <Card className="p-6">
          <h2 className="text-subtitle">Dust could not find your Windows drive.</h2>
          <p className="mt-1 text-body text-ink-2">Restart Dust to try again.</p>
        </Card>
      );
    case 'scanning': {
      const found = state.progress?.filesScanned ?? 0;
      const fraction =
        state.progress !== null && state.usedBytes !== null && state.usedBytes > 0
          ? Math.min(state.progress.bytesSeen / state.usedBytes, 1)
          : null;
      return (
        <Card className="flex flex-col gap-4 p-6">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div>
              <h2 className="text-subtitle">Scanning {state.root}</h2>
              <p className="mt-1 text-body text-ink-2">{formatCount(found)} files checked so far.</p>
            </div>
            {state.onOpen ? (
              <Button size="lg" onClick={state.onOpen}>
                See progress
              </Button>
            ) : null}
          </div>
          <ProgressBar value={fraction} label={`Scanning ${state.root}`} />
        </Card>
      );
    }
    case 'never':
      return (
        <Card className="flex flex-col gap-4 p-6">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div className="max-w-xl">
              <h2 className="text-subtitle">Find out what can be freed on {state.root}</h2>
              <p className="mt-1 text-body text-ink-2">
                Dust looks at temporary files, caches and the Recycle Bin. Nothing is deleted until you confirm it.
              </p>
            </div>
            <Button variant="primary" size="lg" onClick={onScan} loading={scanStarting}>
              Scan {state.root}
            </Button>
          </div>
          {state.usedBytes !== null && state.totalBytes !== null ? (
            <div className="flex flex-col gap-2">
              <UsageBar
                segments={[{ id: 'used', label: 'Used', bytes: state.usedBytes }]}
                totalBytes={state.totalBytes}
                label={`Space used on ${state.root}`}
                legend={false}
              />
              <UsageLine usedBytes={state.usedBytes} totalBytes={state.totalBytes} />
            </div>
          ) : null}
        </Card>
      );
    case 'checking':
      return (
        <Card className="flex flex-col gap-4 p-6" aria-busy={!state.failed}>
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div>
              {state.failed ? (
                <h2 className="text-subtitle">Dust could not read the results of the last scan.</h2>
              ) : (
                <Skeleton className="h-12 w-72" />
              )}
              <p className="mt-1 text-body text-ink-2">
                {state.root} · last checked <RelativeTime ms={state.finishedAt} />
              </p>
            </div>
            <Button variant={state.failed ? 'primary' : 'subtle'} size="lg" onClick={onScan} loading={scanStarting}>
              Scan again
            </Button>
          </div>
          {state.usedBytes !== null && state.totalBytes !== null ? (
            <div className="flex flex-col gap-2">
              <UsageBar
                segments={[{ id: 'used', label: 'Used', bytes: state.usedBytes }]}
                totalBytes={state.totalBytes}
                label={`Space used on ${state.root}`}
                legend={false}
              />
              <UsageLine usedBytes={state.usedBytes} totalBytes={state.totalBytes} />
            </div>
          ) : null}
        </Card>
      );
    case 'results':
      return <ResultsHero state={state} onScan={onScan} scanStarting={scanStarting} onQuickClean={onQuickClean} />;
  }
}
