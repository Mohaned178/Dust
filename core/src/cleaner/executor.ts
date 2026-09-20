import { execFileSync } from 'node:child_process';
import { lstatSync, readdirSync, rmdirSync, unlinkSync } from 'node:fs';
import { isAbsolute, join, normalize } from 'node:path';
import type { PlanItem } from './plan';
import { checkDeletable } from './guard';
import type { GuardOptions } from './guard';

export interface DeleteError {
  path: string;
  code: string;
}

export interface DeleteOutcome {
  status: 'done' | 'partial' | 'failed' | 'already-gone';
  deletedBytes: number;
  skippedLocked: number;
  errors: DeleteError[];
}

export interface ItemResult extends DeleteOutcome {
  ruleId: string;
  path: string;
  action: PlanItem['action']['kind'];
}

export interface EmptyRecycleBinResult {
  ok: boolean;
  code?: string;
  detail?: string;
}

export function defaultEmptyRecycleBin(): EmptyRecycleBinResult {
  if (process.platform !== 'win32') return { ok: false, code: 'RECYCLE-BIN-UNSUPPORTED' };
  try {
    execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', 'Clear-RecycleBin -Force -Confirm:$false -ErrorAction Stop'], {
      encoding: 'utf8',
      timeout: 60_000,
    });
    return { ok: true };
  } catch (error) {
    return { ok: false, code: 'RECYCLE-BIN-ERROR', detail: codeOf(error) };
  }
}

const FILE_LOCKED_CODES = new Set(['EBUSY', 'EPERM']);

export function deletePathTree(target: string): DeleteOutcome {
  const outcome: DeleteOutcome = { status: 'done', deletedBytes: 0, skippedLocked: 0, errors: [] };

  if (!isAbsolute(target)) {
    outcome.errors.push({ path: target, code: 'RELATIVE-PATH' });
    outcome.status = 'failed';
    return outcome;
  }

  let rootStat;
  try {
    rootStat = lstatSync(normalize(target));
  } catch (error) {
    if (codeOf(error) === 'ENOENT') {
      return { status: 'already-gone', deletedBytes: 0, skippedLocked: 0, errors: [] };
    }
    outcome.errors.push({ path: target, code: codeOf(error) });
    outcome.status = 'failed';
    return outcome;
  }

  if (rootStat.isSymbolicLink()) {
    outcome.errors.push({ path: target, code: 'ELINK' });
    outcome.status = 'failed';
    return outcome;
  }

  if (rootStat.isDirectory()) {
    walkDirectory(normalize(target), outcome);
    try {
      rmdirSync(normalize(target));
    } catch (error) {
      const code = codeOf(error);
      if (code !== 'ENOENT' && code !== 'ENOTEMPTY') {
        outcome.errors.push({ path: target, code });
      }
    }
  } else {
    removeFile(normalize(target), rootStat.size, outcome);
  }

  outcome.status = deriveStatus(outcome);
  return outcome;
}

export function executeItem(
  item: PlanItem,
  options: { guard?: GuardOptions; runEmptyRecycleBin?: () => EmptyRecycleBinResult } = {},
): ItemResult {
  if (item.action.kind === 'empty-recycle-bin') {
    const guardResult = checkDeletable(item.path, {
      ...(options.guard ?? {}),
      exemptExact: [item.path],
    });
    if (!guardResult.allowed) {
      return {
        ...baseResult(item),
        action: 'empty-recycle-bin',
        status: 'failed',
        deletedBytes: 0,
        skippedLocked: 0,
        errors: [{ path: item.path, code: `GUARD-${(guardResult.reason ?? 'denied').toUpperCase()}` }],
      };
    }
    const run = options.runEmptyRecycleBin ?? defaultEmptyRecycleBin;
    const result = run();
    if (result.ok) {
      return {
        ...baseResult(item),
        action: 'empty-recycle-bin',
        status: 'done',
        deletedBytes: 0,
        skippedLocked: 0,
        errors: [],
      };
    }
    return {
      ...baseResult(item),
      action: 'empty-recycle-bin',
      status: 'failed',
      deletedBytes: 0,
      skippedLocked: 0,
      errors: [{ path: item.path, code: result.code ?? 'RECYCLE-BIN-ERROR' }],
    };
  }

  const guardResult = checkDeletable(item.path, {
    ...(options.guard ?? {}),
    exemptExact: [item.path],
  });
  if (!guardResult.allowed) {
    return {
      ...baseResult(item),
      action: 'delete-path',
      status: 'failed',
      deletedBytes: 0,
      skippedLocked: 0,
      errors: [{ path: item.path, code: `GUARD-${(guardResult.reason ?? 'denied').toUpperCase()}` }],
    };
  }

  const outcome = deletePathTree(item.path);
  return { ...outcome, ...baseResult(item), action: 'delete-path' };
}

function baseResult(item: PlanItem): Pick<ItemResult, 'ruleId' | 'path'> {
  return { ruleId: item.ruleId, path: item.path };
}

function walkDirectory(dir: string, outcome: DeleteOutcome): void {
  let dirents;
  try {
    dirents = readdirSync(dir, { withFileTypes: true });
  } catch (error) {
    outcome.errors.push({ path: dir, code: codeOf(error) });
    return;
  }

  for (const dirent of dirents) {
    const abs = join(dir, dirent.name);

    if (dirent.isSymbolicLink()) {
      outcome.errors.push({ path: abs, code: 'ELINK' });
      continue;
    }

    if (dirent.isDirectory()) {
      walkDirectory(abs, outcome);
      try {
        rmdirSync(abs);
      } catch (error) {
        const code = codeOf(error);
        if (code !== 'ENOENT' && code !== 'ENOTEMPTY') {
          outcome.errors.push({ path: abs, code });
        }
      }
      continue;
    }

    let size = 0;
    try {
      size = lstatSync(abs).size;
    } catch (error) {
      outcome.errors.push({ path: abs, code: codeOf(error) });
      continue;
    }
    removeFile(abs, size, outcome);
  }
}

function removeFile(abs: string, size: number, outcome: DeleteOutcome): void {
  try {
    unlinkSync(abs);
    outcome.deletedBytes += size;
  } catch (error) {
    const code = codeOf(error);
    if (FILE_LOCKED_CODES.has(code)) {
      outcome.skippedLocked += 1;
    } else {
      outcome.errors.push({ path: abs, code });
    }
  }
}

function deriveStatus(outcome: DeleteOutcome): DeleteOutcome['status'] {
  const hasFailures = outcome.skippedLocked > 0 || outcome.errors.length > 0;
  if (!hasFailures) return 'done';
  if (outcome.errors.length > 0 && outcome.deletedBytes === 0 && outcome.skippedLocked === 0) return 'failed';
  return 'partial';
}

function codeOf(error: unknown): string {
  if (typeof error === 'object' && error !== null && 'code' in error) {
    const code = (error as { code?: unknown }).code;
    if (typeof code === 'string') return code;
  }
  return 'UNKNOWN';
}
