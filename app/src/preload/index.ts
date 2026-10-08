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
  ResultsCategoriesState,
  ResultsState,
  ScanEvent,
  SetPinResult,
  StartAnalyzeResult,
  StartupDetailsEvent,
  StartupLaunchHint,
  StartupListResult,
  StartupRelaunchAction,
  StartupToggleResult,
  SystemInfoLive,
  SystemInfoStatic,
  UninstallEvent,
  UninstallExecuteRequest,
  UninstallExecuteResult,
  UninstallLaunchHint,
  UninstallListResult,
  UninstallPreviewOptions,
  UninstallPreviewResult,
  UninstallRunRequest,
  UninstallRunResult,
  UpdateStatus,
} from '../shared/ipc';

const api: DustApi = {
  getDashboard: () => ipcRenderer.invoke(IPC.dashboardGet) as Promise<DashboardState>,
  startAnalyze: (volume: string) => ipcRenderer.invoke(IPC.scanStart, volume) as Promise<StartAnalyzeResult>,
  cancelScan: () => ipcRenderer.invoke(IPC.scanCancel) as Promise<void>,
  getResults: (root: string) => ipcRenderer.invoke(IPC.resultsGet, root) as Promise<ResultsState>,
  getResultCategories: (root: string) =>
    ipcRenderer.invoke(IPC.resultsCategoriesGet, root) as Promise<ResultsCategoriesState>,
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
  getStartup: () => ipcRenderer.invoke(IPC.startupList) as Promise<StartupListResult>,
  disableStartupEntry: (id: string) => ipcRenderer.invoke(IPC.startupDisable, id) as Promise<StartupToggleResult>,
  enableStartupEntry: (id: string) => ipcRenderer.invoke(IPC.startupEnable, id) as Promise<StartupToggleResult>,
  getStartupLaunchHint: () => ipcRenderer.invoke(IPC.startupHint) as Promise<StartupLaunchHint | null>,
  getSystemInfo: (force?: boolean) =>
    ipcRenderer.invoke(IPC.systemInfoGet, force === true) as Promise<SystemInfoStatic>,
  getSystemInfoLive: () => ipcRenderer.invoke(IPC.systemInfoLive) as Promise<SystemInfoLive>,
  relaunchElevated: (startupToggleId?: string, action?: StartupRelaunchAction) =>
    ipcRenderer.invoke(IPC.relaunchElevated, startupToggleId, action) as Promise<void>,
  listUninstallApps: (force?: boolean) =>
    ipcRenderer.invoke(IPC.uninstallList, force === true) as Promise<UninstallListResult>,
  previewUninstall: (appId: string, options?: UninstallPreviewOptions) =>
    ipcRenderer.invoke(IPC.uninstallPreview, appId, options ?? {}) as Promise<UninstallPreviewResult>,
  runUninstaller: (request: UninstallRunRequest) =>
    ipcRenderer.invoke(IPC.uninstallRun, request) as Promise<UninstallRunResult>,
  executeUninstall: (request: UninstallExecuteRequest) =>
    ipcRenderer.invoke(IPC.uninstallExecute, request) as Promise<UninstallExecuteResult>,
  skipUninstallWaiting: () => ipcRenderer.invoke(IPC.uninstallSkipWaiting) as Promise<void>,
  getUninstallLaunchHint: () => ipcRenderer.invoke(IPC.uninstallHint) as Promise<UninstallLaunchHint | null>,
  relaunchElevatedUninstall: (jobId: string) =>
    ipcRenderer.invoke(IPC.relaunchElevatedUninstall, jobId) as Promise<void>,
  getUpdateStatus: () => ipcRenderer.invoke(IPC.updatesGet) as Promise<UpdateStatus>,
  checkForUpdates: () => ipcRenderer.invoke(IPC.updatesCheck) as Promise<UpdateStatus>,
  installUpdate: () => ipcRenderer.invoke(IPC.updatesInstall) as Promise<void>,
  onUpdateEvent: (handler: (status: UpdateStatus) => void) => {
    const listener = (_event: unknown, payload: UpdateStatus) => handler(payload);
    ipcRenderer.on(IPC.updatesEvent, listener);
    return () => {
      ipcRenderer.removeListener(IPC.updatesEvent, listener);
    };
  },
  onUninstallEvent: (handler: (event: UninstallEvent) => void) => {
    const listener = (_event: unknown, payload: UninstallEvent) => handler(payload);
    ipcRenderer.on(IPC.uninstallEvent, listener);
    return () => {
      ipcRenderer.removeListener(IPC.uninstallEvent, listener);
    };
  },
  onStartupEvent: (handler: (event: StartupDetailsEvent) => void) => {
    const listener = (_event: unknown, payload: StartupDetailsEvent) => handler(payload);
    ipcRenderer.on(IPC.startupEvent, listener);
    return () => {
      ipcRenderer.removeListener(IPC.startupEvent, listener);
    };
  },
  onScanEvent: (handler: (event: ScanEvent) => void) => {
    const listener = (_event: unknown, payload: ScanEvent) => handler(payload);
    ipcRenderer.on(IPC.scanEvent, listener);
    return () => {
      ipcRenderer.removeListener(IPC.scanEvent, listener);
    };
  },
};

contextBridge.exposeInMainWorld('dust', api);
