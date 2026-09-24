import { useCallback, useEffect, useMemo, useState } from 'react';
import type {
  CleanItemResult,
  CleanPreview,
  CleanReport,
  DevCleanupState,
  DevGroup,
  DevProject,
  DustApi,
} from '../../../src/shared/ipc';
import { CleanDialog } from '../components/CleanDialog';
import { CleanPlan } from '../components/CleanPlan';
import { CleanSummary } from '../components/CleanSummary';
import { RestorabilityPill } from '../components/GradePill';
import { ChevronRightIcon, PinIcon } from '../components/icons';
import { cleanErrorMessage, newCleanId } from '../clean';
import { formatBytes, formatRelativeTime } from '../format';

export interface DevCleanupViewProps {
  api: DustApi;
  root: string;
  onBack: () => void;
  onViewResults: (root: string) => void;
}

const FOCUS = 'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent';
const PRIMARY = `inline-flex items-center justify-center rounded-lg bg-accent px-5 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-accent-strong disabled:cursor-not-allowed disabled:opacity-45 ${FOCUS}`;
const SECONDARY = `inline-flex items-center justify-center rounded-lg border border-hairline bg-surface px-3.5 py-1.5 text-sm font-medium text-ink transition-colors hover:border-hairline-strong hover:bg-surface-hover disabled:cursor-not-allowed disabled:opacity-45 ${FOCUS}`;

const GROUP_ORDER = ['dead', 'occasional', 'active', 'orphaned', 'pinned'] as const;
const GROUP_TITLES: Record<DevGroup['id'], string> = {
  dead: 'Dead',
  occasional: 'Occasional',
  active: 'Active',
  orphaned: 'Orphaned node_modules',
  pinned: 'Pinned',
};

const BAND_LEGEND = [
  { id: 'dead', detail: '180+ days' },
  { id: 'occasional', detail: '31–180 days' },
  { id: 'active', detail: '30 days or less' },
  { id: 'orphaned', detail: 'no parent project' },
  { id: 'pinned', detail: 'excluded from cleanup' },
] as const;

export function DevCleanupView({ api, root, onBack, onViewResults }: DevCleanupViewProps) {
  const [state, setState] = useState<DevCleanupState | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set());
  const [collapsed, setCollapsed] = useState<ReadonlySet<string>>(new Set());
  const [preview, setPreview] = useState<CleanPreview | null>(null);
  const [report, setReport] = useState<CleanReport | null>(null);
  const [acknowledge, setAcknowledge] = useState(false);
  const [busy, setBusy] = useState(false);
  const [cleanId, setCleanId] = useState<string | null>(null);
  const [progress, setProgress] = useState<CleanItemResult[]>([]);

  const load = useCallback(() => {
    api
      .getDevCleanup(root)
      .then(setState)
      .catch((cause: unknown) => setError(cause instanceof Error ? cause.message : String(cause)));
  }, [api, root]);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    if (cleanId === null) return;
    return api.onScanEvent((event) => {
      if (event.type === 'clean-item' && event.cleanId === cleanId) {
        setProgress((current) => [...current, event.item]);
      }
    });
  }, [api, cleanId]);

  const projects = useMemo(
    () => (state === null ? [] : state.groups.flatMap((group) => group.projects)),
    [state],
  );
  const selectedBytes = useMemo(
    () =>
      projects
        .filter((project) => selected.has(project.path))
        .reduce((sum, project) => sum + project.nodeModulesBytes, 0),
    [projects, selected],
  );
  const groups = useMemo(() => {
    if (state === null) return [];
    return [...state.groups].sort(
      (a, b) => GROUP_ORDER.indexOf(a.id) - GROUP_ORDER.indexOf(b.id),
    );
  }, [state]);

  const toggle = useCallback((path: string) => {
    setSelected((current) => {
      const next = new Set(current);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      return next;
    });
  }, []);

  const toggleGroup = useCallback((id: string) => {
    setCollapsed((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const selectDeadGreen = useCallback(() => {
    if (state === null) return;
    const dead = state.groups.find((group) => group.id === 'dead');
    const paths = (dead?.projects ?? [])
      .filter((project) => project.offered && project.grade === 'green')
      .map((project) => project.path);
    setSelected(new Set(paths));
  }, [state]);

  const setPin = useCallback(
    async (path: string, pinned: boolean) => {
      const result = await api.setPin(path, pinned);
      if (result.ok) load();
      else setError(result.message);
    },
    [api, load],
  );

  const review = useCallback(async () => {
    setError(null);
    const result = await api.previewClean({ scope: 'dev', root, paths: [...selected] });
    if (result.ok) {
      setPreview(result.preview);
      setAcknowledge(false);
    } else {
      setError(cleanErrorMessage(result));
    }
  }, [api, root, selected]);

  const confirm = useCallback(async () => {
    if (preview === null) return;
    const id = newCleanId();
    setBusy(true);
    setError(null);
    setCleanId(id);
    setProgress([]);
    try {
      const result = await api.executeClean({
        cleanId: id,
        planId: preview.planId,
        acknowledge: preview.items.filter((item) => item.grade === 'review').map((item) => item.path),
      });
      if (result.ok) {
        setReport(result.report);
        setPreview(null);
        setSelected(new Set());
        load();
      } else {
        setError(cleanErrorMessage(result));
      }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(false);
      setCleanId(null);
    }
  }, [api, load, preview]);

  const closeModal = useCallback(() => {
    if (report !== null) {
      setReport(null);
      load();
    } else {
      setPreview(null);
    }
  }, [report, load]);

  if (state === null) {
    return (
      <main className="dust-dashboard flex min-h-screen items-center justify-center bg-canvas px-6 text-sm text-ink-muted">
        {error ?? 'Loading projects.'}
      </main>
    );
  }

  const empty = state.source === 'empty';

  return (
    <main className="dust-dashboard flex min-h-screen flex-col bg-canvas text-ink">
      <header className="mx-auto w-full max-w-5xl px-6 pt-10 sm:px-8 sm:pt-12">
        <h1 className="text-2xl font-semibold tracking-tight text-ink">Dev Cleanup</h1>
        <p className="mt-1.5 text-sm text-ink-muted">
          <span className="font-mono text-ink">{root}</span>
          {state.finishedAt !== null && (
            <>
              <span className="mx-2 text-ink-muted/60" aria-hidden="true">
                ·
              </span>
              analyzed {formatRelativeTime(state.finishedAt)}
            </>
          )}
        </p>
        {!empty && (
          <p className="mt-2 text-xs text-ink-muted">
            Bands by last activity:{' '}
            {BAND_LEGEND.map((band, index) => (
              <span key={band.id}>
                {index > 0 && <span className="mx-1.5" aria-hidden="true">·</span>}
                <span className="font-medium text-ink">{GROUP_TITLES[band.id]}</span> — {band.detail}
              </span>
            ))}
          </p>
        )}
      </header>

      {empty ? (
        <div className="mx-auto w-full max-w-5xl flex-1 px-6 pt-8 sm:px-8">
          <p className="rounded-xl border border-hairline bg-surface px-4 py-14 text-center text-sm text-ink-muted">
            No scan data for this volume — run an Analyze from the dashboard first.
          </p>
        </div>
      ) : (
        <>
          <div className="sticky top-0 z-20 mt-6 border-b border-hairline bg-surface/95 backdrop-blur">
            <div className="mx-auto flex max-w-5xl flex-wrap items-center justify-between gap-x-4 gap-y-2 px-6 py-3 sm:px-8">
              <button type="button" onClick={selectDeadGreen} className={SECONDARY}>
                Select all Dead + green
              </button>
              <div className="flex flex-wrap items-center justify-end gap-x-3 gap-y-2">
                <p className="font-mono text-sm text-ink-muted">{`${selected.size} selected · ${formatBytes(selectedBytes)}`}</p>
                <button
                  type="button"
                  disabled={selected.size === 0 || busy}
                  onClick={() => void review()}
                  className={PRIMARY}
                >
                  {`Clean Selected (${selected.size})`}
                </button>
              </div>
            </div>
          </div>

          <div className="mx-auto w-full max-w-5xl flex-1 px-6 pb-14 pt-8 sm:px-8">
            {error !== null && preview === null && report === null && (
              <p role="alert" className="mb-6 rounded-lg border border-notice-border bg-notice px-3.5 py-2.5 text-sm text-ink">
                {error}
              </p>
            )}

            {busy && progress.length > 0 && (
              <ul
                role="status"
                className="mb-6 space-y-1 rounded-xl border border-hairline bg-surface px-4 py-3 text-sm text-ink-muted"
              >
                {progress.map((item) => (
                  <li key={item.path} className="truncate font-mono text-xs">
                    {item.path} — {item.status}
                  </li>
                ))}
              </ul>
            )}

            <div className="space-y-8">
              {groups.map((group) => (
                <GroupLedger
                  key={group.id}
                  group={group}
                  collapsed={collapsed.has(group.id)}
                  onToggle={() => toggleGroup(group.id)}
                  selected={selected}
                  onToggleProject={toggle}
                  onPin={(path, pinned) => void setPin(path, pinned)}
                  busy={busy}
                />
              ))}
            </div>

            {state.recentlyCleaned.length > 0 && (
              <details className="mt-10 overflow-hidden rounded-xl border border-hairline bg-surface">
                <summary className="cursor-pointer px-4 py-3 text-sm font-medium text-ink transition-colors hover:bg-canvas/60">
                  Recently cleaned ({state.recentlyCleaned.length})
                </summary>
                <div className="border-t border-hairline">
                  <ul className="divide-y divide-hairline">
                    {state.recentlyCleaned.map((entry) => (
                      <li key={entry.path} className="px-4 py-3">
                        <div className="flex items-baseline justify-between gap-3">
                          <p className="min-w-0 truncate text-sm text-ink">{entry.name}</p>
                          <p className="shrink-0 font-mono text-xs text-ink-muted">
                            {formatBytes(entry.bytes)} freed · {formatRelativeTime(entry.cleanedAt)}
                          </p>
                        </div>
                        <p className="mt-1 break-all font-mono text-xs text-ink-muted">{entry.path}</p>
                        {entry.restoreCommand !== null && (
                          <div className="mt-2 flex items-center justify-between gap-3">
                            <code className="min-w-0 break-all font-mono text-xs text-ink">{entry.restoreCommand}</code>
                            <button
                              type="button"
                              aria-label={`Copy command for ${entry.path}`}
                              onClick={() => {
                                void navigator.clipboard?.writeText(entry.restoreCommand ?? '').catch(() => {});
                              }}
                              className={SECONDARY}
                            >
                              Copy
                            </button>
                          </div>
                        )}
                      </li>
                    ))}
                  </ul>
                </div>
              </details>
            )}

            <div className="mt-10 flex flex-wrap gap-2">
              <button type="button" onClick={onBack} className={SECONDARY}>
                Back to dashboard
              </button>
              <button type="button" onClick={() => onViewResults(root)} className={SECONDARY}>
                View results
              </button>
            </div>
          </div>
        </>
      )}

      {(preview !== null || report !== null) && (
        <CleanDialog
          label={report !== null ? 'Cleanup complete' : 'Dev Cleanup'}
          onClose={closeModal}
          dismissible={!busy}
        >
          {report !== null ? (
            <CleanSummary report={report} onDone={closeModal} doneLabel="Back to projects" />
          ) : preview !== null ? (
            <CleanPlan
              preview={preview}
              acknowledge={acknowledge}
              onAcknowledge={setAcknowledge}
              onConfirm={() => void confirm()}
              onCancel={closeModal}
              onReveal={(target) => {
                void api.revealPath(target).catch(() => {});
              }}
              busy={busy}
              error={error}
            />
          ) : null}
        </CleanDialog>
      )}
    </main>
  );
}

interface GroupLedgerProps {
  group: DevGroup;
  collapsed: boolean;
  onToggle: () => void;
  selected: ReadonlySet<string>;
  onToggleProject: (path: string) => void;
  onPin: (path: string, pinned: boolean) => void;
  busy: boolean;
}

function GroupLedger({ group, collapsed, onToggle, selected, onToggleProject, onPin, busy }: GroupLedgerProps) {
  const expanded = !collapsed;
  const total = group.projects.reduce((sum, project) => sum + project.nodeModulesBytes, 0);

  return (
    <section
      aria-label={group.label}
      className="overflow-hidden rounded-2xl border border-hairline bg-surface shadow-[0_1px_2px_rgba(16,24,40,0.04)]"
    >
      <button
        type="button"
        aria-expanded={expanded}
        onClick={onToggle}
        className={`flex w-full items-center gap-3 px-4 py-3.5 text-left transition-colors hover:bg-canvas/60 ${FOCUS}`}
      >
        <ChevronRightIcon
          className={`h-4 w-4 shrink-0 text-ink-muted transition-transform duration-150 ${
            expanded ? 'rotate-90' : ''
          }`}
        />
        <span className="text-sm font-semibold text-ink">{GROUP_TITLES[group.id]}</span>
        <span className="text-sm text-ink-muted">{group.projects.length}</span>
        <span className="ml-auto font-mono text-sm tabular-nums text-ink">{formatBytes(total)}</span>
      </button>

      {expanded && (
        <>
          <div className="h-px w-full bg-hairline" aria-hidden="true" />
          {group.projects.length === 0 ? (
            <p className="px-4 py-4 text-sm text-ink-muted">Nothing here.</p>
          ) : (
            <ul className="divide-y divide-hairline">
              {group.projects.map((project) => (
                <ProjectRow
                  key={project.path}
                  project={project}
                  selected={selected.has(project.path)}
                  onToggle={onToggleProject}
                  onPin={onPin}
                  busy={busy}
                />
              ))}
            </ul>
          )}
        </>
      )}
    </section>
  );
}

interface ProjectRowProps {
  project: DevProject;
  selected: boolean;
  onToggle: (path: string) => void;
  onPin: (path: string, pinned: boolean) => void;
  busy: boolean;
}

function ProjectRow({ project, selected, onToggle, onPin, busy }: ProjectRowProps) {
  const pinned = project.pinned;
  const subline = project.offered
    ? project.restoreCommand !== null
      ? `Rebuild: ${project.restoreCommand}`
      : null
    : project.reasons.length > 0
      ? project.reasons.join(' · ')
      : 'Not offered for cleanup';

  return (
    <li
      className={`flex flex-col gap-1 px-4 py-2.5 transition-colors sm:grid sm:min-h-[44px] sm:grid-cols-[20px_minmax(0,2.4fr)_88px_auto_minmax(0,1.2fr)] sm:items-center sm:gap-3 sm:py-2 ${
        selected ? 'bg-accent-soft/50' : 'hover:bg-canvas/60'
      }`}
    >
      <div className="flex items-center gap-3 sm:contents">
        <div className="flex w-5 shrink-0 items-center justify-center">
          {pinned ? (
            <PinIcon className="h-4 w-4 text-ink-muted" />
          ) : project.offered ? (
            <input
              type="checkbox"
              aria-label={`Select ${project.name}`}
              checked={selected}
              disabled={busy}
              onChange={() => onToggle(project.path)}
              className={`h-4 w-4 rounded border-hairline accent-accent ${FOCUS} disabled:cursor-not-allowed disabled:opacity-40`}
            />
          ) : null}
        </div>

        <div className="min-w-0 flex-1 sm:flex-none">
          <p className={`truncate text-sm ${pinned ? 'text-ink-muted' : 'text-ink'}`} title={project.path}>
            {project.name}
          </p>
          {subline !== null && (
            <p className="mt-0.5 truncate font-mono text-xs text-ink-muted" title={subline}>
              {subline}
            </p>
          )}
        </div>

        <span
          className={`ml-auto shrink-0 text-right font-mono text-sm tabular-nums sm:ml-0 ${
            pinned ? 'text-ink-muted' : 'text-ink'
          }`}
        >
          {formatBytes(project.nodeModulesBytes)}
        </span>
      </div>

      <div className="flex items-center gap-3 pl-8 sm:contents sm:pl-0">
        <div className="flex justify-start">
          {pinned ? (
            <span className="rounded-full border border-hairline bg-canvas px-2.5 py-0.5 text-xs font-medium text-ink-muted">
              kept
            </span>
          ) : project.offered ? (
            <RestorabilityPill grade={project.grade === 'yellow' ? 'yellow' : 'green'} />
          ) : (
            <span className="rounded-full border border-hairline bg-canvas px-2.5 py-0.5 text-xs font-medium text-ink-muted">
              not offered
            </span>
          )}
        </div>

        <div className="flex min-w-0 flex-1 items-center justify-end gap-3 sm:flex-none">
          <span className="min-w-0 truncate text-xs text-ink-muted">{describeActivity(project)}</span>
          <button
            type="button"
            aria-label={`${pinned ? 'Unpin' : 'Keep'} ${project.name}`}
            onClick={() => onPin(project.path, !project.pinned)}
            className={`shrink-0 rounded-lg px-2 py-1 text-xs font-medium text-ink-muted transition-colors hover:bg-canvas hover:text-ink ${FOCUS}`}
          >
            {pinned ? 'Unpin' : 'Keep'}
          </button>
        </div>
      </div>
    </li>
  );
}

function describeActivity(project: DevProject): string {
  if (project.activityMs === null) return 'activity unknown';
  const source =
    project.activitySource === 'git-reflog'
      ? 'git reflog'
      : project.activitySource === 'files'
        ? 'files'
        : project.activitySource === 'manifest'
          ? 'manifest'
          : 'activity';
  return `${source} ${formatRelativeTime(project.activityMs)}`;
}
