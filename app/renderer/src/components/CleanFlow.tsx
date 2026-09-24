import { useCallback, useEffect, useState } from 'react';
import type { CleanPreview, CleanPreviewRequest, CleanReport, CleanScope, DustApi } from '../../../src/shared/ipc';
import { QUICK_CLEAN_SCOPE_NOTE } from '../../../src/shared/categories';
import { cleanErrorMessage, newCleanId } from '../clean';
import { CleanDialog } from './CleanDialog';
import { CleanPlan } from './CleanPlan';
import { CleanSummary } from './CleanSummary';
import { InfoIcon } from './icons';

export interface CleanFlowProps {
  api: DustApi;
  scope: CleanScope;
  root?: string;
  paths?: string[];
  label: string;
  onClose: () => void;
  onPrimary: (report: CleanReport) => void;
  primaryLabel?: string;
  offerRelaunch?: boolean;
}

export function CleanFlow({
  api,
  scope,
  root,
  paths,
  label,
  onClose,
  onPrimary,
  primaryLabel,
  offerRelaunch = false,
}: CleanFlowProps) {
  const [preview, setPreview] = useState<CleanPreview | null>(null);
  const [report, setReport] = useState<CleanReport | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [acknowledge, setAcknowledge] = useState(false);
  const [busy, setBusy] = useState(false);

  const [request] = useState<CleanPreviewRequest>(() =>
    scope === 'quick' ? { scope: 'quick' } : { scope, root: root ?? '', paths: paths ?? [] },
  );

  useEffect(() => {
    let active = true;
    setPreview(null);
    setReport(null);
    setError(null);
    setAcknowledge(false);
    api
      .previewClean(request)
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
  }, [api, request]);

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
    <CleanDialog label={label} onClose={onClose} dismissible={!busy}>
      {report !== null ? (
        <CleanSummary report={report} onDone={() => onPrimary(report)} doneLabel={primaryLabel} />
      ) : preview !== null ? (
        <CleanPlan
          preview={preview}
          acknowledge={acknowledge}
          onAcknowledge={setAcknowledge}
          onConfirm={() => void confirm()}
          onCancel={onClose}
          onReveal={(target) => {
            void api.revealPath(target).catch(() => {});
          }}
          onRelaunchElevated={
            offerRelaunch
              ? () => {
                  void api.relaunchElevated().catch(() => {});
                }
              : undefined
          }
          busy={busy}
          error={error}
          scopeNote={scope === 'quick' ? QUICK_CLEAN_SCOPE_NOTE : null}
        />
      ) : error !== null ? (
        <div className="flex items-start gap-2.5 rounded-xl border border-notice-border bg-notice px-3.5 py-2.5 text-sm text-ink">
          <InfoIcon className="mt-0.5 h-4 w-4 shrink-0 text-accent" />
          <p className="min-w-0">{error}</p>
        </div>
      ) : (
        <p className="py-2 text-sm text-ink-muted">Building the cleanup plan.</p>
      )}
    </CleanDialog>
  );
}
