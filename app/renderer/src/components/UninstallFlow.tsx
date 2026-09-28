import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type {
  DustApi,
  RemovalReport,
  UninstallEvent,
  UninstallItemPreview,
  UninstallPreview,
} from '../../../src/shared/ipc';
import {
  blockReasonText,
  defaultUninstallSelection,
  groupUninstallItems,
  keptReasonText,
  outcomeText,
  selectedReviewItems,
  uninstallSelectionTotals,
} from '../uninstall';
import { formatBytes } from '../format';
import { CleanDialog } from './CleanDialog';
import { CopyButton } from './CopyButton';
import { GradePill } from './GradePill';
import { UninstallPhaseList } from './UninstallPhaseList';
import type { PhaseState } from './UninstallPhaseList';
import { InfoIcon } from './icons';

const FOCUS = 'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent';
const PRIMARY = `inline-flex items-center justify-center rounded-lg bg-accent px-6 py-3 text-sm font-semibold text-white transition-colors hover:bg-accent-strong disabled:cursor-not-allowed disabled:opacity-45 ${FOCUS}`;
const SECONDARY = `inline-flex items-center justify-center rounded-lg border border-hairline bg-surface px-6 py-3 text-sm font-medium text-ink transition-colors hover:border-hairline-strong hover:bg-surface-hover disabled:cursor-not-allowed disabled:opacity-45 ${FOCUS}`;
const COMPACT = `inline-flex items-center justify-center rounded-lg border border-hairline bg-surface px-3.5 py-1.5 text-sm font-medium text-ink transition-colors hover:border-hairline-strong hover:bg-surface-hover ${FOCUS}`;

type Stage = 'building' | 'plan' | 'running' | 'report' | 'error';

export interface UninstallFlowProps {
  api: DustApi;
  appId: string | null;
  adoptJobId?: string | null;
  onClose: () => void;
  onFinished: () => void;
}

function previewMessage(result: { reason: 'busy' | 'not-found' | 'protected' | 'nothing-to-remove' | 'failed'; message?: string }): string {
  if (result.reason === 'busy') return 'A scan is already running. Wait for it to finish, then try again.';
  return result.message ?? "This app can't be removed right now.";
}

export function UninstallFlow({
  api,
  appId,
  adoptJobId = null,
  onClose,
  onFinished,
}: UninstallFlowProps) {
  const [stage, setStage] = useState<Stage>(adoptJobId === null ? 'building' : 'running');
  const [preview, setPreview] = useState<UninstallPreview | null>(null);
  const [report, setReport] = useState<RemovalReport | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [selection, setSelection] = useState<Set<string>>(new Set());
  const [quiet, setQuiet] = useState(false);
  const [runUninstaller, setRunUninstaller] = useState(true);
  const [acknowledge, setAcknowledge] = useState(false);
  const [includeUserData, setIncludeUserData] = useState(false);
  const [phases, setPhases] = useState<Record<string, PhaseState>>({});
  const [waitingSince, setWaitingSince] = useState<number | null>(null);
  const [clock, setClock] = useState(() => Date.now());
  const [skippedWaiting, setSkippedWaiting] = useState(false);
  const [reboot, setReboot] = useState(false);
  const jobId = useRef<string | null>(adoptJobId);

  useEffect(() => {
    if (appId === null) return;
    let active = true;
    api
      .previewUninstall(appId)
      .then((result) => {
        if (!active) return;
        if (!result.ok) {
          setError(previewMessage(result));
          setStage('error');
          return;
        }
        setPreview(result.preview);
        setSelection(new Set(defaultUninstallSelection(result.preview.items)));
        setStage('plan');
      })
      .catch((cause: unknown) => {
        if (!active) return;
        setError(cause instanceof Error ? cause.message : String(cause));
        setStage('error');
      });
    return () => {
      active = false;
    };
  }, [api, appId]);

  useEffect(() => {
    return api.onUninstallEvent((event: UninstallEvent) => {
      if (jobId.current !== null && event.jobId !== jobId.current) return;
      if (event.type === 'phase') {
        setPhases((current) => ({
          ...current,
          [event.phase]: event.note === undefined ? { status: event.status } : { status: event.status, note: event.note },
        }));
        if (event.phase === 'uninstaller' && event.status === 'started') setWaitingSince(Date.now());
        return;
      }
      if (event.type === 'uninstaller-started') {
        setWaitingSince(Date.now());
        return;
      }
      if (event.type === 'uninstaller-reboot-required') {
        setReboot(true);
        return;
      }
      if (event.type === 'finished') {
        setReport(event.report);
        setStage('report');
        onFinished();
        return;
      }
      if (event.type === 'failed') {
        setError(event.message);
        setStage('error');
      }
    });
  }, [api, onFinished]);

  useEffect(() => {
    if (stage !== 'running') return;
    const timer = window.setInterval(() => setClock(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [stage]);

  const totals = useMemo(
    () => (preview === null ? { items: 0, bytes: 0, reviewItems: 0, adminItems: 0 } : uninstallSelectionTotals(preview.items, selection)),
    [preview, selection],
  );
  const reviewItems = useMemo(
    () => (preview === null ? [] : selectedReviewItems(preview.items, selection)),
    [preview, selection],
  );
  const sections = useMemo(
    () => (preview === null ? [] : groupUninstallItems(preview.items)),
    [preview],
  );

  const toggleItem = useCallback((id: string) => {
    setSelection((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const toggleUserData = useCallback(
    (on: boolean) => {
      setIncludeUserData(on);
      setSelection((current) => {
        const next = new Set(current);
        for (const item of preview?.items ?? []) {
          if (item.dataClass !== 'user-data') continue;
          if (on) next.add(item.id);
          else next.delete(item.id);
        }
        return next;
      });
    },
    [preview],
  );

  const execute = useCallback(
    async () => {
      if (preview === null) return;
      const id = preview.planId;
      jobId.current = id;
      setStage('running');
      setPhases({});
      setWaitingSince(null);
      setReboot(false);
      try {
        const result = await api.executeUninstall({
          jobId: id,
          planId: id,
          selection: [...selection],
          includeUserData,
          runUninstaller,
          quiet,
          acknowledge: reviewItems.map((item) => item.id),
        });
        if (result.ok) {
          setReport(result.report);
          setStage('report');
          onFinished();
          return;
        }
        if (result.reason === 'busy') {
          setError('A scan is already running. Wait for it to finish, then try again.');
          setStage('error');
          return;
        }
        if (result.reason === 'unacknowledged-review') {
          setError('Check the acknowledgement before removing review items.');
          setStage('plan');
          return;
        }
        setError(result.message ?? "The uninstall couldn't start.");
        setStage('error');
      } catch (cause) {
        setError(cause instanceof Error ? cause.message : String(cause));
        setStage('error');
      }
    },
    [api, includeUserData, onFinished, preview, quiet, reviewItems, runUninstaller, selection],
  );

  const label = preview === null ? 'Deep Uninstall' : `Remove ${preview.app.displayName}`;
  const dismissible = stage !== 'running';
  const waiting =
    stage === 'running' && waitingSince !== null && phases.uninstaller?.status === 'started' && !skippedWaiting;

  return (
    <CleanDialog label={label} onClose={onClose} dismissible={dismissible}>
      {stage === 'building' && (
        <div className="py-2">
          <p className="text-sm text-ink-muted">Building the removal plan.</p>
        </div>
      )}

      {stage === 'plan' && preview !== null && (
        <>
          <h2 className="text-center text-xl font-semibold tracking-tight text-ink">
            Remove {preview.app.displayName}
          </h2>
          <p className="mt-1 text-center text-sm text-ink-muted">
            {preview.app.publisher.length > 0 ? preview.app.publisher : 'Unknown publisher'}
            {preview.app.version.length > 0 ? ` · ${preview.app.version}` : ''}
          </p>

          <p className="mt-5 text-center font-mono text-[2.5rem] font-semibold leading-none tracking-tight text-ink">
            {formatBytes(totals.bytes)}
          </p>
          <p className="mt-2 text-center text-sm text-ink-muted">
            will be removed · {totals.items} {totals.items === 1 ? 'item' : 'items'}
          </p>

          <div className="mt-6 h-px w-full bg-hairline" aria-hidden="true" />

          {preview.uninstaller !== null && (
            <section aria-label="Official uninstaller" className="mt-5 rounded-xl border border-hairline bg-surface p-4">
              <label className="flex items-start gap-2.5 text-sm text-ink">
                <input
                  type="checkbox"
                  checked={runUninstaller && preview.uninstaller.launchable}
                  disabled={!preview.uninstaller.launchable}
                  onChange={(event) => setRunUninstaller(event.target.checked)}
                  className={`mt-0.5 h-4 w-4 shrink-0 rounded border-hairline accent-accent ${FOCUS}`}
                />
                <span>
                  Run the app&apos;s own uninstaller
                  <span className="mt-0.5 block text-xs text-ink-muted">
                    This runs the command the app registered with Windows.
                  </span>
                </span>
              </label>
              <div className="mt-3 flex items-start justify-between gap-3">
                <code className="min-w-0 break-all font-mono text-xs text-ink">
                  {quiet && preview.uninstaller.silent !== null
                    ? `msiexec ${preview.uninstaller.silent.argv.join(' ')}`
                    : preview.uninstaller.raw}
                </code>
                <CopyButton text={preview.uninstaller.raw} label="Copy uninstall command" />
              </div>
              {preview.uninstaller.blockReason !== null && (
                <p className="mt-2 text-xs text-ink-muted">{blockReasonText(preview.uninstaller.blockReason)}</p>
              )}
              {preview.uninstaller.silent !== null && preview.uninstaller.launchable && (
                <label className="mt-3 flex items-start gap-2.5 border-t border-hairline pt-3 text-sm text-ink">
                  <input
                    type="checkbox"
                    checked={quiet}
                    onChange={(event) => setQuiet(event.target.checked)}
                    className={`mt-0.5 h-4 w-4 shrink-0 rounded border-hairline accent-accent ${FOCUS}`}
                  />
                  <span>
                    Run silently
                    <span className="mt-0.5 block text-xs text-ink-muted">No installer windows.</span>
                  </span>
                </label>
              )}
            </section>
          )}

          {sections.map((section) => (
            <section key={section.id} aria-label={section.title} className="mt-4 rounded-xl border border-hairline bg-surface p-4">
              <div className="flex items-baseline justify-between gap-3">
                <h3 className="text-sm font-semibold text-ink">{section.title}</h3>
                <span className="font-mono text-xs tabular-nums text-ink-muted">
                  {section.items.length} {section.items.length === 1 ? 'item' : 'items'}
                </span>
              </div>
              {section.description !== null && (
                <p className="mt-1 text-xs text-ink-muted">{section.description}</p>
              )}
              {section.id === 'user-data' && (
                <label className="mt-2 flex items-start gap-2.5 text-sm text-ink">
                  <input
                    type="checkbox"
                    checked={includeUserData}
                    onChange={(event) => toggleUserData(event.target.checked)}
                    className={`mt-0.5 h-4 w-4 shrink-0 rounded border-hairline accent-accent ${FOCUS}`}
                  />
                  <span>Also remove user data</span>
                </label>
              )}
              <ul className="mt-3 space-y-2">
                {section.items.map((item) => (
                  <ItemRow
                    key={item.id}
                    item={item}
                    checked={selection.has(item.id)}
                    onToggle={() => toggleItem(item.id)}
                    onReveal={item.kind === 'file' ? () => void api.revealPath(item.target).catch(() => {}) : undefined}
                  />
                ))}
              </ul>
            </section>
          ))}

          {preview.kept.length > 0 && (
            <details className="mt-4 rounded-lg border border-hairline bg-canvas/40">
              <summary className={`cursor-pointer list-none rounded-lg px-3 py-2 text-xs text-ink-muted transition-colors hover:bg-canvas/60 ${FOCUS}`}>
                {preview.kept.length} {preview.kept.length === 1 ? 'item will' : 'items will'} be kept
              </summary>
              <ul className="space-y-2 border-t border-hairline px-3 py-2.5">
                {preview.kept.map((entry) => (
                  <li key={`${entry.target}:${entry.reason}`} className="flex flex-col gap-0.5">
                    <span className="break-all font-mono text-xs text-ink-muted">{entry.target}</span>
                    <span className="text-xs text-ink-muted">{keptReasonText(entry.reason)}</span>
                  </li>
                ))}
              </ul>
            </details>
          )}

          <label className="mt-5 flex items-start gap-2.5 text-sm text-ink">
            <input
              type="checkbox"
              checked={acknowledge}
              onChange={(event) => setAcknowledge(event.target.checked)}
              className={`mt-0.5 h-4 w-4 shrink-0 rounded border-hairline accent-accent ${FOCUS}`}
            />
            <span>
              I understand review items cannot be recovered
              {reviewItems.length > 0 ? ` (${reviewItems.length} selected)` : ''}
            </span>
          </label>

          {error !== null && <ErrorNotice message={error} />}

          <div className="mt-6 flex justify-end gap-2">
            <button type="button" onClick={onClose} className={SECONDARY}>
              Cancel
            </button>
            <button
              type="button"
              disabled={totals.items === 0 || (reviewItems.length > 0 && !acknowledge)}
              onClick={() => void execute()}
              className={PRIMARY}
            >
              Uninstall
            </button>
          </div>
        </>
      )}

      {stage === 'running' && (
        <>
          <h2 className="text-lg font-semibold tracking-tight text-ink">
            {preview === null ? 'Finishing the uninstall' : `Removing ${preview.app.displayName}`}
          </h2>
          <p className="mt-1 text-sm text-ink-muted">Keep Dust open until this finishes.</p>

          <div className="mt-5">
            <UninstallPhaseList states={phases} />
          </div>

          {reboot && (
            <div role="note" className="mt-4 rounded-lg border border-notice-border bg-notice px-3.5 py-2.5 text-sm text-ink">
              This app finishes uninstalling after a restart. Dust left its leftovers alone.
            </div>
          )}

          {waiting && waitingSince !== null && (
            <div className="mt-4 flex items-center justify-between gap-3 rounded-lg border border-hairline bg-canvas/40 px-3.5 py-2.5">
              <p className="text-sm text-ink-muted">
                Still running · {Math.max(Math.floor((clock - waitingSince) / 1000), 0)}s
              </p>
              <button
                type="button"
                className={COMPACT}
                onClick={() => {
                  setSkippedWaiting(true);
                  void api.skipUninstallWaiting();
                }}
              >
                Skip waiting
              </button>
            </div>
          )}
        </>
      )}

      {stage === 'report' && report !== null && (
        <ReportBody report={report} onDone={onClose} />
      )}

      {stage === 'error' && error !== null && (
        <>
          <h2 className="text-lg font-semibold tracking-tight text-ink">Nothing was removed</h2>
          <ErrorNotice message={error} />
          <div className="mt-6 flex justify-end">
            <button type="button" onClick={onClose} className={PRIMARY}>
              Close
            </button>
          </div>
        </>
      )}
    </CleanDialog>
  );
}

function ItemRow({
  item,
  checked,
  onToggle,
  onReveal,
}: {
  item: UninstallItemPreview;
  checked: boolean;
  onToggle: () => void;
  onReveal?: (() => void) | undefined;
}) {
  return (
    <li className="rounded-lg border border-hairline bg-canvas/40 p-3">
      <label className="flex items-start gap-2.5">
        <input
          type="checkbox"
          checked={checked}
          onChange={onToggle}
          aria-label={`Select ${item.label}`}
          className={`mt-0.5 h-4 w-4 shrink-0 rounded border-hairline accent-accent ${FOCUS}`}
        />
        <span className="min-w-0 flex-1">
          <span className="flex items-start justify-between gap-3">
            <span className="min-w-0 break-all font-mono text-xs text-ink-muted">{item.target}</span>
            <span className="shrink-0 font-mono text-xs tabular-nums text-ink">
              {item.bytes === null ? '—' : formatBytes(item.bytes)}
            </span>
          </span>
          <span className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1">
            <GradePill grade={item.grade} />
            {item.adminRequired && <span className="text-xs text-ink-muted">Needs administrator rights.</span>}
            {item.syncRoot === true && <span className="text-xs text-ink-muted">Syncing folder.</span>}
          </span>
          {item.evidence.length > 0 && (
            <span className="mt-1.5 block text-xs text-ink-muted">{item.evidence.join(' · ')}</span>
          )}
          {onReveal !== undefined && (
            <button
              type="button"
              onClick={(event) => {
                event.preventDefault();
                onReveal();
              }}
              className={`mt-1.5 text-xs font-medium text-accent hover:underline ${FOCUS}`}
            >
              Show in Explorer
            </button>
          )}
        </span>
      </label>
    </li>
  );
}

function ErrorNotice({ message }: { message: string }) {
  return (
    <div role="alert" className="mt-4 flex items-start gap-2.5 rounded-lg border border-notice-border bg-notice px-3.5 py-2.5 text-sm text-ink">
      <InfoIcon className="mt-0.5 h-4 w-4 shrink-0 text-accent" />
      <p className="min-w-0">{message}</p>
    </div>
  );
}

function ReportBody({ report, onDone }: { report: RemovalReport; onDone: () => void }) {
  const outcome = outcomeText(report.outcome);
  const freed = report.files.deletedBytes;
  const recycleCount = report.files.recycledItems;
  const kept = report.files.kept.map((entry) => ({ target: entry.target, reason: keptReasonText(entry.reason) }));

  return (
    <>
      <h2 className="text-center text-xl font-semibold tracking-tight text-ink">{outcome.title}</h2>
      <p className="mt-1 text-center text-sm text-ink-muted">{outcome.detail}</p>

      <p className="mt-5 text-center font-mono text-[2.5rem] font-semibold leading-none tracking-tight text-ink">
        {formatBytes(freed)}
      </p>
      <p className="mt-2 text-center text-sm text-ink-muted">freed</p>

      <div className="mt-6 h-px w-full bg-hairline" aria-hidden="true" />

      <dl className="mt-4 space-y-2.5 text-sm">
        <div className="flex items-start justify-between gap-3">
          <dt className="text-ink-muted">Files removed</dt>
          <dd className="font-mono text-xs tabular-nums text-ink">{report.files.deletedItems}</dd>
        </div>
        {recycleCount > 0 && (
          <div className="flex items-start justify-between gap-3">
            <dt className="text-ink-muted">Moved to the Recycle Bin</dt>
            <dd className="font-mono text-xs tabular-nums text-ink">{recycleCount}</dd>
          </div>
        )}
        {report.files.skippedLocked > 0 && (
          <div className="flex items-start justify-between gap-3">
            <dt className="text-ink-muted">In use, left alone</dt>
            <dd className="font-mono text-xs tabular-nums text-ink">{report.files.skippedLocked}</dd>
          </div>
        )}
        <div className="flex items-start justify-between gap-3">
          <dt className="text-ink-muted">Registry keys removed</dt>
          <dd className="font-mono text-xs tabular-nums text-ink">{report.registry.deletedKeys.length}</dd>
        </div>
        {(report.startup.disabled.length > 0 || report.startup.purgedEnvelopes.length > 0) && (
          <div className="flex items-start justify-between gap-3">
            <dt className="text-ink-muted">Startup entries turned off</dt>
            <dd className="font-mono text-xs tabular-nums text-ink">
              {report.startup.disabled.length + report.startup.purgedEnvelopes.length}
            </dd>
          </div>
        )}
      </dl>

      {report.uninstaller.skippedReason !== null && (
        <div role="note" className="mt-4 rounded-lg border border-notice-border bg-notice px-3.5 py-2.5 text-sm text-ink">
          <p className="font-medium">The app&apos;s own uninstaller did not run</p>
          <p className="mt-0.5 text-xs text-ink-muted">
            {blockReasonText(report.uninstaller.skippedReason) ??
              keptReasonText(report.uninstaller.skippedReason)}
          </p>
        </div>
      )}

      {report.uninstaller.ran && !report.uninstaller.verifiedGone && (
        <div role="note" className="mt-4 rounded-lg border border-notice-border bg-notice px-3.5 py-2.5 text-sm text-ink">
          The app still appears in the installed list. The maker&apos;s uninstaller may not have finished; run it
          again from Windows Settings if needed.
        </div>
      )}

      {report.outcome === 'reboot-required' && (
        <div role="note" className="mt-4 rounded-lg border border-notice-border bg-notice px-3.5 py-2.5 text-sm text-ink">
          Restart to finish uninstalling. Leftovers were not touched.
        </div>
      )}

      {report.registry.backupPath.length > 0 && (
        <div className="mt-4 rounded-lg border border-hairline bg-canvas/40 p-3">
          <p className="text-xs text-ink-muted">
            Registry backup · restore with this command
          </p>
          <div className="mt-1.5 flex items-center justify-between gap-2">
            <code className="min-w-0 break-all font-mono text-xs text-ink">{report.registry.restoreCommand}</code>
            <CopyButton text={report.registry.restoreCommand} label="Copy restore command" />
          </div>
        </div>
      )}

      {kept.length > 0 && (
        <details className="mt-4 rounded-lg border border-hairline bg-canvas/40">
          <summary className={`cursor-pointer list-none rounded-lg px-3 py-2 text-xs text-ink-muted transition-colors hover:bg-canvas/60 ${FOCUS}`}>
            {kept.length} {kept.length === 1 ? 'item was' : 'items were'} kept
          </summary>
          <ul className="space-y-2 border-t border-hairline px-3 py-2.5">
            {kept.map((entry) => (
              <li key={`${entry.target}:${entry.reason}`} className="flex flex-col gap-0.5">
                <span className="break-all font-mono text-xs text-ink-muted">{entry.target}</span>
                <span className="text-xs text-ink-muted">{entry.reason}</span>
              </li>
            ))}
          </ul>
        </details>
      )}

      <p className="mt-4 break-all font-mono text-xs text-ink-muted">{report.journalPath}</p>

      <div className="mt-6 flex justify-end">
        <button type="button" onClick={onDone} className={PRIMARY}>
          Done
        </button>
      </div>
    </>
  );
}
