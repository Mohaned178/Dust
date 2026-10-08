import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type {
  DustApi,
  UninstallAppSummary,
  UninstallItemPreview,
  UninstallPreview,
  UninstallRunOutcome,
} from '../../../src/shared/ipc';
import type { RemovalReport } from '@dust/core';
import { formatBytes, formatCount } from '../format';
import { CleanDialog } from './CleanDialog';
import { Alert, Badge, Button, Meter } from './ui';
import { CheckIcon } from './icons';

// Two-step removal, the way dedicated uninstallers work: run the app's own
// uninstaller first, then scan for what it actually left behind and let the
// user choose what to remove. Nothing is deleted before the review step.

export interface UninstallWizardProps {
  api: DustApi;
  app: UninstallAppSummary;
  elevated: boolean;
  onClose: () => void;
  onChanged: () => void;
}

// How the user reached the leftover scan decides what "done" may claim: only
// after a verified uninstall is the app itself gone.
type Origin = 'uninstalled' | 'still-installed' | 'leftovers-only';

type Step =
  | { name: 'confirm' }
  | { name: 'running' }
  | { name: 'still-installed'; outcome: UninstallRunOutcome | null; message: string | null }
  | { name: 'reboot' }
  | { name: 'scanning' }
  | { name: 'review'; preview: UninstallPreview; origin: Origin }
  | { name: 'removing'; preview: UninstallPreview; selected: ReadonlySet<string>; origin: Origin }
  | {
      name: 'done';
      preview: UninstallPreview | null;
      report: RemovalReport | null;
      freed: number;
      removed: number;
      origin: Origin;
    }
  | { name: 'error'; message: string };

const CAUTION_COPY: Record<NonNullable<UninstallAppSummary['caution']>, string> = {
  hardware: 'This is driver or hardware software. Removing it can affect your graphics, sound, or network.',
  security: 'This is security software. Make sure another antivirus is active before removing it.',
  runtime: 'Other apps may need this runtime to start. Remove it only if you know nothing uses it.',
};

const GROUPS: Array<{ kind: UninstallItemPreview['kind']; title: string }> = [
  { kind: 'file', title: 'Files and folders' },
  { kind: 'registry', title: 'Registry entries' },
  { kind: 'startup', title: 'Startup entries' },
];

interface RemovalProgress {
  count: number;
  recent: Array<{ itemId: string; status: string }>;
}

const EMPTY_PROGRESS: RemovalProgress = { count: 0, recent: [] };

const ITEM_STATUS_TEXT: Record<string, string> = {
  deleted: 'Removed',
  recycled: 'Moved to the Recycle Bin',
  'already-gone': 'Already gone',
  partial: 'Partly removed',
  failed: 'Could not be removed',
  kept: 'Kept',
  'skipped-locked': 'In use, skipped',
};

function newJobId(): string {
  return typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : `job-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

export function UninstallWizard({ api, app, elevated, onClose, onChanged }: UninstallWizardProps) {
  const [step, setStep] = useState<Step>(app.hasUninstaller ? { name: 'confirm' } : { name: 'scanning' });
  const [quiet, setQuiet] = useState(false);
  const [progress, setProgress] = useState<RemovalProgress>(EMPTY_PROGRESS);
  const itemStatus = useRef(new Map<string, string>());
  const jobId = useRef<string | null>(null);
  const changed = useRef(false);

  const markChanged = useCallback(() => {
    if (changed.current) return;
    changed.current = true;
    onChanged();
  }, [onChanged]);

  useEffect(
    () =>
      api.onUninstallEvent((event) => {
        if (event.type !== 'item' || event.jobId !== jobId.current) return;
        itemStatus.current.set(event.itemId, event.status);
        // The ref feeds the final tally; this state drives the live progress.
        setProgress((current) => ({
          count: itemStatus.current.size,
          recent: [...current.recent.slice(-2), { itemId: event.itemId, status: event.status }],
        }));
      }),
    [api],
  );

  const scanLeftovers = useCallback(
    async (origin: Origin) => {
      setStep({ name: 'scanning' });
      try {
        const result = await api.previewUninstall(app.id, { leftoversOnly: true });
        if (!result.ok) {
          setStep(
            result.reason === 'busy'
              ? { name: 'error', message: 'Another scan or removal is running. Try again when it finishes.' }
              : { name: 'error', message: result.message },
          );
          return;
        }
        setStep({ name: 'review', preview: result.preview, origin });
      } catch (cause) {
        setStep({ name: 'error', message: cause instanceof Error ? cause.message : String(cause) });
      }
    },
    [api, app.id],
  );

  // An app without a working uninstaller goes straight to the leftover scan.
  const started = useRef(false);
  useEffect(() => {
    if (started.current || app.hasUninstaller) return;
    started.current = true;
    void scanLeftovers('leftovers-only');
  }, [app.hasUninstaller, scanLeftovers]);

  const runUninstaller = useCallback(async () => {
    setStep({ name: 'running' });
    jobId.current = newJobId();
    try {
      const result = await api.runUninstaller({ jobId: jobId.current, appId: app.id, quiet });
      markChanged();
      if (!result.ok) {
        setStep(
          result.reason === 'busy'
            ? { name: 'error', message: 'Another scan or removal is running. Try again when it finishes.' }
            : { name: 'still-installed', outcome: null, message: result.message },
        );
        return;
      }
      if (result.outcome.rebootRequired) {
        setStep({ name: 'reboot' });
        return;
      }
      if (!result.outcome.verifiedGone) {
        setStep({ name: 'still-installed', outcome: result.outcome, message: null });
        return;
      }
      await scanLeftovers('uninstalled');
    } catch (cause) {
      setStep({ name: 'error', message: cause instanceof Error ? cause.message : String(cause) });
    }
  }, [api, app.id, markChanged, quiet, scanLeftovers]);

  const remove = useCallback(
    async (preview: UninstallPreview, selected: ReadonlySet<string>, includeUserData: boolean, origin: Origin) => {
      setStep({ name: 'removing', preview, selected, origin });
      jobId.current = newJobId();
      itemStatus.current.clear();
      setProgress(EMPTY_PROGRESS);
      const selection = [...selected];
      const acknowledge = preview.items
        .filter((item) => selected.has(item.id) && item.grade === 'review')
        .map((item) => item.id);
      try {
        const result = await api.executeUninstall({
          jobId: jobId.current,
          planId: preview.planId,
          selection,
          includeUserData,
          runUninstaller: false,
          quiet: false,
          acknowledge,
        });
        markChanged();
        if (!result.ok) {
          setStep({
            name: 'error',
            message:
              result.reason === 'busy'
                ? 'Another scan or removal is running. Try again when it finishes.'
                : (result.message ?? 'Nothing was removed.'),
          });
          return;
        }
        let freed = 0;
        let removed = 0;
        for (const item of preview.items) {
          const status = itemStatus.current.get(item.id);
          if (status === 'deleted' || status === 'recycled' || status === 'already-gone') {
            removed += 1;
            freed += item.bytes ?? 0;
          }
        }
        setStep({ name: 'done', preview, report: result.report, freed, removed, origin });
      } catch (cause) {
        setStep({ name: 'error', message: cause instanceof Error ? cause.message : String(cause) });
      }
    },
    [api, markChanged],
  );

  const busy = step.name === 'running' || step.name === 'scanning' || step.name === 'removing';

  return (
    <CleanDialog
      label={`Uninstall ${app.displayName}`}
      onClose={onClose}
      dismissible={!busy}
      size="lg"
      header={
        <div className="min-w-0">
          <p className="text-xs font-medium text-ink-muted">Uninstall</p>
          <h2 className="mt-0.5 truncate text-lg font-semibold tracking-tight text-ink">{app.displayName}</h2>
        </div>
      }
    >
      {step.name === 'confirm' && (
        <ConfirmStep
          app={app}
          quiet={quiet}
          onQuiet={setQuiet}
          onCancel={onClose}
          onRun={() => void runUninstaller()}
        />
      )}
      {step.name === 'running' && (
        <Waiting
          title={`Running the ${app.displayName} uninstaller`}
          text={
            quiet ? 'It runs quietly in the background.' : 'Finish the steps in its window. Dust waits until it closes.'
          }
          action={
            <Button size="sm" onClick={() => void api.skipUninstallWaiting()}>
              It&rsquo;s finished
            </Button>
          }
        />
      )}
      {step.name === 'scanning' && (
        <Waiting
          title="Looking for leftovers"
          text="Folders, registry entries, and startup entries the app left behind."
        />
      )}
      {step.name === 'reboot' && (
        <Message
          tone="info"
          title="Restart to finish"
          text={`The ${app.displayName} uninstaller needs a restart. After restarting, open Uninstall apps again to clear anything it left behind.`}
          actions={<Button onClick={onClose}>Close</Button>}
        />
      )}
      {step.name === 'still-installed' && (
        <Message
          tone="info"
          title={`${app.displayName} still looks installed`}
          text={
            step.message ??
            'The uninstaller closed but the app is still registered. If you cancelled it, nothing was removed. You can still look for leftover files.'
          }
          actions={
            <>
              <Button onClick={onClose}>Close</Button>
              <Button variant="primary" onClick={() => void scanLeftovers('still-installed')}>
                Look for leftovers
              </Button>
            </>
          }
        />
      )}
      {step.name === 'review' && (
        <ReviewStep
          app={app}
          preview={step.preview}
          origin={step.origin}
          elevated={elevated}
          onClose={onClose}
          onRelaunch={() => api.relaunchElevatedUninstall(step.preview.planId)}
          onRemove={(selected, includeUserData) => void remove(step.preview, selected, includeUserData, step.origin)}
        />
      )}
      {step.name === 'removing' && (
        <RemovingStep preview={step.preview} total={step.selected.size} progress={progress} />
      )}
      {step.name === 'done' && <DoneStep app={app} step={step} onClose={onClose} />}
      {step.name === 'error' && (
        <Message
          tone="danger"
          title="That didn’t work"
          text={step.message}
          actions={<Button onClick={onClose}>Close</Button>}
        />
      )}
    </CleanDialog>
  );
}

function ConfirmStep({
  app,
  quiet,
  onQuiet,
  onCancel,
  onRun,
}: {
  app: UninstallAppSummary;
  quiet: boolean;
  onQuiet: (value: boolean) => void;
  onCancel: () => void;
  onRun: () => void;
}) {
  return (
    <div>
      <ol className="space-y-4">
        <StepLine number={1} title="Run the app's own uninstaller" text="The same uninstaller Windows Settings uses." />
        <StepLine
          number={2}
          title="Find what it left behind"
          text="Leftover folders, registry entries, and startup entries."
        />
        <StepLine number={3} title="You choose what to remove" text="Nothing extra is deleted until you confirm." />
      </ol>
      {app.caution !== null && (
        <Alert tone="review" className="mt-6">
          {CAUTION_COPY[app.caution]}
        </Alert>
      )}
      {app.kind === 'msi' && (
        <label className="mt-6 flex cursor-pointer items-start gap-3 text-sm">
          <input
            type="checkbox"
            checked={quiet}
            onChange={(event) => onQuiet(event.target.checked)}
            className="mt-0.5 h-4 w-4 accent-accent"
          />
          <span>
            <span className="font-medium text-ink">Uninstall quietly</span>
            <span className="block text-ink-muted">Skip the uninstaller&rsquo;s windows.</span>
          </span>
        </label>
      )}
      <div className="mt-8 flex justify-end gap-2">
        <Button onClick={onCancel}>Cancel</Button>
        <Button variant="primary" onClick={onRun}>
          Uninstall
        </Button>
      </div>
    </div>
  );
}

function StepLine({ number, title, text }: { number: number; title: string; text: string }) {
  return (
    <li className="flex gap-3">
      <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-accent-soft text-xs font-semibold text-accent-strong">
        {number}
      </span>
      <div>
        <p className="text-sm font-medium text-ink">{title}</p>
        <p className="text-sm text-ink-muted">{text}</p>
      </div>
    </li>
  );
}

function Waiting({ title, text, action }: { title: string; text: string; action?: React.ReactNode }) {
  return (
    <div className="flex flex-col items-center py-8 text-center" role="status" aria-live="polite">
      <span className="h-10 w-10 animate-spin rounded-full border-[3px] border-track border-t-accent" aria-hidden />
      <p className="mt-5 text-base font-semibold text-ink">{title}</p>
      <p className="mt-1 max-w-sm text-sm text-ink-muted">{text}</p>
      {action !== undefined && <div className="mt-6">{action}</div>}
    </div>
  );
}

function Message({
  tone,
  title,
  text,
  actions,
}: {
  tone: 'info' | 'danger';
  title: string;
  text: string;
  actions: React.ReactNode;
}) {
  return (
    <div className="py-2">
      <Alert tone={tone} className="px-4 py-4">
        <p className="font-semibold text-ink">{title}</p>
        <p className="mt-1 text-ink-muted">{text}</p>
      </Alert>
      <div className="mt-6 flex justify-end gap-2">{actions}</div>
    </div>
  );
}

function RemovingStep({
  preview,
  total,
  progress,
}: {
  preview: UninstallPreview;
  total: number;
  progress: RemovalProgress;
}) {
  const labels = useMemo(() => new Map(preview.items.map((item) => [item.id, item.label])), [preview.items]);
  const count = Math.min(progress.count, total);
  return (
    <div className="py-4" role="status" aria-live="polite">
      <div className="flex items-center gap-3">
        <span
          className="h-6 w-6 shrink-0 animate-spin rounded-full border-[3px] border-track border-t-accent"
          aria-hidden
        />
        <div className="min-w-0">
          <p className="text-base font-semibold text-ink">
            Removing {formatCount(count)} of {formatCount(total)}
          </p>
          <p className="text-sm text-ink-muted">Registry entries are backed up first.</p>
        </div>
      </div>
      <Meter value={count} max={total} label="Removal progress" className="mt-5 h-1.5" />
      {progress.recent.length > 0 && (
        <ul className="mt-4 space-y-1.5">
          {[...progress.recent].reverse().map((entry) => (
            <li key={entry.itemId} className="flex items-baseline justify-between gap-3 text-xs">
              <span className="min-w-0 truncate text-ink">{labels.get(entry.itemId) ?? entry.itemId}</span>
              <span className={`shrink-0 ${entry.status === 'failed' ? 'text-grade-danger' : 'text-ink-muted'}`}>
                {ITEM_STATUS_TEXT[entry.status] ?? entry.status}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function ReviewStep({
  app,
  preview,
  origin,
  elevated,
  onClose,
  onRelaunch,
  onRemove,
}: {
  app: UninstallAppSummary;
  preview: UninstallPreview;
  origin: Origin;
  elevated: boolean;
  onClose: () => void;
  onRelaunch: () => Promise<void>;
  onRemove: (selected: ReadonlySet<string>, includeUserData: boolean) => void;
}) {
  const [selected, setSelected] = useState<ReadonlySet<string>>(
    () => new Set(preview.items.filter((item) => item.defaultSelected).map((item) => item.id)),
  );
  const [relaunching, setRelaunching] = useState(false);
  const [relaunchError, setRelaunchError] = useState<string | null>(null);
  const hasUserData = preview.items.some((item) => item.dataClass === 'user-data');
  const selectedItems = preview.items.filter((item) => selected.has(item.id));
  const selectedBytes = selectedItems.reduce((sum, item) => sum + (item.bytes ?? 0), 0);
  const includeUserData = selectedItems.some((item) => item.dataClass === 'user-data');
  const grouped = useMemo(
    () =>
      GROUPS.map((group) => ({ ...group, items: preview.items.filter((item) => item.kind === group.kind) })).filter(
        (group) => group.items.length > 0,
      ),
    [preview.items],
  );

  const toggle = (id: string) =>
    setSelected((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  // Review-grade and user-data items start unselected; "Select all" is the
  // explicit opt-in to them, and their badges stay visible on every row.
  const setGroup = (items: readonly UninstallItemPreview[], on: boolean) =>
    setSelected((current) => {
      const next = new Set(current);
      for (const item of items) {
        if (on) next.add(item.id);
        else next.delete(item.id);
      }
      return next;
    });

  // The elevated instance starts from the app id alone: it rebuilds the plan and
  // can't see leftovers of an app that is already uninstalled. So the relaunch
  // is only offered while the app is still registered.
  const canRelaunch = origin !== 'uninstalled';
  const relaunch = () => {
    setRelaunching(true);
    setRelaunchError(null);
    onRelaunch()
      .catch((cause: unknown) => setRelaunchError(cause instanceof Error ? cause.message : String(cause)))
      .finally(() => setRelaunching(false));
  };

  if (preview.items.length === 0) {
    return (
      <div className="flex flex-col items-center py-8 text-center">
        <span className="flex h-12 w-12 items-center justify-center rounded-full bg-grade-safe-soft text-grade-safe">
          <CheckIcon className="h-6 w-6" />
        </span>
        <p className="mt-4 text-base font-semibold text-ink">Nothing left behind</p>
        <p className="mt-1 text-sm text-ink-muted">
          {origin === 'uninstalled'
            ? `${app.displayName} is fully removed.`
            : origin === 'still-installed'
              ? `No leftovers found. ${app.displayName} is still installed.`
              : 'No leftovers found.'}
        </p>
        <Button className="mt-6" onClick={onClose}>
          Done
        </Button>
      </div>
    );
  }

  return (
    <div>
      <p className="text-sm text-ink-muted">
        {app.displayName} left these behind. Items marked <Badge tone="review">Check first</Badge> may hold your
        settings or data, so they are not selected.
      </p>
      {!elevated && preview.items.some((item) => item.adminRequired) && (
        <Alert
          className="mt-3"
          action={
            canRelaunch ? (
              <Button size="sm" disabled={relaunching} onClick={relaunch}>
                Relaunch as administrator
              </Button>
            ) : undefined
          }
        >
          Some items need administrator rights and will be skipped.
          {canRelaunch ? ' Relaunch Dust as administrator to remove them.' : ''}
        </Alert>
      )}
      {relaunchError !== null && (
        <Alert tone="danger" className="mt-3">
          {relaunchError}
        </Alert>
      )}

      {grouped.map((group) => (
        <section key={group.kind} className="mt-6">
          <div className="mb-2 flex items-center justify-between gap-3">
            <h3 className="text-xs font-semibold uppercase tracking-[0.12em] text-ink-muted">{group.title}</h3>
            <div className="flex gap-1">
              <Button
                variant="ghost"
                size="sm"
                aria-label={`Select all ${group.title.toLowerCase()}`}
                disabled={group.items.every((item) => selected.has(item.id))}
                onClick={() => setGroup(group.items, true)}
              >
                Select all
              </Button>
              <Button
                variant="ghost"
                size="sm"
                aria-label={`Select none of ${group.title.toLowerCase()}`}
                disabled={group.items.every((item) => !selected.has(item.id))}
                onClick={() => setGroup(group.items, false)}
              >
                Select none
              </Button>
            </div>
          </div>
          <ul className="divide-y divide-hairline overflow-hidden rounded-xl border border-hairline">
            {group.items.map((item) => (
              <li key={item.id}>
                <label className="flex cursor-pointer items-start gap-3 px-4 py-3 hover:bg-surface-hover">
                  <input
                    type="checkbox"
                    checked={selected.has(item.id)}
                    onChange={() => toggle(item.id)}
                    className="mt-1 h-4 w-4 shrink-0 accent-accent"
                  />
                  <span className="min-w-0 flex-1">
                    <span className="flex flex-wrap items-center gap-2">
                      <span className="text-sm font-medium text-ink">{item.label}</span>
                      {item.grade === 'review' && <Badge tone="review">Check first</Badge>}
                      {item.dataClass === 'user-data' && <Badge>Your data</Badge>}
                    </span>
                    <span className="mt-0.5 block break-all font-mono text-xs text-ink-muted">{item.target}</span>
                    {item.evidence[0] !== undefined && (
                      <span className="mt-0.5 block text-xs text-ink-muted">{item.evidence[0]}</span>
                    )}
                  </span>
                  {item.bytes !== null && (
                    <span className="shrink-0 font-mono text-xs text-ink-muted">{formatBytes(item.bytes)}</span>
                  )}
                </label>
              </li>
            ))}
          </ul>
        </section>
      ))}

      <div className="sticky bottom-0 -mx-7 -mb-7 mt-6 flex items-center justify-between gap-3 border-t border-hairline bg-surface px-7 py-4">
        <p className="text-sm text-ink-muted">
          {formatCount(selected.size)} selected{selectedBytes > 0 ? ` · ${formatBytes(selectedBytes)}` : ''}
          {hasUserData && includeUserData ? ' · includes your data' : ''}
        </p>
        <div className="flex gap-2">
          <Button onClick={onClose}>Keep everything</Button>
          <Button variant="primary" disabled={selected.size === 0} onClick={() => onRemove(selected, includeUserData)}>
            Remove selected
          </Button>
        </div>
      </div>
    </div>
  );
}

function DoneStep({
  app,
  step,
  onClose,
}: {
  app: UninstallAppSummary;
  step: Extract<Step, { name: 'done' }>;
  onClose: () => void;
}) {
  const report = step.report;
  const problems =
    report === null ? 0 : report.files.errors.length + report.registry.failedKeys.length + report.startup.failed.length;
  const locked = report?.files.skippedLocked ?? 0;
  const freed = step.freed > 0 ? `, and ${formatBytes(step.freed)} freed` : '';
  const headline =
    step.removed === 0
      ? 'No leftovers were removed.'
      : step.origin === 'uninstalled'
        ? `Done. ${app.displayName} is removed${step.freed > 0 ? `, and ${formatBytes(step.freed)} of leftovers freed` : ''}.`
        : step.origin === 'still-installed'
          ? `Leftovers removed${freed}. ${app.displayName} is still installed.`
          : `Leftovers removed${freed}.`;
  return (
    <div className="flex flex-col items-center py-6 text-center">
      <span className="flex h-12 w-12 items-center justify-center rounded-full bg-grade-safe-soft text-grade-safe">
        <CheckIcon className="h-6 w-6" />
      </span>
      <p className="mt-4 text-base font-semibold text-ink">{headline}</p>
      <p className="mt-1 text-sm text-ink-muted">
        {formatCount(step.removed)} {step.removed === 1 ? 'item' : 'items'} removed.
        {report !== null && report.files.recycledItems > 0 ? ' Items you checked first went to the Recycle Bin.' : ''}
      </p>
      {(problems > 0 || locked > 0) && (
        <Alert className="mt-4 text-left">
          {problems > 0 ? `${formatCount(problems)} could not be removed. ` : ''}
          {locked > 0 ? `${formatCount(locked)} files were in use and were skipped.` : ''}
        </Alert>
      )}
      {report !== null && report.registry.backupPath.length > 0 && (
        <p className="mt-3 max-w-md break-all text-xs text-ink-muted">
          Registry backup: <span className="font-mono">{report.registry.backupPath}</span>
        </p>
      )}
      <Button className="mt-6" variant="primary" onClick={onClose}>
        Done
      </Button>
    </div>
  );
}
