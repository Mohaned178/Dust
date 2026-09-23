import { describe, expect, it } from 'vitest';
import { ScanLock } from '../src/main/host/scan-lock';

describe('ScanLock', () => {
  it('grants the first acquire and reports the holder on conflicts', () => {
    const lock = new ScanLock();
    const first = lock.acquire('analyze', 'C:\\', 1000);
    expect(first).toEqual({ ok: true, holder: { kind: 'analyze', root: 'C:\\', startedAt: 1000 } });

    const second = lock.acquire('quick-clean', 'D:\\', 2000);
    expect(second).toEqual({ ok: false, holder: { kind: 'analyze', root: 'C:\\', startedAt: 1000 } });
    expect(lock.current()).toEqual({ kind: 'analyze', root: 'C:\\', startedAt: 1000 });
  });

  it('releases the lock for the next scan', () => {
    const lock = new ScanLock();
    lock.acquire('analyze', 'C:\\', 1000);
    lock.release();
    expect(lock.current()).toBeNull();
    expect(lock.acquire('quick-clean', 'D:\\', 2000).ok).toBe(true);
  });
});
