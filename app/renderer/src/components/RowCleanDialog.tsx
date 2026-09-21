import { useCallback, useEffect, useState } from 'react';
import type { CleanPreview, CleanReport, DustApi } from '../../../src/shared/ipc';
import { CleanPlan } from './CleanPlan';
import { CleanSummary } from './CleanSummary';
import { cleanErrorMessage, newCleanId } from '../clean';

export interface RowCleanDialogProps {
  api: DustApi;
  root: string;
  path: string;
  onClose: () => void;
}

export function RowCleanDialog({ api, root, path, onClose }: RowCleanDialogProps) {
  const [preview, setPreview] = useState<CleanPreview | null>(null);
  const [report, setReport] = useState<CleanReport | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [acknowledge, setAcknowledge] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let active = true;
    setPreview(null);
    setReport(null);
    setError(null);
    setAcknowledge(false);
    api
      .previewClean({ scope: 'row', root, paths: [path] })
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
  }, [api, root, path]);

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
    <div
      role="dialog"
      aria-label={`Clean ${path}`}
      className="fixed inset-0 z-20 flex items-center justify-center bg-black/60 p-6"
    >
      <div className="max-h-full w-[560px] overflow-auto rounded-xl border border-neutral-700 bg-neutral-950 p-4">
        {error !== null && <p className="mb-3 text-sm text-red-300">{error}</p>}
        {report !== null ? (
          <CleanSummary report={report} onDone={onClose} doneLabel="Close" />
        ) : preview === null ? (
          <p className="text-sm text-neutral-400">Building the plan...</p>
        ) : (
          <CleanPlan
            preview={preview}
            acknowledge={acknowledge}
            onAcknowledge={setAcknowledge}
            onConfirm={() => void confirm()}
            onCancel={onClose}
            onReveal={(target) => {
              void api.revealPath(target).catch(() => {});
            }}
            onRelaunchElevated={() => {
              void api.relaunchElevated().catch(() => {});
            }}
            busy={busy}
          />
        )}
      </div>
    </div>
  );
}
