import { BrowserWindow, app } from 'electron';
import { join } from 'node:path';

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
  const window = createMainWindow();
  window.once('ready-to-show', () => window.show());
  await loadRenderer(window);
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
