import { useCallback, useEffect, useRef, useState } from 'react';
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
import type { CleanProgress } from './CleanPlan';
import { CleanSummary } from './CleanSummary';
import { Alert, Button } from './ui';

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
  const [attempt, setAttempt] = useState(0);
  const [quickProgress, setQuickProgress] = useState<ScanProgressPayload | null>(null);
  const [cleanProgress, setCleanProgress] = useState<CleanProgress | null>(null);
  // A ref, not state: the first `clean-item` can arrive before a re-render commits.
  const cleanIdRef = useRef<string | null>(null);

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
    return api.onScanEvent((event) => {
      if (event.type !== 'clean-item' || event.cleanId !== cleanIdRef.current) return;
      const { plannedBytes, deletedBytes } = event.item;
      setCleanProgress((current) => ({
        done: (current?.done ?? 0) + 1,
        plannedBytes: (current?.plannedBytes ?? 0) + plannedBytes,
        freedBytes: (current?.freedBytes ?? 0) + deletedBytes,
      }));
    });
  }, [api]);

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
  }, [api, request, attempt]);

  const confirm = useCallback(async () => {
    if (preview === null) return;
    const cleanId = newCleanId();
    cleanIdRef.current = cleanId;
    setCleanProgress(null);
    setBusy(true);
    setError(null);
    try {
      const result = await api.executeClean({
        cleanId,
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
          progress={cleanProgress}
          error={error}
          scopeNote={scope === 'quick' ? QUICK_CLEAN_SCOPE_NOTE : null}
        />
      ) : error !== null ? (
        <>
          <Alert tone="danger">{error}</Alert>
          <div className="mt-4 flex justify-end gap-2">
            <Button onClick={closeFlow}>Close</Button>
            <Button variant="primary" onClick={() => setAttempt((count) => count + 1)}>
              Try again
            </Button>
          </div>
        </>
      ) : (
        <div className="py-2">
          <p className="text-sm text-ink-muted">Building the cleanup plan.</p>
          {scope === 'quick' && quickProgress !== null && (
            <p className="mt-1.5 truncate font-mono text-xs text-ink-muted">
              {formatCount(quickProgress.filesScanned)} files scanned · {quickProgress.currentPath}
            </p>
          )}
          {scope === 'quick' && (
            <Button size="sm" onClick={closeFlow} className="mt-3">
              Cancel
            </Button>
          )}
        </div>
      )}
    </CleanDialog>
  );
}
