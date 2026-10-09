import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { KeyboardEvent } from 'react';
import type { DevProject } from '../../../../src/shared/ipc';
import { useDialogs } from '../../app/dialogs';
import { useNavStore } from '../../app/nav';
import { useStartScan } from '../../app/useStartScan';
import { useApi } from '../../lib/api';
import { BANDS, bytesOf, isSelectable, orderedGroups, recommendedProjects, totalFreed } from '../../lib/developer';
import type { BandId, ListItem } from '../../lib/developer';
import { formatBytes, formatCount } from '../../lib/format';
import { useDashboardStore } from '../../stores/dashboard';
import { useDevStore } from '../../stores/dev';
import { useResultsStore } from '../../stores/results';
import { Button } from '../../ui/Button';
import { Card } from '../../ui/Card';
import { CopyLine } from '../../ui/CopyLine';
import { RelativeTime } from '../../ui/Display';
import { EmptyState, ErrorState } from '../../ui/EmptyState';
import { ChevronRightIcon, PackageIcon } from '../../ui/icons';
import { Notice } from '../../ui/Notice';
import { PageHeader } from '../../ui/PageHeader';
import { Skeleton } from '../../ui/Skeleton';
import { useToast } from '../../ui/toast-store';
import { UsageBar } from '../../ui/UsageBar';
import type { UsageSegment } from '../../ui/UsageBar';
import { VirtualList } from '../../ui/VirtualList';
import type { VirtualListHandle } from '../../ui/VirtualList';
import { openCleanDialog } from '../cleanup/openClean';
import { useRoving } from '../explore/useRoving';
import { GroupRow } from './GroupRow';
import { ProjectRow } from './ProjectRow';

const ROW_HEIGHT = 56;

const getKey = (item: ListItem) => item.key;

export function DeveloperPage() {
  const api = useApi();
  const dialogs = useDialogs();
  const toast = useToast();
  const paramsRoot = useNavStore((state) => state.params.developer?.root ?? null);
  const navigate = useNavStore((state) => state.navigate);
  const dashboard = useDashboardStore((state) => state.dashboard);
  const loadDashboard = useDashboardStore((state) => state.load);
  const cleanup = useDevStore((state) => state.cleanup);
  const loadDev = useDevStore((state) => state.load);
  const selected = useDevStore((state) => state.selected);
  const categories = useResultsStore((state) => state.categories);
  const loadCategories = useResultsStore((state) => state.loadCategories);
  const scan = useStartScan();
  const [collapsed, setCollapsed] = useState<ReadonlySet<BandId>>(new Set(['pinned']));
  const [problem, setProblem] = useState<string | null>(null);
  const listRef = useRef<VirtualListHandle>(null);

  useEffect(() => {
    void loadDashboard(api);
  }, [api, loadDashboard]);

  const system = dashboard.data?.volumes.find((volume) => volume.role === 'system') ?? null;
  const root = paramsRoot ?? system?.root ?? null;
  const usedBytes =
    system?.totalBytes != null && system.freeBytes != null ? Math.max(system.totalBytes - system.freeBytes, 0) : null;

  // Shows the last list at once and reads it again behind it; a hidden page stops doing this.
  useEffect(() => {
    if (root === null) return;
    void loadDev(api, root);
    void loadCategories(api, root);
  }, [api, loadDev, loadCategories, root]);

  const state = cleanup.data;
  const groups = useMemo(() => (state === null ? [] : orderedGroups(state)), [state]);
  const projects = useMemo(() => groups.flatMap((group) => group.projects), [groups]);
  const totalBytes = useMemo(() => bytesOf(projects), [projects]);
  const recommended = useMemo(() => recommendedProjects(groups), [groups]);
  const recommendedBytes = bytesOf(recommended);

  // Only projects that are still offered count, so a stale tick from before a refresh never reaches the plan.
  const chosen = useMemo(
    () => projects.filter((project) => isSelectable(project) && selected.has(project.path)),
    [projects, selected],
  );
  const chosenBytes = bytesOf(chosen);

  const items = useMemo<ListItem[]>(() => {
    const out: ListItem[] = [];
    for (const group of groups) {
      const open = !collapsed.has(group.id);
      out.push({ kind: 'group', key: `group:${group.id}`, group, expanded: open });
      if (!open) continue;
      if (group.projects.length === 0) {
        out.push({ kind: 'empty', key: `empty:${group.id}` });
        continue;
      }
      const maxBytes = group.projects.reduce((max, project) => Math.max(max, project.nodeModulesBytes), 0);
      for (const project of group.projects) {
        out.push({ kind: 'project', key: project.path.toLowerCase(), project, maxBytes });
      }
    }
    return out;
  }, [groups, collapsed]);

  const roving = useRoving(items, getKey, listRef);
  const { tabStopKey, moveTo, setActiveKey } = roving;

  const toggleGroup = useCallback((id: BandId, open?: boolean) => {
    setCollapsed((current) => {
      const next = new Set(current);
      const shouldOpen = open ?? next.has(id);
      if (shouldOpen) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const jumpTo = useCallback(
    (id: BandId) => {
      toggleGroup(id, true);
      const index = items.findIndex((item) => item.key === `group:${id}`);
      if (index >= 0) listRef.current?.scrollToIndex(index);
    },
    [items, toggleGroup],
  );

  const setMany = useCallback(
    (paths: ReadonlyArray<string>, on: boolean) => useDevStore.getState().setSelected(paths, on),
    [],
  );

  const reload = useCallback(() => {
    if (root !== null) void loadDev(api, root, true);
  }, [api, loadDev, root]);

  const setPin = useCallback(
    async (project: DevProject, pinned: boolean) => {
      setProblem(null);
      try {
        const result = await api.setPin(project.path, pinned);
        if (!result.ok) {
          setProblem(result.message);
          return;
        }
        if (pinned) useDevStore.getState().setSelected([project.path], false);
        reload();
        toast({
          title: pinned ? `${project.name} will be kept` : `${project.name} can be cleaned again`,
          description: pinned ? 'Dust will not offer it for cleanup.' : undefined,
          action: { label: 'Undo', onAction: () => void setPin(project, !pinned) },
        });
      } catch {
        setProblem('Dust could not save that change.');
      }
    },
    [api, reload, toast],
  );

  const review = () => {
    if (root === null || chosen.length === 0) return;
    openCleanDialog(dialogs, {
      title: 'Clean project dependencies',
      request: { scope: 'dev', root, paths: chosen.map((project) => project.path) },
    });
  };

  const renderRow = useCallback(
    (item: ListItem) => {
      if (item.kind === 'empty') {
        return <p className="flex h-14 items-center px-12 text-caption text-ink-2">Nothing here.</p>;
      }
      if (item.kind === 'group') {
        return <GroupRow group={item.group} expanded={item.expanded} selected={selected} onSetMany={setMany} />;
      }
      return (
        <ProjectRow
          project={item.project}
          maxBytes={item.maxBytes}
          selected={selected.has(item.project.path)}
          onToggle={(path) => useDevStore.getState().setSelected([path], !selected.has(path))}
          onPin={(project, pinned) => void setPin(project, pinned)}
        />
      );
    },
    [selected, setMany, setPin],
  );

  const itemProps = useCallback(
    (item: ListItem) => ({
      'aria-level': item.kind === 'group' ? 1 : 2,
      'aria-expanded': item.kind === 'group' ? item.expanded : undefined,
      'aria-label':
        item.kind === 'group'
          ? `${BANDS[item.group.id].title}, ${item.group.projects.length} ${item.group.projects.length === 1 ? 'project' : 'projects'}`
          : item.kind === 'project'
            ? `${item.project.name}, ${formatBytes(item.project.nodeModulesBytes)}`
            : undefined,
      tabIndex: item.key === tabStopKey ? 0 : -1,
      'data-key': item.key,
      // On the row itself, so a click anywhere on a heading opens or closes it.
      onClick: () => {
        setActiveKey(item.key);
        if (item.kind === 'group') toggleGroup(item.group.id);
      },
    }),
    [tabStopKey, setActiveKey, toggleGroup],
  );

  const onKeyDown = (event: KeyboardEvent<HTMLElement>) =>
    roving.onKeyDown(event, (index) => {
      const item = items[index];
      if (item === undefined) return false;
      if (item.kind === 'group') {
        const selectable = item.group.projects.filter(isSelectable).map((project) => project.path);
        if (event.key === 'ArrowRight') {
          if (!item.expanded) toggleGroup(item.group.id, true);
          else moveTo(index + 1);
          return true;
        }
        if (event.key === 'ArrowLeft') {
          if (item.expanded) toggleGroup(item.group.id, false);
          return true;
        }
        if (event.key === 'Enter') {
          toggleGroup(item.group.id);
          return true;
        }
        if (event.key === ' ' && selectable.length > 0) {
          setMany(selectable, !selectable.every((path) => selected.has(path)));
          return true;
        }
        return false;
      }
      if (item.kind === 'project') {
        if (event.key === 'ArrowLeft') {
          const parent = items.findIndex(
            (candidate) => candidate.kind === 'group' && candidate.group.projects.includes(item.project),
          );
          if (parent >= 0) moveTo(parent);
          return true;
        }
        if ((event.key === ' ' || event.key === 'Enter') && isSelectable(item.project)) {
          setMany([item.project.path], !selected.has(item.project.path));
          return true;
        }
      }
      return false;
    });

  const npmCache =
    root === null
      ? undefined
      : categories[root.toLowerCase()]?.data?.categories.find((row) => row.category === 'npm-cache');

  const bands = groups.map((group): UsageSegment => ({
    id: group.id,
    label: BANDS[group.id].title,
    bytes: bytesOf(group.projects),
    onSelect: () => jumpTo(group.id),
  }));

  let body;
  if (root === null) {
    body =
      dashboard.error !== null ? (
        <Card>
          <ErrorState title="Dust could not read your drives" onRetry={() => void loadDashboard(api, true)} />
        </Card>
      ) : (
        <Skeleton className="h-52 w-full" />
      );
  } else if (state === null) {
    body =
      cleanup.error !== null ? (
        <Card>
          <ErrorState
            title="Dust could not read your projects"
            description="The last scan could not be loaded."
            onRetry={reload}
          />
        </Card>
      ) : (
        <div className="flex flex-col gap-4" aria-busy="true">
          <Skeleton className="h-40 w-full" />
          <Skeleton className="h-64 w-full" />
        </div>
      );
  } else if (state.source === 'empty') {
    body = (
      <Card>
        <EmptyState
          title={`Scan ${root} to find your projects`}
          description="Dust reads the projects a scan finds. Nothing is deleted until you confirm it."
          action={
            <Button
              variant="primary"
              size="lg"
              loading={scan.starting}
              onClick={() => void scan.start({ root, usedBytes })}
            >
              Scan {root}
            </Button>
          }
        />
      </Card>
    );
  } else {
    body = (
      <div className="flex flex-col gap-6">
        <div className="grid gap-4 lg:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)]">
          <Card className="flex flex-col gap-4 p-6">
            <div>
              <h2 className="text-body font-semibold text-ink-2">node_modules on this drive</h2>
              <p className="mt-1">
                <span className="text-hero font-semibold tabular-nums">{formatBytes(totalBytes)}</span>{' '}
                <span className="text-body text-ink-2">
                  across {formatCount(projects.length)} {projects.length === 1 ? 'project' : 'projects'}
                </span>
              </p>
            </div>
            {totalBytes > 0 ? (
              <UsageBar segments={bands} totalBytes={totalBytes} label="node_modules by when they were last used" />
            ) : null}
          </Card>
          <Card className="flex flex-col gap-3 p-6">
            <h2 className="text-body font-semibold text-ink-2">Suggested</h2>
            {recommended.length > 0 ? (
              <>
                <p className="text-subtitle">
                  Free {formatBytes(recommendedBytes)} from {formatCount(recommended.length)} unused{' '}
                  {recommended.length === 1 ? 'project' : 'projects'}
                </p>
                <p className="text-body text-ink-2">
                  Not used for 6 months or more, and each one rebuilds from its lockfile.
                </p>
                <Button
                  variant="primary"
                  className="mt-auto self-start"
                  onClick={() => useDevStore.getState().replaceSelection(recommended.map((project) => project.path))}
                >
                  Select all safe and unused
                </Button>
              </>
            ) : (
              <>
                <p className="text-subtitle">Nothing to suggest</p>
                <p className="text-body text-ink-2">
                  No project has gone unused for long enough. Pick projects from the list if you need the space.
                </p>
              </>
            )}
          </Card>
        </div>

        {problem !== null ? <Notice variant="warning">{problem}</Notice> : null}

        <section aria-label="Projects" className="flex flex-col gap-2">
          <h2 className="text-subtitle">Projects</h2>
          <Card className="overflow-hidden">
            {items.length === 0 ? (
              <EmptyState title="No projects found" description="The scan did not find any node_modules folders." />
            ) : (
              <div ref={roving.containerRef} onKeyDown={onKeyDown} className="h-[56vh] min-h-80">
                <VirtualList
                  ref={listRef}
                  items={items}
                  rowHeight={ROW_HEIGHT}
                  getKey={getKey}
                  renderRow={renderRow}
                  label="Projects by when they were last used"
                  semantics="tree"
                  itemProps={itemProps}
                />
              </div>
            )}
          </Card>
        </section>

        <section aria-label="Toolchain caches" className="flex flex-col gap-2">
          <h2 className="text-subtitle">Toolchain caches</h2>
          <Card className="flex items-center gap-3 px-4 py-3">
            <PackageIcon className="size-6 shrink-0 text-ink-2" aria-hidden="true" />
            <div className="min-w-0 flex-1">
              <p className="text-body font-semibold">Package cache</p>
              <p className="text-caption text-ink-2">
                Downloaded packages that your package manager fetches again when needed.
              </p>
            </div>
            <span className="text-body font-semibold tabular-nums">
              {npmCache === undefined ? '—' : formatBytes(npmCache.bytes)}
            </span>
            <Button
              variant="subtle"
              disabled={npmCache === undefined || npmCache.bytes === 0}
              onClick={() => navigate('cleanup', { view: 'results', root, category: 'npm-cache' })}
            >
              Review in Clean up
              <ChevronRightIcon className="size-4" aria-hidden="true" />
            </Button>
          </Card>
        </section>

        {state.recentlyCleaned.length > 0 ? (
          <Card className="overflow-hidden">
            <details>
              <summary className="flex cursor-pointer items-center gap-3 px-4 py-3 text-body font-semibold hover:bg-surface-hover">
                Recently cleaned ({formatCount(state.recentlyCleaned.length)})
                <span className="ml-auto text-caption font-normal text-ink-2">
                  {formatBytes(totalFreed(state.recentlyCleaned))} freed
                </span>
              </summary>
              <ul className="divide-y divide-border border-t border-border">
                {state.recentlyCleaned.map((entry) => (
                  <li key={entry.path} className="flex flex-col gap-1 px-4 py-3">
                    <div className="flex items-baseline justify-between gap-3">
                      <span className="truncate text-body font-semibold" title={entry.path}>
                        {entry.name}
                      </span>
                      <span className="shrink-0 text-caption text-ink-2">
                        {formatBytes(entry.bytes)} freed · <RelativeTime ms={entry.cleanedAt} />
                      </span>
                    </div>
                    {entry.restoreCommand !== null ? (
                      <CopyLine text={entry.restoreCommand} label={`Copy the rebuild command for ${entry.name}`} />
                    ) : null}
                  </li>
                ))}
              </ul>
            </details>
          </Card>
        ) : null}
      </div>
    );
  }

  return (
    <>
      <PageHeader
        title="Developer"
        subtitle={
          state !== null && state.source !== 'empty' && root !== null ? (
            <>
              Old project dependencies on {root} · checked <RelativeTime ms={state.finishedAt} />
            </>
          ) : (
            'Reclaim space from project dependencies you no longer use.'
          )
        }
      />
      {body}
      {chosen.length > 0 ? (
        <div className="sticky bottom-0 z-10 mt-6 -mb-8 flex items-center justify-between gap-4 border-t border-border bg-canvas py-4">
          <p className="text-body" aria-live="polite">
            {formatCount(chosen.length)} {chosen.length === 1 ? 'project' : 'projects'} ·{' '}
            <span className="font-semibold tabular-nums">{formatBytes(chosenBytes)}</span> selected
          </p>
          <div className="flex items-center gap-2">
            <Button variant="subtle" onClick={() => useDevStore.getState().resetSelection()}>
              Clear
            </Button>
            <Button variant="primary" size="lg" onClick={review}>
              Review and clean
            </Button>
          </div>
        </div>
      ) : null}
    </>
  );
}
