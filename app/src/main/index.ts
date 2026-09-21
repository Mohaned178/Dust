import { SnapshotStore } from '@dust/core';
import { BrowserWindow, app, ipcMain } from 'electron';
import { join } from 'node:path';
import type { IpcRegistrar } from './ipc';
import { registerIpcHandlers } from './ipc';
import { createEngineHost } from './host/engine-host';
import { createStorePaths, resolveWorkerPath } from './paths';

function createMainWindow(): BrowserWindow {
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

void app.whenReady().then(async () => {
  const store = new SnapshotStore(createStorePaths(app.getPath('userData')));
  const host = createEngineHost({ store, workerPath: resolveWorkerPath(__dirname) });
  const window = createMainWindow();

  const registrar: IpcRegistrar = {
    handle: (channel, listener) => {
      ipcMain.handle(channel, (event, ...args) => listener(event, ...args));
    },
  };
  registerIpcHandlers(registrar, host, {
    send: (channel, payload) => {
      if (!window.isDestroyed()) window.webContents.send(channel, payload);
    },
  });

  window.once('ready-to-show', () => window.show());
  app.on('before-quit', () => host.dispose());
  await loadRenderer(window);
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
