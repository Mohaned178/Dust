import { basename, join } from 'node:path';
import {
  UNINSTALL_PENDING_TTL_MS,
  Journal,
  buildRemovalPlan,
  defaultRuleEnv,
  executeRemoval,
  fullRegistryPath,
  listRemovalApps,
  resetInstalledAppsCache,
  resetRegistrySnapshotCache,
  resolveUninstallerCommand,
  uninstallerRequiresAdmin,
} from '@dust/core';
import type {
  InstalledApp,
  InstalledAppsSnapshot,
  RemovalAppsOptions,
  RemovalEvent,
  RemovalExecutionDeps,
  RemovalExecutionRequest,
  RemovalExecutionResult,
  RemovalPlan,
  RemovalPlanEnv,
  RemovalPlanInput,
  RemovalTotals,
  RuleEnv,
  StartupActions,
  StartupEntryRecord,
} from '@dust/core';
import type {
  ScanKind,
  UninstallAppSummary,
  UninstallExecuteRequest,
  UninstallExecuteResult,
  UninstallEvent,
  UninstallItemPreview,
  UninstallListResult,
  UninstallPreview,
  UninstallPreviewResult,
} from '../../shared/ipc';

export interface ScanLockLike {
  acquire(kind: ScanKind, root: string, now?: number): { ok: boolean; holder: { kind: ScanKind } };
  release(): void;
  current(): { kind: ScanKind } | null;
}

export interface UninstallServiceDeps {
  store: { markAppsChanged(at?: number): unknown };
  env?: RuleEnv;
  systemRoot?: string;
  dustInstallPath?: string;
  elevated?: boolean;
  now?: () => number;
  journalPath: string;
  backupDir: string;
  lock?: ScanLockLike;
  listApps?: (options?: RemovalAppsOptions) => Promise<InstalledAppsSnapshot>;
  buildPlan?: (input: RemovalPlanInput) => Promise<RemovalPlan>;
  executePlan?: (request: RemovalExecutionRequest, deps: RemovalExecutionDeps) => Promise<RemovalExecutionResult>;
  records?: () => Promise<StartupEntryRecord[]>;
  startupActions?: StartupActions;
  resetAppsCache?: () => void;
  createJournal?: (options: { path: string; planId: string; appId: string }) => Pick<Journal, 'append'>;
}

export interface UninstallService {
  list(force?: boolean): Promise<UninstallListResult>;
  preview(appId: string): Promise<UninstallPreviewResult>;
  execute(request: UninstallExecuteRequest): Promise<UninstallExecuteResult>;
  skipWaiting(): void;
  elevatedHandoff(jobId: string): { jobId: string; appId: string } | null;
  onEvent(listener: (event: UninstallEvent) => void): () => void;
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function localLowFor(env: RuleEnv): string {
  return env.userProfile.length > 0 ? join(env.userProfile, 'AppData', 'LocalLow') : '';
}

export function createUninstallService(deps: UninstallServiceDeps): UninstallService {
  const now = deps.now ?? Date.now;
  const env = deps.env ?? defaultRuleEnv();
  const listApps = deps.listApps ?? ((options?: RemovalAppsOptions) => listRemovalApps(options));
  const buildPlan = deps.buildPlan ?? buildRemovalPlan;
  const executePlan = deps.executePlan ?? executeRemoval;
  const resetApps = deps.resetAppsCache ?? resetInstalledAppsCache;
  const elevated = deps.elevated === true;
  const listeners = new Set<(event: UninstallEvent) => void>();
  const pending = new Map<string, { plan: RemovalPlan; createdAt: number; request: UninstallExecuteRequest | null }>();
  const consumed = new Set<string>();
  let skipRequested = false;

  function emit(event: UninstallEvent): void {
    for (const listener of [...listeners]) {
      try {
        listener(event);
      } catch {
        /* observers must never break a removal run */
      }
    }
  }

  function prune(): void {
    for (const [id, entry] of pending) {
      if (now() - entry.createdAt >= UNINSTALL_PENDING_TTL_MS) pending.delete(id);
    }
  }

  function planEnvFor(app: InstalledApp): RemovalPlanEnv {
    return {
      roots: {
        localAppData: env.localAppData,
        appData: env.appData,
        localLow: localLowFor(env),
        programData: env.programData,
        temp: env.temp,
      },
      installLocation: app.installLocation,
      home: env.userProfile,
      systemRoot: deps.systemRoot ?? env.windowsDir,
      dustInstallPath: deps.dustInstallPath,
    };
  }

  function toSummary(app: InstalledApp): UninstallAppSummary {
    const command = resolveUninstallerCommand(app, planEnvFor(app));
    return {
      id: app.id,
      displayName: app.displayName,
      publisher: app.publisher,
      version: app.version,
      installLocation: app.installLocation,
      estimatedSizeKb: app.estimatedSizeKb,
      hive: app.hive,
      kind: command.kind,
      requiresAdmin: uninstallerRequiresAdmin(app, planEnvFor(app)),
      hasUninstaller: app.uninstallString.trim().length > 0 && command.launchable,
    };
  }

  function toPreview(plan: RemovalPlan, app: InstalledApp): UninstallPreview {
    const items: UninstallItemPreview[] = [
      ...plan.leftovers.map((item): UninstallItemPreview => ({
        id: item.id,
        kind: 'file',
        target: item.path,
        label: basename(item.path) || item.path,
        bytes: item.bytes,
        grade: item.grade,
        dataClass: item.class,
        evidence: item.evidence,
        adminRequired: item.adminRequired,
        defaultSelected: item.defaultSelected,
        syncRoot: item.syncRoot,
      })),
      ...plan.registry.map((item): UninstallItemPreview => ({
        id: item.id,
        kind: 'registry',
        target: fullRegistryPath(item.hive, item.path),
        label: fullRegistryPath(item.hive, item.path),
        bytes: null,
        grade: item.grade,
        evidence: [`${item.scope} (${item.hive})`],
        adminRequired: item.adminRequired,
        defaultSelected: item.grade === 'safe',
      })),
      ...plan.startup
        .filter((item) => item.action !== 'none')
        .map((item): UninstallItemPreview => ({
          id: item.entryId,
          kind: 'startup',
          target: item.name,
          label: item.name,
          bytes: null,
          grade: 'safe',
          evidence: [item.action === 'disable' ? 'Turn off at sign-in' : 'Remove Dust backup'],
          adminRequired: item.requiresAdmin,
          defaultSelected: item.match === 'path',
        })),
    ];
    const totals: RemovalTotals = plan.totals;
    return {
      planId: plan.id,
      createdAt: plan.createdAt,
      app: toSummary(app),
      uninstaller:
        plan.uninstaller === null
          ? null
          : {
              raw: plan.uninstaller.command.raw,
              argv: plan.uninstaller.command.args,
              kind: plan.uninstaller.command.kind,
              launchable: plan.uninstaller.command.launchable,
              requiresAdmin: plan.uninstaller.requiresAdmin,
              interactiveOnly: plan.uninstaller.interactiveOnly,
              silent:
                plan.uninstaller.silent === null
                  ? null
                  : { argv: plan.uninstaller.silent.args, wellFormed: plan.uninstaller.silent.wellFormed },
              blockReason: plan.uninstaller.command.blockReason,
            },
      items,
      kept: plan.kept,
      totals,
    };
  }

  async function listSnapshot(force: boolean): Promise<InstalledAppsSnapshot> {
    if (force) {
      resetApps();
      resetRegistrySnapshotCache();
    }
    return listApps({ systemRoot: deps.systemRoot, dustInstallPath: deps.dustInstallPath });
  }

  async function list(force = false): Promise<UninstallListResult> {
    try {
      const snapshot = await listSnapshot(force);
      return {
        ok: true,
        apps: snapshot.apps.map(toSummary),
        trusted: snapshot.trusted,
        elevated,
        loadedAt: now(),
      };
    } catch (error) {
      return { ok: false, message: messageOf(error) };
    }
  }

  async function preview(appId: string): Promise<UninstallPreviewResult> {
    prune();
    try {
      const snapshot = await listSnapshot(false);
      const app = snapshot.apps.find((entry) => entry.id === appId);
      if (app === undefined) {
        return { ok: false, reason: 'not-found', message: 'This app is no longer installed.' };
      }
      const records = deps.records === undefined ? [] : await deps.records().catch(() => []);
      const plan = await buildPlan({ app, apps: snapshot.apps, env: planEnvFor(app), startup: records });
      if (
        plan.uninstaller === null &&
        plan.leftovers.length === 0 &&
        plan.registry.length === 0 &&
        plan.startup.length === 0
      ) {
        return { ok: false, reason: 'nothing-to-remove', message: 'Nothing can be removed for this app.' };
      }
      pending.set(plan.id, { plan, createdAt: now(), request: null });
      return { ok: true, preview: toPreview(plan, app) };
    } catch (error) {
      return { ok: false, reason: 'failed', message: messageOf(error) };
    }
  }

  async function execute(request: UninstallExecuteRequest): Promise<UninstallExecuteResult> {
    prune();
    if (consumed.has(request.planId)) return { ok: false, reason: 'consumed-plan' };
    const entry = pending.get(request.planId);
    if (entry === undefined) return { ok: false, reason: 'unknown-plan' };
    entry.request = request;

    const lock = deps.lock;
    if (lock !== undefined) {
      const acquired = lock.acquire('uninstall', entry.plan.app.installLocation || deps.systemRoot || '', now());
      if (!acquired.ok) return { ok: false, reason: 'busy', running: acquired.holder.kind };
    }

    pending.delete(request.planId);
    consumed.add(request.planId);
    skipRequested = false;

    const makeJournal =
      deps.createJournal ?? ((options: { path: string; planId: string; appId: string }) => new Journal(options));
    const journal = makeJournal({
      path: deps.journalPath,
      planId: entry.plan.id,
      appId: entry.plan.appId,
    });

    try {
      const result = await executePlan(
        {
          plan: entry.plan,
          selection: request.selection,
          acknowledge: request.acknowledge,
          includeUserData: request.includeUserData,
          runUninstaller: request.runUninstaller,
          quiet: request.quiet,
          degraded: !elevated,
          elevated,
        },
        {
          backupDir: deps.backupDir,
          journalPath: deps.journalPath,
          journal,
          now,
          startup: deps.startupActions,
          shouldStopWaiting: () => skipRequested,
          onEvent: (event) => emit(removalEventToIpc(request.jobId, event)),
        },
      );
      if (!result.ok) {
        return result.reason === 'unacknowledged-review'
          ? {
              ok: false,
              reason: 'unacknowledged-review',
              message: `Review items need acknowledgement: ${result.items.join(', ')}`,
            }
          : { ok: false, reason: 'no-selection', message: 'Nothing was selected.' };
      }
      resetApps();
      resetRegistrySnapshotCache();
      deps.store.markAppsChanged(now());
      emit({ type: 'finished', jobId: request.jobId, report: result.report });
      return { ok: true, report: result.report };
    } catch (error) {
      emit({ type: 'failed', jobId: request.jobId, message: messageOf(error) });
      return { ok: false, reason: 'failed', message: messageOf(error) };
    } finally {
      lock?.release();
    }
  }

  function skipWaiting(): void {
    skipRequested = true;
  }

  function elevatedHandoff(jobId: string): { jobId: string; appId: string } | null {
    prune();
    const entry = pending.get(jobId);
    if (entry === undefined) return null;
    return { jobId, appId: entry.plan.appId };
  }

  function onEvent(listener: (event: UninstallEvent) => void): () => void {
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  }

  return { list, preview, execute, skipWaiting, elevatedHandoff, onEvent };
}

function removalEventToIpc(jobId: string, event: RemovalEvent): UninstallEvent {
  switch (event.type) {
    case 'phase':
      return {
        type: 'phase',
        jobId,
        phase: event.phase,
        status: event.status,
        ...(event.note === undefined ? {} : { note: event.note }),
      };
    case 'uninstaller-started':
      return { type: 'uninstaller-started', jobId, pid: event.pid, argv: event.argv };
    case 'uninstaller-exited':
      return { type: 'uninstaller-exited', jobId, exitCode: event.exitCode };
    case 'reboot-required':
      return { type: 'uninstaller-reboot-required', jobId };
    case 'verify':
      return { type: 'verify', jobId, gone: event.gone, attempt: event.attempt };
    default:
      return {
        type: 'item',
        jobId,
        itemId: event.itemId,
        status: event.status,
        bytes: event.bytes,
      };
  }
}
