import type { StartupNotice, StartupRelaunchAction } from '../shared/ipc';
import type { EngineHost } from './host/engine-host';

export const PENDING_TOGGLE_PREFIX = '--dust-startup-toggle=';
export const PENDING_ENABLE_PREFIX = '--dust-startup-enable=';

export interface PendingStartupToggle {
  requested: boolean;
  id: string | null;
  action: StartupRelaunchAction;
}

function parseId(arg: string, prefix: string): string | null {
  const id = arg.slice(prefix.length);
  return /^[a-f0-9]{16}$/.test(id) ? id : null;
}

export function parsePendingStartupToggle(argv: string[]): PendingStartupToggle {
  const enable = argv.find((arg) => arg.startsWith(PENDING_ENABLE_PREFIX));
  if (enable !== undefined) {
    return { requested: true, id: parseId(enable, PENDING_ENABLE_PREFIX), action: 'enable' };
  }
  const toggle = argv.find((arg) => arg.startsWith(PENDING_TOGGLE_PREFIX));
  if (toggle === undefined) return { requested: false, id: null, action: 'disable' };
  return { requested: true, id: parseId(toggle, PENDING_TOGGLE_PREFIX), action: 'disable' };
}

export async function applyPendingStartupToggle(
  host: EngineHost,
  id: string,
  action: StartupRelaunchAction = 'disable',
): Promise<StartupNotice | null> {
  const list = await host.getStartup();
  if (!list.ok) return null;
  const entry = list.state.entries.find((candidate) => candidate.id === id);
  if (entry === undefined || entry.protected) return null;

  if (action === 'disable') {
    if (entry.state !== 'enabled' || entry.disabledKind === 'windows') return null;
    const toggled = await host.disableStartup(entry.id);
    if (!toggled.ok) return null;
    return { entryId: entry.id, name: entry.name, to: 'disabled' };
  }

  if (entry.state !== 'disabled') return null;
  const toggled = await host.enableStartup(entry.id);
  if (!toggled.ok) return null;
  return {
    entryId: entry.id,
    name: entry.name,
    to: 'enabled',
    disabledKind: entry.disabledKind ?? 'dust',
  };
}
