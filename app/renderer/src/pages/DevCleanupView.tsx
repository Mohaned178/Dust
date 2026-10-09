import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type {
  CleanItemResult,
  CleanPreview,
  CleanReport,
  DevCleanupState,
  DevGroup,
  DevProject,
  DustApi,
} from '../../../src/shared/ipc';
import { BulkBar } from '../components/BulkBar';
import { CleanDialog } from '../components/CleanDialog';
import { CleanPlan } from '../components/CleanPlan';
import { CleanSummary } from '../components/CleanSummary';
import { CopyButton } from '../components/CopyButton';
import { RestorabilityPill } from '../components/GradePill';
import { ChevronRightIcon, CodeIcon, PackageIcon, PinIcon, SparkleIcon } from '../components/icons';
import { Alert, Badge, Button, Card, FOCUS, PageHeader } from '../components/ui';
import { cleanErrorMessage, newCleanId } from '../clean';
import { formatBytes, formatCount, formatRelativeTime } from '../format';

export interface DevCleanupViewProps {
  api: DustApi;
  root: string;
  onBack: () => void;
  onViewResults: (root: string) => void;
}

type BandId = DevGroup['id'];

const GROUP_ORDER: readonly BandId[] = ['dead', 'occasional', 'active', 'orphaned', 'pinned'];

const BANDS: Record<BandId, { title: string; detail: string; dot: string; blurb: string }> = {
  dead: {
    title: 'Dead',
    detail: '180+ days',
    dot: 'bg-accent',
    blurb: 'Untouched for six months or more. The safest place to start.',
  },
  occasional: {
    title: 'Occasional',
    detail: '31–180 days',
    dot: 'bg-map-4',
    blurb: 'Opened now and then. Rebuilding costs one install when you return.',
  },
  active: {
    title: 'Active',
    detail: '30 days or less',
    dot: 'bg-grade-review-dot',
    blurb: 'Worked on recently. You will likely need these again soon.',
  },
  orphaned: {
    title: 'Orphaned node_modules',
    detail: 'no parent project',
    dot: 'bg-grade-safe-dot',
    blurb: 'node_modules with no package.json beside it to rebuild from.',
  },
  pinned: {
    title: 'Pinned',
    detail: 'excluded from cleanup',
    dot: 'bg-hairline-strong',
    blurb: 'Projects you chose to keep. Dust never offers these.',
  },
};

export function DevCleanupView({ api, root, onBack, onViewResults }: DevCleanupViewProps) {
  const [state, setState] = useState<DevCleanupState | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set());
  const [collapsed, setCollapsed] = useState<ReadonlySet<string>>(new Set(['pinned']));
  const [preview, setPreview] = useState<CleanPreview | null>(null);
  const [report, setReport] = useState<CleanReport | null>(null);
  const [acknowledge, setAcknowledge] = useState(false);
  const [busy, setBusy] = useState(false);
  const [cleanId, setCleanId] = useState<string | null>(null);
  const [progress, setProgress] = useState<CleanItemResult[]>([]);
  const groupRefs = useRef(new Map<BandId, HTMLElement>());

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

  const groups = useMemo(() => {
    if (state === null) return [];
    return [...state.groups].sort((a, b) => GROUP_ORDER.indexOf(a.id) - GROUP_ORDER.indexOf(b.id));
  }, [state]);
  const projects = useMemo(() => groups.flatMap((group) => group.projects), [groups]);
  const totalBytes = useMemo(() => projects.reduce((sum, project) => sum + project.nodeModulesBytes, 0), [projects]);
  const selectedBytes = useMemo(
    () =>
      projects
        .filter((project) => selected.has(project.path))
        .reduce((sum, project) => sum + project.nodeModulesBytes, 0),
    [projects, selected],
  );
  const recommended = useMemo(
    () =>
      (groups.find((group) => group.id === 'dead')?.projects ?? []).filter(
        (project) => project.offered && !project.pinned && project.grade === 'green',
      ),
    [groups],
  );
  const recommendedBytes = recommended.reduce((sum, project) => sum + project.nodeModulesBytes, 0);

  const toggle = useCallback((path: string) => {
    setSelected((current) => {
      const next = new Set(current);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      return next;
    });
  }, []);

  const setMany = useCallback((paths: readonly string[], on: boolean) => {
    setSelected((current) => {
      const next = new Set(current);
      for (const path of paths) {
        if (on) next.add(path);
        else next.delete(path);
      }
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

  const jumpTo = useCallback((id: BandId) => {
    setCollapsed((current) => {
      if (!current.has(id)) return current;
      const next = new Set(current);
      next.delete(id);
      return next;
    });
    requestAnimationFrame(() => groupRefs.current.get(id)?.scrollIntoView?.({ behavior: 'smooth', block: 'start' }));
  }, []);

  const selectRecommended = useCallback(() => {
    setSelected(new Set(recommended.map((project) => project.path)));
  }, [recommended]);

  const setPin = useCallback(
    async (path: string, pinned: boolean) => {
      const result = await api.setPin(path, pinned);
      if (result.ok) {
        if (pinned) setMany([path], false);
        load();
      } else setError(result.message);
    },
    [api, load, setMany],
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

  const header = (
    <>
      <button
        type="button"
        onClick={onBack}
        className={`mb-4 rounded text-sm font-medium text-accent hover:underline ${FOCUS}`}
      >
        ← Home
      </button>
      <PageHeader
        title="Dev Cleanup"
        subtitle={
          <>
            Old <span className="font-mono text-ink">node_modules</span> under{' '}
            <span className="font-mono text-ink">{root}</span>
            {state?.finishedAt != null && <> · analyzed {formatRelativeTime(state.finishedAt)}</>}
          </>
        }
        actions={
          <Button size="sm" onClick={() => onViewResults(root)}>
            View results
          </Button>
        }
      />
    </>
  );

  if (state === null) {
    return (
      <main className="min-h-full bg-canvas text-ink">
        <div className="mx-auto max-w-5xl px-6 py-10 sm:px-10">
          {header}
          {error !== null ? (
            <Alert tone="danger" className="mt-8">
              {error}
            </Alert>
          ) : (
            <DevLoading />
          )}
        </div>
      </main>
    );
  }

  const empty = state.source === 'empty';

  return (
    <main className="min-h-full bg-canvas text-ink">
      <div className="mx-auto max-w-5xl px-6 py-10 sm:px-10">
        {header}

        {empty ? (
          <Card className="mt-8 flex flex-col items-center px-6 py-14 text-center">
            <span className="flex h-12 w-12 items-center justify-center rounded-2xl bg-accent-soft text-accent-strong">
              <CodeIcon className="h-6 w-6" />
            </span>
            <p className="mt-4 text-base font-semibold text-ink">No scan data for this drive yet</p>
            <p className="mt-1 max-w-sm text-sm text-ink-muted">
              Run an Analyze from Home first. Dev Cleanup reads the projects that scan finds.
            </p>
            <Button className="mt-5" onClick={onBack}>
              Back to Home
            </Button>
          </Card>
        ) : (
          <>
            <Overview
              groups={groups}
              totalBytes={totalBytes}
              projectCount={projects.length}
              recommendedCount={recommended.length}
              recommendedBytes={recommendedBytes}
              onSelectRecommended={selectRecommended}
              onJump={jumpTo}
              busy={busy}
            />

            {error !== null && preview === null && report === null && (
              <Alert tone="danger" className="mt-6">
                {error}
              </Alert>
            )}

            {busy && progress.length > 0 && (
              <Card className="mt-6 px-4 py-3">
                <ul role="status" className="space-y-1 text-sm text-ink-muted">
                  {progress.map((item) => (
                    <li key={item.path} className="truncate font-mono text-xs">
                      {item.path} — {item.status}
                    </li>
                  ))}
                </ul>
              </Card>
            )}

            <div className="mt-8 space-y-5">
              {groups.map((group) => (
                <GroupLedger
                  key={group.id}
                  ref={(node) => {
                    if (node === null) groupRefs.current.delete(group.id);
                    else groupRefs.current.set(group.id, node);
                  }}
                  group={group}
                  collapsed={collapsed.has(group.id)}
                  onToggle={() => toggleGroup(group.id)}
                  selected={selected}
                  onToggleProject={toggle}
                  onSetMany={setMany}
                  onPin={(path, pinned) => void setPin(path, pinned)}
                  busy={busy}
                />
              ))}
            </div>

            {state.recentlyCleaned.length > 0 && (
              <Card className="mt-8 overflow-hidden">
                <details>
                  <summary
                    className={`flex cursor-pointer items-center gap-3 px-5 py-3.5 text-sm font-semibold text-ink transition-colors hover:bg-surface-hover ${FOCUS}`}
                  >
                    Recently cleaned ({state.recentlyCleaned.length})
                    <span className="ml-auto font-mono text-xs font-normal text-ink-muted">
                      {formatBytes(state.recentlyCleaned.reduce((sum, entry) => sum + entry.bytes, 0))} freed
                    </span>
                  </summary>
                  <ul className="divide-y divide-hairline border-t border-hairline">
                    {state.recentlyCleaned.map((entry) => (
                      <li key={entry.path} className="flex items-center gap-4 px-5 py-3">
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-sm font-medium text-ink">{entry.name}</p>
                          <p className="mt-0.5 truncate font-mono text-xs text-ink-muted" title={entry.path}>
                            {formatBytes(entry.bytes)} freed · {formatRelativeTime(entry.cleanedAt)}
                            {entry.restoreCommand !== null && (
                              <>
                                {' · rebuild with '}
                                <code className="text-ink">{entry.restoreCommand}</code>
                              </>
                            )}
                          </p>
                        </div>
                        {entry.restoreCommand !== null && (
                          <CopyButton text={entry.restoreCommand} label={`Copy command for ${entry.path}`} />
                        )}
                      </li>
                    ))}
                  </ul>
                </details>
              </Card>
            )}

            {selected.size > 0 && (
              <BulkBar
                count={selected.size}
                bytes={selectedBytes}
                onClear={() => setSelected(new Set())}
                onClean={() => void review()}
              />
            )}
          </>
        )}
      </div>

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

interface OverviewProps {
  groups: DevGroup[];
  totalBytes: number;
  projectCount: number;
  recommendedCount: number;
  recommendedBytes: number;
  onSelectRecommended: () => void;
  onJump: (id: BandId) => void;
  busy: boolean;
}

function Overview({
  groups,
  totalBytes,
  projectCount,
  recommendedCount,
  recommendedBytes,
  onSelectRecommended,
  onJump,
  busy,
}: OverviewProps) {
  const bands = groups.map((group) => ({
    id: group.id,
    count: group.projects.length,
    bytes: group.projects.reduce((sum, project) => sum + project.nodeModulesBytes, 0),
  }));
  const pct = (bytes: number) => (totalBytes > 0 ? (bytes / totalBytes) * 100 : 0);

  return (
    <div className="mt-8 grid gap-5 lg:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)]">
      <Card className="p-6">
        <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-ink-muted">node_modules on this drive</p>
        <p className="mt-2 flex flex-wrap items-baseline gap-x-3">
          <span className="font-mono text-[2.25rem] font-semibold leading-none tracking-tight text-ink">
            {formatBytes(totalBytes)}
          </span>
          <span className="text-sm text-ink-muted">
            across {formatCount(projectCount)} {projectCount === 1 ? 'project' : 'projects'}
          </span>
        </p>

        <div
          role="img"
          aria-label={bands.map((band) => `${BANDS[band.id].title} ${Math.round(pct(band.bytes))}%`).join(', ')}
          className="mt-5 flex h-3 w-full gap-0.5 overflow-hidden rounded-full bg-track"
        >
          {bands
            .filter((band) => band.bytes > 0)
            .map((band) => (
              <div
                key={band.id}
                className={`dust-bar-fill h-full first:rounded-l-full last:rounded-r-full ${BANDS[band.id].dot}`}
                style={{ width: `${pct(band.bytes)}%` }}
              />
            ))}
        </div>

        <ul aria-label="Bands by last activity" className="mt-4 grid gap-x-6 gap-y-1 sm:grid-cols-2">
          {bands.map((band) => (
            <li key={band.id}>
              <button
                type="button"
                onClick={() => onJump(band.id)}
                className={`flex w-full items-center gap-2.5 rounded-lg px-2 py-1.5 text-left text-sm transition-colors hover:bg-surface-hover ${FOCUS}`}
              >
                <span aria-hidden="true" className={`h-2.5 w-2.5 shrink-0 rounded-full ${BANDS[band.id].dot}`} />
                <span className="min-w-0 truncate">
                  <span className="font-medium text-ink">{BANDS[band.id].title}</span>{' '}
                  <span className="text-xs text-ink-muted">{BANDS[band.id].detail}</span>
                </span>
                <span className="ml-auto shrink-0 font-mono text-xs tabular-nums text-ink-muted">
                  {band.count === 0 ? '—' : formatBytes(band.bytes)}
                </span>
              </button>
            </li>
          ))}
        </ul>
      </Card>

      <Card className="flex flex-col p-6">
        <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-accent-soft text-accent-strong">
          <SparkleIcon className="h-5 w-5" />
        </span>
        <p className="mt-4 text-[11px] font-semibold uppercase tracking-[0.14em] text-ink-muted">Recommended</p>
        {recommendedCount > 0 ? (
          <>
            <p className="mt-1.5 text-lg font-semibold tracking-tight text-ink">
              Free <span className="font-mono text-accent-strong">{formatBytes(recommendedBytes)}</span> from{' '}
              {formatCount(recommendedCount)} dead {recommendedCount === 1 ? 'project' : 'projects'}
            </p>
            <p className="mt-1 text-sm text-ink-muted">
              Untouched for 180+ days, and each one rebuilds from its lockfile.
            </p>
            <Button variant="primary" className="mt-auto self-start" disabled={busy} onClick={onSelectRecommended}>
              Select dead &amp; safe
            </Button>
          </>
        ) : (
          <>
            <p className="mt-1.5 text-lg font-semibold tracking-tight text-ink">No dead projects to clear</p>
            <p className="mt-1 text-sm text-ink-muted">
              Nothing has sat untouched long enough. Pick projects from the lists below if you need space.
            </p>
          </>
        )}
      </Card>
    </div>
  );
}

interface GroupLedgerProps {
  ref: (node: HTMLElement | null) => void;
  group: DevGroup;
  collapsed: boolean;
  onToggle: () => void;
  selected: ReadonlySet<string>;
  onToggleProject: (path: string) => void;
  onSetMany: (paths: readonly string[], on: boolean) => void;
  onPin: (path: string, pinned: boolean) => void;
  busy: boolean;
}

function GroupLedger({
  ref,
  group,
  collapsed,
  onToggle,
  selected,
  onToggleProject,
  onSetMany,
  onPin,
  busy,
}: GroupLedgerProps) {
  const expanded = !collapsed;
  const band = BANDS[group.id];
  const total = group.projects.reduce((sum, project) => sum + project.nodeModulesBytes, 0);
  const maxBytes = group.projects.reduce((max, project) => Math.max(max, project.nodeModulesBytes), 0);
  const selectable = group.projects.filter((project) => project.offered && !project.pinned).map((p) => p.path);
  const chosen = selectable.filter((path) => selected.has(path)).length;
  const allChosen = selectable.length > 0 && chosen === selectable.length;

  return (
    <section ref={ref} aria-label={group.label} className="scroll-mt-6">
      <Card className="overflow-hidden">
        <div className="flex items-center gap-3 px-5 py-4">
          {selectable.length > 0 && (
            <input
              type="checkbox"
              aria-label={`Select all in ${band.title}`}
              checked={allChosen}
              ref={(node) => {
                if (node !== null) node.indeterminate = chosen > 0 && !allChosen;
              }}
              disabled={busy}
              onChange={() => onSetMany(selectable, !allChosen)}
              className={`h-4 w-4 shrink-0 rounded border-hairline accent-accent ${FOCUS} disabled:opacity-40`}
            />
          )}
          <button
            type="button"
            aria-expanded={expanded}
            onClick={onToggle}
            className={`flex min-w-0 flex-1 items-center gap-3 rounded-lg text-left ${FOCUS}`}
          >
            <span aria-hidden="true" className={`h-2.5 w-2.5 shrink-0 rounded-full ${band.dot}`} />
            <span className="min-w-0 flex-1">
              <span className="flex items-center gap-2">
                <span className="text-sm font-semibold text-ink">{band.title}</span>
                <Badge>{formatCount(group.projects.length)}</Badge>
                <span className="hidden text-xs text-ink-muted sm:inline">{band.detail}</span>
              </span>
              <span className="mt-0.5 block truncate text-xs text-ink-muted">{band.blurb}</span>
            </span>
            <span className="shrink-0 font-mono text-sm font-semibold tabular-nums text-ink">
              {formatBytes(total)}
            </span>
            <ChevronRightIcon
              className={`h-4 w-4 shrink-0 text-ink-muted transition-transform duration-150 ${expanded ? 'rotate-90' : ''}`}
            />
          </button>
        </div>

        {expanded && (
          <div className="border-t border-hairline">
            {group.projects.length === 0 ? (
              <p className="px-5 py-6 text-center text-sm text-ink-muted">Nothing here.</p>
            ) : (
              <ul className="divide-y divide-hairline">
                {group.projects.map((project) => (
                  <ProjectRow
                    key={project.path}
                    project={project}
                    maxBytes={maxBytes}
                    selected={selected.has(project.path)}
                    onToggle={onToggleProject}
                    onPin={onPin}
                    busy={busy}
                  />
                ))}
              </ul>
            )}
          </div>
        )}
      </Card>
    </section>
  );
}

interface ProjectRowProps {
  project: DevProject;
  maxBytes: number;
  selected: boolean;
  onToggle: (path: string) => void;
  onPin: (path: string, pinned: boolean) => void;
  busy: boolean;
}

function ProjectRow({ project, maxBytes, selected, onToggle, onPin, busy }: ProjectRowProps) {
  const pinned = project.pinned;
  const selectable = project.offered && !pinned;
  const subline = project.offered
    ? project.restoreCommand !== null
      ? `Rebuild: ${project.restoreCommand}`
      : project.path
    : project.reasons.length > 0
      ? project.reasons.join(' · ')
      : 'Not offered for cleanup';
  const Icon = pinned ? PinIcon : project.kind === 'orphaned-node-modules' ? PackageIcon : CodeIcon;
  const share = maxBytes > 0 ? Math.max((project.nodeModulesBytes / maxBytes) * 100, 3) : 0;

  return (
    <li
      className={`flex items-center gap-3 px-5 py-3 transition-colors ${
        selected ? 'bg-accent-soft/50' : 'hover:bg-surface-hover'
      }`}
    >
      <span className="flex w-4 shrink-0 justify-center">
        {selectable && (
          <input
            type="checkbox"
            aria-label={`Select ${project.name}`}
            checked={selected}
            disabled={busy}
            onChange={() => onToggle(project.path)}
            className={`h-4 w-4 rounded border-hairline accent-accent ${FOCUS} disabled:cursor-not-allowed disabled:opacity-40`}
          />
        )}
      </span>

      <span
        aria-hidden="true"
        className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-xl ${
          pinned || !project.offered ? 'bg-track text-ink-muted' : 'bg-accent-soft text-accent-strong'
        }`}
      >
        <Icon className="h-4 w-4" />
      </span>

      <div className="min-w-0 flex-1">
        <div className="flex min-w-0 items-center gap-1.5">
          <p className={`truncate text-sm font-medium ${pinned ? 'text-ink-muted' : 'text-ink'}`} title={project.path}>
            {project.name}
          </p>
          {project.kind === 'monorepo' && (
            <Badge>{project.workspaceCount > 0 ? `${project.workspaceCount} workspaces` : 'monorepo'}</Badge>
          )}
          {project.packageManager.length > 0 && project.packageManager !== 'unknown' && (
            <span className="hidden shrink-0 text-[11px] text-ink-muted md:inline">{project.packageManager}</span>
          )}
        </div>
        <p className="mt-0.5 truncate font-mono text-xs text-ink-muted" title={subline}>
          {subline}
        </p>
      </div>

      <span className="hidden w-32 shrink-0 text-right text-xs text-ink-muted lg:block" title={describeActivity(project)}>
        {project.activityMs === null ? 'activity unknown' : formatRelativeTime(project.activityMs)}
      </span>

      <span className="hidden w-20 shrink-0 sm:block" aria-hidden="true">
        <span className="block h-1.5 w-full overflow-hidden rounded-full bg-track">
          <span
            className={`dust-bar-fill block h-full rounded-full ${selectable ? 'bg-accent' : 'bg-ink-muted/40'}`}
            style={{ width: `${share}%` }}
          />
        </span>
      </span>

      <span
        className={`w-20 shrink-0 text-right font-mono text-sm font-semibold tabular-nums ${
          pinned ? 'text-ink-muted' : 'text-ink'
        }`}
      >
        {formatBytes(project.nodeModulesBytes)}
      </span>

      <span className="hidden w-24 shrink-0 md:flex md:justify-end">
        {pinned ? (
          <Badge>kept</Badge>
        ) : project.offered ? (
          <RestorabilityPill grade={project.grade === 'yellow' ? 'yellow' : 'green'} />
        ) : (
          <Badge>not offered</Badge>
        )}
      </span>

      <button
        type="button"
        aria-label={`${pinned ? 'Unpin' : 'Keep'} ${project.name}`}
        title={pinned ? 'Offer this project for cleanup again' : 'Never offer this project for cleanup'}
        onClick={() => onPin(project.path, !project.pinned)}
        className={`inline-flex shrink-0 items-center gap-1 rounded-lg px-2 py-1 text-xs font-medium text-ink-muted transition-colors hover:bg-canvas hover:text-ink ${FOCUS}`}
      >
        <PinIcon className="h-3.5 w-3.5" />
        {pinned ? 'Unpin' : 'Keep'}
      </button>
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
  return `Last ${source} activity ${formatRelativeTime(project.activityMs)}`;
}

function DevLoading() {
  return (
    <div role="status" aria-busy="true" className="mt-8 animate-pulse motion-reduce:animate-none">
      <span className="sr-only">Loading projects.</span>
      <div aria-hidden="true" className="grid gap-5 lg:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)]">
        <div className="h-52 rounded-2xl border border-hairline bg-surface" />
        <div className="h-52 rounded-2xl border border-hairline bg-surface" />
      </div>
      <div aria-hidden="true" className="mt-8 space-y-5">
        {[0, 1, 2].map((index) => (
          <div key={index} className="h-[4.5rem] rounded-2xl border border-hairline bg-surface" />
        ))}
      </div>
    </div>
  );
}
