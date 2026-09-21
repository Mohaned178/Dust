import { randomUUID } from 'node:crypto';
import {
  AggregateTree,
  RULES_VERSION,
  ScanSession,
  buildSnapshot,
  classifyProjects,
  createExternalPredicate,
  createInventoryRules,
  createNodeFsProbe,
  defaultRecycleBinEnumeration,
  defaultRuleEnv,
  getVolumeUsage,
  listVolumes,
  volumeRootOf,
} from '@dust/core';
import type {
  FolderRecord,
  Marker,
  ProjectOptions,
  RecycleBinInfo,
  Rule,
  RuleContext,
  RuleEnv,
  ScanResult,
  SessionOptions,
  SnapshotMatch,
  VolumeInfo,
  VolumeUsage,
} from '@dust/core';
import type { SnapshotStore } from '@dust/core';
import type {
  CategorySummaryRow,
  DashboardState,
  ResultMatch,
  ResultRow,
  ResultsState,
  ScanEvent,
  StartAnalyzeResult,
} from '../../shared/ipc';
import { aggregateCategories, collectRuleMatches } from './analyze';
import { buildDashboardState } from './dashboard';
import { ScanLock } from './scan-lock';
import { ThrottledEmitter } from './throttler';
import { buildRowsFromSnapshot, buildRowsFromTree, sameRoot, summarizeCategories, toResultRow } from './results';
import type { ResultsEnv } from './results';

export interface ScanSessionLike {
  start(): Promise<ScanResult>;
  cancel(): void;
}

export interface EngineHostDeps {
  store: SnapshotStore;
  workerPath?: string;
  pool?: SessionOptions['pool'];
  env?: RuleEnv;
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
}

export interface EngineHost {
  getDashboard(): DashboardState;
  startAnalyze(volume: string): Promise<StartAnalyzeResult>;
  cancelScan(): Promise<boolean>;
  getResults(root: string): ResultsState;
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

export function createEngineHost(deps: EngineHostDeps): EngineHost {
  const now = deps.now ?? Date.now;
  const listVolumesFn = deps.listVolumes ?? listVolumes;
  const getVolumeUsageFn = deps.getVolumeUsage ?? getVolumeUsage;
  const env = deps.env ?? defaultRuleEnv();
  const createSession = deps.createSession ?? ((options: SessionOptions) => new ScanSession(options));
  const createRules =
    deps.createRules ??
    ((ruleEnv: RuleEnv, projects: ProjectOptions, options) =>
      createInventoryRules(ruleEnv, { projects, recycleBin: options.recycleBin }));
  const listeners = new Set<(event: ScanEvent) => void>();
  const lock = new ScanLock();

  let active: { runId: string; session: ScanSessionLike; settled: Promise<void> } | null = null;

  let lastResults: {
    root: string;
    status: 'complete' | 'cancelled';
    finishedAt: number;
    categories: CategorySummaryRow[];
    rows: ResultRow[];
  } | null = null;

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
    return buildDashboardState({ volumes, usage, snapshot: deps.store.load(), scan: lock.current() });
  }

  async function startAnalyze(volume: string): Promise<StartAnalyzeResult> {
    const requestedRoot = volumeRootOf(volume);
    const target =
      requestedRoot === null
        ? undefined
        : listVolumesFn().find((entry) => entry.root.toLowerCase() === requestedRoot.toLowerCase());
    if (!target) return { ok: false, reason: 'invalid-volume', message: `unknown volume: ${volume}` };
    const targetRoot = target.root;

    const acquired = lock.acquire('analyze', targetRoot, now());
    if (!acquired.ok) return { ok: false, reason: 'busy', running: acquired.holder.kind };

    const runId = randomUUID();
    const startedAt = now();
    lastResults = null;
    const progress = new ThrottledEmitter<ScanEvent>((event) => emit(event), {
      intervalMs: deps.progressIntervalMs ?? 100,
    });

    const folderIntervalMs = deps.folderIntervalMs ?? 100;
    const categoryIntervalMs = deps.categoryIntervalMs ?? 2000;
    const guard = guardEnv(env);
    const probe = createNodeFsProbe();
    const liveTree = new AggregateTree();
    const liveMarkers: Marker[] = [];
    const folderBuffer: ResultRow[] = [];
    let lastFolderFlush = 0;
    let lastCategoryRun = 0;
    let categoryRunning = false;
    let liveEnded = false;

    let recycleBinInfo: RecycleBinInfo | null = null;
    const rules = createRules(
      env,
      { pins: deps.store.getPins(), isExternal: createExternalPredicate(listVolumesFn()), now },
      {
        recycleBin: {
          enumerate: () => (recycleBinInfo ??= defaultRecycleBinEnumeration()),
        },
      },
    );

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
      void collectRuleMatches(rules, { root: targetRoot, tree: liveTree, markers: liveMarkers, probe })
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
      liveTree.addFolder(record);
      folderBuffer.push(
        toResultRow(record, {
          root: targetRoot,
          complete: true,
          childCount: liveTree.children(record.path).length,
          env: guard,
        }),
      );
      const stamp = now();
      if (stamp - lastFolderFlush >= folderIntervalMs) {
        lastFolderFlush = stamp;
        flushFolders();
      }
      maybeLiveCategories();
    }

    function finishLive(): void {
      liveEnded = true;
      flushFolders();
    }

    let session: ScanSessionLike;
    try {
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
    active = { runId, session, settled };
    emit({ type: 'started', runId, root: target.root, startedAt });

    void runAnalysis({ session, runId, startedAt, progress, settle, rules, probe, finishLive });

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
    finishLive: () => void;
  }): Promise<void> {
    try {
      const result = await input.session.start();
      input.finishLive();
      input.progress.flush();
      emit({ type: 'finalizing', runId: input.runId });
      const summary = await finalize(result, input.startedAt, input.rules, input.probe);
      emit({ type: 'categories', runId: input.runId, categories: summary.categories });
      emit({ type: 'matches', runId: input.runId, matches: summary.matches });
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
      input.finishLive();
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
    const existing = deps.store.load();
    const priorCleanedAt = existing.kind === 'ok' ? existing.snapshot.cleanedAt : null;
    const external = createExternalPredicate(listVolumesFn());
    const pins = deps.store.getPins();

    const analysis = classifyProjects({
      root: result.root,
      tree: result.tree,
      markers: result.markers,
      probe,
      pins,
      isExternal: external,
      now,
    });
    const ctx: RuleContext = { root: result.root, tree: result.tree, markers: result.markers, probe };
    const matches = await collectRuleMatches(rules, ctx);
    const ruleCategories = aggregateCategories(matches);
    const categories = summarizeCategories(ruleCategories);
    const finishedAt = now();

    lastResults = {
      root: result.root,
      status: result.status,
      finishedAt,
      categories,
      rows: buildRowsFromTree(result.tree, result.root, matches, guardEnv(env)),
    };

    const usage = getVolumeUsageFn(listVolumesFn().map((volume) => volume.root));
    const snapshot = buildSnapshot({
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
    });
    const save = deps.store.save(snapshot);

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
      return {
        source: 'snapshot',
        root: loaded.snapshot.root,
        finishedAt: loaded.snapshot.finishedAt,
        status: loaded.snapshot.status,
        rulesStale: loaded.snapshot.rulesVersion !== RULES_VERSION,
        depthLimited: true,
        categories: summarizeCategories(loaded.snapshot.categories),
        rows: buildRowsFromSnapshot(loaded.snapshot, guardEnv(env)),
      };
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

  return { getDashboard, startAnalyze, cancelScan, getResults, onEvent, dispose };
}
