import { IPC } from '../shared/ipc';
import type { CleanExecuteRequest, CleanPreviewRequest, ScanEvent } from '../shared/ipc';
import type { EngineHost } from './host/engine-host';

export interface IpcRegistrar {
  handle(channel: string, listener: (event: unknown, ...args: unknown[]) => unknown): void;
}

export interface EventSender {
  send(channel: string, payload: unknown): void;
}

export interface ShellActions {
  revealPath(path: string): Promise<void>;
  relaunchElevated(): Promise<void>;
}

export function registerIpcHandlers(
  registrar: IpcRegistrar,
  host: EngineHost,
  sender: EventSender,
  shell: ShellActions,
): () => void {
  registrar.handle(IPC.dashboardGet, () => host.getDashboard());
  registrar.handle(IPC.scanStart, (_event, volume) => host.startAnalyze(typeof volume === 'string' ? volume : ''));
  registrar.handle(IPC.scanCancel, () => host.cancelScan());
  registrar.handle(IPC.resultsGet, (_event, root) => host.getResults(typeof root === 'string' ? root : ''));
  registrar.handle(IPC.revealPath, (_event, path) => shell.revealPath(typeof path === 'string' ? path : ''));
  registrar.handle(IPC.cleanPreview, (_event, request) => host.previewClean(parseCleanPreviewRequest(request)));
  registrar.handle(IPC.cleanExecute, (_event, request) => host.executeClean(parseCleanExecuteRequest(request)));
  registrar.handle(IPC.devCleanupGet, (_event, root) => host.getDevCleanup(typeof root === 'string' ? root : ''));
  registrar.handle(IPC.pinsSet, (_event, path, pinned) =>
    host.setPin(typeof path === 'string' ? path : '', pinned === true),
  );
  registrar.handle(IPC.relaunchElevated, () => shell.relaunchElevated());
  return host.onEvent((event: ScanEvent) => sender.send(IPC.scanEvent, event));
}

export function parseCleanPreviewRequest(value: unknown): CleanPreviewRequest {
  if (typeof value === 'object' && value !== null) {
    const record = value as Record<string, unknown>;
    if (record.scope === 'quick') return { scope: 'quick' };
    if ((record.scope === 'dev' || record.scope === 'row') && typeof record.root === 'string') {
      const paths = Array.isArray(record.paths)
        ? record.paths.filter((entry): entry is string => typeof entry === 'string')
        : [];
      return { scope: record.scope, root: record.root, paths };
    }
  }
  return { scope: 'quick' };
}

export function parseCleanExecuteRequest(value: unknown): CleanExecuteRequest {
  const record = typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : {};
  const acknowledge = Array.isArray(record.acknowledge)
    ? record.acknowledge.filter((entry): entry is string => typeof entry === 'string')
    : [];
  return {
    cleanId: typeof record.cleanId === 'string' ? record.cleanId : '',
    planId: typeof record.planId === 'string' ? record.planId : '',
    acknowledge,
  };
}
