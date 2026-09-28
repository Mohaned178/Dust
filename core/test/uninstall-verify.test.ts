import { describe, expect, it } from 'vitest';
import { waitForRemoval } from '../src/uninstall/verify';
import { UNINSTALL_VERIFY_GRACE_MS, UNINSTALL_VERIFY_POLL_MS } from '../src/uninstall/types';

function clockControl(): {
  now: () => number;
  sleep: (ms: number) => Promise<void>;
  sleeps: number[];
  get: () => number;
} {
  let current = 0;
  const sleeps: number[] = [];
  return {
    now: () => current,
    sleep: async (ms: number) => {
      sleeps.push(ms);
      current += ms;
    },
    sleeps,
    get: () => current,
  };
}

describe('waitForRemoval', () => {
  it('returns immediately when the key is already gone', async () => {
    const clock = clockControl();
    const result = await waitForRemoval({
      check: async () => false,
      now: clock.now,
      sleep: clock.sleep,
    });
    expect(result).toEqual({ gone: true, attempts: 1, skipped: false, elapsedMs: 0 });
    expect(clock.sleeps).toEqual([]);
  });

  it('polls at the default cadence until gone', async () => {
    const clock = clockControl();
    let checks = 0;
    const result = await waitForRemoval({
      check: async () => {
        checks += 1;
        return checks < 3;
      },
      now: clock.now,
      sleep: clock.sleep,
    });
    expect(result).toMatchObject({ gone: true, attempts: 3, skipped: false });
    expect(clock.sleeps).toEqual([UNINSTALL_VERIFY_POLL_MS, UNINSTALL_VERIFY_POLL_MS]);
  });

  it('gives up after the grace window, reporting every attempt', async () => {
    const clock = clockControl();
    const attempts: number[] = [];
    const result = await waitForRemoval({
      check: async () => true,
      now: clock.now,
      sleep: clock.sleep,
      onAttempt: (attempt) => attempts.push(attempt),
    });
    expect(result).toMatchObject({ gone: false, skipped: false });
    expect(result.attempts).toBe(UNINSTALL_VERIFY_GRACE_MS / UNINSTALL_VERIFY_POLL_MS + 1);
    expect(clock.get()).toBe(UNINSTALL_VERIFY_GRACE_MS);
    expect(attempts).toHaveLength(result.attempts);
  });

  it('stops on request and reports the final state as skipped', async () => {
    const clock = clockControl();
    let stops = 0;
    const result = await waitForRemoval({
      check: async () => true,
      now: clock.now,
      sleep: clock.sleep,
      shouldStop: () => {
        stops += 1;
        return stops > 1;
      },
    });
    expect(result).toMatchObject({ gone: false, skipped: true, attempts: 2 });
  });

  it('honors custom poll and grace windows', async () => {
    const clock = clockControl();
    const result = await waitForRemoval({
      check: async () => true,
      now: clock.now,
      sleep: clock.sleep,
      pollMs: 100,
      graceMs: 250,
    });
    expect(result.attempts).toBe(4);
    expect(clock.sleeps).toEqual([100, 100, 100]);
  });
});
