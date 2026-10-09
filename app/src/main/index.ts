import {
  backupDirFor,
  defaultRuleEnv,
  createWindowsStartupStore,
  journalPathFor,
  pruneRegistryBackups,
  systemDriveRoot,
} from '@dust/core';
import { BrowserWindow, app, dialog, ipcMain, nativeImage, session, shell } from 'electron';
import { autoUpdater } from 'electron-updater';
import { execFile, spawn } from 'node:child_process';
import { appendFileSync, closeSync, existsSync, openSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import {
  awaitElevatedStartup,
  buildElevationLaunchCommand,
  decideElevation,
  elevationAckPath,
  elevationArgs,
  encodePowerShellCommand,
  hasElevatedFlag,
} from './elevation';
import type { IpcRegistrar } from './ipc';
import { registerIpcHandlers, setTimingLogPath } from './ipc';
import { readAppIconDataUrl } from './app-icon';
import type { EngineHost } from './host/engine-host';
import { createEngineHost } from './host/engine-host';
import { reportSamples } from './host/instrument';
import { createFilePublisherLoader, createStartupService } from './host/startup';
import { resolveWorkerPath } from './paths';
import { VolumeSnapshotStore } from './host/volume-store';
import { hardenWebContents, installSessionSecurity } from './security';
import {
  applyPendingStartupToggle,
  parsePendingStartupToggle,
  PENDING_ENABLE_PREFIX,
  PENDING_TOGGLE_PREFIX,
} from './startup-launch';
import {
  PENDING_UNINSTALL_PREFIX,
  clearPendingUninstall,
  parsePendingUninstallArg,
  pendingUninstallPath,
  readPendingUninstall,
  writePendingUninstall,
} from './uninstall-launch';
import type { PendingUninstallJob } from './uninstall-launch';
import type { StartupLaunchHint, StartupRelaunchAction, UninstallLaunchHint } from '../shared/ipc';
import { IPC } from '../shared/ipc';
import { createUpdateService } from './updater';
import type { UpdaterAdapter } from './updater';

function isRunningElevated(): Promise<boolean> {
  if (process.platform !== 'win32') return Promise.resolve(true);
  const candidate = process.env.SystemRoot
    ? join(process.env.SystemRoot, 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe')
    : 'powershell.exe';
  const script =
    '([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)';
  return new Promise((resolve) => {
    execFile(
      existsSync(candidate) ? candidate : 'powershell.exe',
      ['-NoProfile', '-NonInteractive', '-Command', script],
      { encoding: 'utf8', timeout: 15_000, windowsHide: true },
      (error, stdout) => {
        if (error) {
          resolve(false);
          return;
        }
        resolve(stdout.trim().toLowerCase() === 'true');
      },
    );
  });
}

/** True while the rebuilt renderer (app/renderer-next) is the one being run. */
const nextRenderer = process.env.DUST_RENDERER === 'next';

// Window chrome for the light Fluent look. Values mirror --canvas and --ink in renderer-next tokens.css.
const NEXT_WINDOW = {
  width: 1200,
  height: 800,
  minWidth: 960,
  minHeight: 640,
  backgroundColor: '#F7F9FC',
  titleBarStyle: 'hidden',
  titleBarOverlay: { color: '#F7F9FC', symbolColor: '#1B1B1F', height: 40 },
} as const;

function createMainWindow(backgroundThrottling: boolean): BrowserWindow {
  return new BrowserWindow({
    ...(nextRenderer
      ? NEXT_WINDOW
      : { width: 1180, height: 780, minWidth: 900, minHeight: 600, backgroundColor: '#0b0b0c' }),
    title: 'Dust',
    show: false,
    webPreferences: {
      preload: join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      backgroundThrottling,
    },
  });
}

async function loadRenderer(window: BrowserWindow): Promise<void> {
  const devServer = process.env.DUST_DEV_SERVER_URL;
  if (devServer) {
    await window.loadURL(devServer);
  } else {
    await window.loadFile(join(__dirname, '..', 'renderer', 'index.html'));
  }
}

async function runAutoNav(window: BrowserWindow): Promise<void> {
  const click = (match: string): Promise<boolean> =>
    window.webContents.executeJavaScript(
      `(() => { const b = [...document.querySelectorAll('button')].find((x) => x.textContent.trim().startsWith(${JSON.stringify(
        match,
      )})); if (b) { b.click(); return true; } return false; })()`,
    );
  const wait = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));
  const clickAndWait = async (match: string, ready: string): Promise<void> => {
    const startedAt = Date.now();
    const clicked = await click(match);
    let readyAt = -1;
    for (let i = 0; i < 200; i += 1) {
      if (await window.webContents.executeJavaScript(ready)) {
        readyAt = Date.now();
        break;
      }
      await wait(25);
    }
    console.log(
      `[dust:timing] click "${match}" clicked=${clicked} ready=${readyAt < 0 ? 'timeout' : `${readyAt - startedAt}ms`}`,
    );
  };
  await wait(3000);
  for (let i = 0; i < 3; i += 1) {
    await clickAndWait('View results', '!!document.querySelector(\'section[aria-label="Reclaimable summary"]\')');
    await wait(1500);
    await clickAndWait('Back to dashboard', '!!document.querySelector("main.dust-dashboard h1")');
    await wait(1500);
  }
}

async function runBench(host: EngineHost, window: BrowserWindow, rawRoot: string): Promise<void> {
  const root = rawRoot.replace(/\//g, '\\');
  const browse = process.env.DUST_BENCH_MODE === 'browse';
  const reportPath = process.env.DUST_BENCH_REPORT ?? join(app.getPath('userData'), 'bench-report.json');
  let startedAt = 0;
  let finalizingAt = 0;
  let finishedAt = 0;
  let failedMessage: string | null = null;
  let scanStats: { files: number; bytes: number; projects: number; reclaimableBytes: number } | null = null;
  const done = new Promise<void>((resolve) => {
    const off = host.onEvent((event) => {
      if (event.type === 'started') startedAt = Date.now();
      if (event.type === 'finalizing') finalizingAt = Date.now();
      if (event.type === 'failed') failedMessage = event.message;
      if (event.type === 'finished') {
        scanStats = {
          files: event.filesScanned,
          bytes: event.bytesSeen,
          projects: event.projects,
          reclaimableBytes: event.reclaimableBytes,
        };
      }
      if (event.type === 'browse-finished') {
        scanStats = { files: event.filesScanned, bytes: event.bytesSeen, projects: 0, reclaimableBytes: 0 };
      }
      if (event.type === 'finished' || event.type === 'browse-finished' || event.type === 'failed') {
        finishedAt = Date.now();
        off();
        resolve();
      }
    });
  });

  const clickScript = `(() => {
    const label = ${JSON.stringify(`${browse ? 'Browse' : 'Analyze'} ${root}`)};
    const button = [...document.querySelectorAll('button')].find((element) => element.getAttribute('aria-label') === label);
    if (!button) return false;
    button.click();
    return true;
  })()`;
  let clicked = false;
  for (let attempt = 0; attempt < 40 && !clicked; attempt += 1) {
    clicked = (await window.webContents.executeJavaScript(clickScript)) === true;
    if (!clicked) await new Promise((resolve) => setTimeout(resolve, 250));
  }
  if (!clicked) {
    const started = await (browse ? host.startBrowse(root) : host.startAnalyze(root));
    if (!started.ok) {
      const report = { root, ok: false, result: started, samples: reportSamples(), renderer: [] };
      writeFileSync(reportPath, JSON.stringify(report, null, 2));
      console.log(JSON.stringify(report, null, 2));
      app.quit();
      return;
    }
  }

  const timeout = setTimeout(
    () => {
      const report = { root, ok: false, reason: 'bench-timeout', samples: reportSamples(), renderer: [] };
      writeFileSync(reportPath, JSON.stringify(report, null, 2));
      console.log(JSON.stringify(report, null, 2));
      app.quit();
    },
    20 * 60 * 1000,
  );

  await done;
  clearTimeout(timeout);
  await new Promise((resolve) => setTimeout(resolve, 3000));
  const renderer = await window.webContents.executeJavaScript(
    'window.__dustRendererReport ? window.__dustRendererReport() : []',
  );
  const rendererMemory = await window.webContents.executeJavaScript(
    'window.__dustRendererMemory ? window.__dustRendererMemory() : null',
  );
  const report = {
    root,
    mode: browse ? 'browse' : 'analyze',
    ok: failedMessage === null,
    failedMessage,
    scanMs: (browse ? finishedAt : finalizingAt) - startedAt,
    finalizeMs: browse ? 0 : finishedAt - finalizingAt,
    totalMs: finishedAt - startedAt,
    scanStats,
    memory: {
      rssMb: Math.round(process.memoryUsage().rss / 1024 / 1024),
      heapUsedMb: Math.round(process.memoryUsage().heapUsed / 1024 / 1024),
    },
    samples: reportSamples(),
    renderer,
    rendererMemory,
  };
  writeFileSync(reportPath, JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
  app.quit();
}

function describeError(error: unknown): string {
  if (error instanceof Error) return String(error);
  try {
    return JSON.stringify(error) ?? String(error);
  } catch {
    return String(error);
  }
}

function logMainError(userDataDir: string, scope: string, error: unknown): void {
  try {
    appendFileSync(
      join(userDataDir, 'error.log'),
      `${new Date().toISOString()} [${scope}] ${describeError(error)}\n${error instanceof Error ? (error.stack ?? '') : ''}\n`,
      'utf8',
    );
  } catch {
    /* logging must never break the app */
  }
}

function installCrashLogging(userDataDir: string): void {
  process.on('uncaughtException', (error) => {
    logMainError(userDataDir, 'uncaughtException', error);
    app.quit();
  });
  process.on('unhandledRejection', (reason) => {
    logMainError(userDataDir, 'unhandledRejection', reason);
  });
  app.on('render-process-gone', (_event, _contents, details) => {
    logMainError(userDataDir, 'render-process-gone', details);
  });
  app.on('child-process-gone', (_event, details) => {
    logMainError(userDataDir, 'child-process-gone', details);
  });
}

void app
  .whenReady()
  .then(async () => {
    app.setAppUserModelId('com.mohaned178.dust');
    const benchRoot = app.isPackaged ? undefined : process.env.DUST_BENCH_ROOT;
    if (benchRoot) {
      app.setPath('userData', join(tmpdir(), 'dust-bench-userdata'));
    }
    const userDataDir = app.getPath('userData');
    installCrashLogging(userDataDir);
    installSessionSecurity(session.defaultSession, {
      dev: process.env.DUST_DEV_SERVER_URL !== undefined,
    });
    const ackPath = elevationAckPath(userDataDir);
    const launchedViaElevation = hasElevatedFlag(process.argv);
    let elevated = launchedViaElevation || (await isRunningElevated());
    const requestElevation = async (extra: string[] = []): Promise<'ready' | 'declined' | 'failed'> => {
      try {
        rmSync(ackPath, { force: true });
      } catch {
        /* best effort */
      }
      const args = [
        ...elevationArgs({ packaged: app.isPackaged, appPath: app.getAppPath(), argv: process.argv }),
        ...extra,
      ];
      const command = buildElevationLaunchCommand(process.execPath, args, ackPath);
      const launchLog = join(userDataDir, 'elevation-launch.log');
      const log = (text: string): void => {
        try {
          appendFileSync(launchLog, `${new Date().toISOString()} ${text}\n`, 'utf8');
        } catch {
          /* best effort */
        }
      };
      log(`request: ${command}`);
      return awaitElevatedStartup({
        spawn: () => {
          let child;
          try {
            const fd = openSync(launchLog, 'a');
            child = spawn(
              'powershell.exe',
              ['-NoProfile', '-WindowStyle', 'Hidden', '-EncodedCommand', encodePowerShellCommand(command)],
              {
                detached: false,
                stdio: ['ignore', fd, fd],
              },
            );
            closeSync(fd);
          } catch (error) {
            log(`spawn failed: ${String(error)}`);
            return { exited: Promise.resolve(1) };
          }
          child.unref();
          log(`spawned launcher pid=${String(child.pid)}`);
          return {
            exited: new Promise<number | null>((resolve) => {
              child.once('spawn', () => log('launcher spawn event'));
              child.once('close', (code, signal) =>
                log(`launcher close code=${String(code)} signal=${String(signal)}`),
              );
              child.once('exit', (code) => {
                log(`launcher exit: ${String(code)}`);
                resolve(code);
              });
              child.once('error', (error) => {
                log(`launcher error: ${String(error)}`);
                resolve(null);
              });
            }),
          };
        },
        ackExists: () => existsSync(ackPath),
        sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
      }).then((outcome) => {
        log(`outcome: ${outcome}`);
        return outcome;
      });
    };
    if (decideElevation({ platform: process.platform, argv: process.argv, isElevated: elevated }) === 'relaunch') {
      for (;;) {
        const outcome = await requestElevation();
        if (outcome === 'ready') {
          app.quit();
          return;
        }
        const choice = await dialog.showMessageBox({
          type: 'info',
          title: 'Dust',
          message: "Dust couldn't restart with administrator rights.",
          detail:
            'Apps install and uninstall more completely when Dust runs as administrator. You can continue without it, or try again.',
          buttons: ['Continue without admin', 'Try again', 'Quit'],
          defaultId: 1,
          cancelId: 0,
        });
        if (choice.response === 2) {
          app.quit();
          return;
        }
        if (choice.response === 0) {
          elevated = false;
          break;
        }
      }
    }
    const store = new VolumeSnapshotStore(userDataDir, systemDriveRoot(defaultRuleEnv()) ?? 'C:\\');
    const backupDir = backupDirFor(userDataDir);
    pruneRegistryBackups(backupDir);
    if (process.env.DUST_TIMING === '1') {
      setTimingLogPath(join(userDataDir, 'perf.log'));
    }
    const startupStore = createWindowsStartupStore({
      env: process.env,
      windowsDir: process.env.SystemRoot,
      resolveShortcut: async (shortcutPath) => {
        try {
          const details = shell.readShortcutLink(shortcutPath);
          return { target: details.target, args: details.args ?? '' };
        } catch {
          return null;
        }
      },
    });
    const startup = createStartupService({
      store: startupStore,
      loadPublisher: createFilePublisherLoader(),
      loadIcon: async (executablePath) => {
        try {
          const icon = await app.getFileIcon(executablePath, { size: 'small' });
          return icon.isEmpty() ? null : icon.toDataURL();
        } catch {
          return null;
        }
      },
    });
    const dustInstallPath = app.isPackaged ? dirname(process.execPath) : dirname(app.getAppPath());
    const uninstallPendingPath = pendingUninstallPath(userDataDir);
    const uninstallArgId = parsePendingUninstallArg(process.argv);
    const pendingJob = uninstallArgId === null ? null : readPendingUninstall(uninstallPendingPath);
    const validPendingJob = pendingJob !== null && pendingJob.jobId === uninstallArgId ? pendingJob : null;
    let uninstallLaunchHint: UninstallLaunchHint | null = null;
    if (uninstallArgId !== null || existsSync(uninstallPendingPath)) {
      clearPendingUninstall(uninstallPendingPath);
      uninstallLaunchHint =
        validPendingJob !== null
          ? { open: true, appId: validPendingJob.appId, notice: null, stalePending: false, runningJobId: null }
          : { open: true, appId: null, notice: null, stalePending: true, runningJobId: null };
    }
    const host = createEngineHost({
      store,
      streamLiveRows: false,
      workerPath: resolveWorkerPath(__dirname),
      volumesCacheFile: join(userDataDir, 'volumes-cache.json'),
      installedAppsCacheFile: join(userDataDir, 'installed-apps-cache.json'),
      systemHardwareCacheFile: join(userDataDir, 'system-hardware-cache.json'),
      prewarmAfterFirstDashboard: benchRoot === undefined,
      startup,
      dustInstallPath,
      uninstallDeps: {
        store,
        batchAppEvents: nextRenderer,
        journalPath: journalPathFor(userDataDir),
        backupDir,
        elevated,
        systemRoot: process.env.SystemRoot,
        dustInstallPath,
        records: () => startup.records(),
        startupActions: {
          disable: async (id) => (await startup.disable(id)).ok,
          purgeEnvelope: async (id) => (await startup.removeBackup(id)).ok,
        },
        loadIcon: async (iconPath) =>
          readAppIconDataUrl(iconPath, {
            exists: existsSync,
            fileIcon: async (target) => app.getFileIcon(target, { size: 'normal' }),
            imageFromPath: (target) => nativeImage.createFromPath(target),
          }),
      },
    });
    const window = createMainWindow(benchRoot === undefined);
    const updates = createUpdateService({
      updater: autoUpdater as unknown as UpdaterAdapter,
      isPackaged: app.isPackaged,
      onStatus: (status) => {
        if (!window.webContents.isDestroyed()) window.webContents.send(IPC.updatesEvent, status);
      },
    });

    const pendingToggle = parsePendingStartupToggle(process.argv);
    let startupLaunchHint: StartupLaunchHint | null = pendingToggle.requested ? { open: true, notice: null } : null;
    if (pendingToggle.requested && pendingToggle.id !== null) {
      const notice = await applyPendingStartupToggle(host, pendingToggle.id, pendingToggle.action);
      if (notice !== null) startupLaunchHint = { open: true, notice };
    }

    const registrar: IpcRegistrar = {
      handle: (channel, listener) => {
        ipcMain.handle(channel, (event, ...args) => listener(event, ...args));
      },
    };
    registerIpcHandlers(
      registrar,
      host,
      {
        send: (channel, payload) => {
          if (!window.webContents.isDestroyed()) window.webContents.send(channel, payload);
        },
      },
      {
        revealPath: async (path) => {
          shell.showItemInFolder(path);
        },
        relaunchElevated: async (startupToggleId?: string, action: StartupRelaunchAction = 'disable') => {
          if (process.platform !== 'win32') return;
          const extra: string[] = [];
          if (typeof startupToggleId === 'string' && /^[a-f0-9]{16}$/.test(startupToggleId)) {
            const prefix = action === 'enable' ? PENDING_ENABLE_PREFIX : PENDING_TOGGLE_PREFIX;
            extra.push(`${prefix}${startupToggleId}`);
          }
          const outcome = await requestElevation(extra);
          if (outcome === 'ready') app.quit();
        },
        relaunchElevatedUninstall: async (jobId: string) => {
          if (process.platform !== 'win32') return;
          const handoff = host.elevatedUninstallHandoff(jobId);
          if (handoff === null) return;
          const pending: PendingUninstallJob = {
            v: 2,
            jobId: handoff.jobId,
            appId: handoff.appId,
            createdAt: Date.now(),
          };
          if (!writePendingUninstall(uninstallPendingPath, pending)) return;
          const outcome = await requestElevation([`${PENDING_UNINSTALL_PREFIX}${jobId}`]);
          if (outcome === 'ready') {
            app.quit();
            return;
          }
          await dialog.showMessageBox({
            type: 'info',
            title: 'Dust',
            message: "Dust couldn't restart with administrator rights.",
            detail: 'Nothing was changed. You can try again, or continue without admin.',
            buttons: ['OK'],
          });
        },
      },
      () => startupLaunchHint,
      () => uninstallLaunchHint,
      updates,
    );

    window.once('ready-to-show', () => window.show());
    app.on('before-quit', () => {
      updates.dispose();
      host.dispose();
    });
    await loadRenderer(window);
    updates.start();
    hardenWebContents(window.webContents, {
      appUrl: window.webContents.getURL(),
      devServerUrl: process.env.DUST_DEV_SERVER_URL,
    });
    if (launchedViaElevation) {
      try {
        writeFileSync(ackPath, `${Date.now()}`, 'utf8');
      } catch {
        /* the parent falls back to its timeout */
      }
    }
    if (process.env.DUST_AUTO === '1' && !app.isPackaged) await runAutoNav(window);
    if (benchRoot) await runBench(host, window, benchRoot);
  })
  .catch((error: unknown) => {
    console.error('Dust failed to start', error);
    logMainError(app.getPath('userData'), 'startup', error);
    app.quit();
  });

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
