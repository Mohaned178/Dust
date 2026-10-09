import { describe, expect, it } from 'vitest';
import { folderChildren, searchRows, topContributors, SUMMARY_CONTRIBUTOR_CAP } from '../src/main/host/results-index';
import { applyCleanReport } from '../src/main/host/cleanup-rows';
import type { CleanReport, ResultAction, ResultRow } from '../src/shared/ipc';

function row(path: string, parent: string | null, bytes: number, extra: Partial<ResultRow> = {}): ResultRow {
  return {
    path,
    name: path.split('\\').pop() || path,
    parent,
    bytes,
    allocatedBytes: bytes,
    fileCount: 1,
    folderCount: 0,
    linkCount: 0,
    newestMtimeMs: 0,
    errorCount: 0,
    partial: false,
    complete: true,
    childCount: 0,
    grade: 'review',
    gradeReason: 'test',
    action: null,
    ...extra,
  };
}

const temp: ResultAction = { ruleId: 'temp', category: 'temp', grade: 'safe', evidence: 'test' };
const caches: ResultAction = { ruleId: 'cache', category: 'app-caches', grade: 'review', evidence: 'test' };

function fixture(): ResultRow[] {
  return [
    row('C:\\', null, 1000),
    row('C:\\Users', 'C:\\', 600),
    row('C:\\Windows', 'C:\\', 300, { grade: 'danger' }),
    row('C:\\Temp', 'C:\\', 100, { action: temp }),
    row('C:\\Users\\Ada', 'C:\\Users', 400),
    row('C:\\Users\\Ada\\Cache', 'C:\\Users\\Ada', 250, { action: caches }),
    row('C:\\Users\\Bob', 'C:\\Users', 200),
  ];
}

describe('folderChildren', () => {
  it('lists direct children largest first and reports the total', () => {
    const result = folderChildren(fixture(), 'C:\\');
    expect(result.rows.map((r) => r.name)).toEqual(['Users', 'Windows', 'Temp']);
    expect(result.total).toBe(3);
  });

  it('treats an empty path as the root and matches paths case-insensitively', () => {
    const rows = fixture();
    expect(folderChildren(rows, '').total).toBe(3);
    expect(folderChildren(rows, 'c:\\users\\').rows.map((r) => r.name)).toEqual(['Ada', 'Bob']);
  });

  it('pages with limit and offset', () => {
    const page = folderChildren(fixture(), 'C:\\', { limit: 1, offset: 1 });
    expect(page.total).toBe(3);
    expect(page.rows.map((r) => r.name)).toEqual(['Windows']);
  });

  it('sorts by name and can hide system-critical rows', () => {
    const rows = fixture();
    expect(folderChildren(rows, 'C:\\', { sort: 'name' }).rows.map((r) => r.name)).toEqual([
      'Temp',
      'Users',
      'Windows',
    ]);
    const hidden = folderChildren(rows, 'C:\\', { hideDanger: true });
    expect(hidden.rows.map((r) => r.name)).toEqual(['Users', 'Temp']);
    expect(hidden.total).toBe(2);
  });

  it('returns nothing for an unknown folder and clamps bad paging values', () => {
    const rows = fixture();
    expect(folderChildren(rows, 'C:\\Nope')).toEqual({ rows: [], total: 0 });
    expect(folderChildren(rows, 'C:\\', { limit: -5, offset: -2 }).rows).toHaveLength(1);
  });
});

describe('topContributors', () => {
  it('groups action rows by category, largest first, with every category present', () => {
    const result = topContributors(fixture());
    expect(result.temp.map((r) => r.path)).toEqual(['C:\\Temp']);
    expect(result['app-caches'].map((r) => r.path)).toEqual(['C:\\Users\\Ada\\Cache']);
    expect(result['recycle-bin']).toEqual([]);
  });

  it('caps each category', () => {
    const rows = [row('C:\\', null, 1)];
    for (let i = 0; i < SUMMARY_CONTRIBUTOR_CAP + 50; i += 1) {
      rows.push(row(`C:\\t${i}`, 'C:\\', i, { action: temp }));
    }
    const result = topContributors(rows);
    expect(result.temp).toHaveLength(SUMMARY_CONTRIBUTOR_CAP);
    expect(result.temp[0]!.bytes).toBe(SUMMARY_CONTRIBUTOR_CAP + 49);
  });
});

describe('searchRows', () => {
  it('matches on any part of the path, largest first', () => {
    const result = searchRows(fixture(), 'ADA');
    expect(result.rows.map((r) => r.name)).toEqual(['Ada', 'Cache']);
    expect(result.total).toBe(2);
  });

  it('caps rows but still reports every match', () => {
    const rows = [row('C:\\', null, 1)];
    for (let i = 0; i < 20; i += 1) rows.push(row(`C:\\item${i}`, 'C:\\', i));
    const result = searchRows(rows, 'item', { limit: 5 });
    expect(result.rows).toHaveLength(5);
    expect(result.total).toBe(20);
  });

  it('returns nothing for a blank query and honours hideDanger', () => {
    const rows = fixture();
    expect(searchRows(rows, '   ')).toEqual({ rows: [], total: 0 });
    expect(searchRows(rows, 'windows', { hideDanger: true })).toEqual({ rows: [], total: 0 });
    expect(searchRows(rows, 'windows').total).toBe(1);
  });
});

describe('after a clean', () => {
  it('serves the rows applyCleanReport returns, not the deleted ones', () => {
    const rows = fixture();
    expect(topContributors(rows).temp).toHaveLength(1);
    expect(folderChildren(rows, 'C:\\').total).toBe(3);

    const report: CleanReport = {
      planId: 'p',
      scope: 'row',
      root: 'C:\\',
      startedAt: 0,
      finishedAt: 0,
      items: [
        {
          ruleId: 'temp',
          path: 'C:\\Temp',
          category: 'temp',
          action: 'delete-path',
          status: 'done',
          plannedBytes: 100,
          deletedBytes: 100,
          skippedLocked: 0,
          errorCount: 0,
          restoreCommand: null,
        },
      ],
      deletedBytes: 100,
      skippedLocked: 0,
      itemErrors: 0,
      remainingReclaimableBytes: 0,
      cleanedAt: 0,
    };
    const after = applyCleanReport(rows, report);
    expect(topContributors(after).temp).toEqual([]);
    expect(folderChildren(after, 'C:\\').rows.map((r) => r.name)).toEqual(['Users', 'Windows']);
    expect(searchRows(after, 'temp').total).toBe(0);
  });
});

describe('on a full-drive tree (about 280k rows)', () => {
  it('stays inside generous time bounds', () => {
    const rows = [row('C:\\', null, 1e12)];
    for (let d = 0; d < 500; d += 1) {
      const dir = `C:\\dir${d}`;
      rows.push(row(dir, 'C:\\', 1e9 - d));
      for (let i = 0; i < 560; i += 1) {
        rows.push(row(`${dir}\\sub${i}`, dir, (i * 7919) % 100000, i % 50 === 0 ? { action: temp } : {}));
      }
    }
    const time = (fn: () => unknown): number => {
      const startedAt = performance.now();
      fn();
      return performance.now() - startedAt;
    };
    // Measured at 15 ms, 85 ms and 330 ms; the bounds leave room for slow machines.
    expect(time(() => topContributors(rows))).toBeLessThan(300);
    expect(time(() => folderChildren(rows, 'C:\\dir3'))).toBeLessThan(1000);
    expect(time(() => searchRows(rows, 'sub12'))).toBeLessThan(3000);
    expect(time(() => searchRows(rows, 'dir7'))).toBeLessThan(300);
  });
});
