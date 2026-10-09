import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import type {
  RemovalReport,
  UninstallAppSummary,
  UninstallItemPreview,
  UninstallPreview,
  UninstallRunOutcome,
} from '../../../../src/shared/ipc';
import { useApi } from '../../lib/api';
import { formatBytes, formatCount } from '../../lib/format';
import { useAppsStore } from '../../stores/apps';
import { Badge, GradePill } from '../../ui/Badge';
import { Button, Spinner } from '../../ui/Button';
import { Checkbox } from '../../ui/Checkbox';
import { Dialog } from '../../ui/Dialog';
import { SuccessIcon } from '../../ui/icons';
import { Notice } from '../../ui/Notice';
import { ProgressBar } from '../../ui/ProgressBar';

// Two-step removal, the way dedicated uninstallers work: run the app's own uninstaller first, then look for what it
// left behind and let the user choose what to remove. Nothing is deleted before the review step.

export interface UninstallWizardProps {
  open: boolean;
  onClose: () => void;
  app: UninstallAppSummary;
  elevated: boolean;
  /** Called once, as soon as something about the installed apps may have changed. */
  onChanged: () => void;
}

// How the user reached the leftover scan decides what "done" may claim: only after a verified uninstall is the app
// itself gone.
type Origin = 'uninstalled' | 'still-installed' | 'leftovers-only';

type Step =
  | { name: 'confirm' }
  | { name: 'running' }
  | { name: 'still-installed'; message: string | null }
  | { name: 'reboot' }
  | { name: 'scanning' }
  | { name: 'review'; preview: UninstallPreview; origin: Origin }
  | { name: 'removing'; preview: UninstallPreview; total: number; jobId: string }
  | { name: 'done'; report: RemovalReport; origin: Origin }
  | { name: 'error'; message: string };

const CAUTION_COPY: Record<NonNullable<UninstallAppSummary['caution']>, string> = {
  hardware: 'This is driver or hardware software. Removing it can affect your graphics, sound or network.',
  security: 'This is security software. Make sure another antivirus is active before you remove it.',
  runtime: 'Other apps may need this to start. Remove it only if you know nothing uses it.',
};

const GROUPS: Array<{ kind: UninstallItemPreview['kind']; title: string }> = [
  { kind: 'file', title: 'Files and folders' },
  { kind: 'registry', title: 'Registry entries' },
  { kind: 'startup', title: 'Startup entries' },
];

const BUSY_TEXT = 'Another scan or removal is running. Try again when it finishes.';

function newJobId(): string {
  return typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : `job-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function errorText(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause);
}

function Waiting({ title, text, action }: { title: string; text: string; action?: ReactNode }) {
  return (
    <div className="flex flex-col items-center gap-2 py-6 text-center" role="status">
      <Spinner className="size-8 text-accent" />
      <p className="mt-2 text-body font-semibold">{title}</p>
      <p className="max-w-sm text-body text-ink-2">{text}</p>
      {action !== undefined ? <div className="mt-3">{action}</div> : null}
    </div>
  );
}

function StepLine({ number, title, text }: { number: number; title: string; text: string }) {
  return (
    <li className="flex gap-3">
      <span className="flex size-6 shrink-0 items-center justify-center rounded-full bg-accent-soft text-caption font-semibold text-accent-hover">
        {number}
      </span>
      <div>
        <p className="text-body font-semibold">{title}</p>
        <p className="text-body text-ink-2">{text}</p>
      </div>
    </li>
  );
}

/** What was removed, counted from the report so the wording never claims more than happened. */
function removedCount(report: RemovalReport): number {
  return (
    report.files.deletedItems +
    report.files.recycledItems +
    report.registry.deletedKeys.length +
    report.startup.disabled.length
  );
}

function ReviewBody({
  app,
  preview,
  origin,
  elevated,
  selected,
  onSelected,
  onRelaunch,
  relaunching,
  relaunchError,
}: {
  app: UninstallAppSummary;
  preview: UninstallPreview;
  origin: Origin;
  elevated: boolean;
  selected: ReadonlySet<string>;
  onSelected: (next: ReadonlySet<string>) => void;
  onRelaunch: () => void;
  relaunching: boolean;
  relaunchError: string | null;
}) {
  const grouped = useMemo(
    () =>
      GROUPS.map((group) => ({ ...group, items: preview.items.filter((item) => item.kind === group.kind) })).filter(
        (group) => group.items.length > 0,
      ),
    [preview.items],
  );
  const setItems = (items: ReadonlyArray<UninstallItemPreview>, on: boolean) => {
    const next = new Set(selected);
    for (const item of items) {
      if (on) next.add(item.id);
      else next.delete(item.id);
    }
    onSelected(next);
  };
  // The elevated copy starts from the app id alone and rebuilds the plan, so it cannot see the leftovers of an app
  // that is already uninstalled. The relaunch is only offered while the app is still registered.
  const canRelaunch = origin !== 'uninstalled';

  if (preview.items.length === 0) {
    return (
      <div className="flex flex-col items-center gap-2 py-6 text-center">
        <SuccessIcon className="size-8 text-safe" aria-hidden="true" />
        <p className="text-body font-semibold">Nothing left behind</p>
        <p className="text-body text-ink-2">
          {origin === 'uninstalled'
            ? `${app.displayName} is fully removed.`
            : origin === 'still-installed'
              ? `No leftovers found. ${app.displayName} is still installed.`
              : 'No leftovers found.'}
        </p>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <p className="text-body text-ink-2">
        {app.displayName} left these behind. Items marked <GradePill grade="review" /> may hold your settings or data,
        so they start unticked.
      </p>
      {!elevated && preview.items.some((item) => item.adminRequired) ? (
        <Notice
          action={
            canRelaunch ? (
              <Button variant="secondary" loading={relaunching} onClick={onRelaunch}>
                Relaunch as administrator
              </Button>
            ) : undefined
          }
        >
          Some items need administrator rights and will be left alone.
          {canRelaunch ? ' Relaunch Dust as administrator to remove them.' : ''}
        </Notice>
      ) : null}
      {relaunchError !== null ? <Notice variant="warning">{relaunchError}</Notice> : null}
      {grouped.map((group) => (
        <section key={group.kind} aria-label={group.title} className="flex flex-col gap-2">
          <div className="flex items-center justify-between gap-3">
            <h3 className="text-body font-semibold">{group.title}</h3>
            <div className="flex gap-1">
              <Button
                variant="subtle"
                aria-label={`Select all ${group.title.toLowerCase()}`}
                disabled={group.items.every((item) => selected.has(item.id))}
                onClick={() => setItems(group.items, true)}
              >
                Select all
              </Button>
              <Button
                variant="subtle"
                aria-label={`Select none of ${group.title.toLowerCase()}`}
                disabled={group.items.every((item) => !selected.has(item.id))}
                onClick={() => setItems(group.items, false)}
              >
                Select none
              </Button>
            </div>
          </div>
          <ul className="divide-y divide-border overflow-hidden rounded-control border border-border">
            {group.items.map((item) => (
              <li key={item.id} className="flex items-start gap-3 px-3 py-2">
                <Checkbox
                  checked={selected.has(item.id)}
                  onCheckedChange={(on) => setItems([item], on)}
                  aria-label={`Select ${item.label}`}
                  className="mt-0.5"
                />
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="min-w-0 text-body font-semibold break-all">{item.label}</span>
                    {item.grade === 'review' ? <GradePill grade="review" /> : null}
                    {item.dataClass === 'user-data' ? <Badge>Your data</Badge> : null}
                  </div>
                  {item.target !== item.label ? (
                    <p className="font-mono text-caption break-all text-ink-2">{item.target}</p>
                  ) : null}
                  {item.evidence[0] !== undefined ? (
                    <p className="text-caption text-ink-2">{item.evidence[0]}</p>
                  ) : null}
                </div>
                {item.bytes !== null ? (
                  <span className="shrink-0 text-caption tabular-nums text-ink-2">{formatBytes(item.bytes)}</span>
                ) : null}
              </li>
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}

function DoneBody({ app, report, origin }: { app: UninstallAppSummary; report: RemovalReport; origin: Origin }) {
  const removed = removedCount(report);
  const freed = report.files.deletedBytes;
  const problems = report.files.errors.length + report.registry.failedKeys.length + report.startup.failed.length;
  const locked = report.files.skippedLocked;
  const freedText = freed > 0 ? `, and ${formatBytes(freed)} freed` : '';
  const headline =
    removed === 0
      ? 'No leftovers were removed.'
      : origin === 'uninstalled'
        ? `${app.displayName} is removed${freed > 0 ? `, and ${formatBytes(freed)} of leftovers freed` : ''}.`
        : origin === 'still-installed'
          ? `Leftovers removed${freedText}. ${app.displayName} is still installed.`
          : `Leftovers removed${freedText}.`;
  return (
    <div className="flex flex-col gap-3">
      <div role="status" className="flex items-center gap-3">
        <SuccessIcon className="size-8 shrink-0 text-safe" aria-hidden="true" />
        <div>
          <p className="text-body font-semibold">{headline}</p>
          <p className="text-body text-ink-2">
            {formatCount(removed)} {removed === 1 ? 'item' : 'items'} removed.
            {report.files.recycledItems > 0 ? ' Items marked Review went to the Recycle Bin.' : ''}
          </p>
        </div>
      </div>
      {problems > 0 || locked > 0 ? (
        <Notice variant="warning">
          {problems > 0 ? `${formatCount(problems)} could not be removed. ` : ''}
          {locked > 0 ? `${formatCount(locked)} files were in use and were left alone.` : ''}
        </Notice>
      ) : null}
      {report.registry.backupPath.length > 0 ? (
        <p className="text-caption break-all text-ink-2">
          Registry backup: <span className="font-mono">{report.registry.backupPath}</span>
        </p>
      ) : null}
    </div>
  );
}

export function UninstallWizard({ open, onClose, app, elevated, onChanged }: UninstallWizardProps) {
  const api = useApi();
  const [step, setStep] = useState<Step>(app.hasUninstaller ? { name: 'confirm' } : { name: 'scanning' });
  const [quiet, setQuiet] = useState(false);
  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set());
  const [relaunching, setRelaunching] = useState(false);
  const [relaunchError, setRelaunchError] = useState<string | null>(null);
  const changed = useRef(false);
  const safeRef = useRef<HTMLButtonElement>(null);
  const mounted = useRef(true);
  const started = useRef(false);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const markChanged = useCallback(() => {
    if (changed.current) return;
    changed.current = true;
    onChanged();
  }, [onChanged]);

  const scanLeftovers = useCallback(
    async (origin: Origin) => {
      setStep({ name: 'scanning' });
      try {
        const result = await api.previewUninstall(app.id, { leftoversOnly: true });
        if (!mounted.current) return;
        if (!result.ok) {
          setStep({ name: 'error', message: result.reason === 'busy' ? BUSY_TEXT : result.message });
          return;
        }
        setSelected(new Set(result.preview.items.filter((item) => item.defaultSelected).map((item) => item.id)));
        setStep({ name: 'review', preview: result.preview, origin });
      } catch (cause) {
        if (mounted.current) setStep({ name: 'error', message: errorText(cause) });
      }
    },
    [api, app.id],
  );

  // An app without a working uninstaller goes straight to the leftover scan.
  useEffect(() => {
    if (started.current || app.hasUninstaller) return;
    started.current = true;
    void scanLeftovers('leftovers-only');
  }, [app.hasUninstaller, scanLeftovers]);

  const runUninstaller = useCallback(async () => {
    setStep({ name: 'running' });
    try {
      const result = await api.runUninstaller({ jobId: newJobId(), appId: app.id, quiet });
      markChanged();
      if (!mounted.current) return;
      if (!result.ok) {
        setStep(
          result.reason === 'busy'
            ? { name: 'error', message: BUSY_TEXT }
            : { name: 'still-installed', message: result.message },
        );
        return;
      }
      const outcome: UninstallRunOutcome = result.outcome;
      if (outcome.rebootRequired) setStep({ name: 'reboot' });
      else if (!outcome.verifiedGone) setStep({ name: 'still-installed', message: null });
      else await scanLeftovers('uninstalled');
    } catch (cause) {
      if (mounted.current) setStep({ name: 'error', message: errorText(cause) });
    }
  }, [api, app.id, markChanged, quiet, scanLeftovers]);

  const remove = useCallback(
    async (preview: UninstallPreview, origin: Origin) => {
      const jobId = newJobId();
      const chosen = preview.items.filter((item) => selected.has(item.id));
      setStep({ name: 'removing', preview, total: chosen.length, jobId });
      try {
        const result = await api.executeUninstall({
          jobId,
          planId: preview.planId,
          selection: chosen.map((item) => item.id),
          includeUserData: chosen.some((item) => item.dataClass === 'user-data'),
          runUninstaller: false,
          quiet: false,
          acknowledge: chosen.filter((item) => item.grade === 'review').map((item) => item.id),
        });
        markChanged();
        if (!mounted.current) return;
        if (!result.ok) {
          setStep({
            name: 'error',
            message: result.reason === 'busy' ? BUSY_TEXT : (result.message ?? 'Nothing was removed.'),
          });
          return;
        }
        setStep({ name: 'done', report: result.report, origin });
      } catch (cause) {
        if (mounted.current) setStep({ name: 'error', message: errorText(cause) });
      }
    },
    [api, markChanged, selected],
  );

  const relaunch = (planId: string) => {
    setRelaunching(true);
    setRelaunchError(null);
    api
      .relaunchElevatedUninstall(planId)
      .catch((cause: unknown) => {
        if (mounted.current) setRelaunchError(errorText(cause));
      })
      .finally(() => {
        if (mounted.current) setRelaunching(false);
      });
  };

  // The first control of every step is the safe choice (Cancel, Close, Keep everything); focus goes there.
  useEffect(() => {
    safeRef.current?.focus();
  }, [step.name]);

  const job = useAppsStore((state) => (step.name === 'removing' ? state.jobs[step.jobId] : undefined));

  const busy = step.name === 'running' || step.name === 'scanning' || step.name === 'removing';
  let body: ReactNode;
  let footer: ReactNode;
  let description: string | undefined;

  switch (step.name) {
    case 'confirm':
      description = 'Nothing is deleted until you choose what to remove.';
      body = (
        <div className="flex flex-col gap-4">
          <ol className="flex flex-col gap-3">
            <StepLine number={1} title="Run the app's own uninstaller" text="The same one Windows Settings uses." />
            <StepLine
              number={2}
              title="Find what it left behind"
              text="Folders, registry entries and startup entries."
            />
            <StepLine number={3} title="You choose what to remove" text="Nothing extra is deleted until you confirm." />
          </ol>
          {app.caution !== null ? <Notice variant="warning">{CAUTION_COPY[app.caution]}</Notice> : null}
          {app.kind === 'msi' ? (
            <Checkbox
              checked={quiet}
              onCheckedChange={setQuiet}
              label="Uninstall quietly, without the uninstaller's windows"
            />
          ) : null}
        </div>
      );
      footer = (
        <>
          <Button ref={safeRef} variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="primary" onClick={() => void runUninstaller()}>
            Uninstall
          </Button>
        </>
      );
      break;
    case 'running':
      body = (
        <Waiting
          title={`Running the ${app.displayName} uninstaller`}
          text={
            quiet ? 'It runs quietly in the background.' : 'Finish the steps in its window. Dust waits until it closes.'
          }
          action={
            <Button variant="secondary" onClick={() => void api.skipUninstallWaiting()}>
              It has finished
            </Button>
          }
        />
      );
      footer = null;
      break;
    case 'scanning':
      body = (
        <Waiting
          title="Looking for leftovers"
          text="Folders, registry entries and startup entries the app left behind."
        />
      );
      footer = null;
      break;
    case 'reboot':
      description = undefined;
      body = (
        <Notice>
          The {app.displayName} uninstaller needs a restart. After restarting, open Apps again to clear anything it left
          behind.
        </Notice>
      );
      footer = (
        <Button ref={safeRef} variant="primary" onClick={onClose}>
          Close
        </Button>
      );
      break;
    case 'still-installed':
      body = (
        <Notice>
          {step.message ??
            'The uninstaller closed but the app is still registered. If you cancelled it, nothing was removed. You can still look for leftover files.'}
        </Notice>
      );
      footer = (
        <>
          <Button ref={safeRef} variant="secondary" onClick={onClose}>
            Close
          </Button>
          <Button variant="primary" onClick={() => void scanLeftovers('still-installed')}>
            Look for leftovers
          </Button>
        </>
      );
      break;
    case 'review': {
      const { preview, origin } = step;
      const chosen = preview.items.filter((item) => selected.has(item.id));
      const bytes = chosen.reduce((sum, item) => sum + (item.bytes ?? 0), 0);
      body = (
        <ReviewBody
          app={app}
          preview={preview}
          origin={origin}
          elevated={elevated}
          selected={selected}
          onSelected={setSelected}
          onRelaunch={() => relaunch(preview.planId)}
          relaunching={relaunching}
          relaunchError={relaunchError}
        />
      );
      footer =
        preview.items.length === 0 ? (
          <Button ref={safeRef} variant="primary" onClick={onClose}>
            Done
          </Button>
        ) : (
          <>
            <span className="mr-auto self-center text-body text-ink-2" aria-live="polite">
              {formatCount(chosen.length)} selected{bytes > 0 ? ` · ${formatBytes(bytes)}` : ''}
              {chosen.some((item) => item.dataClass === 'user-data') ? ' · includes your data' : ''}
            </span>
            <Button ref={safeRef} variant="secondary" onClick={onClose}>
              Keep everything
            </Button>
            <Button variant="danger" disabled={chosen.length === 0} onClick={() => void remove(preview, origin)}>
              Remove {chosen.length === 0 ? 'selected' : bytes > 0 ? formatBytes(bytes) : `${chosen.length} selected`}
            </Button>
          </>
        );
      break;
    }
    case 'removing': {
      const done = Math.min(job?.itemsDone ?? 0, step.total);
      description = 'Registry entries are backed up first.';
      body = (
        <div role="status" className="flex flex-col gap-3">
          <p className="text-body">
            Removing {formatCount(done)} of {formatCount(step.total)}
          </p>
          <ProgressBar value={step.total === 0 ? null : done / step.total} label="Removing leftovers" />
        </div>
      );
      footer = (
        <Button variant="danger" loading>
          Removing
        </Button>
      );
      break;
    }
    case 'done':
      body = <DoneBody app={app} report={step.report} origin={step.origin} />;
      footer = (
        <Button ref={safeRef} variant="primary" onClick={onClose}>
          Done
        </Button>
      );
      break;
    case 'error':
      body = <Notice variant="warning">{step.message}</Notice>;
      footer = (
        <Button ref={safeRef} variant="primary" onClick={onClose}>
          Close
        </Button>
      );
      break;
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => !next && !busy && onClose()}
      title={step.name === 'done' ? 'Finished' : `Uninstall ${app.displayName}`}
      description={description}
      dismissible={!busy}
      initialFocus={safeRef}
      footer={footer}
      className="max-w-xl"
    >
      {body}
    </Dialog>
  );
}
