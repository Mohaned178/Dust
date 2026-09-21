import { IPC } from '../shared/ipc';
import type { ScanEvent } from '../shared/ipc';
import type { EngineHost } from './host/engine-host';

export interface IpcRegistrar {
  handle(channel: string, listener: (event: unknown, ...args: unknown[]) => unknown): void;
}

export interface EventSender {
  send(channel: string, payload: unknown): void;
}

export function registerIpcHandlers(registrar: IpcRegistrar, host: EngineHost, sender: EventSender): () => void {
  registrar.handle(IPC.dashboardGet, () => host.getDashboard());
  registrar.handle(IPC.scanStart, (_event, volume) => host.startAnalyze(typeof volume === 'string' ? volume : ''));
  registrar.handle(IPC.scanCancel, () => {
    host.cancelScan();
  });
  return host.onEvent((event: ScanEvent) => sender.send(IPC.scanEvent, event));
}
