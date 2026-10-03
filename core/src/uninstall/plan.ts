import { randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import type { InstalledApp } from '../system/installed-apps';
import type { StartupEntryRecord } from '../startup/types';
import { matchAppName, toRemovalApp } from './apps';
import { buildSilentOption, isAbsoluteWindowsPath, parseUninstallCommand } from './command';
import { discoverLeftovers, measureLeftoverCandidates } from './leftovers';
import type { LeftoverRoots } from './leftovers';
import { assertUninstallTarget, defaultUninstallParents, isPathInsideOrEqual, normalizePlanPath } from './path-policy';
import { scanRegistry, UNINSTALL_KEY_PREFIX } from './registry-scan';
import type {
  KeptItem,
  RegistryCandidate,
  RemovalPlan,
  RemovalTotals,
  StartupCandidate,
  UninstallCommand,
  UninstallPlannedCommand,
} from './types';

export interface RemovalPlanEnv {
  roots: LeftoverRoots;
  installLocation?: string;
  installParents?: string[];
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
  exists?: (path: string) => boolean;
  now?: () => number;
  makeId?: () => string;
}

function defaultProgramFiles(): string[] {
  return [process.env.ProgramFiles, process.env['ProgramFiles(x86)']].filter(
    (value): value is string => typeof value === 'string' && value.length > 0,
  );
}

export function uninstallerRequiresAdmin(app: InstalledApp, env: RemovalPlanEnv): boolean {
  if (app.hive !== 'hkcu') return true;
  const normalized = normalizePlanPath((env.installLocation ?? app.installLocation).trim());
  if (normalized === null) return false;
  const programFiles = env.programFiles ?? defaultProgramFiles();
  if (programFiles.some((root) => isPathInsideOrEqual(root, normalized))) return true;
  if (isPathInsideOrEqual(env.roots.programData, normalized)) return true;
  if (env.systemRoot !== undefined && isPathInsideOrEqual(env.systemRoot, normalized)) return true;
  return false;
}

function resolveBareExecutable(
  command: UninstallCommand,
  app: InstalledApp,
  env: RemovalPlanEnv,
  exists: (path: string) => boolean,
): UninstallCommand {
  if (command.kind !== 'exe' || command.launchable || isAbsoluteWindowsPath(command.executable)) {
    return command;
  }
  const base = normalizePlanPath((env.installLocation ?? app.installLocation).trim());
  if (base === null) return command;
  const candidate = normalizePlanPath(join(base, command.executable));
  if (candidate === null || !isPathInsideOrEqual(base, candidate) || !exists(candidate)) {
    return command;
  }
  return { ...command, executable: candidate, exeExists: true, launchable: true, blockReason: null };
}

export function resolveUninstallerCommand(
  app: InstalledApp,
  env: RemovalPlanEnv,
  exists: (path: string) => boolean = existsSync,
): UninstallCommand {
  const parsed = parseUninstallCommand(app.uninstallString.trim(), { exists });
  return resolveBareExecutable(parsed, app, env, exists);
}

function planUninstaller(
  app: InstalledApp,
  env: RemovalPlanEnv,
  exists: (path: string) => boolean,
): { plan: UninstallPlannedCommand | null; kept: KeptItem | null } {
  const raw = app.uninstallString.trim();
  if (raw.length === 0) {
    return { plan: null, kept: { target: app.displayName, reason: 'no-uninstaller' } };
  }
  const command = resolveUninstallerCommand(app, env, exists);
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

function startupMatch(entry: StartupEntryRecord, app: InstalledApp, installLocation: string): 'path' | 'name' | null {
  const parsed = parseUninstallCommand(entry.command, { exists: () => true });
  if (parsed.executable.length > 0) {
    if (
      installLocation.length > 0 &&
      isAbsoluteWindowsPath(parsed.executable) &&
      isPathInsideOrEqual(installLocation, parsed.executable)
    ) {
      return 'path';
    }
    const leaf = (parsed.executable.split(/[\\/]/).pop() ?? '').replace(/\.exe$/i, '');
    if (leaf.length > 0 && matchAppName(leaf, app) !== null) return 'name';
  }
  return matchAppName(entry.name, app) !== null ? 'name' : null;
}

function toStartupCandidate(entry: StartupEntryRecord, match: 'path' | 'name'): StartupCandidate {
  const action: StartupCandidate['action'] =
    entry.state === 'enabled' ? 'disable' : entry.disabledKind === 'dust' ? 'purge-envelope' : 'none';
  return {
    entryId: entry.id,
    name: entry.name,
    source: entry.source,
    state: entry.state,
    disabledKind: entry.disabledKind,
    action,
    match,
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
  const exists = input.exists ?? existsSync;
  const installLocation = (env.installLocation ?? app.installLocation).trim();
  const installParents = env.installParents ?? defaultUninstallParents();
  const kept: KeptItem[] = [];

  const policyLocation =
    installLocation.length > 0
      ? assertUninstallTarget(installLocation, {
          roots: installParents,
          systemRoot: env.systemRoot,
          userProfile: env.home,
          dustInstallPath: env.dustInstallPath,
        })
      : null;
  const matchLocation = policyLocation?.ok === true ? policyLocation.path : '';

  const uninstaller = planUninstaller(app, env, exists);
  if (uninstaller.kept !== null) kept.push(uninstaller.kept);

  const leftovers = discoverLeftovers(app, apps, {
    roots: env.roots,
    installLocation,
    installParents,
    home: env.home,
    oneDrive: env.oneDrive,
    programFiles: env.programFiles,
    systemRoot: env.systemRoot,
    dustInstallPath: env.dustInstallPath,
    measure: () => null,
  });
  await measureLeftoverCandidates(leftovers.candidates);
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
    const match = startupMatch(entry, app, matchLocation);
    if (match === null) continue;
    if (entry.protected) {
      kept.push({ target: entry.name, reason: 'protected-startup-entry' });
      continue;
    }
    startup.push(toStartupCandidate(entry, match));
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
    ...plan.registry.filter((candidate) => candidate.grade === 'safe').map((candidate) => candidate.id),
    ...plan.startup
      .filter((candidate) => candidate.action !== 'none' && candidate.match === 'path')
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
