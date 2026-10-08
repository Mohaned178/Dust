// Validates the MFT reader against the directory walker on a real volume.
// Must run from an elevated (administrator) terminal, or the MFT path falls
// back to the walker and the comparison is meaningless.
//
//   npx tsx scripts/compare-mft.ts --root "C:\\" [--top 15]
//
// Runs the MFT scan first (cold cache for the walk is not reproducible
// without a reboot either way, so run it twice and read the second result
// when comparing raw speed), then the walker, and prints both timings plus the
// largest top-level folders side by side.
import { join } from 'node:path';
import { ScanSession } from '../src/index';
import type { ScanResult } from '../src/index';

function parseArgs(argv: string[]): { root: string; top: number } {
  let root = 'C:\\';
  let top = 15;
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === '--root' && argv[i + 1]) root = argv[i + 1]!;
    if (argv[i] === '--top' && argv[i + 1]) top = Number(argv[i + 1]);
  }
  return { root, top };
}

const pool = {
  workerPath: join(import.meta.dirname, '..', 'src', 'scan', 'worker-entry.ts'),
  execArgv: ['--import', 'tsx'],
};

async function run(root: string, mft: boolean): Promise<{ result: ScanResult; ms: number }> {
  const startedAt = performance.now();
  const result = await new ScanSession({ root, mft, pool }).start();
  return { result, ms: Math.round(performance.now() - startedAt) };
}

const gb = (bytes: number) => `${(bytes / 1024 ** 3).toFixed(2)} GB`;

async function main(): Promise<void> {
  const { root, top } = parseArgs(process.argv.slice(2));
  const mft = await run(root, true);
  if (mft.result.method !== 'mft') {
    console.error('MFT scan was not used: run this from an administrator terminal on an NTFS volume.');
    process.exit(1);
  }
  const walk = await run(root, false);

  const summary = (label: string, { result, ms }: { result: ScanResult; ms: number }) =>
    `${label.padEnd(5)} ${String(ms).padStart(7)} ms  files=${result.filesScanned}  bytes=${gb(result.bytesSeen)}  errors=${result.errors}`;
  console.log(summary('mft', mft));
  console.log(summary('walk', walk));

  const rootPath = mft.result.root;
  const children = mft.result.tree
    .children(rootPath)
    .sort((a, b) => b.bytes - a.bytes)
    .slice(0, top);
  console.log(`\n${'folder'.padEnd(40)} ${'mft'.padStart(12)} ${'walk'.padStart(12)}  diff`);
  for (const child of children) {
    const other = walk.result.tree.get(child.path);
    const diff = other ? child.bytes - other.bytes : child.bytes;
    const pct = other && other.bytes > 0 ? ((diff / other.bytes) * 100).toFixed(2) : 'n/a';
    console.log(
      `${child.path.slice(0, 40).padEnd(40)} ${gb(child.bytes).padStart(12)} ${(other ? gb(other.bytes) : '-').padStart(12)}  ${pct}%`,
    );
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
