import { useEffect, useRef, useState } from 'react';
import type { CategorySummaryRow, DustApi, ScanProgressPayload } from '../../../src/shared/ipc';
import { formatBytes, formatClock, formatCount } from '../format';
import { Button, Card, ProgressRing } from '../components/ui';

export interface ScanProgressProps {
  api: DustApi;
  root: string;
  runId: string;
  /** Used space on the drive: the denominator that turns bytes found into a percentage. */
  usedBytes: number | null;
  onFinished: (root: string, status: 'complete' | 'cancelled') => void;
  onFailed: (message: string) => void;
}

type Phase = 'reading' | 'checking' | 'done';

const PHASE_COPY: Record<Phase, string> = {
  reading: 'Reading folders',
  checking: 'Checking what is safe to clean',
  done: 'Done',
};

export function ScanProgress({ api, root, runId, usedBytes, onFinished, onFailed }: ScanProgressProps) {
  const [progress, setProgress] = useState<ScanProgressPayload | null>(null);
  const [categories, setCategories] = useState<CategorySummaryRow[]>([]);
  const [phase, setPhase] = useState<Phase>('reading');
  const [cancelling, setCancelling] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const startedAt = useRef(performance.now());
  const finishedRef = useRef(onFinished);
  const failedRef = useRef(onFailed);
  finishedRef.current = onFinished;
  failedRef.current = onFailed;

  useEffect(
    () =>
      api.onScanEvent((event) => {
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
            setPhase('done');
            finishedRef.current(root, event.status);
            break;
          case 'failed':
            failedRef.current(event.message);
            break;
          default:
            break;
        }
      }),
    [api, root, runId],
  );

  useEffect(() => {
    const id = setInterval(() => setElapsed(performance.now() - startedAt.current), 250);
    return () => clearInterval(id);
  }, []);

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
    void api.cancelScan().catch(() => setCancelling(false));
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

          <div className="mt-8 flex justify-center">
            <Button onClick={cancel} disabled={cancelling || phase !== 'reading'}>
              {cancelling ? 'Stopping…' : 'Cancel'}
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
