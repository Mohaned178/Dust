import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ThrottledEmitter } from '../src/main/host/throttler';

describe('ThrottledEmitter', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(0);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('emits the first value immediately and coalesces the rest', () => {
    const seen: number[] = [];
    const emitter = new ThrottledEmitter<number>((value) => seen.push(value), { intervalMs: 100 });
    emitter.push(1);
    expect(seen).toEqual([1]);
    emitter.push(2);
    emitter.push(3);
    expect(seen).toEqual([1]);
    vi.advanceTimersByTime(100);
    expect(seen).toEqual([1, 3]);
  });

  it('flush emits the pending value right away', () => {
    const seen: number[] = [];
    const emitter = new ThrottledEmitter<number>((value) => seen.push(value), { intervalMs: 100 });
    emitter.push(1);
    emitter.push(2);
    emitter.flush();
    expect(seen).toEqual([1, 2]);
    vi.advanceTimersByTime(500);
    expect(seen).toEqual([1, 2]);
  });

  it('cancel drops the pending value', () => {
    const seen: number[] = [];
    const emitter = new ThrottledEmitter<number>((value) => seen.push(value), { intervalMs: 100 });
    emitter.push(1);
    emitter.push(2);
    emitter.cancel();
    vi.advanceTimersByTime(500);
    expect(seen).toEqual([1]);
  });
});
