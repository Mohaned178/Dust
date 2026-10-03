// Direct enumerator benchmark: compares NodeFsEnumerator against
// WindowsFindEnumerator over the same directory list, in one thread.
//
//   npx tsx scripts/bench-enumerator.ts [--root <dir>] [--impl both|node|windows] [--repeat N]
import { readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import type { Enumerator } from '../src/scanner/enumerator';
import { NodeFsEnumerator } from '../src/scanner/enumerator';
import { WindowsFindEnumerator } from '../src/scanner/win-enumerator';

interface Args {
  root: string;
  impl: 'both' | 'node' | 'windows';
  repeat: number;
}

function parseArgs(argv: string[]): Args {
  const args: Args = { root: resolve(import.meta.dirname, '..'), impl: 'both', repeat: 1 };
  for (let i = 0; i < argv.length; i += 1) {
    const flag = argv[i];
    const value = argv[i + 1];
    if (flag === '--root' && value) args.root = resolve(value);
    else if (flag === '--impl' && value) args.impl = value as Args['impl'];
    else if (flag === '--repeat' && value) args.repeat = Math.max(1, Number(value));
  }
  return args;
}

function collectDirs(root: string): string[] {
  const dirs: string[] = [];
  const stack: string[] = [root];
  while (stack.length > 0) {
    const dir = stack.pop() as string;
    dirs.push(dir);
    let entries;
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      if (entry.isDirectory()) stack.push(join(dir, entry.name));
    }
  }
  return dirs;
}

interface RunResult {
  ms: number;
  directories: number;
  entries: number;
  files: number;
  bytes: number;
  errors: number;
  filesPerSecond: number;
}

function run(impl: Enumerator, dirs: string[]): RunResult {
  let entries = 0;
  let files = 0;
  let bytes = 0;
  let errors = 0;
  const startedAt = performance.now();
  for (const dir of dirs) {
    const listing = impl.list(dir);
    errors += listing.entryErrors;
    for (const entry of listing.entries) {
      entries += 1;
      if (entry.kind === 'file') {
        files += 1;
        bytes += entry.size;
      }
    }
  }
  const ms = performance.now() - startedAt;
  return {
    ms: Math.round(ms),
    directories: dirs.length,
    entries,
    files,
    bytes,
    errors,
    filesPerSecond: ms > 0 ? Math.round((files / ms) * 1000) : 0,
  };
}

function main(): void {
  const args = parseArgs(process.argv.slice(2));
  const dirs = collectDirs(args.root);
  const impls: ('node' | 'windows')[] = args.impl === 'both' ? ['node', 'windows'] : [args.impl];
  const results: Record<string, RunResult[]> = {};

  for (const name of impls) {
    results[name] = [];
    for (let i = 0; i < args.repeat; i += 1) {
      const impl: Enumerator = name === 'windows' ? new WindowsFindEnumerator() : new NodeFsEnumerator();
      results[name].push(run(impl, dirs));
    }
  }

  console.log(JSON.stringify({ root: args.root, directories: dirs.length, results }, null, 2));
}

main();
