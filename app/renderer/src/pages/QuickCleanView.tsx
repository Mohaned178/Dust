import { useCallback, useEffect, useState } from 'react';
import type { CleanPreview, CleanReport, DustApi, ScanProgressPayload } from '../../../src/shared/ipc';
import { CleanPlan } from '../components/CleanPlan';
import { CleanSummary } from '../components/CleanSummary';
import { cleanErrorMessage, newCleanId } from '../clean';
import { formatCount } from '../format';

export interface QuickCleanViewProps {
  api: DustApi;
  onDone: () => void;
  onViewResults: (root: string) => void;
}

export function QuickCleanView({ api, onDone, onViewResults }: QuickCleanViewProps) {
  const [preview, setPreview] = useState<CleanPreview | null>(null);
  const [report, setReport] = useState<CleanReport | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [acknowledge, setAcknowledge] = useState(false);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState<ScanProgressPayload | null>(null);

  useEffect(() => {
    let active = true;
    setPreview(null);
    setError(null);
    api
      .previewClean({ scope: 'quick' })
      .then((result) => {
        if (!active) return;
        if (result.ok) setPreview(result.preview);
        else setError(cleanErrorMessage(result));
      })
      .catch((cause: unknown) => {
        if (active) setError(cause instanceof Error ? cause.message : String(cause));
      });
    return () => {
      active = false;
    };
  }, [api]);

  useEffect(
    () =>
      api.onScanEvent((event) => {
        if (event.type === 'quick-clean-progress') setProgress(event.progress);
      }),
    [api],
  );

  const confirm = useCallback(async () => {
    if (preview === null) return;
    setBusy(true);
    setError(null);
    try {
      const result = await api.executeClean({
        cleanId: newCleanId(),
        planId: preview.planId,
        acknowledge: preview.items.filter((item) => item.grade === 'review').map((item) => item.path),
      });
      if (result.ok) setReport(result.report);
      else setError(cleanErrorMessage(result));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(false);
    }
  }, [api, preview]);

  return (
    <main className="mx-auto max-w-3xl px-8 py-10">
      <header className="mb-6">
        <h1 className="text-2xl font-semibold text-neutral-100">Quick Clean</h1>
        <p className="mt-1 text-sm text-neutral-400">
          {preview !== null
            ? preview.root
            : 'Safe system cleanup - projects are never touched here.'}
        </p>
      </header>

      {error !== null && (
        <p className="mb-4 rounded-lg border border-red-900 bg-red-950/40 px-4 py-2 text-sm text-red-200">{error}</p>
      )}

      {report !== null ? (
        <CleanSummary report={report} onDone={() => onViewResults(report.root)} doneLabel="View updated disk" />
      ) : preview === null ? (
        error === null && (
          <>
            <p className="text-sm text-neutral-400">Building the cleanup plan.</p>
            {progress !== null && (
              <p className="mt-2 text-xs text-neutral-500">
                {formatCount(progress.filesScanned)} files scanned · {progress.currentPath}
              </p>
            )}
            <button
              type="button"
              onClick={() => {
                void api.cancelScan().catch(() => {});
              }}
              className="mt-3 rounded-md border border-neutral-700 px-3 py-1.5 text-sm text-neutral-200"
            >
              Cancel
            </button>
          </>
        )
      ) : (
        <CleanPlan
          preview={preview}
          acknowledge={acknowledge}
          onAcknowledge={setAcknowledge}
          onConfirm={() => void confirm()}
          onCancel={onDone}
          onReveal={(target) => {
            void api.revealPath(target).catch(() => {});
          }}
          onRelaunchElevated={() => {
            void api.relaunchElevated().catch(() => {});
          }}
          busy={busy}
        />
      )}

      <button
        type="button"
        onClick={onDone}
        className="mt-6 rounded-md bg-neutral-800 px-3 py-1.5 text-sm text-neutral-200"
      >
        Back to dashboard
      </button>
    </main>
  );
}
