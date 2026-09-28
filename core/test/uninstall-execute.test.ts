import { describe, expect, it } from 'vitest';
import { toRemovalApp } from '../src/uninstall/apps';
import { fullRegistryPath } from '../src/uninstall/backup';
import { executeRemoval } from '../src/uninstall/execute';
import type {
  FileRemoveMode,
  RemovalEvent,
  RemovalExecutionDeps,
  RemovalExecutionRequest,
  RemovalExecutionResult,
  UninstallerRunInput,
} from '../src/uninstall/execute';
import type {
  LeftoverCandidate,
  RegistryCandidate,
  RemovalPlan,
  StartupCandidate,
  UninstallCommand,
} from '../src/uninstall/types';
import { makeInstalledApp } from './installed-app-fixtures';

const COMMAND: UninstallCommand = {
  raw: 'uninstall.exe /S',
  kind: 'exe',
  executable: 'uninstall.exe',
  args: ['/S'],
  msiProductCode: null,
  exeExists: true,
  launchable: true,
  blockReason: null,
};

function makePlan(overrides: Partial<RemovalPlan> = {}): RemovalPlan {
  const app = makeInstalledApp({ displayName: 'FooApp', publisher: 'Foo Corp', hive: 'hkcu', keyName: '{F}' });
  return {
    id: 'plan-1',
    appId: app.id,
    createdAt: 0,
    app: toRemovalApp(app),
    uninstaller: { command: COMMAND, requiresAdmin: false, interactiveOnly: true, silent: null },
    leftovers: [],
    registry: [],
    startup: [],
    kept: [],
    totals: {
      bytes: 0,
      items: 0,
      reviewBytes: 0,
      reviewItems: 0,
      userDataBytes: 0,
      userDataItems: 0,
      adminItems: 0,
    },
    ...overrides,
  };
}

function leftover(overrides: Partial<LeftoverCandidate> & { id: string }): LeftoverCandidate {
  return {
    path: `C:\\Leftovers\\${overrides.id}`,
    bytes: 0,
    class: 'app-data',
    grade: 'safe',
    evidence: ['fixture'],
    adminRequired: false,
    defaultSelected: true,
    syncRoot: false,
    link: null,
    sharedWith: [],
    ...overrides,
  };
}

function registryItem(overrides: Partial<RegistryCandidate> & { id: string }): RegistryCandidate {
  return {
    hive: 'hklm',
    path: 'Software\\Foo',
    scope: 'product',
    grade: 'safe',
    adminRequired: true,
    excludedReason: null,
    ...overrides,
  };
}

function startupItem(overrides: Partial<StartupCandidate> & { entryId: string }): StartupCandidate {
  return {
    name: 'Foo Updater',
    source: 'hkcu-run',
    state: 'enabled',
    disabledKind: null,
    action: 'disable',
    match: 'path',
    protected: false,
    requiresAdmin: false,
    ...overrides,
  };
}

const UNINSTALL_PATH = 'Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\{F}';

interface Harness {
  events: RemovalEvent[];
  journal: Array<{ kind: string; details: Record<string, unknown> }>;
  removed: Array<{ path: string; mode: FileRemoveMode }>;
  deletedKeys: string[];
  startupDisabled: string[];
  startupPurged: string[];
  runnerInputs: UninstallerRunInput[];
  checks: number;
}

function createHarness(overrides: Partial<RemovalExecutionDeps> = {}): {
  run: (plan: RemovalPlan, request: Omit<RemovalExecutionRequest, 'plan'>) => Promise<RemovalExecutionResult>;
  harness: Harness;
} {
  const harness: Harness = {
    events: [],
    journal: [],
    removed: [],
    deletedKeys: [],
    startupDisabled: [],
    startupPurged: [],
    runnerInputs: [],
    checks: 0,
  };
  const deps: RemovalExecutionDeps = {
    backupDir: 'C:\\Backups',
    journalPath: 'C:\\Dust\\uninstall-history.log',
    journal: { append: (kind, details = {}) => harness.journal.push({ kind, details }) },
    now: () => 1000,
    createBackup: async (candidates) => ({
      ok: true,
      path: 'C:\\Backups\\x.reg',
      restoreCommand: 'reg import "C:\\Backups\\x.reg"',
      exportedKeys: candidates.map((candidate) => fullRegistryPath(candidate.hive, candidate.path)),
    }),
    runUninstaller: async (input) => {
      harness.runnerInputs.push(input);
      input.onSpawned(4242);
      return { exitCode: 0, skippedWaiting: false };
    },
    checkAppKeyPresent: async () => {
      harness.checks += 1;
      return false;
    },
    waitForRemoval: async ({ check }) => {
      const present = await check();
      return { gone: !present, attempts: 1, skipped: false, elapsedMs: 0 };
    },
    removeFile: async (path, mode) => {
      harness.removed.push({ path, mode });
      return { status: 'deleted', bytes: 1, skippedLocked: 0 };
    },
    deleteRegistryKey: async (key) => {
      harness.deletedKeys.push(key);
      return true;
    },
    startup: {
      disable: async (entryId) => {
        harness.startupDisabled.push(entryId);
        return true;
      },
      purgeEnvelope: async (entryId) => {
        harness.startupPurged.push(entryId);
        return true;
      },
    },
    onEvent: (event) => harness.events.push(event),
    ...overrides,
  };
  return {
    harness,
    run: (plan, request) => executeRemoval({ plan, ...request }, deps),
  };
}

function phases(harness: Harness): Array<[string, string]> {
  return harness.events
    .filter((event): event is Extract<RemovalEvent, { type: 'phase' }> => event.type === 'phase')
    .map((event) => [event.phase, event.status]);
}

describe('executeRemoval', () => {
  it('runs the full phase sequence and assembles a complete report', async () => {
    const { run, harness } = createHarness();
    const plan = makePlan({
      leftovers: [leftover({ id: 'file-1', bytes: 10 })],
      registry: [registryItem({ id: 'reg-uninstall', scope: 'uninstall-key', path: UNINSTALL_PATH })],
      startup: [startupItem({ entryId: 'startup-1' })],
    });

    const result = await run(plan, {
      selection: ['file-1', 'reg-uninstall', 'startup-1'],
      includeUserData: false,
      runUninstaller: true,
      quiet: false,
      degraded: false,
      elevated: false,
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.report.outcome).toBe('complete');
    expect(result.report.uninstaller).toMatchObject({
      ran: true,
      exitCode: 0,
      verifiedGone: true,
      skippedWaiting: false,
      rebootCode: false,
      skippedReason: null,
      argv: ['/S'],
    });
    expect(result.report.files).toMatchObject({ deletedItems: 1, deletedBytes: 1, errors: [], kept: [] });
    expect(result.report.registry.deletedKeys).toEqual([fullRegistryPath('hklm', UNINSTALL_PATH)]);
    expect(result.report.startup).toEqual({ disabled: ['Foo Updater'], purgedEnvelopes: [], failed: [] });
    expect(result.report.journalPath).toBe('C:\\Dust\\uninstall-history.log');
    expect(phases(harness)).toEqual([
      ['prepare', 'started'],
      ['prepare', 'done'],
      ['backup', 'started'],
      ['backup', 'done'],
      ['uninstaller', 'started'],
      ['uninstaller', 'done'],
      ['verify', 'started'],
      ['verify', 'done'],
      ['files', 'started'],
      ['files', 'done'],
      ['registry', 'started'],
      ['registry', 'done'],
      ['startup', 'started'],
      ['startup', 'done'],
      ['finish', 'started'],
      ['finish', 'done'],
    ]);
    const kinds = harness.journal.map((line) => line.kind);
    expect(kinds).toContain('started');
    expect(kinds).toContain('backup');
    expect(kinds).toContain('uninstaller-spawned');
    expect(kinds).toContain('uninstaller-exited');
    expect(kinds).toContain('verify');
    expect(kinds).toContain('files');
    expect(kinds).toContain('registry');
    expect(kinds).toContain('startup');
    expect(kinds).toContain('finished');
  });

  it('refuses an empty selection and unacknowledged review items', async () => {
    const { run } = createHarness();
    const empty = await run(makePlan(), {
      selection: [],
      includeUserData: false,
      runUninstaller: false,
      quiet: false,
      degraded: false,
      elevated: false,
    });
    expect(empty).toEqual({ ok: false, reason: 'no-selection' });

    const plan = makePlan({
      leftovers: [leftover({ id: 'review-1', grade: 'review', defaultSelected: false })],
    });
    const review = await run(plan, {
      selection: ['review-1'],
      acknowledge: [],
      includeUserData: false,
      runUninstaller: false,
      quiet: false,
      degraded: false,
      elevated: false,
    });
    expect(review).toEqual({ ok: false, reason: 'unacknowledged-review', items: ['review-1'] });
  });

  it('stops after a reboot-required uninstaller and skips cleanup', async () => {
    const { run, harness } = createHarness({
      runUninstaller: async (input) => {
        harness.runnerInputs.push(input);
        input.onSpawned(1);
        return { exitCode: 3010, skippedWaiting: false };
      },
    });
    const plan = makePlan({
      leftovers: [leftover({ id: 'file-1' })],
      registry: [registryItem({ id: 'reg-uninstall', scope: 'uninstall-key', path: UNINSTALL_PATH })],
    });

    const result = await run(plan, {
      selection: ['file-1', 'reg-uninstall'],
      includeUserData: false,
      runUninstaller: true,
      quiet: false,
      degraded: false,
      elevated: false,
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.report.outcome).toBe('reboot-required');
    expect(result.report.uninstaller.rebootCode).toBe(true);
    expect(harness.removed).toEqual([]);
    expect(harness.deletedKeys).toEqual([]);
    expect(phases(harness)).toContainEqual(['files', 'skipped']);
    expect(phases(harness)).toContainEqual(['registry', 'skipped']);
    expect(phases(harness)).toContainEqual(['startup', 'skipped']);
  });

  it('can skip the uninstaller and still clean leftovers', async () => {
    const { run, harness } = createHarness();
    const plan = makePlan({ leftovers: [leftover({ id: 'file-1' })] });
    const result = await run(plan, {
      selection: ['file-1'],
      includeUserData: false,
      runUninstaller: false,
      quiet: false,
      degraded: false,
      elevated: false,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.report.uninstaller.ran).toBe(false);
    expect(harness.runnerInputs).toEqual([]);
    expect(harness.removed).toHaveLength(1);
    expect(phases(harness)).toContainEqual(['uninstaller', 'skipped']);
    expect(phases(harness)).toContainEqual(['verify', 'skipped']);
  });

  it('uses the silent argv only when quiet is requested and available', async () => {
    const { run, harness } = createHarness();
    const silent = { args: ['/x', '{G}', '/qn', '/norestart'], source: 'msi-default' as const, wellFormed: true };
    const plan = makePlan({
      uninstaller: {
        command: { ...COMMAND, args: ['/X{G}'] },
        requiresAdmin: true,
        interactiveOnly: false,
        silent,
      },
    });
    const base = {
      selection: [] as string[],
      includeUserData: false,
      runUninstaller: true,
      degraded: false,
      elevated: false,
    };

    await run(plan, { ...base, selection: [], quiet: true });
    await run(plan, { ...base, selection: [], quiet: false });
    expect(harness.runnerInputs[0]!.argv).toEqual(silent.args);
    expect(harness.runnerInputs[1]!.argv).toEqual(['/X{G}']);
  });

  it('reports an unlaunchable uninstaller as skipped and continues cleanup', async () => {
    const { run, harness } = createHarness();
    const plan = makePlan({
      uninstaller: {
        command: { ...COMMAND, launchable: false, blockReason: 'missing-exe' },
        requiresAdmin: false,
        interactiveOnly: true,
        silent: null,
      },
      leftovers: [leftover({ id: 'file-1' })],
    });
    const result = await run(plan, {
      selection: ['file-1'],
      includeUserData: false,
      runUninstaller: true,
      quiet: false,
      degraded: false,
      elevated: false,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.report.uninstaller.ran).toBe(false);
    expect(result.report.uninstaller.skippedReason).toBe('missing-exe');
    expect(harness.runnerInputs).toEqual([]);
    expect(harness.removed).toHaveLength(1);
    expect(phases(harness)).toContainEqual(['uninstaller', 'skipped']);
    expect(result.report.outcome).toBe('partial');
  });

  it('reports partial when the key survives verification', async () => {
    const { run } = createHarness({
      checkAppKeyPresent: async () => true,
      waitForRemoval: async () => ({ gone: false, attempts: 3, skipped: false, elapsedMs: 4000 }),
    });
    const plan = makePlan({ leftovers: [leftover({ id: 'file-1' })] });
    const result = await run(plan, {
      selection: ['file-1'],
      includeUserData: false,
      runUninstaller: true,
      quiet: false,
      degraded: false,
      elevated: false,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.report.uninstaller.verifiedGone).toBe(false);
    expect(result.report.outcome).toBe('partial');
  });

  it('does a single verification check when the user stops waiting', async () => {
    const { run, harness } = createHarness({
      runUninstaller: async (input) => {
        harness.runnerInputs.push(input);
        input.onSpawned(7);
        return { exitCode: null, skippedWaiting: true };
      },
    });
    const plan = makePlan({ leftovers: [leftover({ id: 'file-1' })] });
    const result = await run(plan, {
      selection: ['file-1'],
      includeUserData: false,
      runUninstaller: true,
      quiet: false,
      degraded: false,
      elevated: false,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.report.uninstaller.skippedWaiting).toBe(true);
    expect(harness.checks).toBe(1);
    expect(harness.removed).toHaveLength(1);
  });

  it('skips registry deletion when the backup fails, and only deletes backed-up keys', async () => {
    const failedBackup = createHarness({
      createBackup: async () => ({ ok: false, reason: 'export-failed', detail: 'denied' }),
    });
    const plan = makePlan({
      leftovers: [leftover({ id: 'file-1' })],
      registry: [registryItem({ id: 'reg-1' })],
    });
    const request = {
      selection: ['file-1', 'reg-1'],
      includeUserData: false,
      runUninstaller: true,
      quiet: false,
      degraded: false,
      elevated: false,
    };
    const failed = await failedBackup.run(plan, request);
    expect(failed.ok).toBe(true);
    if (!failed.ok) return;
    expect(failed.report.registry.deletedKeys).toEqual([]);
    expect(failedBackup.harness.deletedKeys).toEqual([]);
    expect(failedBackup.harness.removed).toHaveLength(1);
    expect(failed.report.outcome).toBe('partial');
    expect(failedBackup.harness.journal.map((line) => line.kind)).toContain('error');
    expect(phases(failedBackup.harness)).toContainEqual(['registry', 'skipped']);

    const partialBackup = createHarness({
      createBackup: async (candidates) => ({
        ok: true,
        path: 'C:\\Backups\\x.reg',
        restoreCommand: 'reg import "C:\\Backups\\x.reg"',
        exportedKeys: [fullRegistryPath(candidates[0]!.hive, candidates[0]!.path)],
      }),
    });
    const two = makePlan({
      registry: [
        registryItem({ id: 'reg-a', path: 'Software\\Foo' }),
        registryItem({ id: 'reg-b', path: 'Software\\Bar' }),
      ],
    });
    const partial = await partialBackup.run(two, { ...request, selection: ['reg-a', 'reg-b'] });
    expect(partial.ok).toBe(true);
    if (!partial.ok) return;
    expect(partialBackup.harness.deletedKeys).toEqual([fullRegistryPath('hklm', 'Software\\Foo')]);
    expect(partial.report.registry.failedKeys).toEqual([
      { path: fullRegistryPath('hklm', 'Software\\Bar'), code: 'NOT-BACKED-UP' },
    ]);
  });

  it('deletes registry keys lowest-scope first and the uninstall key last', async () => {
    const { run, harness } = createHarness();
    const plan = makePlan({
      registry: [
        registryItem({ id: 'reg-uninstall', scope: 'uninstall-key', path: UNINSTALL_PATH }),
        registryItem({ id: 'reg-product', scope: 'product', path: 'Software\\Foo\\App' }),
        registryItem({ id: 'reg-vendor', scope: 'vendor-root', path: 'Software\\Foo' }),
      ],
    });
    const result = await run(plan, {
      selection: ['reg-uninstall', 'reg-product', 'reg-vendor'],
      includeUserData: false,
      runUninstaller: false,
      quiet: false,
      degraded: false,
      elevated: false,
    });
    expect(result.ok).toBe(true);
    expect(harness.deletedKeys).toEqual([
      fullRegistryPath('hklm', 'Software\\Foo'),
      fullRegistryPath('hklm', 'Software\\Foo\\App'),
      fullRegistryPath('hklm', UNINSTALL_PATH),
    ]);
  });

  it('routes safe items to hard delete, review to the recycle bin and keeps protected classes', async () => {
    const { run, harness } = createHarness({
      removeFile: async (path, mode) => {
        harness.removed.push({ path, mode });
        if (path.endsWith('locked')) return { status: 'skipped-locked', bytes: 0, skippedLocked: 1 };
        if (path.endsWith('boom')) return { status: 'failed', bytes: 0, skippedLocked: 0, code: 'EPERM' };
        return { status: mode === 'recycle' ? 'recycled' : 'deleted', bytes: mode === 'recycle' ? 0 : 5, skippedLocked: 0 };
      },
    });
    const plan = makePlan({
      leftovers: [
        leftover({ id: 'safe' }),
        leftover({ id: 'review', grade: 'review' }),
        leftover({ id: 'link', link: 'junction' }),
        leftover({ id: 'sync', syncRoot: true }),
        leftover({ id: 'user', class: 'user-data' }),
        leftover({ id: 'locked' }),
        leftover({ id: 'boom' }),
      ],
    });
    const result = await run(plan, {
      selection: ['safe', 'review', 'link', 'sync', 'user', 'locked', 'boom'],
      acknowledge: ['review'],
      includeUserData: false,
      runUninstaller: false,
      quiet: false,
      degraded: false,
      elevated: false,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(harness.removed.map((entry) => [entry.path.endsWith('safe') ? 'safe' : entry.path.split('\\').pop(), entry.mode])).toEqual([
      ['safe', 'delete'],
      ['review', 'recycle'],
      ['locked', 'delete'],
      ['boom', 'delete'],
    ]);
    expect(result.report.files).toMatchObject({ deletedItems: 1, recycledItems: 1, skippedLocked: 1 });
    expect(result.report.files.errors).toEqual([{ path: 'C:\\Leftovers\\boom', code: 'EPERM' }]);
    expect(result.report.files.kept).toEqual(
      expect.arrayContaining([
        { target: 'C:\\Leftovers\\link', reason: 'reparse-point' },
        { target: 'C:\\Leftovers\\sync', reason: 'synced-folder' },
        { target: 'C:\\Leftovers\\user', reason: 'user-data-not-included' },
      ]),
    );
    expect(result.report.outcome).toBe('partial');
  });

  it('honors explicit user-data opt-in', async () => {
    const { run, harness } = createHarness();
    const plan = makePlan({ leftovers: [leftover({ id: 'user', class: 'user-data' })] });
    const result = await run(plan, {
      selection: ['user'],
      includeUserData: true,
      runUninstaller: false,
      quiet: false,
      degraded: false,
      elevated: false,
    });
    expect(result.ok).toBe(true);
    expect(harness.removed).toHaveLength(1);
  });

  it('skips admin items in degraded mode and reports them', async () => {
    const { run, harness } = createHarness();
    const plan = makePlan({
      uninstaller: {
        command: COMMAND,
        requiresAdmin: true,
        interactiveOnly: true,
        silent: null,
      },
      leftovers: [leftover({ id: 'admin-dir', adminRequired: true, class: 'install-dir' }), leftover({ id: 'user-file' })],
      registry: [registryItem({ id: 'reg-1' })],
    });
    const result = await run(plan, {
      selection: ['admin-dir', 'user-file', 'reg-1'],
      includeUserData: false,
      runUninstaller: true,
      quiet: false,
      degraded: true,
      elevated: false,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.report.degraded).toBe(true);
    expect(result.report.elevation).toBe('none');
    expect(result.report.uninstaller.ran).toBe(true);
    expect(result.report.uninstaller.skippedReason).toBeNull();
    expect(harness.runnerInputs).toHaveLength(1);
    expect(harness.deletedKeys).toEqual([]);
    expect(harness.removed.map((entry) => entry.path)).toEqual(['C:\\Leftovers\\user-file']);
    expect(result.report.files.kept).toContainEqual({
      target: 'C:\\Leftovers\\admin-dir',
      reason: 'needs-admin',
    });
    expect(result.report.registry.failedKeys).toContainEqual({
      path: fullRegistryPath('hklm', 'Software\\Foo'),
      code: 'NEEDS-ADMIN',
    });
  });

  it('records startup failures and keeps going', async () => {
    const { run } = createHarness({
      startup: {
        disable: async () => false,
        purgeEnvelope: async () => true,
      },
    });
    const plan = makePlan({
      startup: [startupItem({ entryId: 'startup-1' }), startupItem({ entryId: 'startup-2', name: 'Foo Helper', disabledKind: 'dust', state: 'disabled', action: 'purge-envelope' })],
    });
    const result = await run(plan, {
      selection: ['startup-1', 'startup-2'],
      includeUserData: false,
      runUninstaller: false,
      quiet: false,
      degraded: false,
      elevated: false,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.report.startup).toEqual({ disabled: [], purgedEnvelopes: ['Foo Helper'], failed: ['Foo Updater'] });
    expect(result.report.outcome).toBe('partial');
  });
});
