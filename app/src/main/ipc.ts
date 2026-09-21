import { IPC } from '../shared/ipc';
import type { ScanEvent } from '../shared/ipc';
import type { EngineHost } from './host/engine-host';

export interface IpcRegistrar {
  handle(channel: string, listener: (event: unknown, ...args: unknown[]) => unknown): void;
}

export interface EventSender {
  send(channel: string, payload: unknown): void;
}

export interface ShellActions {
  revealPath(path: string): Promise<void>;
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
  return host.onEvent((event: ScanEvent) => sender.send(IPC.scanEvent, event));
}
