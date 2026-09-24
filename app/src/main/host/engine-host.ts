import { randomUUID } from 'node:crypto';
import {
  AggregateTree,
  Cleaner,
  PlanTokenError,
  RULES_VERSION,
  ScanSession,
  buildSnapshot,
  classifyProjects,
  createExternalPredicate,
  createInventoryRules,
  createNodeFsProbe,
  defaultRecycleBinEnumeration,
  defaultRuleEnv,
  deleteUnprotectedPath,
  getVolumeUsage,
  listVolumes,
  pruneSnapshotAfterCleanup,
  systemDriveRoot,
  volumeRootOf,
} from '@dust/core';
import type {
  BrowseDeleteResult,
  CleanupPlan,
  CleanupReport as CoreCleanupReport,
  FolderRecord,
  Marker,
  ProjectOptions,
  ProjectRecord,
  RecycleBinInfo,
  Rule,
  RuleContext,
  RuleEnv,
  ScanResult,
  SessionOptions,
  SnapshotCategory,
  SnapshotData,
  SnapshotMatch,
  VolumeInfo,
  VolumeUsage,
} from '@dust/core';
import type { SnapshotStore } from '@dust/core';
import type {
  BrowseRow,
  BrowseState,
  CategorySummaryRow,
  CleanExecuteRequest,
  CleanExecuteResult,
  CleanPreview,
  CleanPreviewRequest,
  CleanPreviewResult,
  CleanReport,
  CleanScope,
  DashboardState,
  DevCleanupState,
  RecentlyCleanedProject,
  ResultMatch,
  ResultRow,
  ResultsState,
  ScanEvent,
  SetPinResult,
  StartAnalyzeResult,
} from '../../shared/ipc';
import { aggregateCategories, collectRuleMatches } from './analyze';
import { buildDashboardState } from './dashboard';
import { instrument, instrumentAsync } from './instrument';
import { ScanLock } from './scan-lock';
import { ThrottledEmitter } from './throttler';
import {
  buildRowsFromSnapshot,
  buildRowsFromTree,
  sameRoot,
  summarizeCategories,
  toBrowseRow,
  toResultRow,
} from './results';
import type { ResultsEnv } from './results';
import { applyCleanReport } from './cleanup-rows';
import {
  isUnderAny,
  samePath,
  scopeRules,
  snapshotRules,
  subtractCategories,
  toCleanItemResult,
  toCleanPreview,
  toCleanReport,
} from './cleanup';
import { groupDevProjects, projectNameOf, toDevProjects } from './dev-cleanup';
import { measureDirectories } from './targeted';

export interface ScanSessionLike {
  start(): Promise<ScanResult>;
  cancel(): void;
}

export interface EngineHostDeps {
  store: SnapshotStore;
  workerPath?: string;
  pool?: SessionOptions['pool'];
  env?: RuleEnv;
  systemRoot?: string;
  now?: () => number;
  progressIntervalMs?: number;
  folderIntervalMs?: number;
  categoryIntervalMs?: number;
  listVolumes?: () => VolumeInfo[];
  getVolumeUsage?: (volumes: string[]) => VolumeUsage[];
  createSession?: (options: SessionOptions) => ScanSessionLike;
  createRules?: (
    env: RuleEnv,
    projects: ProjectOptions,
    options: { recycleBin?: { enumerate?: () => RecycleBinInfo | Promise<RecycleBinInfo> } },
  ) => Rule[];
  createCleaner?: () => Cleaner;
  quickRoot?: () => string;
}

export interface EngineHost {
  getDashboard(): DashboardState;
  startAnalyze(volume: string): Promise<StartAnalyzeResult>;
  startBrowse(volume: string): Promise<StartAnalyzeResult>;
  cancelScan(): Promise<boolean>;
  getResults(root: string): ResultsState;
  getBrowseResults(root: string): BrowseState;
  deleteBrowsePath(path: string): Promise<BrowseDeleteResult>;
  previewClean(request: CleanPreviewRequest): Promise<CleanPreviewResult>;
  executeClean(request: CleanExecuteRequest): Promise<CleanExecuteResult>;
  getDevCleanup(root: string): DevCleanupState;
  setPin(path: string, pinned: boolean): SetPinResult;
  onEvent(listener: (event: ScanEvent) => void): () => void;
  dispose(): void;
}

function guardEnv(env: RuleEnv): ResultsEnv {
  return {
    systemRoot: env.windowsDir || undefined,
    programData: env.programData || undefined,
    userProfile: env.userProfile || undefined,
  };
}

interface PlanSource {
  source: CleanPreview['source'];
  root: string;
  scanAgeMs: number | null;
  rules: Rule[];
  ctx: RuleContext;
}

interface PendingPlan {
  plan: CleanupPlan;
  scope: CleanScope;
  root: string;
  selection: string[];
}

export function createEngineHost(deps: EngineHostDeps): EngineHost {
  const now = deps.now ?? Date.now;
  const listVolumesFn = deps.listVolumes ?? listVolumes;
  const getVolumeUsageFn = deps.getVolumeUsage ?? getVolumeUsage;
  const env = deps.env ?? defaultRuleEnv();
  const systemRoot = deps.systemRoot ?? systemDriveRoot(env) ?? 'C:\\';
  const createSession = deps.createSession ?? ((options: SessionOptions) => new ScanSession(options));
  const createRules =
    deps.createRules ??
    ((ruleEnv: RuleEnv, projects: ProjectOptions, options) =>
      createInventoryRules(ruleEnv, { projects, recycleBin: options.recycleBin }));
  const listeners = new Set<(event: ScanEvent) => void>();
  const lock = new ScanLock();
  const guard = guardEnv(env);

  let active: { runId: string; session: ScanSessionLike; settled: Promise<void> } | null = null;

  let lastResults: {
    root: string;
    status: 'complete' | 'cancelled';
    finishedAt: number;
    categories: CategorySummaryRow[];
    rows: ResultRow[];
  } | null = null;

  let lastRun: {
    root: string;
    tree: AggregateTree;
    markers: Marker[];
    probe: RuleContext['probe'];
    rules: Rule[];
    projects: ProjectRecord[];
    ruleCategories: SnapshotCategory[];
    finishedAt: number;
  } | null = null;

  let lastBrowse: {
    root: string;
    status: 'complete' | 'cancelled';
    finishedAt: number;
    rows: BrowseRow[];
    tree: AggregateTree;
  } | null = null;

  let recentlyCleaned: RecentlyCleanedProject[] = [];
  const snapshotResultsCache = new WeakMap<SnapshotData, ResultsState>();
  const pendingPlans = new Map<string, PendingPlan>();
  const cleaner =
    deps.createCleaner?.() ??
    new Cleaner({
      guard: {
        systemRoot: env.windowsDir || undefined,
        programData: env.programData || undefined,
        userProfile: env.userProfile || undefined,
      },
      now,
    });

  function onSystemDrive(path: string): boolean {
    const volume = volumeRootOf(path);
    return volume !== null && sameRoot(volume, systemRoot);
  }

  function emit(event: ScanEvent): void {
    for (const listener of [...listeners]) {
      try {
        listener(event);
      } catch {
        /* a broken listener must not corrupt the run */
      }
    }
  }

  function getDashboard(): DashboardState {
    const volumes = listVolumesFn();
    const usage = getVolumeUsageFn(volumes.map((volume) => volume.root));
    return buildDashboardState({
      volumes,
      usage,
      snapshot: deps.store.load(),
      scan: lock.current(),
      systemRoot,
      live:
        lastResults !== null
          ? {
              root: lastResults.root,
              finishedAt: lastResults.finishedAt,
              reclaimableBytes: lastResults.categories.reduce((sum, row) => sum + row.bytes, 0),
            }
          : null,
    });
  }

  function liveSource(): PlanSource | null {
    if (lastRun === null) return null;
    return {
      source: 'live',
      root: lastRun.root,
      scanAgeMs: Math.max(now() - lastRun.finishedAt, 0),
      rules: lastRun.rules,
      ctx: { root: lastRun.root, tree: lastRun.tree, markers: lastRun.markers, probe: lastRun.probe },
    };
  }

  function snapshotSource(snapshot: SnapshotData): PlanSource {
    return {
      source: 'snapshot',
      root: snapshot.root,
      scanAgeMs: Math.max(now() - snapshot.finishedAt, 0),
      rules: snapshotRules(snapshot, deps.store.getPins()),
      ctx: { root: snapshot.root, tree: new AggregateTree(), markers: [], probe: createNodeFsProbe() },
    };
  }

  function quickCleanRoot(): string {
    if (lastRun !== null) return lastRun.root;
    const loaded = deps.store.load();
    if (loaded.kind === 'ok') return loaded.snapshot.root;
    return deps.quickRoot?.() ?? systemRoot;
  }

  async function targetedSource(root: string): Promise<PlanSource> {
    const probe = createNodeFsProbe();
    const rules = createRules(
      env,
      { pins: deps.store.getPins(), isExternal: createExternalPredicate(listVolumesFn()), now },
      { recycleBin: { enumerate: () => defaultRecycleBinEnumeration() } },
    );
    const actions = new Map(rules.map((rule) => [rule.id, rule.action.kind]));
    const discovery = await collectRuleMatches(scopeRules(rules, 'quick', []), {
      root,
      tree: new AggregateTree(),
      markers: [],
      probe,
    });
    const tree = measureDirectories(
      discovery
        .filter((match) => actions.get(match.ruleId) !== 'empty-recycle-bin')
        .map((match) => match.path),
    );
    return { source: 'targeted', root, scanAgeMs: null, rules, ctx: { root, tree, markers: [], probe } };
  }

  async function resolveQuickSource(): Promise<PlanSource> {
    const live = liveSource();
    if (live !== null) return live;
    const loaded = deps.store.load();
    if (loaded.kind === 'ok') return snapshotSource(loaded.snapshot);
    return targetedSource(quickCleanRoot());
  }

  async function resolveRootSource(root: string): Promise<PlanSource | null> {
    const live = liveSource();
    if (live !== null && sameRoot(live.root, root)) return live;
    const loaded = deps.store.load();
    if (loaded.kind === 'ok' && sameRoot(loaded.snapshot.root, root)) return snapshotSource(loaded.snapshot);
    return null;
  }

  async function previewClean(request: CleanPreviewRequest): Promise<CleanPreviewResult> {
    const scope = request.scope;
    if (scope !== 'quick' && request.paths.length === 0) {
      return { ok: false, reason: 'empty-selection', message: 'Select at least one item to clean' };
    }
    const lockRoot = scope === 'quick' ? quickCleanRoot() : request.root;
    if (!onSystemDrive(lockRoot)) {
      return {
        ok: false,
        reason: 'invalid-root',
        message: `Cleanup is only available for the system drive (${systemRoot})`,
      };
    }
    const acquired = lock.acquire('quick-clean', lockRoot, now());
    if (!acquired.ok) return { ok: false, reason: 'busy', running: acquired.holder.kind };
    try {
      const base = scope === 'quick' ? await resolveQuickSource() : await resolveRootSource(request.root);
      if (base === null) {
        return {
          ok: false,
          reason: 'invalid-root',
          message: `No scan data for ${lockRoot} - run an Analyze first`,
        };
      }
      const selection = scope === 'quick' ? [] : request.paths;
      const plan = await cleaner.preview(scopeRules(base.rules, scope, selection), base.ctx);
      if (plan.items.length === 0) {
        return { ok: false, reason: 'empty-selection', message: 'Nothing to clean here' };
      }
      pendingPlans.set(plan.id, { plan, scope, root: base.root, selection: [...selection] });
      return {
        ok: true,
        preview: toCleanPreview(plan, base.source, base.root, base.scanAgeMs, {
          windowsDir: env.windowsDir || undefined,
        }),
      };
    } catch (error) {
      return { ok: false, reason: 'failed', message: messageOf(error) };
    } finally {
      lock.release();
    }
  }

  function applyCleanupEffects(pending: PendingPlan, coreReport: CoreCleanupReport): number {
    const loaded = deps.store.load();
    const baseCategories: SnapshotCategory[] =
      lastRun !== null && sameRoot(lastRun.root, pending.root)
        ? lastRun.ruleCategories
        : loaded.kind === 'ok' && sameRoot(loaded.snapshot.root, pending.root)
          ? loaded.snapshot.categories
          : [];

    const report = toCleanReport(pending.plan, pending.scope, pending.root, coreReport, 0);

    if (lastResults !== null && sameRoot(lastResults.root, pending.root)) {
      lastResults = {
        ...lastResults,
        rows: applyCleanReport(lastResults.rows, report),
        categories: summarizeCategories(subtractCategories(baseCategories, report)),
      };
    }

    if (loaded.kind === 'ok' && sameRoot(loaded.snapshot.root, pending.root)) {
      deps.store.save(pruneSnapshotAfterCleanup(loaded.snapshot, coreReport, now()));
    }

    lastRun = null;
    return summarizeCategories(subtractCategories(baseCategories, report)).reduce(
      (sum, row) => sum + row.bytes,
      0,
    );
  }

  function recordRecentlyCleaned(pending: PendingPlan, report: CleanReport): void {
    const byProject = new Map<string, RecentlyCleanedProject>();
    for (const item of report.items) {
      if (item.ruleId !== 'npm-project-modules' || item.deletedBytes <= 0) continue;
      const projectPath = pending.selection
        .filter((path) => isUnderAny(item.path, [path]))
        .sort((a, b) => b.length - a.length)[0];
      if (projectPath === undefined) continue;
      const existing = byProject.get(projectPath);
      if (existing) {
        existing.bytes += item.deletedBytes;
        continue;
      }
      byProject.set(projectPath, {
        root: pending.root,
        path: projectPath,
        name: projectNameOf(projectPath),
        bytes: item.deletedBytes,
        restoreCommand: item.restoreCommand,
        cleanedAt: report.finishedAt,
      });
    }
    for (const entry of byProject.values()) {
      recentlyCleaned = [entry, ...recentlyCleaned.filter((row) => !samePath(row.path, entry.path))];
    }
  }

  async function executeClean(request: CleanExecuteRequest): Promise<CleanExecuteResult> {
    const pending = pendingPlans.get(request.planId);
    if (!pending) return { ok: false, reason: 'unknown-plan' };
    if (!onSystemDrive(pending.root)) return { ok: false, reason: 'unknown-plan' };
    const acquired = lock.acquire('quick-clean', pending.root, now());
    if (!acquired.ok) return { ok: false, reason: 'busy', running: acquired.holder.kind };
    try {
      let coreReport: CoreCleanupReport;
      try {
        coreReport = await cleaner.execute(request.planId, {
          acknowledge: request.acknowledge,
          onItem: (result) =>
            emit({
              type: 'clean-item',
              cleanId: request.cleanId,
              item: toCleanItemResult(pending.plan, result),
            }),
        });
      } catch (error) {
        if (error instanceof PlanTokenError) return { ok: false, reason: error.code };
        return { ok: false, reason: 'failed', message: messageOf(error) };
      }
      pendingPlans.delete(request.planId);
      const remaining = applyCleanupEffects(pending, coreReport);
      const report = toCleanReport(pending.plan, pending.scope, pending.root, coreReport, remaining);
      if (pending.scope === 'dev') recordRecentlyCleaned(pending, report);
      emit({ type: 'cleaned', cleanId: request.cleanId, root: pending.root });
      return { ok: true, report };
    } finally {
      lock.release();
    }
  }

  function getDevCleanup(root: string): DevCleanupState {
    if (!onSystemDrive(root)) {
      return { source: 'empty', root, finishedAt: null, groups: [], recentlyCleaned: [] };
    }
    const pins = deps.store.getPins();
    let source: DevCleanupState['source'] = 'empty';
    let finishedAt: number | null = null;
    let projects: ProjectRecord[] = [];

    if (lastRun !== null && sameRoot(lastRun.root, root)) {
      source = 'live';
      finishedAt = lastRun.finishedAt;
      projects = lastRun.projects;
    } else {
      const loaded = deps.store.load();
      if (loaded.kind === 'ok' && sameRoot(loaded.snapshot.root, root)) {
        source = 'snapshot';
        finishedAt = loaded.snapshot.finishedAt;
        projects = loaded.snapshot.projects;
      }
    }

    const cleaned = recentlyCleaned.filter((entry) => sameRoot(entry.root, root));
    const visible = toDevProjects(projects, pins).filter(
      (entry) => !cleaned.some((candidate) => samePath(candidate.path, entry.path)),
    );
    return { source, root, finishedAt, groups: groupDevProjects(visible), recentlyCleaned: cleaned };
  }

  function setPin(path: string, pinned: boolean): SetPinResult {
    if (!onSystemDrive(path)) {
      return { ok: false, message: `Pins are only supported on the system drive (${systemRoot})` };
    }
    const current = deps.store.getPins();
    const remaining = current.filter((pin) => !samePath(pin, path));
    const next = pinned ? [...remaining, path] : remaining;
    const saved = deps.store.setPins(next);
    return saved.ok ? { ok: true, pins: next } : { ok: false, message: saved.error ?? 'could not save pins' };
  }

  function messageOf(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
  }

  async function startAnalyze(volume: string): Promise<StartAnalyzeResult> {
    const requestedRoot = volumeRootOf(volume);
    const target =
      requestedRoot === null
        ? undefined
        : instrument('start.listVolumes', () =>
            listVolumesFn().find((entry) => entry.root.toLowerCase() === requestedRoot.toLowerCase()),
          );
    if (!target) return { ok: false, reason: 'invalid-volume', message: `unknown volume: ${volume}` };
    const targetRoot = target.root;
    if (!onSystemDrive(targetRoot)) {
      return {
        ok: false,
        reason: 'not-system-drive',
        message: `Analyze is only available for the system drive (${systemRoot})`,
      };
    }

    const acquired = lock.acquire('analyze', targetRoot, now());
    if (!acquired.ok) return { ok: false, reason: 'busy', running: acquired.holder.kind };

    const runId = randomUUID();
    const startedAt = now();
    const progress = new ThrottledEmitter<ScanEvent>((event) => emit(event), {
      intervalMs: deps.progressIntervalMs ?? 100,
    });

    const folderIntervalMs = deps.folderIntervalMs ?? 100;
    const categoryIntervalMs = deps.categoryIntervalMs ?? 2000;
    const probe = createNodeFsProbe();
    const liveTree = new AggregateTree();
    const liveMarkers: Marker[] = [];
    const folderBuffer: ResultRow[] = [];
    let lastFolderFlush = 0;
    let lastCategoryRun = 0;
    let categoryRunning = false;
    let liveEnded = false;

    let rules: Rule[];

    function flushFolders(): void {
      if (folderBuffer.length === 0) return;
      emit({ type: 'folders', runId, folders: folderBuffer.splice(0) });
    }

    function maybeLiveCategories(): void {
      if (liveEnded || categoryRunning) return;
      const stamp = now();
      if (stamp - lastCategoryRun < categoryIntervalMs) return;
      lastCategoryRun = stamp;
      categoryRunning = true;
      const liveRules = rules.filter((rule) => rule.category !== 'npm-projects');
      void collectRuleMatches(liveRules, { root: targetRoot, tree: liveTree, markers: liveMarkers, probe })
        .then((matches) => {
          if (liveEnded) return;
          emit({ type: 'categories', runId, categories: summarizeCategories(aggregateCategories(matches)) });
        })
        .catch(() => {})
        .finally(() => {
          categoryRunning = false;
        });
    }

    function onLiveFolder(record: FolderRecord): void {
      if (liveEnded) return;
      instrument('tree.live.addFolder', () => {
        liveTree.addFolder(record);
      });
      folderBuffer.push(
        instrument('row.build.live', () =>
          toResultRow(record, {
            root: targetRoot,
            complete: true,
            childCount: liveTree.children(record.path).length,
            env: guard,
          }),
        ),
      );
      const stamp = now();
      if (stamp - lastFolderFlush >= folderIntervalMs) {
        lastFolderFlush = stamp;
        flushFolders();
      }
      maybeLiveCategories();
    }

    function finishLive(result: ScanResult | null): void {
      liveEnded = true;
      if (result !== null) {
        const rootNode = result.tree.get(result.root);
        if (rootNode) {
          folderBuffer.push(
            toResultRow(rootNode, {
              root: result.root,
              complete: rootNode.complete,
              childCount: result.tree.children(result.root).length,
              env: guard,
            }),
          );
        }
      }
      flushFolders();
    }

    let session: ScanSessionLike;
    try {
      let recycleBinInfo: RecycleBinInfo | Promise<RecycleBinInfo> | null = null;
      rules = createRules(
        env,
        {
          pins: deps.store.getPins(),
          isExternal: instrument('start.listVolumes', () => createExternalPredicate(listVolumesFn())),
          now,
        },
        {
          recycleBin: {
            enumerate: () => (recycleBinInfo ??= defaultRecycleBinEnumeration()),
          },
        },
      );
      session = createSession({
        root: volume,
        pool: deps.pool ?? (deps.workerPath ? { workerPath: deps.workerPath } : false),
        onFolder: onLiveFolder,
        onMarker: (marker) => liveMarkers.push(marker),
        onProgress: (update) => {
          progress.push({
            type: 'progress',
            runId,
            progress: {
              filesScanned: update.filesScanned,
              bytesSeen: update.bytesSeen,
              currentPath: update.currentPath,
              dirsCompleted: update.dirsCompleted,
              errors: update.errors,
              elapsedMs: Math.max(now() - startedAt, 0),
            },
          });
        },
      });
    } catch (error) {
      lock.release();
      return {
        ok: false,
        reason: 'start-failed',
        message: error instanceof Error ? error.message : String(error),
      };
    }
    let settle!: () => void;
    const settled = new Promise<void>((resolve) => {
      settle = resolve;
    });
    lastResults = null;
    lastRun = null;
    pendingPlans.clear();
    recentlyCleaned = [];
    active = { runId, session, settled };
    emit({ type: 'started', runId, root: target.root, startedAt });

    void runAnalysis({ session, runId, startedAt, progress, settle, rules, probe, finishLive });

    return { ok: true, runId };
  }

  async function startBrowse(volume: string): Promise<StartAnalyzeResult> {
    const requestedRoot = volumeRootOf(volume);
    const target =
      requestedRoot === null
        ? undefined
        : instrument('start.listVolumes', () =>
            listVolumesFn().find((entry) => entry.root.toLowerCase() === requestedRoot.toLowerCase()),
          );
    if (!target) return { ok: false, reason: 'invalid-volume', message: `unknown volume: ${volume}` };
    const targetRoot = target.root;

    const acquired = lock.acquire('browse', targetRoot, now());
    if (!acquired.ok) return { ok: false, reason: 'busy', running: acquired.holder.kind };

    const runId = randomUUID();
    const startedAt = now();
    const progress = new ThrottledEmitter<ScanEvent>((event) => emit(event), {
      intervalMs: deps.progressIntervalMs ?? 100,
    });
    const folderIntervalMs = deps.folderIntervalMs ?? 100;
    const liveTree = new AggregateTree();
    const rows: BrowseRow[] = [];
    const folderBuffer: BrowseRow[] = [];
    let lastFolderFlush = 0;
    let liveEnded = false;

    function flushFolders(): void {
      if (folderBuffer.length === 0) return;
      emit({ type: 'browse-folders', runId, folders: folderBuffer.splice(0) });
    }

    function onLiveFolder(record: FolderRecord): void {
      if (liveEnded) return;
      instrument('tree.browse.addFolder', () => {
        liveTree.addFolder(record);
      });
      const row = instrument('row.build.browse', () =>
        toBrowseRow(record, {
          root: targetRoot,
          complete: true,
          childCount: liveTree.children(record.path).length,
        }),
      );
      rows.push(row);
      folderBuffer.push(row);
      const stamp = now();
      if (stamp - lastFolderFlush >= folderIntervalMs) {
        lastFolderFlush = stamp;
        flushFolders();
      }
    }

    let session: ScanSessionLike;
    try {
      session = createSession({
        root: volume,
        pool: deps.pool ?? (deps.workerPath ? { workerPath: deps.workerPath } : false),
        onFolder: onLiveFolder,
        onProgress: (update) => {
          progress.push({
            type: 'progress',
            runId,
            progress: {
              filesScanned: update.filesScanned,
              bytesSeen: update.bytesSeen,
              currentPath: update.currentPath,
              dirsCompleted: update.dirsCompleted,
              errors: update.errors,
              elapsedMs: Math.max(now() - startedAt, 0),
            },
          });
        },
      });
    } catch (error) {
      lock.release();
      return { ok: false, reason: 'start-failed', message: messageOf(error) };
    }

    let settle!: () => void;
    const settled = new Promise<void>((resolve) => {
      settle = resolve;
    });
    active = { runId, session, settled };
    emit({ type: 'started', runId, root: target.root, startedAt });

    void (async () => {
      try {
        const result = await session.start();
        liveEnded = true;
        const rootNode = result.tree.get(result.root);
        if (rootNode) {
          const row = toBrowseRow(rootNode, {
            root: result.root,
            complete: rootNode.complete,
            childCount: result.tree.children(result.root).length,
          });
          rows.push(row);
          folderBuffer.push(row);
        }
        flushFolders();
        progress.flush();
        const finishedAt = now();
        lastBrowse = { root: result.root, status: result.status, finishedAt, rows, tree: result.tree };
        emit({
          type: 'browse-finished',
          runId,
          status: result.status,
          startedAt,
          finishedAt,
          filesScanned: result.filesScanned,
          bytesSeen: result.bytesSeen,
          errors: result.errors,
        });
      } catch (error) {
        liveEnded = true;
        progress.cancel();
        emit({ type: 'failed', runId, message: messageOf(error) });
      } finally {
        active = null;
        lock.release();
        settle();
      }
    })();

    return { ok: true, runId };
  }

  async function runAnalysis(input: {
    session: ScanSessionLike;
    runId: string;
    startedAt: number;
    progress: ThrottledEmitter<ScanEvent>;
    settle: () => void;
    rules: Rule[];
    probe: RuleContext['probe'];
    finishLive: (result: ScanResult | null) => void;
  }): Promise<void> {
    try {
      const result = await input.session.start();
      input.finishLive(result);
      input.progress.flush();
      emit({ type: 'finalizing', runId: input.runId });
      const summary = await finalize(result, input.startedAt, input.rules, input.probe);
      emit({ type: 'categories', runId: input.runId, categories: summary.categories });
      emit({
        type: 'matches',
        runId: input.runId,
        matches: summary.matches.map(({ path, bytes, ruleId, category, grade, evidence }) => ({
          path,
          bytes,
          ruleId,
          category,
          grade,
          evidence,
        })),
      });
      emit({
        type: 'finished',
        runId: input.runId,
        status: result.status,
        startedAt: input.startedAt,
        finishedAt: summary.finishedAt,
        filesScanned: result.filesScanned,
        bytesSeen: result.bytesSeen,
        errors: result.errors,
        projects: summary.projects,
        reclaimableBytes: summary.reclaimableBytes,
        saved: summary.saved,
      });
    } catch (error) {
      input.finishLive(null);
      input.progress.cancel();
      emit({
        type: 'failed',
        runId: input.runId,
        message: error instanceof Error ? error.message : String(error),
      });
    } finally {
      active = null;
      lock.release();
      input.settle();
    }
  }

  async function finalize(
    result: ScanResult,
    startedAt: number,
    rules: Rule[],
    probe: RuleContext['probe'],
  ): Promise<{
    finishedAt: number;
    projects: number;
    reclaimableBytes: number;
    saved: boolean;
    categories: CategorySummaryRow[];
    matches: ResultMatch[];
  }> {
    const existing = instrument('finalize.store.load', () => deps.store.load());
    const priorCleanedAt = existing.kind === 'ok' ? existing.snapshot.cleanedAt : null;
    const external = instrument('finalize.listVolumes', () => createExternalPredicate(listVolumesFn()));
    const pins = deps.store.getPins();

    const analysis = instrument('finalize.classifyProjects', () =>
      classifyProjects({
        root: result.root,
        tree: result.tree,
        markers: result.markers,
        probe,
        pins,
        isExternal: external,
        now,
      }),
    );
    const ctx: RuleContext = { root: result.root, tree: result.tree, markers: result.markers, probe };
    const matches = await instrumentAsync('finalize.collectRuleMatches', () => collectRuleMatches(rules, ctx));
    const ruleCategories = instrument('finalize.categories', () => aggregateCategories(matches));
    const categories = instrument('finalize.categories', () => summarizeCategories(ruleCategories));
    const finishedAt = now();

    lastResults = {
      root: result.root,
      status: result.status,
      finishedAt,
      categories,
      rows: instrument('row.build.final', () => buildRowsFromTree(result.tree, result.root, matches, guard)),
    };

    lastRun = {
      root: result.root,
      tree: result.tree,
      markers: result.markers,
      probe,
      rules,
      projects: analysis.projects,
      ruleCategories,
      finishedAt,
    };

    const usage = instrument('finalize.volumes', () =>
      getVolumeUsageFn(listVolumesFn().map((volume) => volume.root)),
    );
    const snapshot = instrument('finalize.buildSnapshot', () =>
      buildSnapshot({
        root: result.root,
        startedAt,
        finishedAt,
        status: result.status,
        tree: result.tree,
        projects: analysis.projects,
        categories: ruleCategories,
        matches: matches.map(
          (match): SnapshotMatch => ({
            path: match.path,
            ruleId: match.ruleId,
            category: match.category,
            bytes: match.bytes,
            grade: match.grade,
            evidence: match.evidence,
          }),
        ),
        disks: usage.map((entry) => ({
          volume: entry.volume,
          totalBytes: entry.totalBytes,
          freeBytes: entry.freeBytes,
        })),
        priorCleanedAt,
      }),
    );
    const save = instrument('finalize.store.save', () => deps.store.save(snapshot));

    return {
      finishedAt,
      projects: analysis.projects.length,
      reclaimableBytes: categories.reduce((sum, entry) => sum + entry.bytes, 0),
      saved: save.ok,
      categories,
      matches,
    };
  }

  async function cancelScan(): Promise<boolean> {
    const run = active;
    if (!run) return false;
    run.session.cancel();
    await run.settled;
    return true;
  }

  function getResults(requestedRoot: string): ResultsState {
    if (lastResults !== null && sameRoot(lastResults.root, requestedRoot)) {
      return {
        source: 'live',
        root: lastResults.root,
        finishedAt: lastResults.finishedAt,
        status: lastResults.status,
        rulesStale: false,
        depthLimited: false,
        categories: lastResults.categories,
        rows: lastResults.rows,
      };
    }

    const loaded = deps.store.load();
    if (loaded.kind === 'ok' && sameRoot(loaded.snapshot.root, requestedRoot)) {
      const cached = snapshotResultsCache.get(loaded.snapshot);
      if (cached !== undefined) return cached;
      const state: ResultsState = {
        source: 'snapshot',
        root: loaded.snapshot.root,
        finishedAt: loaded.snapshot.finishedAt,
        status: loaded.snapshot.status,
        rulesStale: loaded.snapshot.rulesVersion !== RULES_VERSION,
        depthLimited: true,
        categories: summarizeCategories(loaded.snapshot.categories),
        rows: buildRowsFromSnapshot(loaded.snapshot, guard),
      };
      snapshotResultsCache.set(loaded.snapshot, state);
      return state;
    }

    return {
      source: 'empty',
      root: requestedRoot,
      finishedAt: null,
      status: null,
      rulesStale: false,
      depthLimited: false,
      categories: summarizeCategories([]),
      rows: [],
    };
  }

  function getBrowseResults(requestedRoot: string): BrowseState {
    if (lastBrowse !== null && sameRoot(lastBrowse.root, requestedRoot)) {
      return {
        source: 'live',
        root: lastBrowse.root,
        finishedAt: lastBrowse.finishedAt,
        status: lastBrowse.status,
        rows: lastBrowse.rows,
      };
    }
    return { source: 'empty', root: requestedRoot, finishedAt: null, status: null, rows: [] };
  }

  function browseRefusal(path: string, refusal: string): BrowseDeleteResult {
    return { path, status: 'refused', deletedBytes: 0, skippedLocked: 0, errors: [], refusal };
  }

  function applyBrowseDelete(rows: BrowseRow[], result: BrowseDeleteResult): void {
    if (result.status === 'refused' || result.status === 'failed' || result.deletedBytes === 0) return;

    const removed = result.status === 'done' || result.status === 'already-gone';
    for (const row of rows) {
      const isTarget = samePath(row.path, result.path);
      if (isTarget) {
        if (!removed) row.bytes = Math.max(row.bytes - result.deletedBytes, 0);
        continue;
      }
      if (isUnderAny(result.path, [row.path])) {
        row.bytes = Math.max(row.bytes - result.deletedBytes, 0);
      }
    }

    if (removed) {
      const remaining = rows.filter((row) => !isUnderAny(row.path, [result.path]));
      rows.length = 0;
      rows.push(...remaining);
    }
  }

  async function deleteBrowsePath(path: string): Promise<BrowseDeleteResult> {
    if (active !== null) return browseRefusal(path, 'busy');
    if (lastBrowse === null || !isUnderAny(path, [lastBrowse.root])) {
      return browseRefusal(path, 'not-browsed');
    }

    const result = deleteUnprotectedPath(path, { guard: guardEnv(env) });
    applyBrowseDelete(lastBrowse.rows, result);
    return result;
  }

  function onEvent(listener: (event: ScanEvent) => void): () => void {
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  }

  function dispose(): void {
    active?.session.cancel();
    listeners.clear();
  }

  return {
    getDashboard,
    startAnalyze,
    startBrowse,
    cancelScan,
    getResults,
    getBrowseResults,
    deleteBrowsePath,
    previewClean,
    executeClean,
    getDevCleanup,
    setPin,
    onEvent,
    dispose,
  };
}
