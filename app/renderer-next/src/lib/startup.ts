import type { StartupEntry, StartupListState, StartupSource } from '../../../src/shared/ipc';
import type { StartupDetail } from '../stores/startup';

/** Where an entry starts from, in plain words. */
export function sourceLabel(source: StartupSource): string {
  switch (source) {
    case 'hkcu-run':
      return 'Registry · this user';
    case 'hklm-run':
      return 'Registry · all users';
    case 'hklm-run-wow64':
      return 'Registry · all users, 32-bit';
    case 'startup-folder-user':
      return 'Startup folder · this user';
    case 'startup-folder-common':
      return 'Startup folder · all users';
  }
}

export function countsFor(entries: ReadonlyArray<StartupEntry>): StartupListState['counts'] {
  return {
    total: entries.length,
    enabled: entries.filter((entry) => entry.state === 'enabled').length,
    disabled: entries.filter((entry) => entry.state === 'disabled').length,
  };
}

/** Lays publishers and icons that became known after the list over it, without changing what the backend sent. */
export function withDetails(state: StartupListState, details: ReadonlyMap<string, StartupDetail>): StartupListState {
  if (details.size === 0) return state;
  return {
    ...state,
    entries: state.entries.map((entry) => {
      const detail = details.get(entry.id);
      if (detail === undefined) return entry;
      return {
        ...entry,
        publisher: entry.publisher ?? detail.publisher,
        iconDataUrl: entry.iconDataUrl ?? detail.iconDataUrl,
      };
    }),
  };
}

export function patchEntry(state: StartupListState, id: string, patch: Partial<StartupEntry>): StartupListState {
  const entries = state.entries.map((entry) => (entry.id === id ? { ...entry, ...patch } : entry));
  return { ...state, entries, counts: countsFor(entries) };
}

/** What the list looks like the moment a switch is flipped, before the backend has answered. */
export function moveEntry(state: StartupListState, id: string, on: boolean): StartupListState {
  return patchEntry(state, id, { state: on ? 'enabled' : 'disabled', disabledKind: on ? null : 'dust' });
}

export type StartupFilter = 'all' | 'on' | 'off';

export function filterEntries(entries: ReadonlyArray<StartupEntry>, filter: StartupFilter): StartupEntry[] {
  const kept =
    filter === 'all'
      ? [...entries]
      : entries.filter((entry) => entry.state === (filter === 'on' ? 'enabled' : 'disabled'));
  return kept.sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }));
}

/** The line under the page title: "9 apps start with Windows · 6 on". */
export function summaryText(counts: StartupListState['counts']): string {
  const noun = counts.total === 1 ? 'app starts' : 'apps start';
  return `${counts.total} ${noun} with Windows · ${counts.enabled} on`;
}

/**
 * A plain-words judgement such as "Usually safe to turn off". The backend does not provide one yet; when it adds a
 * `verdict` to an entry, the row shows it and nothing else here needs to change.
 */
export function verdictOf(entry: StartupEntry): string | null {
  const verdict = (entry as StartupEntry & { verdict?: unknown }).verdict;
  return typeof verdict === 'string' && verdict.length > 0 ? verdict : null;
}
