import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import type { RemovalReport, UninstallItemPreview, UninstallPreview } from '../../../../src/shared/ipc';
import { useApi } from '../../lib/api';
import { formatBytes, formatCount } from '../../lib/format';
import {
  UNINSTALL_PHASES,
  blockReasonText,
  defaultUninstallSelection,
  groupUninstallItems,
  keptReasonText,
  outcomeText,
  selectedReviewItems,
  uninstallSelectionTotals,
} from '../../lib/uninstall';
import { useAppsStore } from '../../stores/apps';
import { GradePill } from '../../ui/Badge';
import { Button, Spinner } from '../../ui/Button';
import { Checkbox } from '../../ui/Checkbox';
import { Dialog } from '../../ui/Dialog';
import { CheckIcon, WarningIcon } from '../../ui/icons';
import { CopyLine } from '../../ui/CopyLine';
import { Notice } from '../../ui/Notice';

export interface ResumeFlowProps {
  open: boolean;
  onClose: () => void;
  /** The app to remove. Null when adopting a removal that is already running. */
  appId: string | null;
  adoptJobId: string | null;
  elevated: boolean;
  onChanged: () => void;
}

type Stage = 'building' | 'plan' | 'running' | 'report' | 'error';

const BUSY_TEXT = 'A scan is already running. Wait for it to finish, then try again.';

function previewMessage(result: { reason: string; message?: string }): string {
  if (result.reason === 'busy') return BUSY_TEXT;
  return result.message ?? 'This app cannot be removed right now.';
}

/** The exception's own words are for the log, not for the user. */
const PLAN_FAILED = 'Dust could not build the removal plan. Nothing was changed.';
const RELAUNCH_FAILED = 'Dust could not restart with administrator rights. Nothing was changed.';
const RUN_FAILED = 'Dust could not finish the removal. Open Apps to see what is left.';

function PhaseMarker({ status }: { status: string }) {
  if (status === 'started') return <Spinner className="size-4 text-accent" />;
  if (status === 'done') return <CheckIcon className="size-4 text-safe" aria-hidden="true" />;
  if (status === 'failed') return <WarningIcon className="size-4 text-review" aria-hidden="true" />;
  return <span className="size-1.5 rounded-full bg-border-strong" aria-hidden="true" />;
}

function PhaseList({ phases }: { phases: Record<string, { status: string; note?: string } | undefined> }) {
  return (
    <ol aria-label="Removal progress" aria-live="polite" className="flex flex-col gap-2">
      {UNINSTALL_PHASES.map((phase) => {
        const state = phases[phase.id] ?? { status: 'pending' };
        return (
          <li key={phase.id} className="flex items-start gap-3">
            <span className="mt-0.5 flex size-4 shrink-0 items-center justify-center">
              <PhaseMarker status={state.status} />
            </span>
            <div className="min-w-0">
              <p className={state.status === 'pending' ? 'text-body text-ink-2' : 'text-body'}>{phase.label}</p>
              {state.note !== undefined ? (
                <p className="text-caption text-ink-2">{keptReasonText(state.note)}</p>
              ) : null}
            </div>
          </li>
        );
      })}
    </ol>
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
  onReveal: (() => void) | undefined;
}) {
  return (
    <li className="flex items-start gap-3 rounded-control bg-canvas p-3">
      <Checkbox checked={checked} onCheckedChange={onToggle} aria-label={`Select ${item.label}`} className="mt-0.5" />
      <div className="min-w-0 flex-1">
        <div className="flex items-start justify-between gap-3">
          <span className="min-w-0 font-mono text-caption break-all text-ink-2">{item.target}</span>
          <span className="shrink-0 text-caption font-semibold tabular-nums">
            {item.bytes === null ? '—' : formatBytes(item.bytes)}
          </span>
        </div>
        <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1">
          <GradePill grade={item.grade} />
          {item.adminRequired ? <span className="text-caption text-ink-2">Needs administrator rights.</span> : null}
          {item.syncRoot === true ? <span className="text-caption text-ink-2">Syncing folder.</span> : null}
        </div>
        {item.evidence.length > 0 ? <p className="text-caption text-ink-2">{item.evidence.join(' · ')}</p> : null}
        {onReveal !== undefined ? (
          <Button variant="subtle" className="-ml-3 h-6" onClick={onReveal}>
            Show in Explorer
          </Button>
        ) : null}
      </div>
    </li>
  );
}

function ReportBody({ report }: { report: RemovalReport }) {
  const outcome = outcomeText(report.outcome);
  const kept = report.files.kept.map((entry) => ({ target: entry.target, reason: keptReasonText(entry.reason) }));
  const rows: Array<[string, number]> = [
    ['Files removed', report.files.deletedItems],
    ['Moved to the Recycle Bin', report.files.recycledItems],
    ['In use, left alone', report.files.skippedLocked],
    ['Registry keys removed', report.registry.deletedKeys.length],
    ['Startup entries turned off', report.startup.disabled.length + report.startup.purgedEnvelopes.length],
  ];
  return (
    <div className="flex flex-col gap-4">
      <div role="status">
        <p className="text-body font-semibold">{outcome.title}</p>
        <p className="text-body text-ink-2">{outcome.detail}</p>
        <p className="mt-3 text-hero font-semibold tabular-nums">{formatBytes(report.files.deletedBytes)}</p>
        <p className="text-body text-ink-2">freed</p>
      </div>
      <dl className="flex flex-col gap-2 text-body">
        {rows
          .filter(([label, count]) => count > 0 || label === 'Files removed' || label === 'Registry keys removed')
          .map(([label, count]) => (
            <div key={label} className="flex items-start justify-between gap-3">
              <dt className="text-ink-2">{label}</dt>
              <dd className="tabular-nums">{formatCount(count)}</dd>
            </div>
          ))}
      </dl>
      {report.uninstaller.skippedReason !== null ? (
        <Notice>
          The app's own uninstaller did not run.{' '}
          {blockReasonText(report.uninstaller.skippedReason) ?? keptReasonText(report.uninstaller.skippedReason)}
        </Notice>
      ) : null}
      {report.uninstaller.ran && !report.uninstaller.verifiedGone ? (
        <Notice>
          The app still appears in the installed list. Its own uninstaller may not have finished; run it again from
          Windows Settings if needed.
        </Notice>
      ) : null}
      {report.outcome === 'reboot-required' ? (
        <Notice>Restart to finish uninstalling. Leftovers were not touched.</Notice>
      ) : null}
      {report.registry.backupPath.length > 0 ? (
        <div className="flex flex-col gap-1 rounded-control bg-canvas p-3">
          <p className="text-caption text-ink-2">Registry backup. Restore it with this command.</p>
          <CopyLine text={report.registry.restoreCommand} label="Copy the restore command" />
        </div>
      ) : null}
      {kept.length > 0 ? (
        <details className="rounded-control border border-border">
          <summary className="cursor-pointer px-3 py-2 text-caption text-ink-2 hover:bg-surface-hover">
            {formatCount(kept.length)} {kept.length === 1 ? 'item was' : 'items were'} kept
          </summary>
          <ul className="flex flex-col gap-2 border-t border-border p-3">
            {kept.map((entry) => (
              <li key={`${entry.target}:${entry.reason}`} className="flex flex-col">
                <span className="font-mono text-caption break-all text-ink-2">{entry.target}</span>
                <span className="text-caption text-ink-2">{entry.reason}</span>
              </li>
            ))}
          </ul>
        </details>
      ) : null}
      <p className="font-mono text-caption break-all text-ink-2">{report.journalPath}</p>
    </div>
  );
}

/**
 * The removal Dust restarts into after being relaunched as administrator: one plan with the app's own uninstaller and
 * its leftovers, reviewed and run in one go. Also adopts a removal that is already running (progress and report).
 */
export function ResumeFlow({ open, onClose, appId, adoptJobId, elevated, onChanged }: ResumeFlowProps) {
  const api = useApi();
  const [stage, setStage] = useState<Stage>(adoptJobId === null ? 'building' : 'running');
  const [preview, setPreview] = useState<UninstallPreview | null>(null);
  const [report, setReport] = useState<RemovalReport | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [selection, setSelection] = useState<ReadonlySet<string>>(new Set());
  const [quiet, setQuiet] = useState(false);
  const [runUninstaller, setRunUninstaller] = useState(true);
  const [acknowledged, setAcknowledged] = useState(false);
  const [includeUserData, setIncludeUserData] = useState(false);
  const [jobId, setJobId] = useState<string | null>(adoptJobId);
  const [waitingSince, setWaitingSince] = useState<number | null>(null);
  const [clock, setClock] = useState(() => Date.now());
  const [skippedWaiting, setSkippedWaiting] = useState(false);
  const safeRef = useRef<HTMLButtonElement>(null);
  const mounted = useRef(true);
  const changedRef = useRef(false);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const markChanged = useCallback(() => {
    if (changedRef.current) return;
    changedRef.current = true;
    onChanged();
  }, [onChanged]);

  useEffect(() => {
    if (appId === null) return;
    let active = true;
    api.previewUninstall(appId).then(
      (result) => {
        if (!active) return;
        if (!result.ok) {
          setError(previewMessage(result));
          setStage('error');
          return;
        }
        setPreview(result.preview);
        setSelection(new Set(defaultUninstallSelection(result.preview.items)));
        setStage('plan');
      },
      () => {
        if (!active) return;
        setError(PLAN_FAILED);
        setStage('error');
      },
    );
    return () => {
      active = false;
    };
  }, [api, appId]);

  // What the removal has reported, from the events the app already folded into the store.
  const job = useAppsStore((state) => (jobId === null ? undefined : state.jobs[jobId]));
  const phases = job?.phases ?? {};
  const outcome = job?.outcome ?? null;
  useEffect(() => {
    if (stage !== 'running' || outcome === null) return;
    if (outcome.type === 'finished') {
      setReport(outcome.report);
      setStage('report');
      markChanged();
    } else {
      setError(outcome.message);
      setStage('error');
    }
  }, [stage, outcome, markChanged]);

  const uninstallerStarted = phases.uninstaller?.status === 'started';
  useEffect(() => {
    if (uninstallerStarted) setWaitingSince((current) => current ?? Date.now());
  }, [uninstallerStarted]);
  useEffect(() => {
    if (stage !== 'running') return;
    const timer = setInterval(() => setClock(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [stage]);

  const items = useMemo(() => preview?.items ?? [], [preview]);
  const totals = useMemo(() => uninstallSelectionTotals(items, selection), [items, selection]);
  const reviewItems = useMemo(() => selectedReviewItems(items, selection), [items, selection]);
  const sections = useMemo(() => groupUninstallItems(items), [items]);

  const toggleItem = (id: string) =>
    setSelection((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  const toggleUserData = (on: boolean) => {
    setIncludeUserData(on);
    setSelection((current) => {
      const next = new Set(current);
      for (const item of items) {
        if (item.dataClass !== 'user-data') continue;
        if (on) next.add(item.id);
        else next.delete(item.id);
      }
      return next;
    });
  };

  const execute = async () => {
    if (preview === null) return;
    const id = preview.planId;
    const needsAdmin = preview.totals.adminItems > 0 || preview.uninstaller?.requiresAdmin === true;
    if (needsAdmin && !elevated) {
      try {
        await api.relaunchElevatedUninstall(id);
      } catch {
        if (mounted.current) {
          setError(RELAUNCH_FAILED);
          setStage('error');
        }
      }
      return;
    }
    setJobId(id);
    setStage('running');
    setWaitingSince(null);
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
      if (!mounted.current) return;
      if (result.ok) {
        setReport(result.report);
        setStage('report');
        markChanged();
        return;
      }
      if (result.reason === 'unacknowledged-review') {
        setError('Tick the box to confirm you understand before removing items marked Review.');
        setStage('plan');
        return;
      }
      setError(result.reason === 'busy' ? BUSY_TEXT : (result.message ?? 'The uninstall could not start.'));
      setStage('error');
    } catch {
      if (mounted.current) {
        setError(RUN_FAILED);
        setStage('error');
      }
    }
  };

  useEffect(() => {
    safeRef.current?.focus();
  }, [stage]);

  const waiting = stage === 'running' && waitingSince !== null && uninstallerStarted && !skippedWaiting;
  const needsAck = reviewItems.length > 0;
  let body: ReactNode;
  let footer: ReactNode = null;
  let title = 'Remove an app';
  let description: string | undefined;

  if (stage === 'building') {
    body = (
      <p role="status" className="text-body text-ink-2">
        Building the removal plan.
      </p>
    );
  } else if (stage === 'plan' && preview !== null) {
    title = `Remove ${preview.app.displayName}`;
    description = `${preview.app.publisher.length > 0 ? preview.app.publisher : 'Unknown publisher'}${
      preview.app.version.length > 0 ? ` · ${preview.app.version}` : ''
    }`;
    body = (
      <div className="flex flex-col gap-4">
        <div>
          <p className="text-hero font-semibold tabular-nums">{formatBytes(totals.bytes)}</p>
          <p className="text-body text-ink-2">
            will be removed · {formatCount(totals.items)} {totals.items === 1 ? 'item' : 'items'}
          </p>
        </div>
        {preview.uninstaller !== null ? (
          <section
            aria-label="The app's own uninstaller"
            className="flex flex-col gap-2 rounded-control border border-border p-3"
          >
            <Checkbox
              checked={runUninstaller && preview.uninstaller.launchable}
              disabled={!preview.uninstaller.launchable}
              onCheckedChange={setRunUninstaller}
              label="Run the app's own uninstaller"
            />
            <CopyLine
              text={
                quiet && preview.uninstaller.silent !== null
                  ? `msiexec ${preview.uninstaller.silent.argv.join(' ')}`
                  : preview.uninstaller.raw
              }
              label="Copy the uninstall command"
            />
            {preview.uninstaller.blockReason !== null ? (
              <p className="text-caption text-ink-2">{blockReasonText(preview.uninstaller.blockReason)}</p>
            ) : null}
            {preview.uninstaller.silent !== null && preview.uninstaller.launchable ? (
              <Checkbox checked={quiet} onCheckedChange={setQuiet} label="Run silently, with no installer windows" />
            ) : null}
          </section>
        ) : null}
        {sections.map((section) => (
          <section key={section.id} aria-label={section.title} className="flex flex-col gap-2">
            <div className="flex items-baseline justify-between gap-3">
              <h3 className="text-body font-semibold">{section.title}</h3>
              <span className="text-caption text-ink-2">
                {formatCount(section.items.length)} {section.items.length === 1 ? 'item' : 'items'}
              </span>
            </div>
            {section.description !== null ? <p className="text-caption text-ink-2">{section.description}</p> : null}
            {section.id === 'user-data' ? (
              <Checkbox checked={includeUserData} onCheckedChange={toggleUserData} label="Also remove user data" />
            ) : null}
            <ul className="flex flex-col gap-2">
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
        {preview.kept.length > 0 ? (
          <details className="rounded-control border border-border">
            <summary className="cursor-pointer px-3 py-2 text-caption text-ink-2 hover:bg-surface-hover">
              {formatCount(preview.kept.length)} {preview.kept.length === 1 ? 'item will' : 'items will'} be kept
            </summary>
            <ul className="flex flex-col gap-2 border-t border-border p-3">
              {preview.kept.map((entry) => (
                <li key={`${entry.target}:${entry.reason}`} className="flex flex-col">
                  <span className="font-mono text-caption break-all text-ink-2">{entry.target}</span>
                  <span className="text-caption text-ink-2">{keptReasonText(entry.reason)}</span>
                </li>
              ))}
            </ul>
          </details>
        ) : null}
        <Checkbox
          checked={acknowledged}
          onCheckedChange={setAcknowledged}
          label={`I understand that items marked Review cannot be recovered${needsAck ? ` (${reviewItems.length} selected)` : ''}`}
        />
        {error !== null ? <Notice variant="warning">{error}</Notice> : null}
      </div>
    );
    footer = (
      <>
        <Button ref={safeRef} variant="secondary" onClick={onClose}>
          Cancel
        </Button>
        <Button
          variant="danger"
          disabled={totals.items === 0 || (needsAck && !acknowledged)}
          onClick={() => void execute()}
        >
          Uninstall
        </Button>
      </>
    );
  } else if (stage === 'running') {
    title = preview === null ? 'Finishing the uninstall' : `Removing ${preview.app.displayName}`;
    description = 'Keep Dust open until this finishes.';
    body = (
      <div className="flex flex-col gap-4">
        <PhaseList phases={phases} />
        {job?.rebootRequired === true ? (
          <Notice>This app finishes uninstalling after a restart. Dust left its leftovers alone.</Notice>
        ) : null}
        {waiting && waitingSince !== null ? (
          <div className="flex items-center justify-between gap-3 rounded-control bg-canvas px-3 py-2">
            <p className="text-body text-ink-2">
              Still running · {Math.max(Math.floor((clock - waitingSince) / 1000), 0)} s
            </p>
            <Button
              variant="secondary"
              onClick={() => {
                setSkippedWaiting(true);
                void api.skipUninstallWaiting();
              }}
            >
              Skip waiting
            </Button>
          </div>
        ) : null}
      </div>
    );
  } else if (stage === 'report' && report !== null) {
    title = 'Finished';
    body = <ReportBody report={report} />;
    footer = (
      <Button ref={safeRef} variant="primary" onClick={onClose}>
        Done
      </Button>
    );
  } else {
    title = 'Nothing was removed';
    body = <Notice variant="warning">{error ?? 'Something went wrong.'}</Notice>;
    footer = (
      <Button ref={safeRef} variant="primary" onClick={onClose}>
        Close
      </Button>
    );
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => !next && stage !== 'running' && onClose()}
      title={title}
      description={description}
      dismissible={stage !== 'running'}
      initialFocus={safeRef}
      footer={footer}
      className="max-w-2xl"
    >
      {body}
    </Dialog>
  );
}
