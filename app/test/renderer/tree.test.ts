import { describe, expect, it } from 'vitest';
import {
  ancestorKeys,
  compareRows,
  createRowStore,
  filterPaths,
  flattenVisible,
  isRowVisible,
  matchedPaths,
  mergeMatches,
  pathKey,
  pathName,
  pathParent,
  sameRoot,
  upsertRows,
} from '../../renderer/src/tree';
import type { ResultRow } from '../../src/shared/ipc';

function row(path: string, parent: string | null, overrides: Partial<ResultRow> = {}): ResultRow {
  return {
    path,
    name: pathName(path),
    parent,
    bytes: 0,
    allocatedBytes: 0,
    fileCount: 0,
    folderCount: 0,
    linkCount: 0,
    newestMtimeMs: 0,
    errorCount: 0,
    partial: false,
    complete: true,
    childCount: 0,
    grade: 'review',
    gradeReason: 'Unrecognized folder — review before deleting',
    action: null,
    ...overrides,
  };
}

describe('path helpers', () => {
  it('splits Windows paths without Node built-ins', () => {
    expect(pathParent('C:\\Users\\x\\Temp')).toBe('C:\\Users\\x');
    expect(pathParent('C:\\Users')).toBe('C:\\');
    expect(pathName('C:\\Users\\x\\Temp')).toBe('Temp');
    expect(pathKey('C:\\Users\\X\\')).toBe('c:\\users\\x');
    expect(sameRoot('C:\\', 'c:\\')).toBe(true);
  });
});

describe('RowStore', () => {
  it('creates stub ancestors for rows that stream in before their parents', () => {
    const store = createRowStore('C:\\');
    upsertRows(store, [row('C:\\a\\b', 'C:\\a', { bytes: 5 })]);

    expect(store.nodes.get(pathKey('C:\\a'))?.complete).toBe(false);
    expect(store.nodes.get(pathKey('C:\\a'))?.name).toBe('a');
    expect(store.nodes.get(pathKey('C:\\a\\b'))?.bytes).toBe(5);
    expect(flattenVisible(store, new Set([pathKey('C:\\a')]), { key: 'size', desc: true }, null)).toHaveLength(2);
  });

  it('merges the real parent record in place and sorts siblings', () => {
    const store = createRowStore('C:\\');
    upsertRows(store, [
      row('C:\\small', 'C:\\', { bytes: 1 }),
      row('C:\\big', 'C:\\', { bytes: 100 }),
    ]);
    upsertRows(store, [row('C:\\big', 'C:\\', { bytes: 100, complete: true, childCount: 0 })]);

    const flat = flattenVisible(store, new Set(), { key: 'size', desc: true }, null);
    expect(flat.map((entry) => entry.row.path)).toEqual(['C:\\big', 'C:\\small']);
    expect(flat[0]!.depth).toBe(0);
  });

  it('refreshes name and parent when a real row replaces a stub', () => {
    const store = createRowStore('C:\\');
    upsertRows(store, [row('C:\\a', 'C:\\', { bytes: 5 })]);
    upsertRows(store, [row('C:\\', null, { name: 'C:\\', bytes: 5, childCount: 1 })]);
    expect(store.nodes.get(pathKey('C:\\'))?.name).toBe('C:\\');
    expect(store.nodes.get(pathKey('C:\\'))?.complete).toBe(true);
  });

  it('applies rule matches to existing rows', () => {
    const store = createRowStore('C:\\');
    upsertRows(store, [row('C:\\Temp', 'C:\\')]);
    mergeMatches(store, [
      { path: 'C:\\Temp', bytes: 1, ruleId: 'system-temp', category: 'temp', grade: 'safe', evidence: 'fixture' },
    ]);
    expect(store.nodes.get(pathKey('C:\\Temp'))?.action).toMatchObject({ ruleId: 'system-temp' });
  });
});

describe('isRowVisible', () => {
  it('treats top-level rows as visible and deeper rows only under expanded ancestors', () => {
    const expanded = new Set([pathKey('C:\\a')]);
    expect(isRowVisible(null, 'C:\\', expanded)).toBe(true);
    expect(isRowVisible('C:\\', 'C:\\', expanded)).toBe(true);
    expect(isRowVisible('C:\\a', 'C:\\', expanded)).toBe(true);
    expect(isRowVisible('C:\\a\\b', 'C:\\', expanded)).toBe(true);
    expect(isRowVisible('C:\\c\\d', 'C:\\', expanded)).toBe(false);
  });
});

describe('compareRows', () => {
  it('orders by every supported key', () => {
    const a = row('C:\\a', 'C:\\', { name: 'a', bytes: 2, allocatedBytes: 1, fileCount: 1, grade: 'safe', newestMtimeMs: 5 });
    const b = row('C:\\b', 'C:\\', { name: 'b', bytes: 1, allocatedBytes: 2, fileCount: 4, grade: 'danger', newestMtimeMs: 9 });
    expect(compareRows(a, b, 'name')).toBeLessThan(0);
    expect(compareRows(a, b, 'size')).toBeGreaterThan(0);
    expect(compareRows(a, b, 'allocated')).toBeLessThan(0);
    expect(compareRows(a, b, 'items')).toBeLessThan(0);
    expect(compareRows(a, b, 'grade')).toBeLessThan(0);
    expect(compareRows(a, b, 'modified')).toBeLessThan(0);
  });
});

describe('filterPaths', () => {
  it('includes matched paths and all their ancestors', () => {
    const store = createRowStore('C:\\');
    upsertRows(store, [
      row('C:\\Users\\x\\AppData\\Local\\Temp', 'C:\\Users\\x\\AppData\\Local', {
        action: { ruleId: 'system-temp', category: 'temp', grade: 'safe', evidence: 'fixture' },
      }),
    ]);
    const included = filterPaths(store, 'temp');
    expect(included).not.toBeNull();
    expect(included!.has(pathKey('C:\\'))).toBe(true);
    expect(included!.has(pathKey('C:\\Users'))).toBe(true);
    expect(included!.has(pathKey('C:\\Users\\x\\AppData\\Local\\Temp'))).toBe(true);
    expect(included!.has(pathKey('C:\\other'))).toBe(false);
    expect(filterPaths(store, null)).toBeNull();
  });
});

function deepTempStore(): ReturnType<typeof createRowStore> {
  const store = createRowStore('C:\\');
  upsertRows(store, [
    row('C:\\Users', 'C:\\', { bytes: 100 }),
    row('C:\\Users\\x', 'C:\\Users', { bytes: 90 }),
    row('C:\\Users\\x\\AppData', 'C:\\Users\\x', { bytes: 80 }),
    row('C:\\Users\\x\\AppData\\Local', 'C:\\Users\\x\\AppData', { bytes: 70 }),
    row('C:\\Users\\x\\AppData\\Local\\Temp', 'C:\\Users\\x\\AppData\\Local', {
      bytes: 862,
      action: { ruleId: 'system-temp', category: 'temp', grade: 'safe', evidence: 'fixture' },
    }),
    row('C:\\Users\\x\\AppData\\Local\\Temp\\junk.tmp', 'C:\\Users\\x\\AppData\\Local\\Temp', { bytes: 10 }),
  ]);
  return store;
}

describe('filtered flattening', () => {
  it('collects the ancestor chain of matches, excluding the root', () => {
    const store = deepTempStore();
    const ancestors = ancestorKeys(store, matchedPaths(store, 'temp'));
    expect([...ancestors].sort()).toEqual(
      [
        pathKey('C:\\Users'),
        pathKey('C:\\Users\\x'),
        pathKey('C:\\Users\\x\\AppData'),
        pathKey('C:\\Users\\x\\AppData\\Local'),
      ].sort(),
    );
  });

  it('reveals the matched folder only once its ancestors are expanded', () => {
    const store = deepTempStore();
    const filter = filterPaths(store, 'temp');
    const matches = matchedPaths(store, 'temp');

    const collapsed = flattenVisible(store, new Set(), { key: 'size', desc: true }, filter, matches);
    expect(collapsed.map((entry) => entry.row.path)).toEqual(['C:\\Users']);

    const opened = ancestorKeys(store, matches);
    const seeded = flattenVisible(store, opened, { key: 'size', desc: true }, filter, matches);
    expect(seeded.map((entry) => entry.row.path)).toContain('C:\\Users\\x\\AppData\\Local\\Temp');
  });

  it('shows children of a matched folder only when that folder is expanded', () => {
    const store = deepTempStore();
    const filter = filterPaths(store, 'temp');
    const matches = matchedPaths(store, 'temp');
    const ancestors = ancestorKeys(store, matches);

    const closed = flattenVisible(store, ancestors, { key: 'size', desc: true }, filter, matches);
    expect(closed.map((entry) => entry.row.path)).not.toContain('C:\\Users\\x\\AppData\\Local\\Temp\\junk.tmp');

    const open = new Set([...ancestors, pathKey('C:\\Users\\x\\AppData\\Local\\Temp')]);
    const opened = flattenVisible(store, open, { key: 'size', desc: true }, filter, matches);
    expect(opened.map((entry) => entry.row.path)).toContain('C:\\Users\\x\\AppData\\Local\\Temp\\junk.tmp');
  });

  it('toggles a filtered ancestor between expanded and collapsed', () => {
    const store = deepTempStore();
    const filter = filterPaths(store, 'temp');
    const matches = matchedPaths(store, 'temp');

    const expanded = flattenVisible(
      store,
      new Set([pathKey('C:\\Users')]),
      { key: 'size', desc: true },
      filter,
      matches,
    );
    const collapsed = flattenVisible(store, new Set(), { key: 'size', desc: true }, filter, matches);
    expect(expanded.length).toBeGreaterThan(collapsed.length);
  });
});
