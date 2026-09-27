import { hostname } from 'node:os';
import { describe, expect, it } from 'vitest';
import { getSystemInfoStatic } from '../src/system/system-info';

describe('system info against real Windows', () => {
  it(
    'reads and parses the machine',
    async (ctx) => {
      if (process.platform !== 'win32') {
        ctx.skip();
        return;
      }
      const snapshot = await getSystemInfoStatic();
      expect(snapshot.hardwareAvailable).toBe(true);
      expect(snapshot.hostname).toBe(hostname());
      expect(snapshot.os.name).not.toBeNull();
      expect(snapshot.os.build).toMatch(/^\d+(\.\d+)?$/);
      expect(snapshot.cpu).not.toBeNull();
      expect(snapshot.cpu?.model.length).toBeGreaterThan(0);
    },
    30_000,
  );
});
