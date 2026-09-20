import { describe, expect, it } from 'vitest';
import { executeItem } from '../src/cleaner/executor';
import type { PlanItem } from '../src/cleaner/plan';

function item(overrides: Partial<PlanItem> = {}): PlanItem {
  return {
    ruleId: 'recycle-bin',
    category: 'recycle-bin',
    path: 'F:\\synthetic\\recycle',
    bytes: 0,
    grade: 'review',
    recovery: { kind: 'junk', reason: 'Emptied items are permanently gone' },
    evidence: 'fixture',
    action: { kind: 'empty-recycle-bin' },
    ...overrides,
  };
}

describe('executeItem empty-recycle-bin', () => {
  it('reports a defined failure when the platform cannot empty the bin', () => {
    const result = executeItem(item(), {
      guard: { userProfile: 'C:\\Users\\x', userFolders: [] },
      runEmptyRecycleBin: () => ({ ok: false, code: 'RECYCLE-BIN-UNSUPPORTED' }),
    });
    expect(result).toMatchObject({
      action: 'empty-recycle-bin',
      status: 'failed',
      deletedBytes: 0,
    });
    expect(result.errors[0]?.code).toBe('RECYCLE-BIN-UNSUPPORTED');
  });

  it('reports done with zero deleted bytes when the empty call succeeds', () => {
    const result = executeItem(item(), {
      guard: { userProfile: 'C:\\Users\\x', userFolders: [] },
      runEmptyRecycleBin: () => ({ ok: true }),
    });
    expect(result).toMatchObject({ action: 'empty-recycle-bin', status: 'done', deletedBytes: 0 });
    expect(result.errors).toEqual([]);
  });

  it('reports failure with details when the empty call errors', () => {
    const result = executeItem(item(), {
      guard: { userProfile: 'C:\\Users\\x', userFolders: [] },
      runEmptyRecycleBin: () => ({ ok: false, code: 'RECYCLE-BIN-ERROR', detail: 'access denied' }),
    });
    expect(result.status).toBe('failed');
    expect(result.errors[0]?.code).toBe('RECYCLE-BIN-ERROR');
  });

  it('refuses a volume root for the recycle-bin action before running the empty call', () => {
    let called = false;
    const result = executeItem(item({ path: 'C:\\' }), {
      guard: { userProfile: 'C:\\Users\\x', userFolders: [] },
      runEmptyRecycleBin: () => {
        called = true;
        return { ok: true };
      },
    });
    expect(result.status).toBe('failed');
    expect(result.errors[0]?.code).toBe('GUARD-VOLUME-ROOT');
    expect(called).toBe(false);
  });
});
