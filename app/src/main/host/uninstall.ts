import { basename, join } from 'node:path';
import {
  UNINSTALL_PENDING_TTL_MS,
  Journal,
  appCaution,
  buildRemovalPlan,
  defaultDirectorySizeAsync,
  defaultRuleEnv,
  executeRemoval,
  fullRegistryPath,
  listRemovalApps,
  normalizePlanPath,
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
  UninstallPreviewOptions,
  UninstallPreviewResult,
  UninstallRunRequest,
  UninstallRunResult,
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
  measureDirectory?: (path: string) => Promise<number | null>;
  /** Loads an icon file (.exe, .dll or .ico) as a data URL. */
  loadIcon?: (path: string) => Promise<string | null>;
  /** Send sizes and icons as 'app-sizes' / 'app-icons' arrays every 100 ms instead of one event each. */
  batchAppEvents?: boolean;
}

export interface UninstallService {
  list(force?: boolean): Promise<UninstallListResult>;
  preview(appId: string, options?: UninstallPreviewOptions): Promise<UninstallPreviewResult>;
  runUninstaller(request: UninstallRunRequest): Promise<UninstallRunResult>;
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
  const measureDirectory = deps.measureDirectory ?? defaultDirectorySizeAsync;
  // Apps whose uninstaller ran this session, kept so their leftovers can still
  // be scanned once the registry entry is gone.
  const uninstalled = new Map<string, InstalledApp>();

  const BATCH_INTERVAL_MS = 100;
  const batchAppEvents = deps.batchAppEvents === true;
  let pendingSizes: Array<{ appId: string; bytes: number }> = [];
  let pendingIcons: Array<{ appId: string; iconDataUrl: string }> = [];
  let batchTimer: ReturnType<typeof setTimeout> | null = null;

  function flushBatches(): void {
    if (batchTimer !== null) clearTimeout(batchTimer);
    batchTimer = null;
    const sizes = pendingSizes;
    const icons = pendingIcons;
    pendingSizes = [];
    pendingIcons = [];
    if (sizes.length > 0) emit({ type: 'app-sizes', sizes });
    if (icons.length > 0) emit({ type: 'app-icons', icons });
  }

  function queueBatch(): void {
    if (batchTimer !== null) return;
    batchTimer = setTimeout(flushBatches, BATCH_INTERVAL_MS);
    batchTimer.unref?.();
  }

  function emitAppSize(appId: string, bytes: number): void {
    if (!batchAppEvents) {
      emit({ type: 'app-size', appId, bytes });
      return;
    }
    pendingSizes.push({ appId, bytes });
    queueBatch();
  }

  function emitAppIcon(appId: string, iconDataUrl: string): void {
    if (!batchAppEvents) {
      emit({ type: 'app-icon', appId, iconDataUrl });
      return;
    }
    pendingIcons.push({ appId, iconDataUrl });
    queueBatch();
  }

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
      sizeBytes: sizes.get(sizeKey(app)) ?? null,
      iconDataUrl: icons.get(app.id) ?? null,
      hive: app.hive,
      kind: command.kind,
      requiresAdmin: uninstallerRequiresAdmin(app, planEnvFor(app)),
      hasUninstaller: app.uninstallString.trim().length > 0 && command.launchable,
      caution: appCaution(app),
    };
  }

  // The registry's EstimatedSize is often missing or copied from an installer
  // (two different games reporting the identical size), so install folders
  // are measured in the background and streamed to the list as they finish.
  const sizes = new Map<string, number>();
  let sizing: Promise<void> | null = null;

  function sizeKey(app: InstalledApp): string {
    return `${app.id}|${app.installLocation.trim().toLowerCase()}`;
  }

  function measurable(location: string): string | null {
    const normalized = normalizePlanPath(location);
    if (normalized === null) return null;
    const key = normalized.toLowerCase();
    const roots = [
      process.env.ProgramFiles,
      process.env['ProgramFiles(x86)'],
      env.programData,
      env.windowsDir,
      env.userProfile,
      env.localAppData,
      env.appData,
    ]
      .filter((root): root is string => typeof root === 'string' && root.length > 0)
      .map((root) => root.replace(/[\\/]+$/, '').toLowerCase());
    return roots.includes(key) ? null : normalized;
  }

  function measureSizes(apps: readonly InstalledApp[]): void {
    if (sizing !== null) return;
    const queue = apps.filter((app) => !sizes.has(sizeKey(app)) && measurable(app.installLocation) !== null);
    if (queue.length === 0) return;
    sizing = (async () => {
      for (const app of queue) {
        const location = measurable(app.installLocation)!;
        const bytes = await measureDirectory(location).catch(() => null);
        if (bytes === null) continue;
        sizes.set(sizeKey(app), bytes);
        emitAppSize(app.id, bytes);
      }
    })().finally(() => {
      sizing = null;
    });
  }

  // Icons come from the app's DisplayIcon and, like sizes, stream in after the
  // list so the first paint never waits on the shell.
  const loadIcon = deps.loadIcon;
  const icons = new Map<string, string | null>();
  let iconing: Promise<void> | null = null;

  function loadIcons(apps: readonly InstalledApp[]): void {
    if (loadIcon === undefined || iconing !== null) return;
    const queue = apps.filter((app) => !icons.has(app.id));
    if (queue.length === 0) return;
    iconing = (async () => {
      for (let start = 0; start < queue.length; start += 8) {
        await Promise.all(
          queue.slice(start, start + 8).map(async (app) => {
            const path = iconPathOf(app.displayIcon);
            const icon = path === null ? null : await loadIcon(path).catch(() => null);
            icons.set(app.id, icon);
            if (icon !== null) emitAppIcon(app.id, icon);
          }),
        );
      }
    })().finally(() => {
      iconing = null;
    });
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
      measureSizes(snapshot.apps);
      loadIcons(snapshot.apps);
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

  async function preview(appId: string, options: UninstallPreviewOptions = {}): Promise<UninstallPreviewResult> {
    prune();
    try {
      const leftoversOnly = options.leftoversOnly === true;
      // After an uninstall the registry and app list have changed: read both fresh.
      const snapshot = await listSnapshot(leftoversOnly);
      const registered = snapshot.apps.find((entry) => entry.id === appId);
      const app = registered ?? (leftoversOnly ? uninstalled.get(appId) : undefined);
      if (app === undefined) {
        return { ok: false, reason: 'not-found', message: 'This app is no longer installed.' };
      }
      const records = deps.records === undefined ? [] : await deps.records().catch(() => []);
      const plan = await buildPlan({
        app,
        apps: snapshot.apps,
        env: planEnvFor(app),
        startup: records,
        ...(leftoversOnly ? { skipUninstaller: true, uninstallKeyPresent: registered !== undefined } : {}),
      });
      // After the uninstaller ran, an empty scan is the good outcome: nothing left behind.
      if (
        !leftoversOnly &&
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

  // Step one of an uninstall: run the app's own uninstaller and wait for its
  // whole process tree. Leftovers are scanned afterwards (preview with
  // leftoversOnly), so only what the uninstaller actually left is offered.
  async function runUninstaller(request: UninstallRunRequest): Promise<UninstallRunResult> {
    let app: InstalledApp | undefined;
    let plan: RemovalPlan;
    try {
      const snapshot = await listSnapshot(false);
      app = snapshot.apps.find((entry) => entry.id === request.appId);
      if (app === undefined) {
        return { ok: false, reason: 'not-found', message: 'This app is no longer installed.' };
      }
      plan = await buildPlan({ app, apps: snapshot.apps, env: planEnvFor(app), uninstallerOnly: true });
    } catch (error) {
      return { ok: false, reason: 'failed', message: messageOf(error) };
    }
    if (plan.uninstaller === null || !plan.uninstaller.command.launchable) {
      return {
        ok: false,
        reason: 'no-uninstaller',
        message: `${app.displayName} has no uninstaller Dust can run.`,
      };
    }

    const lock = deps.lock;
    if (lock !== undefined) {
      const acquired = lock.acquire('uninstall', app.installLocation || deps.systemRoot || '', now());
      if (!acquired.ok) return { ok: false, reason: 'busy', running: acquired.holder.kind };
    }
    uninstalled.set(app.id, app);
    skipRequested = false;
    const makeJournal =
      deps.createJournal ?? ((options: { path: string; planId: string; appId: string }) => new Journal(options));
    try {
      const result = await executePlan(
        {
          plan,
          selection: [],
          includeUserData: false,
          runUninstaller: true,
          quiet: request.quiet,
          degraded: !elevated,
          elevated,
        },
        {
          backupDir: deps.backupDir,
          journalPath: deps.journalPath,
          journal: makeJournal({ path: deps.journalPath, planId: plan.id, appId: plan.appId }),
          now,
          shouldStopWaiting: () => skipRequested,
          onEvent: (event) => emit(removalEventToIpc(request.jobId, event)),
        },
      );
      if (!result.ok) return { ok: false, reason: 'failed', message: 'The uninstaller could not be started.' };
      const report = result.report.uninstaller;
      return {
        ok: true,
        outcome: {
          ran: report.ran,
          exitCode: report.exitCode,
          verifiedGone: report.verifiedGone,
          rebootRequired: report.rebootCode,
          skippedWaiting: report.skippedWaiting,
          skippedReason: report.skippedReason,
        },
      };
    } catch (error) {
      return { ok: false, reason: 'failed', message: messageOf(error) };
    } finally {
      resetApps();
      resetRegistrySnapshotCache();
      sizes.delete(sizeKey(app));
      deps.store.markAppsChanged(now());
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

  return { list, preview, runUninstaller, execute, skipWaiting, elevatedHandoff, onEvent };
}

/**
 * Turns a registry DisplayIcon value (`"C:\App\app.exe",0`, `%ProgramFiles%\x.ico`)
 * into a file path, or null when it names nothing an icon can be read from.
 * Accepts forward slashes (`C:/App/icon.ico`), resource DLLs (the shell resolves
 * their default icon), and bare file names from System32 (`msiexec.exe`).
 */
export function iconPathOf(displayIcon: string, vars: NodeJS.ProcessEnv = process.env): string | null {
  let value = displayIcon.trim();
  if (value.length === 0) return null;
  value = value.replace(/,\s*-?\d+\s*$/, '').trim();
  value = value.replace(/^"+|"+$/g, '').trim();
  value = value.replace(/%([^%]+)%/g, (whole, name: string) => lookupVar(vars, name) ?? whole);
  if (value.includes('%')) return null;
  value = value.replace(/\//g, '\\');
  if (/^[a-z]:\\/i.test(value)) return ICON_FILE.test(value) ? value : null;
  if (/^[^\\/]+$/u.test(value) && ICON_FILE.test(value)) {
    const systemRoot = lookupVar(vars, 'SystemRoot') ?? lookupVar(vars, 'windir');
    if (typeof systemRoot === 'string' && systemRoot.length > 0) {
      return `${systemRoot.replace(/[\\/]+$/, '')}\\System32\\${value}`;
    }
  }
  return null;
}

/** Environment lookup that tolerates the casing of `%programfiles%`-style names. */
function lookupVar(vars: NodeJS.ProcessEnv, name: string): string | undefined {
  const direct = vars[name] ?? vars[name.toUpperCase()] ?? vars[name.toLowerCase()];
  if (direct !== undefined) return direct;
  const wanted = name.toLowerCase();
  for (const key of Object.keys(vars)) {
    if (key.toLowerCase() === wanted) return vars[key];
  }
  return undefined;
}

const ICON_FILE = /\.(exe|dll|ico)$/i;

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
