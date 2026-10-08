import type { StartupDetailsEvent, StartupListState } from '../../src/shared/ipc';

type Detail = StartupDetailsEvent['details'][number];

// Publishers and icons reach the page as events, separately from the list. They are kept here,
// outside the page cache, so an event can never replace a list that is still loading, and one
// that arrives before the list is not lost.
const overlay = new Map<string, Detail>();

/** Forget everything. Tests use this between cases. */
export function resetStartupDetails(): void {
  overlay.clear();
}

export function recordStartupDetails(details: Detail[]): void {
  for (const detail of details) overlay.set(detail.id, detail);
}

/** The overlay wins for the ids it holds; every other field of an entry is left as it is. */
export function applyStartupDetails(state: StartupListState): StartupListState {
  if (overlay.size === 0) return state;
  let changed = false;
  const entries = state.entries.map((entry) => {
    const detail = overlay.get(entry.id);
    if (detail === undefined) return entry;
    if (detail.publisher === entry.publisher && detail.iconDataUrl === entry.iconDataUrl) return entry;
    changed = true;
    return { ...entry, publisher: detail.publisher, iconDataUrl: detail.iconDataUrl };
  });
  return changed ? { ...state, entries } : state;
}

/**
 * Call with a state that came from the main process. Once that already carries a publisher or icon
 * for an id, it is at least as new as the event and the overlay entry would only go stale.
 */
export function pruneStartupDetails(state: StartupListState): StartupListState {
  for (const entry of state.entries) {
    if (entry.publisher !== null || entry.iconDataUrl !== null) overlay.delete(entry.id);
  }
  return state;
}
