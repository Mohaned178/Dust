import type { CleanReport, ResultRow } from '../../shared/ipc';
import { pathKey } from './results';

interface Deduction {
  key: string;
  bytes: number;
  allocatedBytes: number;
  fileCount: number;
  folderCount: number;
  linkCount: number;
  partial: boolean;
}

export function applyCleanReport(rows: ResultRow[], report: CleanReport): ResultRow[] {
  const byKey = new Map(rows.map((row) => [pathKey(row.path), row]));
  const goneKeys = new Set<string>();
  const deductions: Deduction[] = [];

  for (const item of report.items) {
    const key = pathKey(item.path);
    if (item.status === 'done' || item.status === 'already-gone') {
      goneKeys.add(key);
    } else if (item.status === 'partial') {
      deductions.push({
        key,
        bytes: item.deletedBytes,
        allocatedBytes: item.deletedBytes,
        fileCount: 0,
        folderCount: 0,
        linkCount: 0,
        partial: true,
      });
    }
  }

  const removed = new Set<string>();
  for (const key of goneKeys) {
    const row = byKey.get(key);
    if (row) {
      deductions.push({
        key,
        bytes: row.bytes,
        allocatedBytes: row.allocatedBytes,
        fileCount: row.fileCount,
        folderCount: row.folderCount,
        linkCount: row.linkCount,
        partial: false,
      });
    }
    for (const candidate of rows) {
      const candidateKey = pathKey(candidate.path);
      if (isSameOrUnder(candidateKey, key)) removed.add(candidateKey);
    }
  }

  const out: ResultRow[] = [];
  for (const row of rows) {
    const key = pathKey(row.path);
    if (removed.has(key)) continue;
    let next = row;
    for (const deduction of deductions) {
      if (!isSameOrUnder(deduction.key, key)) continue;
      next = {
        ...next,
        bytes: Math.max(next.bytes - deduction.bytes, 0),
        allocatedBytes: Math.max(next.allocatedBytes - deduction.allocatedBytes, 0),
        fileCount: Math.max(next.fileCount - deduction.fileCount, 0),
        folderCount: Math.max(next.folderCount - deduction.folderCount, 0),
        linkCount: Math.max(next.linkCount - deduction.linkCount, 0),
        partial: next.partial || (deduction.partial && deduction.key === key),
      };
    }
    out.push(next);
  }
  return out;
}

function isSameOrUnder(key: string, rootKey: string): boolean {
  if (key === rootKey) return true;
  const base = rootKey.endsWith('\\') ? rootKey : `${rootKey}\\`;
  return key.startsWith(base) || key.startsWith(`${rootKey}/`);
}
