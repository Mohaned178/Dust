import { randomUUID } from 'node:crypto';
import {
  ScanSession,
  buildSnapshot,
  classifyProjects,
  createExternalPredicate,
  createInventoryRules,
  createNodeFsProbe,
  defaultRuleEnv,
  getVolumeUsage,
  listVolumes,
  volumeRootOf,
} from '@dust/core';
import type {
  ProjectOptions,
  Rule,
  RuleContext,
  RuleEnv,
  ScanResult,
  SessionOptions,
  VolumeInfo,
  VolumeUsage,
} from '@dust/core';
import type { SnapshotStore } from '@dust/core';
import type { DashboardState, ScanEvent, StartAnalyzeResult } from '../../shared/ipc';
import { aggregateCategories, collectRuleMatches } from './analyze';
import { buildDashboardState } from './dashboard';
import { ScanLock } from './scan-lock';
import { ThrottledEmitter } from './throttler';

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
  listVolumes?: () => VolumeInfo[];
  getVolumeUsage?: (volumes: string[]) => VolumeUsage[];
  createSession?: (options: SessionOptions) => ScanSessionLike;
  createRules?: (env: RuleEnv, projects: ProjectOptions) => Rule[];
}

export interface EngineHost {
  getDashboard(): DashboardState;
  startAnalyze(volume: string): Promise<StartAnalyzeResult>;
  cancelScan(): boolean;
  onEvent(listener: (event: ScanEvent) => void): () => void;
  dispose(): void;
}

export function createEngineHost(deps: EngineHostDeps): EngineHost {
  const now = deps.now ?? Date.now;
  const listVolumesFn = deps.listVolumes ?? listVolumes;
  const getVolumeUsageFn = deps.getVolumeUsage ?? getVolumeUsage;
  const env = deps.env ?? defaultRuleEnv();
  const createSession = deps.createSession ?? ((options: SessionOptions) => new ScanSession(options));
  const createRules =
    deps.createRules ??
    ((ruleEnv: RuleEnv, projects: ProjectOptions) => createInventoryRules(ruleEnv, { projects }));
  const listeners = new Set<(event: ScanEvent) => void>();
  const lock = new ScanLock();

  let active: { runId: string; session: ScanSessionLike } | null = null;

  function emit(event: ScanEvent): void {
    for (const listener of [...listeners]) listener(event);
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

    const acquired = lock.acquire('analyze', target.root, now());
    if (!acquired.ok) return { ok: false, reason: 'busy', running: acquired.holder.kind };

    const runId = randomUUID();
    const startedAt = now();
    const progress = new ThrottledEmitter<ScanEvent>((event) => emit(event), {
      intervalMs: deps.progressIntervalMs ?? 100,
    });

    let session: ScanSessionLike;
    try {
      session = createSession({
        root: volume,
        pool: deps.pool ?? (deps.workerPath ? { workerPath: deps.workerPath } : false),
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
    active = { runId, session };
    emit({ type: 'started', runId, root: target.root, startedAt });

    void runAnalysis({ session, runId, startedAt, progress });

    return { ok: true, runId };
  }

  async function runAnalysis(input: {
    session: ScanSessionLike;
    runId: string;
    startedAt: number;
    progress: ThrottledEmitter<ScanEvent>;
  }): Promise<void> {
    try {
      const result = await input.session.start();
      input.progress.flush();
      emit({ type: 'finalizing', runId: input.runId });
      const summary = await finalize(result, input.startedAt);
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
      input.progress.cancel();
      emit({
        type: 'failed',
        runId: input.runId,
        message: error instanceof Error ? error.message : String(error),
      });
    } finally {
      active = null;
      lock.release();
    }
  }

  async function finalize(
    result: ScanResult,
    startedAt: number,
  ): Promise<{ finishedAt: number; projects: number; reclaimableBytes: number; saved: boolean }> {
    const probe = createNodeFsProbe();
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
    const rules = createRules(env, { pins, isExternal: external, now });
    const ctx: RuleContext = { root: result.root, tree: result.tree, markers: result.markers, probe };
    const categories = aggregateCategories(await collectRuleMatches(rules, ctx));

    const usage = getVolumeUsageFn(listVolumesFn().map((volume) => volume.root));
    const finishedAt = now();
    const snapshot = buildSnapshot({
      root: result.root,
      startedAt,
      finishedAt,
      status: result.status,
      tree: result.tree,
      projects: analysis.projects,
      categories,
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
    };
  }

  function cancelScan(): boolean {
    if (!active) return false;
    active.session.cancel();
    return true;
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

  return { getDashboard, startAnalyze, cancelScan, onEvent, dispose };
}
