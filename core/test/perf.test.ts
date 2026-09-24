import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { ScanSession } from '../src/scanner/session';
import { Fixture } from './fixtures';

const enabled = process.env.DUST_PERF === '1';

// The default transport execArgv is empty; under vitest/ts the worker entry must
// be loaded through tsx to resolve extensionless imports (same as session-pool.test.ts).
const workerPath = resolve(fileURLToPath(new URL('.', import.meta.url)), '..', 'src', 'scan', 'worker-entry.ts');
const poolOptions = { workerPath, execArgv: ['--import', 'tsx'] };

describe.skipIf(!enabled)('performance (gated: set DUST_PERF=1)', () => {
  it('scans a 200k-file synthetic tree within budget and prints throughput', async () => {
    const fixture = new Fixture();
    try {
      const dirs = 200;
      const filesPerDir = 1000;
      for (let d = 0; d < dirs; d += 1) {
        for (let f = 0; f < filesPerDir; f += 1) {
          fixture.file(`dir-${d}/file-${f}.txt`, '');
        }
      }
      const startedAt = Date.now();
      const result = await new ScanSession({ root: fixture.root, pool: poolOptions }).start();
      const elapsedMs = Date.now() - startedAt;
      const filesPerSecond = elapsedMs > 0 ? Math.round((result.filesScanned / elapsedMs) * 1000) : 0;
      // eslint-disable-next-line no-console
      console.log(`200k files: ${elapsedMs} ms (${filesPerSecond} files/sec) via ${result.filesScanned} files`);
      expect(result.status).toBe('complete');
      expect(result.filesScanned).toBe(dirs * filesPerDir);
      expect(filesPerSecond).toBeGreaterThanOrEqual(8_000);
    } finally {
      fixture.cleanup();
    }
  }, 180_000);
});
