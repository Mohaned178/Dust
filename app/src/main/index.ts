import { SnapshotStore } from '@dust/core';
import { BrowserWindow, app, ipcMain, shell } from 'electron';
import { spawn } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildElevationCommand } from './elevation';
import type { IpcRegistrar } from './ipc';
import { registerIpcHandlers } from './ipc';
import type { EngineHost } from './host/engine-host';
import { createEngineHost } from './host/engine-host';
import { reportSamples } from './host/instrument';
import { createStorePaths, resolveWorkerPath } from './paths';

function createMainWindow(backgroundThrottling: boolean): BrowserWindow {
  return new BrowserWindow({
    width: 1180,
    height: 780,
    minWidth: 900,
    minHeight: 600,
    backgroundColor: '#0b0b0c',
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

async function runBench(host: EngineHost, window: BrowserWindow, rawRoot: string): Promise<void> {
  const root = rawRoot.replace(/\//g, '\\');
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
      if (event.type === 'finished' || event.type === 'failed') {
        finishedAt = Date.now();
        off();
        resolve();
      }
    });
  });

  const clickScript = `(() => {
    const label = ${JSON.stringify(`Analyze ${root}`)};
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
    const started = await host.startAnalyze(root);
    if (!started.ok) {
      const report = { root, ok: false, result: started, samples: reportSamples(), renderer: [] };
      writeFileSync(reportPath, JSON.stringify(report, null, 2));
      console.log(JSON.stringify(report, null, 2));
      app.quit();
      return;
    }
  }

  const timeout = setTimeout(() => {
    const report = { root, ok: false, reason: 'bench-timeout', samples: reportSamples(), renderer: [] };
    writeFileSync(reportPath, JSON.stringify(report, null, 2));
    console.log(JSON.stringify(report, null, 2));
    app.quit();
  }, 20 * 60 * 1000);

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
    ok: failedMessage === null,
    failedMessage,
    scanMs: finalizingAt - startedAt,
    finalizeMs: finishedAt - finalizingAt,
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

void app.whenReady().then(async () => {
  const benchRoot = process.env.DUST_BENCH_ROOT;
  if (benchRoot) {
    app.setPath('userData', join(tmpdir(), 'dust-bench-userdata'));
  }
  const store = new SnapshotStore(createStorePaths(app.getPath('userData')));
  const host = createEngineHost({ store, workerPath: resolveWorkerPath(__dirname) });
  const window = createMainWindow(benchRoot === undefined);

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
      relaunchElevated: async () => {
        if (process.platform !== 'win32') return;
        const args = app.isPackaged ? [] : [app.getAppPath()];
        const child = spawn(
          'powershell.exe',
          ['-NoProfile', '-Command', buildElevationCommand(process.execPath, args)],
          { detached: true, stdio: 'ignore' },
        );
        child.unref();
        app.quit();
      },
    },
  );

  window.once('ready-to-show', () => window.show());
  app.on('before-quit', () => host.dispose());
  await loadRenderer(window);
  if (benchRoot) await runBench(host, window, benchRoot);
}).catch((error: unknown) => {
  console.error('Dust failed to start', error);
  app.quit();
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
