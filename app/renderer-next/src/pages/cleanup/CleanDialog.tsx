import { useEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import type {
  CleanItemPreview,
  CleanPreview,
  CleanPreviewRequest,
  CleanReport,
  DashboardVolumeCard,
} from '../../../../src/shared/ipc';
import { useApi } from '../../lib/api';
import {
  acknowledgementPaths,
  cleanErrorMessage,
  groupPreviewByCategory,
  groupResultsByCategory,
  needsAcknowledgement,
  newCleanId,
  recoveryNote,
  refusedReasonText,
  resultStatusText,
} from '../../lib/clean';
import { categoryName } from '../../lib/categories';
import { formatBytes, formatCount } from '../../lib/format';
import { useCleanStore } from '../../stores/clean';
import { useCleanupStore } from '../../stores/cleanup';
import { useDashboardStore } from '../../stores/dashboard';
import { useDevStore } from '../../stores/dev';
import { useScanStore } from '../../stores/scan';
import { Button } from '../../ui/Button';
import { Checkbox } from '../../ui/Checkbox';
import { Dialog } from '../../ui/Dialog';
import { RelativeTime } from '../../ui/Display';
import { GradePill } from '../../ui/Badge';
import { CopyLine } from '../../ui/CopyLine';
import { ChevronRightIcon, SuccessIcon } from '../../ui/icons';
import { Notice } from '../../ui/Notice';
import { ProgressBar } from '../../ui/ProgressBar';
import { Skeleton } from '../../ui/Skeleton';
import { UsageBar } from '../../ui/UsageBar';
import { refreshAfterClean } from './refresh';

export interface CleanDialogProps {
  open: boolean;
  onClose: () => void;
  /** What to clean: `quick`, or the exact paths the user chose. */
  request: CleanPreviewRequest;
  title: string;
  /** A line under the total that says what the plan covers (Quick clean). */
  scopeNote?: string;
}

type Step =
  | { kind: 'planning' }
  | { kind: 'plan'; preview: CleanPreview }
  | { kind: 'deleting'; preview: CleanPreview; cleanId: string }
  | { kind: 'done'; preview: CleanPreview; report: CleanReport; drive: DriveChange }
  | { kind: 'failed'; message: string };

interface DriveUse {
  usedBytes: number;
  totalBytes: number;
}

/** The drive's use as the app read it before the clean and again afterwards. Both come from the backend. */
interface DriveChange {
  root: string;
  before: DriveUse | null;
  /** Null until the drive has been read again. */
  after: DriveUse | null;
}

/** Items shown per category in the plan. The totals always cover every item. */
const ITEM_LIST_CAP = 200;

function driveUse(root: string): DriveUse | null {
  const volume = useDashboardStore
    .getState()
    .dashboard.data?.volumes.find(
      (candidate: DashboardVolumeCard) => candidate.root.toLowerCase() === root.toLowerCase(),
    );
  if (volume === undefined || volume.totalBytes === null || volume.freeBytes === null) return null;
  return { usedBytes: Math.max(volume.totalBytes - volume.freeBytes, 0), totalBytes: volume.totalBytes };
}

function errorText(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause);
}

function PlanItem({ item }: { item: CleanItemPreview }) {
  return (
    <li className="flex flex-col gap-1 rounded-control bg-canvas p-3">
      <div className="flex items-start justify-between gap-3">
        <span className="min-w-0 font-mono text-caption break-all text-ink-2">{item.path}</span>
        <span className="shrink-0 text-caption font-semibold tabular-nums">{formatBytes(item.bytes)}</span>
      </div>
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
        <GradePill grade={item.grade} />
        <span className="text-caption text-ink-2">
          {item.recovery.kind === 'regenerate' ? 'Can be rebuilt with:' : item.recovery.text}
        </span>
      </div>
      {item.recovery.kind === 'regenerate' ? (
        <CopyLine text={item.recovery.text} label={`Copy the rebuild command for ${item.path}`} />
      ) : null}
      <p className="text-caption text-ink-2">{item.evidence}</p>
      {item.adminRequired ? <p className="text-caption text-ink-2">Needs administrator rights.</p> : null}
    </li>
  );
}

function PlanCategories({ preview }: { preview: CleanPreview }) {
  return (
    <ul className="flex flex-col gap-2" aria-label="What will be deleted, by category">
      {groupPreviewByCategory(preview.items).map(([category, items]) => {
        const bytes = items.reduce((sum, item) => sum + item.bytes, 0);
        const note = recoveryNote(category, items);
        return (
          <li key={category} className="rounded-control border border-border">
            <details className="group">
              <summary className="flex cursor-pointer list-none items-center gap-2 rounded-control px-3 py-2 hover:bg-surface-hover">
                <ChevronRightIcon
                  className="dur-faster size-4 shrink-0 text-ink-2 transition-transform group-open:rotate-90"
                  aria-hidden="true"
                />
                <span className="min-w-0 flex-1">
                  <span className="block text-body font-semibold">{categoryName(category)}</span>
                  {note ? <span className="block text-caption text-ink-2">{note}</span> : null}
                </span>
                <span className="shrink-0 text-caption text-ink-2">
                  {formatCount(items.length)} {items.length === 1 ? 'item' : 'items'}
                </span>
                <span className="w-16 shrink-0 text-right text-body font-semibold tabular-nums">
                  {formatBytes(bytes)}
                </span>
              </summary>
              <ul className="flex flex-col gap-2 border-t border-border p-3">
                {items.slice(0, ITEM_LIST_CAP).map((item) => (
                  <PlanItem key={`${item.ruleId}:${item.path}`} item={item} />
                ))}
                {items.length > ITEM_LIST_CAP ? (
                  <li className="text-caption text-ink-2">
                    And {formatCount(items.length - ITEM_LIST_CAP)} smaller items in this category.
                  </li>
                ) : null}
              </ul>
            </details>
          </li>
        );
      })}
    </ul>
  );
}

function RefusedItems({ refused }: { refused: CleanPreview['refused'] }) {
  return (
    <details className="group rounded-control border border-border">
      <summary className="flex cursor-pointer list-none items-center gap-2 px-3 py-2 text-caption text-ink-2 hover:bg-surface-hover">
        <ChevronRightIcon
          className="dur-faster size-4 shrink-0 transition-transform group-open:rotate-90"
          aria-hidden="true"
        />
        {refused.length === 1
          ? '1 matching item is not included'
          : `${formatCount(refused.length)} matching items are not included`}
      </summary>
      <ul className="flex flex-col gap-2 border-t border-border p-3">
        {refused.map((entry) => (
          <li key={`${entry.ruleId}:${entry.path}`} className="flex flex-col">
            <span className="font-mono text-caption break-all text-ink-2">{entry.path}</span>
            <span className="text-caption text-ink-2">{refusedReasonText(entry.reason)}</span>
          </li>
        ))}
      </ul>
    </details>
  );
}

function DriveLine({ label, use }: { label: string; use: DriveUse }) {
  return (
    <div className="flex flex-col gap-1">
      <p className="text-caption text-ink-2">
        {label}: {formatBytes(use.usedBytes)} of {formatBytes(use.totalBytes)} used
      </p>
      <UsageBar
        segments={[{ id: 'used', label: 'Used', bytes: use.usedBytes }]}
        totalBytes={use.totalBytes}
        label={`${label}: space used`}
        legend={false}
      />
    </div>
  );
}

function Summary({
  preview,
  report,
  drive,
  onRelaunch,
}: {
  preview: CleanPreview;
  report: CleanReport;
  drive: DriveChange;
  onRelaunch: () => void;
}) {
  const adminPaths = new Set(preview.items.filter((item) => item.adminRequired).map((item) => item.path));
  const problems = report.items.filter((item) => item.status === 'failed' || item.status === 'partial');
  const needsAdmin = problems.some((item) => adminPaths.has(item.path));
  return (
    <div className="flex flex-col gap-4">
      <div role="status" className="flex items-center gap-3">
        <SuccessIcon className="size-8 shrink-0 text-safe" aria-hidden="true" />
        <div>
          <p className="text-hero font-semibold tabular-nums">{formatBytes(report.deletedBytes)}</p>
          <p className="text-body text-ink-2">freed</p>
        </div>
      </div>
      {drive.before !== null || drive.after !== null ? (
        <div className="flex flex-col gap-3">
          {drive.before !== null ? <DriveLine label="Before" use={drive.before} /> : null}
          {drive.after !== null ? <DriveLine label="Now" use={drive.after} /> : <Skeleton className="h-8 w-full" />}
        </div>
      ) : null}
      <ul className="flex flex-col gap-1" aria-label="What was deleted, by category">
        {groupResultsByCategory(report.items).map(([category, items]) => (
          <li key={category} className="flex items-center justify-between gap-3 text-body">
            <span>{categoryName(category)}</span>
            <span className="font-semibold tabular-nums">
              {formatBytes(items.reduce((sum, item) => sum + item.deletedBytes, 0))}
            </span>
          </li>
        ))}
      </ul>
      {report.items.some((item) => item.restoreCommand !== null) ? (
        <section aria-label="Rebuild commands" className="flex flex-col gap-2">
          <h3 className="text-body font-semibold">Bring them back</h3>
          <ul className="flex max-h-40 flex-col gap-2 overflow-y-auto">
            {report.items
              .filter((item) => item.restoreCommand !== null)
              .map((item) => (
                <li key={`${item.ruleId}:${item.path}`} className="flex flex-col rounded-control bg-canvas p-3">
                  <span className="font-mono text-caption break-all text-ink-2">{item.path}</span>
                  <CopyLine text={item.restoreCommand!} label={`Copy the rebuild command for ${item.path}`} />
                </li>
              ))}
          </ul>
        </section>
      ) : null}
      {problems.length > 0 ? (
        <Notice
          variant="warning"
          action={
            needsAdmin ? (
              <Button variant="secondary" onClick={onRelaunch}>
                Relaunch as administrator
              </Button>
            ) : undefined
          }
        >
          {problems.length === 1
            ? '1 item could not be fully cleaned.'
            : `${formatCount(problems.length)} items could not be fully cleaned.`}
        </Notice>
      ) : null}
      {problems.length > 0 ? (
        <ul className="flex max-h-40 flex-col gap-2 overflow-y-auto" aria-label="Items that were not fully cleaned">
          {problems.map((item) => (
            <li key={`${item.ruleId}:${item.path}`} className="flex flex-col rounded-control bg-canvas p-3">
              <span className="font-mono text-caption break-all text-ink-2">{item.path}</span>
              <span className="text-caption">{resultStatusText(item)}</span>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

/**
 * One dialog for the whole clean: build the plan, review it, delete, summarise. The confirm button always names
 * the amount, and nothing is deleted until it is pressed.
 */
export function CleanDialog({ open, onClose, request, title, scopeNote }: CleanDialogProps) {
  const api = useApi();
  const [step, setStep] = useState<Step>({ kind: 'planning' });
  const [attempt, setAttempt] = useState(0);
  const [acknowledged, setAcknowledged] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  // The first control of every step is the safe choice (Cancel, Done, Close); focus goes there as the step changes.
  const safeRef = useRef<HTMLButtonElement>(null);
  const mounted = useRef(true);
  const startedAttempt = useRef(-1);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  // Only the latest request counts, and a repeat effect run (StrictMode) must not start a second quick scan.
  useEffect(() => {
    if (startedAttempt.current === attempt) return;
    startedAttempt.current = attempt;
    setStep({ kind: 'planning' });
    setAcknowledged(false);
    setProblem(null);
    api.previewClean(request).then(
      (result) => {
        if (!mounted.current || startedAttempt.current !== attempt) return;
        setStep(
          result.ok
            ? { kind: 'plan', preview: result.preview }
            : { kind: 'failed', message: cleanErrorMessage(result) },
        );
      },
      (cause: unknown) => {
        if (!mounted.current || startedAttempt.current !== attempt) return;
        setStep({ kind: 'failed', message: errorText(cause) });
      },
    );
  }, [api, request, attempt]);

  useEffect(() => {
    safeRef.current?.focus();
  }, [step.kind]);

  const quickProgress = useScanStore((state) => state.quickProgress);
  const cleanRun = useCleanStore((state) => (step.kind === 'deleting' ? state.runs[step.cleanId] : undefined));

  const close = () => {
    // A quick clean is still scanning if it has no plan yet; leaving must stop that scan.
    if (step.kind === 'planning' && request.scope === 'quick') void api.cancelScan().catch(() => {});
    onClose();
  };

  const confirm = async (preview: CleanPreview) => {
    const cleanId = newCleanId();
    const before = driveUse(preview.root);
    setProblem(null);
    setStep({ kind: 'deleting', preview, cleanId });
    try {
      const result = await api.executeClean({
        cleanId,
        planId: preview.planId,
        acknowledge: acknowledgementPaths(preview.items),
      });
      if (!mounted.current) return;
      if (!result.ok) {
        setProblem(cleanErrorMessage(result));
        setStep({ kind: 'plan', preview });
        return;
      }
      const { report } = result;
      useCleanupStore.getState().resetSelection();
      useDevStore.getState().resetSelection();
      setStep({ kind: 'done', preview, report, drive: { root: report.root, before, after: null } });
      // The "now" figure is read from the backend again, never worked out from the amount freed.
      await refreshAfterClean(api, report.root);
      if (!mounted.current) return;
      const after = driveUse(report.root);
      setStep((current) => (current.kind === 'done' ? { ...current, drive: { ...current.drive, after } } : current));
    } catch (cause) {
      if (!mounted.current) return;
      setProblem(errorText(cause));
      setStep({ kind: 'plan', preview });
    }
  };

  const relaunch = () => void api.relaunchElevated().catch(() => {});

  let body: ReactNode;
  let footer: ReactNode;
  let description: string | undefined;

  switch (step.kind) {
    case 'planning':
      description = 'Dust is working out exactly what would be deleted. Nothing is deleted yet.';
      body = (
        <div role="status" className="flex flex-col gap-3">
          {scopeNote ? <p className="text-body text-ink-2">{scopeNote}</p> : null}
          <ProgressBar label="Preparing the plan" />
          {request.scope === 'quick' && quickProgress !== null ? (
            <p className="truncate font-mono text-caption text-ink-2" title={quickProgress.currentPath}>
              {formatCount(quickProgress.filesScanned)} files checked · {quickProgress.currentPath}
            </p>
          ) : null}
        </div>
      );
      footer = (
        <Button ref={safeRef} variant="secondary" onClick={close}>
          Cancel
        </Button>
      );
      break;
    case 'plan': {
      const { preview } = step;
      const needsAck = needsAcknowledgement(preview.items);
      const adminItems = preview.items.filter((item) => item.adminRequired).length;
      const sourcePrefix = preview.source === 'live' ? 'Based on the scan from ' : 'Based on the saved scan from ';
      description = scopeNote;
      body = (
        <div className="flex flex-col gap-4">
          <div>
            <p className="text-hero font-semibold tabular-nums">{formatBytes(preview.totals.bytes)}</p>
            <p className="text-body text-ink-2">
              will be deleted · {formatCount(preview.totals.items)} {preview.totals.items === 1 ? 'item' : 'items'}
            </p>
          </div>
          {preview.items.length === 0 ? (
            <p className="text-body text-ink-2">There is nothing to clean here.</p>
          ) : (
            <PlanCategories preview={preview} />
          )}
          <p className="text-caption text-ink-2">
            {preview.source === 'targeted' ? (
              'Sizes were measured just now.'
            ) : (
              <>
                {sourcePrefix}
                <RelativeTime ms={Date.now() - (preview.scanAgeMs ?? 0)} />.
              </>
            )}
          </p>
          {preview.refused.length > 0 ? <RefusedItems refused={preview.refused} /> : null}
          {adminItems > 0 ? (
            <Notice
              action={
                <Button variant="secondary" onClick={relaunch}>
                  Relaunch as administrator
                </Button>
              }
            >
              {adminItems === 1 ? '1 item needs' : `${formatCount(adminItems)} items need`} administrator rights.
            </Notice>
          ) : null}
          {needsAck ? (
            <Checkbox
              checked={acknowledged}
              onCheckedChange={setAcknowledged}
              label="I understand that some of these items cannot be recovered."
            />
          ) : null}
          {problem !== null ? <Notice variant="warning">{problem}</Notice> : null}
        </div>
      );
      footer = (
        <>
          <Button ref={safeRef} variant="secondary" onClick={close}>
            Cancel
          </Button>
          <Button
            variant="danger"
            disabled={preview.items.length === 0 || (needsAck && !acknowledged)}
            onClick={() => void confirm(preview)}
          >
            Delete {formatBytes(preview.totals.bytes)}
          </Button>
        </>
      );
      break;
    }
    case 'deleting': {
      const total = step.preview.totals.items;
      const done = Math.min(cleanRun?.items.length ?? 0, total);
      const plannedDone = cleanRun?.items.reduce((sum, item) => sum + item.plannedBytes, 0) ?? 0;
      const freed = cleanRun?.items.reduce((sum, item) => sum + item.deletedBytes, 0) ?? 0;
      description = 'Please keep Dust open until this finishes.';
      body = (
        <div role="status" className="flex flex-col gap-3">
          <p className="text-body">
            {done === 0
              ? `Deleting ${formatCount(total)} ${total === 1 ? 'item' : 'items'}. Large folders can take a few minutes.`
              : `Deleted ${formatCount(done)} of ${formatCount(total)} ${total === 1 ? 'item' : 'items'} · ${formatBytes(freed)} freed`}
          </p>
          {/* Weighted by size, so one huge folder does not read as 1 of N done. */}
          <ProgressBar
            value={done === 0 ? null : plannedDone / Math.max(step.preview.totals.bytes, 1)}
            label="Deleting"
          />
        </div>
      );
      footer = (
        <Button variant="danger" loading>
          Deleting
        </Button>
      );
      break;
    }
    case 'done':
      body = <Summary preview={step.preview} report={step.report} drive={step.drive} onRelaunch={relaunch} />;
      footer = (
        <Button ref={safeRef} variant="primary" onClick={onClose}>
          Done
        </Button>
      );
      break;
    case 'failed':
      body = <Notice variant="warning">{step.message}</Notice>;
      footer = (
        <>
          <Button ref={safeRef} variant="secondary" onClick={close}>
            Close
          </Button>
          <Button variant="primary" onClick={() => setAttempt((count) => count + 1)}>
            Try again
          </Button>
        </>
      );
      break;
  }

  const heading = step.kind === 'done' ? 'Cleanup finished' : step.kind === 'deleting' ? 'Deleting…' : title;

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => !next && close()}
      title={heading}
      description={description}
      dismissible={step.kind !== 'deleting'}
      initialFocus={safeRef}
      footer={footer}
      className="max-w-xl"
    >
      {body}
    </Dialog>
  );
}
