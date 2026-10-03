import { describe, expect, it } from 'vitest';
import {
  RECYCLE_BATCH_SCRIPT,
  RECYCLE_BATCH_SIZE,
  RECYCLE_SCRIPT,
  stageManyToRecycleBin,
  stageToRecycleBin,
} from '../src/cleaner/recycle';

describe('stageToRecycleBin', () => {
  it('delegates to the injected runner with the target path', async () => {
    const calls: string[] = [];
    const result = await stageToRecycleBin('C:\\Leftovers\\App', {
      run: async (path) => {
        calls.push(path);
        return { ok: true };
      },
    });
    expect(result).toEqual({ ok: true });
    expect(calls).toEqual(['C:\\Leftovers\\App']);
  });

  it('reports failures without throwing', async () => {
    const result = await stageToRecycleBin('C:\\Leftovers\\App', {
      run: async () => {
        throw new Error('powershell missing');
      },
    });
    expect(result).toEqual({ ok: false, code: 'RECYCLE-ERROR' });
  });

  it('passes the path through the environment and uses the recycle option', () => {
    expect(RECYCLE_SCRIPT).toContain('$env:DUST_RECYCLE_PATH');
    expect(RECYCLE_SCRIPT).toContain('SendToRecycleBin');
    expect(RECYCLE_SCRIPT).toContain('OnlyErrorDialogs');
  });
});

describe('stageManyToRecycleBin', () => {
  it('stages unique paths in chunks and maps per-path failures', async () => {
    const calls: string[][] = [];
    const paths = Array.from({ length: RECYCLE_BATCH_SIZE + 2 }, (_, index) => `C:\\Leftovers\\${index}`);
    const failing = new Set([paths[1], paths[RECYCLE_BATCH_SIZE]]);

    const results = await stageManyToRecycleBin(paths, {
      run: async (chunk) => {
        calls.push(chunk);
        return chunk.map((path) => (failing.has(path) ? { ok: false, code: 'RECYCLE-ERROR' } : { ok: true }));
      },
    });

    expect(calls.map((chunk) => chunk.length)).toEqual([RECYCLE_BATCH_SIZE, 2]);
    expect(results.size).toBe(paths.length);
    for (const path of paths) {
      expect(results.get(path)).toEqual(failing.has(path) ? { ok: false, code: 'RECYCLE-ERROR' } : { ok: true });
    }
  });

  it('marks a whole chunk as failed when the runner throws', async () => {
    const results = await stageManyToRecycleBin(['C:\\a', 'C:\\b'], {
      run: async () => {
        throw new Error('powershell missing');
      },
    });
    expect(results.get('C:\\a')).toEqual({ ok: false, code: 'RECYCLE-ERROR' });
    expect(results.get('C:\\b')).toEqual({ ok: false, code: 'RECYCLE-ERROR' });
  });

  it('uses the batched environment variable and reports failures', () => {
    expect(RECYCLE_BATCH_SCRIPT).toContain('$env:DUST_RECYCLE_PATHS');
    expect(RECYCLE_BATCH_SCRIPT).toContain('SendToRecycleBin');
    expect(RECYCLE_BATCH_SCRIPT).toContain('$failed += $i');
  });
});
