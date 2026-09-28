import { randomUUID } from 'node:crypto';
import type { InstalledApp } from '../system/installed-apps';
import type { StartupEntryRecord } from '../startup/types';
import { matchAppName, toRemovalApp } from './apps';
import { buildSilentOption, parseUninstallCommand } from './command';
import { discoverLeftovers } from './leftovers';
import type { LeftoverRoots } from './leftovers';
import { scanRegistry, UNINSTALL_KEY_PREFIX } from './registry-scan';
import type {
  KeptItem,
  RegistryCandidate,
  RemovalPlan,
  RemovalTotals,
  StartupCandidate,
  UninstallPlannedCommand,
} from './types';

export interface RemovalPlanEnv {
  roots: LeftoverRoots;
  installLocation?: string;
  home?: string;
  oneDrive?: string[];
  programFiles?: string[];
  systemRoot?: string;
  dustInstallPath?: string;
}

export interface RemovalPlanInput {
  app: InstalledApp;
  apps?: readonly InstalledApp[];
  env: RemovalPlanEnv;
  startup?: readonly StartupEntryRecord[];
  registryRead?: () => Promise<string>;
  now?: () => number;
  makeId?: () => string;
}

function canonical(value: string): string {
  return value.replace(/[\\/]+$/, '').toLowerCase();
}

function underRoot(candidate: string, root: string): boolean {
  const target = canonical(candidate);
  const base = canonical(root);
  if (target.length === 0 || base.length === 0) return false;
  return target === base || target.startsWith(`${base}\\`) || target.startsWith(`${base}/`);
}

function defaultProgramFiles(): string[] {
  return [process.env.ProgramFiles, process.env['ProgramFiles(x86)']].filter(
    (value): value is string => typeof value === 'string' && value.length > 0,
  );
}

export function uninstallerRequiresAdmin(app: InstalledApp, env: RemovalPlanEnv): boolean {
  if (app.hive !== 'hkcu') return true;
  const installLocation = (env.installLocation ?? app.installLocation).trim();
  if (installLocation.length === 0) return false;
  const programFiles = env.programFiles ?? defaultProgramFiles();
  if (programFiles.some((root) => underRoot(installLocation, root))) return true;
  if (underRoot(installLocation, env.roots.programData)) return true;
  if (env.systemRoot !== undefined && underRoot(installLocation, env.systemRoot)) return true;
  return false;
}

function planUninstaller(
  app: InstalledApp,
  env: RemovalPlanEnv,
): { plan: UninstallPlannedCommand | null; kept: KeptItem | null } {
  const raw = app.uninstallString.trim();
  if (raw.length === 0) {
    return { plan: null, kept: { target: app.displayName, reason: 'no-uninstaller' } };
  }
  const command = parseUninstallCommand(raw);
  return {
    plan: {
      command,
      requiresAdmin: uninstallerRequiresAdmin(app, env),
      interactiveOnly: command.kind !== 'msi',
      silent: buildSilentOption({
        command,
        quietUninstallString: app.quietUninstallString,
        windowsInstaller: app.windowsInstaller,
      }),
    },
    kept: null,
  };
}

function startupMatches(entry: StartupEntryRecord, app: InstalledApp, installLocation: string): boolean {
  const location = installLocation.trim().toLowerCase();
  if (location.length > 0 && entry.command.toLowerCase().includes(location)) return true;
  const parsed = parseUninstallCommand(entry.command, { exists: () => true });
  if (parsed.executable.length > 0) {
    const leaf = (parsed.executable.split(/[\\/]/).pop() ?? '').replace(/\.exe$/i, '');
    if (leaf.length > 0 && matchAppName(leaf, app) !== null) return true;
  }
  return matchAppName(entry.name, app) !== null;
}

function toStartupCandidate(entry: StartupEntryRecord): StartupCandidate {
  const action: StartupCandidate['action'] =
    entry.state === 'enabled' ? 'disable' : entry.disabledKind === 'dust' ? 'purge-envelope' : 'none';
  return {
    entryId: entry.id,
    name: entry.name,
    source: entry.source,
    state: entry.state,
    disabledKind: entry.disabledKind,
    action,
    protected: false,
    requiresAdmin: entry.requiresAdmin,
  };
}

function buildTotals(
  leftovers: RemovalPlan['leftovers'],
  registry: RegistryCandidate[],
  startup: StartupCandidate[],
): RemovalTotals {
  const totals: RemovalTotals = {
    bytes: 0,
    items: 0,
    reviewBytes: 0,
    reviewItems: 0,
    userDataBytes: 0,
    userDataItems: 0,
    adminItems: 0,
  };
  for (const item of leftovers) {
    totals.items += 1;
    totals.bytes += item.bytes ?? 0;
    if (item.grade === 'review') {
      totals.reviewItems += 1;
      totals.reviewBytes += item.bytes ?? 0;
    }
    if (item.class === 'user-data') {
      totals.userDataItems += 1;
      totals.userDataBytes += item.bytes ?? 0;
    }
    if (item.adminRequired) totals.adminItems += 1;
  }
  for (const item of registry) {
    totals.items += 1;
    if (item.grade === 'review') totals.reviewItems += 1;
    if (item.adminRequired) totals.adminItems += 1;
  }
  for (const item of startup) {
    if (item.action === 'none') continue;
    totals.items += 1;
    if (item.requiresAdmin) totals.adminItems += 1;
  }
  return totals;
}

export async function buildRemovalPlan(input: RemovalPlanInput): Promise<RemovalPlan> {
  const { app, env } = input;
  const apps = input.apps ?? [app];
  const installLocation = (env.installLocation ?? app.installLocation).trim();
  const kept: KeptItem[] = [];

  const uninstaller = planUninstaller(app, env);
  if (uninstaller.kept !== null) kept.push(uninstaller.kept);

  const leftovers = discoverLeftovers(app, apps, {
    roots: env.roots,
    installLocation,
    home: env.home,
    oneDrive: env.oneDrive,
    programFiles: env.programFiles,
    systemRoot: env.systemRoot,
    dustInstallPath: env.dustInstallPath,
  });
  kept.push(...leftovers.skipped);

  const registryScan = await scanRegistry(
    app,
    apps,
    input.registryRead === undefined ? {} : { read: input.registryRead },
  );
  const registry: RegistryCandidate[] = [];
  for (const candidate of registryScan.candidates) {
    if (candidate.excludedReason !== null) {
      kept.push({ target: candidate.path, reason: candidate.excludedReason });
      continue;
    }
    registry.push(candidate);
  }
  if (!registryScan.trusted) {
    kept.push({ target: UNINSTALL_KEY_PREFIX, reason: 'registry-untrusted' });
  }

  const startup: StartupCandidate[] = [];
  for (const entry of input.startup ?? []) {
    if (!startupMatches(entry, app, installLocation)) continue;
    if (entry.protected) {
      kept.push({ target: entry.name, reason: 'protected-startup-entry' });
      continue;
    }
    startup.push(toStartupCandidate(entry));
  }

  return {
    id: (input.makeId ?? randomUUID)(),
    appId: app.id,
    createdAt: (input.now ?? Date.now)(),
    app: toRemovalApp(app),
    uninstaller: uninstaller.plan,
    leftovers: leftovers.candidates,
    registry,
    startup,
    kept,
    totals: buildTotals(leftovers.candidates, registry, startup),
  };
}

export function planRequiresAdmin(plan: RemovalPlan): boolean {
  return plan.totals.adminItems > 0 || plan.uninstaller?.requiresAdmin === true;
}

export function defaultSelection(plan: RemovalPlan): string[] {
  return [
    ...plan.leftovers.filter((candidate) => candidate.defaultSelected).map((candidate) => candidate.id),
    ...plan.registry
      .filter((candidate) => candidate.grade === 'safe')
      .map((candidate) => candidate.id),
    ...plan.startup
      .filter((candidate) => candidate.action !== 'none')
      .map((candidate) => candidate.entryId),
  ];
}

export function missingAcknowledgements(
  plan: RemovalPlan,
  selection: readonly string[],
  acknowledge: readonly string[],
): string[] {
  const selected = new Set(selection);
  const acknowledged = new Set(acknowledge);
  const out: string[] = [];
  for (const item of [...plan.leftovers, ...plan.registry]) {
    if (selected.has(item.id) && item.grade === 'review' && !acknowledged.has(item.id)) {
      out.push(item.id);
    }
  }
  return out;
}
