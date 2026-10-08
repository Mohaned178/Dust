import { useEffect, useRef, useState } from 'react';
import type { CategorySummaryRow, DustApi, ScanEvent, ScanProgressPayload } from '../../../src/shared/ipc';
import { formatBytes, formatClock, formatCount } from '../format';
import { Alert, Button, Card, ProgressRing } from '../components/ui';

/**
 * What the app has seen of one scan run. The app-level listener fills this from
 * mount, so a run that finishes before this screen subscribes is not lost.
 */
export interface ScanRunRecord {
  progress: ScanProgressPayload | null;
  categories: CategorySummaryRow[];
  finalizing: boolean;
  outcome: { type: 'finished'; status: 'complete' | 'cancelled' } | { type: 'failed'; message: string } | null;
}

export function emptyScanRun(): ScanRunRecord {
  return { progress: null, categories: [], finalizing: false, outcome: null };
}

/** Folds one scan event into a run record (mutating it); events that do not describe a run are ignored. */
export function applyScanEvent(record: ScanRunRecord, event: ScanEvent): void {
  switch (event.type) {
    case 'progress':
      record.progress = event.progress;
      break;
    case 'categories':
      record.categories = event.categories;
      break;
    case 'finalizing':
      record.finalizing = true;
      break;
    case 'finished':
      record.outcome = { type: 'finished', status: event.status };
      break;
    case 'failed':
      record.outcome = { type: 'failed', message: event.message };
      break;
    default:
      break;
  }
}

export interface ScanProgressProps {
  api: DustApi;
  root: string;
  runId: string;
  /** Used space on the drive: the denominator that turns bytes found into a percentage. */
  usedBytes: number | null;
  /** Events already seen for this run (the screen mounts after the scan has started). */
  getRun?: (runId: string) => ScanRunRecord | undefined;
  onFinished: (root: string, status: 'complete' | 'cancelled') => void;
  onFailed: (message: string) => void;
}

type Phase = 'reading' | 'checking' | 'done';

const PHASE_COPY: Record<Phase, string> = {
  reading: 'Reading folders',
  checking: 'Checking what is safe to clean',
  done: 'Done',
};

export function ScanProgress({ api, root, runId, usedBytes, getRun, onFinished, onFailed }: ScanProgressProps) {
  const [seen] = useState(() => getRun?.(runId));
  const [progress, setProgress] = useState<ScanProgressPayload | null>(seen?.progress ?? null);
  const [categories, setCategories] = useState<CategorySummaryRow[]>(seen?.categories ?? []);
  const [phase, setPhase] = useState<Phase>(
    seen?.outcome?.type === 'finished' ? 'done' : seen?.finalizing ? 'checking' : 'reading',
  );
  const [cancelling, setCancelling] = useState(false);
  const [cancelFailed, setCancelFailed] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const startedAt = useRef(performance.now());
  const settled = useRef(false);
  const finishedRef = useRef(onFinished);
  const failedRef = useRef(onFailed);
  const getRunRef = useRef(getRun);
  finishedRef.current = onFinished;
  failedRef.current = onFailed;
  getRunRef.current = getRun;

  useEffect(() => {
    const settle = (outcome: NonNullable<ScanRunRecord['outcome']>) => {
      if (settled.current) return;
      settled.current = true;
      if (outcome.type === 'finished') {
        setPhase('done');
        finishedRef.current(root, outcome.status);
      } else {
        failedRef.current(outcome.message);
      }
    };
    const unsubscribe = api.onScanEvent((event) => {
      if (!('runId' in event) || event.runId !== runId) return;
      switch (event.type) {
        case 'progress':
          setProgress(event.progress);
          break;
        case 'categories':
          setCategories(event.categories);
          break;
        case 'finalizing':
          setPhase('checking');
          break;
        case 'finished':
          settle({ type: 'finished', status: event.status });
          break;
        case 'failed':
          settle({ type: 'failed', message: event.message });
          break;
        default:
          break;
      }
    });
    // Subscribed: now catch up on anything that arrived before this screen mounted.
    // Events are delivered one at a time, so nothing can slip between these two steps.
    const earlier = getRunRef.current?.(runId);
    if (earlier !== undefined) {
      setProgress(earlier.progress);
      setCategories(earlier.categories);
      if (earlier.finalizing) setPhase('checking');
      if (earlier.outcome !== null) settle(earlier.outcome);
    }
    return unsubscribe;
  }, [api, root, runId]);

  // The clock stops once the scan is done.
  useEffect(() => {
    if (phase === 'done') return;
    const id = setInterval(() => setElapsed(performance.now() - startedAt.current), 250);
    return () => clearInterval(id);
  }, [phase]);

  const bytes = progress?.bytesSeen ?? 0;
  // Bytes found track used space closely; hold at 99 until the scan really ends.
  const percent =
    phase === 'checking' || phase === 'done'
      ? 100
      : usedBytes !== null && usedBytes > 0
        ? Math.min(Math.floor((bytes / usedBytes) * 100), 99)
        : null;
  const found = categories.filter((row) => row.bytes > 0);

  const cancel = () => {
    setCancelling(true);
    setCancelFailed(false);
    void api.cancelScan().catch(() => {
      setCancelling(false);
      setCancelFailed(true);
    });
  };

  return (
    <main className="flex min-h-full items-center justify-center bg-canvas px-6 py-10 text-ink">
      <div className="w-full max-w-xl">
        <Card className="px-8 py-10 text-center">
          <p className="text-sm font-medium text-ink-muted">Scanning</p>
          <h1 className="mt-1 text-3xl font-semibold tracking-tight">{root}</h1>

          <div className="mt-8 flex justify-center">
            <ProgressRing percent={percent}>
              {percent === null ? (
                <span className="font-mono text-2xl font-semibold">{formatBytes(bytes)}</span>
              ) : (
                <span className="font-mono text-4xl font-semibold tracking-tight">{percent}%</span>
              )}
              <span className="mt-1 text-xs text-ink-muted">{PHASE_COPY[phase]}</span>
            </ProgressRing>
          </div>

          <dl className="mt-8 grid grid-cols-3 gap-4 border-t border-hairline pt-6 text-left">
            <Stat label="Files" value={formatCount(progress?.filesScanned ?? 0)} />
            <Stat label="Size found" value={formatBytes(bytes)} />
            <Stat label="Time" value={formatClock(elapsed)} />
          </dl>

          <p
            className="mt-6 truncate text-left font-mono text-xs text-ink-muted"
            title={progress?.currentPath ?? ''}
            aria-hidden
          >
            {phase === 'reading' ? (progress?.currentPath ?? 'Starting…') : 'Matching cleanup rules and projects…'}
          </p>
          <p className="sr-only" role="status" aria-live="polite">
            {percent !== null ? `${percent} percent` : ''} {PHASE_COPY[phase]}
          </p>

          {cancelFailed && (
            <Alert tone="danger" className="mt-6 text-left">
              Could not stop the scan. Try again.
            </Alert>
          )}

          <div className="mt-8 flex justify-center">
            <Button onClick={cancel} disabled={cancelling || phase !== 'reading'}>
              {cancelling ? 'Stopping…' : phase === 'reading' ? 'Cancel' : 'Finishing…'}
            </Button>
          </div>
        </Card>

        {found.length > 0 && (
          <div className="mt-5">
            <p className="mb-2 text-center text-xs font-medium text-ink-muted">Found so far</p>
            <ul className="flex flex-wrap justify-center gap-2">
              {found.map((row) => (
                <li
                  key={row.category}
                  className="rounded-full border border-accent-border bg-accent-soft px-3 py-1 text-xs font-medium text-accent-strong"
                >
                  {row.label} · <span className="font-mono">{formatBytes(row.bytes)}</span>
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </main>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-xs text-ink-muted">{label}</dt>
      <dd className="mt-1 font-mono text-lg font-semibold text-ink">{value}</dd>
    </div>
  );
}
