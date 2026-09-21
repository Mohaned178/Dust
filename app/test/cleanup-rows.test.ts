import { describe, expect, it } from 'vitest';
import { applyCleanReport } from '../src/main/host/cleanup-rows';
import type { CleanReport, ResultRow } from '../src/shared/ipc';

function row(path: string, parent: string | null, overrides: Partial<ResultRow> = {}): ResultRow {
  return {
    path,
    name: path,
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
    gradeReason: 'fixture',
    action: null,
    ...overrides,
  };
}

function report(items: CleanReport['items']): CleanReport {
  return {
    planId: 'plan-1',
    scope: 'quick',
    root: 'C:\\',
    startedAt: 1,
    finishedAt: 2,
    items,
    deletedBytes: items.reduce((sum, item) => sum + item.deletedBytes, 0),
    skippedLocked: 0,
    itemErrors: 0,
    remainingReclaimableBytes: 0,
    cleanedAt: 2,
  };
}

describe('applyCleanReport', () => {
  const rows = [
    row('C:\\', null, { bytes: 1000, allocatedBytes: 2000, fileCount: 10, folderCount: 2 }),
    row('C:\\Temp', 'C:\\', { bytes: 300, allocatedBytes: 300, fileCount: 3, folderCount: 1 }),
    row('C:\\Temp\\deep', 'C:\\Temp', { bytes: 100, allocatedBytes: 100, fileCount: 1, folderCount: 0 }),
    row('C:\\Other', 'C:\\', { bytes: 700, allocatedBytes: 700, fileCount: 6, folderCount: 1 }),
  ];

  it('removes the subtree and deducts bytes and counts from ancestors', () => {
    const result = applyCleanReport(
      rows,
      report([
        {
          ruleId: 'system-temp',
          path: 'C:\\Temp',
          category: 'temp',
          action: 'delete-path',
          status: 'done',
          plannedBytes: 300,
          deletedBytes: 300,
          skippedLocked: 0,
          errorCount: 0,
          restoreCommand: null,
        },
      ]),
    );

    expect(result.map((entry) => entry.path)).toEqual(['C:\\', 'C:\\Other']);
    expect(result[0]).toMatchObject({ bytes: 700, allocatedBytes: 1700, fileCount: 7, folderCount: 1 });
  });

  it('shrinks partially cleaned rows and flags them', () => {
    const result = applyCleanReport(
      rows,
      report([
        {
          ruleId: 'system-temp',
          path: 'C:\\Temp\\deep',
          category: 'temp',
          action: 'delete-path',
          status: 'partial',
          plannedBytes: 100,
          deletedBytes: 40,
          skippedLocked: 1,
          errorCount: 0,
          restoreCommand: null,
        },
      ]),
    );

    const deep = result.find((entry) => entry.path === 'C:\\Temp\\deep');
    const temp = result.find((entry) => entry.path === 'C:\\Temp');
    expect(deep).toMatchObject({ bytes: 60, partial: true });
    expect(temp).toMatchObject({ bytes: 260, partial: false });
    expect(result[0]?.bytes).toBe(960);
  });

  it('leaves failed and already-gone-without-row items alone', () => {
    const result = applyCleanReport(
      rows,
      report([
        {
          ruleId: 'system-temp',
          path: 'C:\\Missing',
          category: 'temp',
          action: 'delete-path',
          status: 'already-gone',
          plannedBytes: 5,
          deletedBytes: 0,
          skippedLocked: 0,
          errorCount: 0,
          restoreCommand: null,
        },
        {
          ruleId: 'system-temp',
          path: 'C:\\Locked',
          category: 'temp',
          action: 'delete-path',
          status: 'failed',
          plannedBytes: 5,
          deletedBytes: 0,
          skippedLocked: 0,
          errorCount: 1,
          restoreCommand: null,
        },
      ]),
    );

    expect(result.map((entry) => entry.path)).toEqual(['C:\\', 'C:\\Temp', 'C:\\Temp\\deep', 'C:\\Other']);
    expect(result[0]?.bytes).toBe(1000);
  });
});
