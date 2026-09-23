import { contextBridge, ipcRenderer } from 'electron';
import { IPC } from '../shared/ipc';
import type {
  BrowseDeleteResult,
  BrowseState,
  CleanExecuteRequest,
  CleanExecuteResult,
  CleanPreviewRequest,
  CleanPreviewResult,
  DashboardState,
  DevCleanupState,
  DustApi,
  ResultsState,
  ScanEvent,
  SetPinResult,
  StartAnalyzeResult,
} from '../shared/ipc';

const api: DustApi = {
  getDashboard: () => ipcRenderer.invoke(IPC.dashboardGet) as Promise<DashboardState>,
  startAnalyze: (volume: string) => ipcRenderer.invoke(IPC.scanStart, volume) as Promise<StartAnalyzeResult>,
  cancelScan: () => ipcRenderer.invoke(IPC.scanCancel) as Promise<void>,
  getResults: (root: string) => ipcRenderer.invoke(IPC.resultsGet, root) as Promise<ResultsState>,
  startBrowse: (volume: string) => ipcRenderer.invoke(IPC.browseStart, volume) as Promise<StartAnalyzeResult>,
  getBrowseResults: (root: string) => ipcRenderer.invoke(IPC.browseResultsGet, root) as Promise<BrowseState>,
  deleteBrowsePath: (path: string) => ipcRenderer.invoke(IPC.browseDelete, path) as Promise<BrowseDeleteResult>,
  revealPath: (path: string) => ipcRenderer.invoke(IPC.revealPath, path) as Promise<void>,
  previewClean: (request: CleanPreviewRequest) =>
    ipcRenderer.invoke(IPC.cleanPreview, request) as Promise<CleanPreviewResult>,
  executeClean: (request: CleanExecuteRequest) =>
    ipcRenderer.invoke(IPC.cleanExecute, request) as Promise<CleanExecuteResult>,
  getDevCleanup: (root: string) => ipcRenderer.invoke(IPC.devCleanupGet, root) as Promise<DevCleanupState>,
  setPin: (path: string, pinned: boolean) => ipcRenderer.invoke(IPC.pinsSet, path, pinned) as Promise<SetPinResult>,
  relaunchElevated: () => ipcRenderer.invoke(IPC.relaunchElevated) as Promise<void>,
  onScanEvent: (handler: (event: ScanEvent) => void) => {
    const listener = (_event: unknown, payload: ScanEvent) => handler(payload);
    ipcRenderer.on(IPC.scanEvent, listener);
    return () => {
      ipcRenderer.removeListener(IPC.scanEvent, listener);
    };
  },
};

contextBridge.exposeInMainWorld('dust', api);
