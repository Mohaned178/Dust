import { describe, expect, it } from 'vitest';
import {
  filterEntries,
  moveEntry,
  patchEntry,
  sourceLabel,
  summaryText,
  verdictOf,
  withDetails,
} from '../../../renderer-next/src/lib/startup';
import { makeStartupEntry, makeStartupState } from '../../renderer/fakes';

describe('startup helpers', () => {
  it('describes where an entry starts from in plain words', () => {
    expect(sourceLabel('hkcu-run')).toBe('Registry · this user');
    expect(sourceLabel('hklm-run')).toBe('Registry · all users');
    expect(sourceLabel('hklm-run-wow64')).toBe('Registry · all users, 32-bit');
    expect(sourceLabel('startup-folder-user')).toBe('Startup folder · this user');
    expect(sourceLabel('startup-folder-common')).toBe('Startup folder · all users');
  });

  it('summarises the counts without scoring them', () => {
    expect(summaryText({ total: 9, enabled: 6, disabled: 3 })).toBe('9 apps start with Windows · 6 on');
    expect(summaryText({ total: 1, enabled: 1, disabled: 0 })).toBe('1 app starts with Windows · 1 on');
  });

  it('filters and sorts by name', () => {
    const { entries } = makeStartupState();
    expect(filterEntries(entries, 'all').map((entry) => entry.name)).toEqual([
      'Discord',
      'OneDrive',
      'SecurityHealth',
      'Slack',
      'Steam',
    ]);
    expect(filterEntries(entries, 'on')).toHaveLength(3);
    expect(filterEntries(entries, 'off').map((entry) => entry.name)).toEqual(['OneDrive', 'Slack']);
  });

  it('lays details over the list only where nothing is known, and leaves the original alone', () => {
    const state = makeStartupState({
      entries: [makeStartupEntry({ id: 'x', publisher: null }), makeStartupEntry({ id: 'y', publisher: 'Known' })],
    });
    const shown = withDetails(
      state,
      new Map([
        ['x', { publisher: 'Late', iconDataUrl: 'data:a' }],
        ['y', { publisher: 'Other', iconDataUrl: null }],
      ]),
    );
    expect(shown.entries.map((entry) => entry.publisher)).toEqual(['Late', 'Known']);
    expect(shown.entries[0]!.iconDataUrl).toBe('data:a');
    expect(state.entries[0]!.publisher).toBeNull();
    expect(withDetails(state, new Map())).toBe(state);
  });

  it('moves one entry and keeps the counts right', () => {
    const state = makeStartupState();
    const off = moveEntry(state, state.entries[0]!.id, false);
    expect(off.entries[0]).toMatchObject({ state: 'disabled', disabledKind: 'dust' });
    expect(off.counts).toEqual({ total: 5, enabled: 2, disabled: 3 });
    const back = patchEntry(off, state.entries[0]!.id, { state: 'enabled', disabledKind: null });
    expect(back.counts).toEqual(state.counts);
  });

  it('shows a verdict only when the backend provides one', () => {
    expect(verdictOf(makeStartupEntry())).toBeNull();
    expect(verdictOf({ ...makeStartupEntry(), verdict: 'Usually safe to turn off' } as never)).toBe(
      'Usually safe to turn off',
    );
  });
});
