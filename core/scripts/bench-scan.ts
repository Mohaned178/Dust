// Benchmark harness for the Dust scan engine.
//
// Synthetic mode (default):
//   npx tsx scripts/bench-scan.ts --files 200000 [--workers 8] [--split 20000] [--legacy]
// Real-disk mode (the spec section 8 validation spike):
//   npx tsx scripts/bench-scan.ts --root "C:\\" [--workers 8] [--split 20000]
//
// The real-disk run must be executed on the developer machine (2-4M entries)
// with Windows Defender enabled, before any UI investment. If the budget
// (1M files < 45 s target, 60 s acceptable) is missed, the levers in order
// are: worker-count tuning, split-size tuning, native enumerator.
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ScanSession } from '../src/index';

interface Args {
  files: number;
  root: string | null;
  workers: number | undefined;
  split: number | undefined;
  legacy: boolean;
}

function parseArgs(argv: string[]): Args {
  const args: Args = { files: 200_000, root: null, workers: undefined, split: undefined, legacy: false };
  for (let i = 0; i < argv.length; i += 1) {
    const flag = argv[i];
    const value = argv[i + 1];
    if (flag === '--files' && value) args.files = Number(value);
    else if (flag === '--root' && value) args.root = value;
    else if (flag === '--workers' && value) args.workers = Number(value);
    else if (flag === '--split' && value) args.split = Number(value);
    else if (flag === '--legacy') args.legacy = true;
  }
  return args;
}

function createSyntheticTree(files: number): string {
  const root = mkdtempSync(join(tmpdir(), 'dust-bench-'));
  const dirCount = 200;
  const perDir = Math.ceil(files / dirCount);
  for (let d = 0; d < dirCount; d += 1) {
    const dir = join(root, `dir-${d}`);
    mkdirSync(dir, { recursive: true });
    for (let f = 0; f < perDir; f += 1) {
      writeFileSync(join(dir, `file-${f}.txt`), '');
    }
  }
  return root;
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  let root = args.root;
  let synthetic: string | null = null;
  if (!root) {
    synthetic = createSyntheticTree(args.files);
    root = synthetic;
  }

  const startedAt = Date.now();
  const session = new ScanSession({
    root,
    pool: args.legacy
      ? false
      : {
          workers: args.workers,
          splitAfterEntries: args.split,
          workerPath: join(import.meta.dirname, '..', 'src', 'scan', 'worker-entry.ts'),
          execArgv: ['--import', 'tsx'],
        },
  });
  const result = await session.start();
  const elapsedMs = Date.now() - startedAt;

  const filesPerSecond = elapsedMs > 0 ? Math.round((result.filesScanned / elapsedMs) * 1000) : 0;
  console.log(
    JSON.stringify(
      {
        root,
        mode: args.legacy ? 'legacy' : 'pool',
        workers: args.legacy ? 1 : (args.workers ?? 'default'),
        splitAfterEntries: args.split ?? 'default',
        status: result.status,
        files: result.filesScanned,
        bytes: result.bytesSeen,
        folders: result.tree.size(),
        errors: result.errors,
        elapsedMs,
        filesPerSecond,
      },
      null,
      2,
    ),
  );

  if (synthetic) rmSync(synthetic, { recursive: true, force: true });
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
