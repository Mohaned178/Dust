import { useEffect, useState } from 'react';
import { useNavStore } from '../../app/nav';
import { useStartScan } from '../../app/useStartScan';
import { useApi } from '../../lib/api';
import { categoryName } from '../../lib/categories';
import { formatBytes, formatClock, formatCount } from '../../lib/format';
import { useCleanupStore } from '../../stores/cleanup';
import { useScanStore } from '../../stores/scan';
import { Button } from '../../ui/Button';
import { Card } from '../../ui/Card';
import { ErrorState } from '../../ui/EmptyState';
import { PageHeader } from '../../ui/PageHeader';
import { ProgressBar } from '../../ui/ProgressBar';
import { Tag } from '../../ui/Badge';
import { refreshAfterClean } from './refresh';

/** Shortens a long path in the middle, where the start and the end both say something. */
export function middleTruncate(path: string, max = 72): string {
  if (path.length <= max) return path;
  const keep = max - 1;
  const head = Math.ceil(keep * 0.4);
  return `${path.slice(0, head)}…${path.slice(path.length - (keep - head))}`;
}

export interface ScanViewProps {
  root: string;
  runId: string;
  /** Used space on the drive, the denominator that turns bytes found into a percentage. */
  usedBytes: number | null;
}

export function ScanView({ root, runId, usedBytes }: ScanViewProps) {
  const api = useApi();
  const navigate = useNavStore((state) => state.navigate);
  const run = useScanStore((state) => state.runs[runId]);
  const scan = useStartScan();
  const [cancelling, setCancelling] = useState(false);
  const [cancelFailed, setCancelFailed] = useState(false);
  // The clock ticks from its own timer, not from scan events.
  const [now, setNow] = useState(() => Date.now());

  const outcome = run?.outcome ?? null;
  useEffect(() => {
    if (outcome !== null) return;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [outcome]);

  // The run's first event can trail the navigation by a moment. If it never arrives (an old link, a run dropped
  // from the store), show the results instead of waiting forever.
  const missing = run === undefined;
  useEffect(() => {
    if (!missing) return;
    const timer = setTimeout(() => navigate('cleanup', { view: 'results', root }), 3000);
    return () => clearTimeout(timer);
  }, [missing, navigate, root]);

  // A finished scan goes straight to its results. The lists are read again first, so the page never shows the
  // previous scan as if it were this one.
  const finished = outcome?.type === 'finished';
  useEffect(() => {
    if (!finished) return;
    let active = true;
    useCleanupStore.getState().resetSelection();
    void refreshAfterClean(api, root).finally(() => {
      if (active) navigate('cleanup', { view: 'results', root });
    });
    return () => {
      active = false;
    };
  }, [api, finished, navigate, root]);

  if (outcome?.type === 'failed') {
    return (
      <>
        <PageHeader title="Clean up" />
        <Card>
          <ErrorState
            title="The scan did not finish"
            description={outcome.message}
            onRetry={() => void scan.start({ root, usedBytes })}
          />
        </Card>
      </>
    );
  }

  const progress = run?.progress ?? null;
  const checking = run?.finalizing === true || finished;
  const bytes = progress?.bytesSeen ?? 0;
  // Bytes found track used space closely; hold below 100 until the scan really ends.
  const fraction = checking ? 1 : usedBytes !== null && usedBytes > 0 ? Math.min(bytes / usedBytes, 0.99) : null;
  const found = (run?.categories ?? []).filter((row) => row.bytes > 0 && row.category !== 'npm-projects');
  const elapsed = run?.startedAt != null ? now - run.startedAt : 0;
  const path = progress?.currentPath ?? '';

  const cancel = () => {
    setCancelling(true);
    setCancelFailed(false);
    void api.cancelScan().catch(() => {
      setCancelling(false);
      setCancelFailed(true);
    });
  };

  return (
    <>
      <PageHeader title="Clean up" subtitle={`Scanning ${root}`} />
      <Card className="flex flex-col gap-4 p-6">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <p className="text-subtitle">
              {checking
                ? 'Checking what is safe to clean'
                : `Scanning ${root} — ${formatCount(progress?.filesScanned ?? 0)} files`}
            </p>
            <p className="mt-1 text-body text-ink-2">
              {formatClock(elapsed)} elapsed · {formatBytes(bytes)} looked at
            </p>
          </div>
          <Button variant="secondary" size="lg" onClick={cancel} disabled={cancelling || checking}>
            {cancelling ? 'Stopping' : 'Cancel'}
          </Button>
        </div>
        <ProgressBar value={fraction} label={checking ? 'Checking what is safe to clean' : `Scanning ${root}`} />
        <p className="truncate font-mono text-caption text-ink-2" title={path} aria-hidden="true">
          {checking
            ? 'Matching your files with Dust’s cleanup rules…'
            : path === ''
              ? 'Starting…'
              : middleTruncate(path)}
        </p>
        <p className="sr-only" role="status">
          {checking ? 'Checking what is safe to clean' : 'Scanning'}
        </p>
        {cancelFailed ? <p className="text-body text-danger">Dust could not stop the scan. Try again.</p> : null}
      </Card>
      {found.length > 0 ? (
        <section className="mt-6" aria-label="Found so far">
          <h2 className="mb-2 text-body font-semibold">Found so far</h2>
          <ul className="flex flex-wrap gap-2">
            {found.map((row) => (
              <li key={row.category}>
                <Tag>
                  {categoryName(row.category)} · {formatBytes(row.bytes)}
                </Tag>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </>
  );
}
