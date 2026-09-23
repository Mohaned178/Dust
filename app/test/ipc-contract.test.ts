import { describe, expect, it } from 'vitest';
import { IPC } from '../src/shared/ipc';

describe('IPC contract', () => {
  it('uses unique, namespaced channel names', () => {
    const channels = Object.values(IPC);
    expect(channels).toHaveLength(14);
    expect(new Set(channels).size).toBe(channels.length);
    for (const channel of channels) expect(channel).toMatch(/^dust:/);
  });
});
