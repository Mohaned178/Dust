import { describe, expect, it } from 'vitest';
import { RECYCLE_SCRIPT, stageToRecycleBin } from '../src/cleaner/recycle';

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
