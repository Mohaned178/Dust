import { useCallback, useEffect, useState } from 'react';
import type {
  CleanPreview,
  CleanPreviewRequest,
  CleanReport,
  CleanScope,
  DustApi,
  ScanProgressPayload,
} from '../../../src/shared/ipc';
import { QUICK_CLEAN_SCOPE_NOTE } from '../../../src/shared/categories';
import { cleanErrorMessage, newCleanId } from '../clean';
import { formatCount } from '../format';
import { CleanDialog } from './CleanDialog';
import { CleanPlan } from './CleanPlan';
import { CleanSummary } from './CleanSummary';
import { InfoIcon } from './icons';

const FOCUS = 'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent';
const COMPACT_SECONDARY = `inline-flex items-center justify-center rounded-lg border border-hairline bg-surface px-3.5 py-1.5 text-sm font-medium text-ink transition-colors hover:border-hairline-strong hover:bg-surface-hover ${FOCUS}`;

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
  const [quickProgress, setQuickProgress] = useState<ScanProgressPayload | null>(null);

  const [request] = useState<CleanPreviewRequest>(() =>
    scope === 'quick' ? { scope: 'quick' } : { scope, root: root ?? '', paths: paths ?? [] },
  );

  useEffect(() => {
    if (scope !== 'quick') return;
    return api.onScanEvent((event) => {
      if (event.type === 'quick-clean-progress') setQuickProgress(event.progress);
    });
  }, [api, scope]);

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

  const closeFlow = useCallback(() => {
    if (scope === 'quick' && preview === null && report === null && error === null) {
      void api.cancelScan().catch(() => {});
    }
    onClose();
  }, [api, error, onClose, preview, report, scope]);

  return (
    <CleanDialog label={label} onClose={closeFlow} dismissible={!busy}>
      {report !== null ? (
        <CleanSummary report={report} onDone={() => onPrimary(report)} doneLabel={primaryLabel} />
      ) : preview !== null ? (
        <CleanPlan
          preview={preview}
          acknowledge={acknowledge}
          onAcknowledge={setAcknowledge}
          onConfirm={() => void confirm()}
          onCancel={closeFlow}
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
        <div className="py-2">
          <p className="text-sm text-ink-muted">Building the cleanup plan.</p>
          {scope === 'quick' && quickProgress !== null && (
            <p className="mt-1.5 truncate font-mono text-xs text-ink-muted">
              {formatCount(quickProgress.filesScanned)} files scanned · {quickProgress.currentPath}
            </p>
          )}
          {scope === 'quick' && (
            <button type="button" onClick={closeFlow} className={`mt-3 ${COMPACT_SECONDARY}`}>
              Cancel
            </button>
          )}
        </div>
      )}
    </CleanDialog>
  );
}
