import { createExclusionPredicate } from '../src/scanner/exclusions';
import { NodeFsEnumerator } from '../src/scanner/enumerator';
import { scanTree } from '../src/scanner/scanner';
import { volumeClusterSize } from '../src/system/cluster';

interface Args {
  root: string | null;
}

function parseArgs(argv: string[]): Args {
  const args: Args = { root: null };
  for (let i = 0; i < argv.length; i += 1) {
    const flag = argv[i];
    const value = argv[i + 1];
    if (flag === '--root' && value) args.root = value;
  }
  return args;
}

function main(): void {
  const args = parseArgs(process.argv.slice(2));
  if (!args.root) {
    console.error('usage: npx tsx scripts/bench-tree.ts --root "<dir>"');
    process.exit(1);
  }

  const root = args.root;
  const clusterSize = volumeClusterSize(root);
  const isExcluded = createExclusionPredicate({});
  let folders = 0;

  const startedAt = Date.now();
  const stats = scanTree({
    root,
    enumerator: new NodeFsEnumerator(),
    isExcluded,
    clusterSize,
    onFolder: () => {
      folders += 1;
    },
  });
  const elapsedMs = Date.now() - startedAt;

  const filesPerSecond = elapsedMs > 0 ? Math.round((stats.filesScanned / elapsedMs) * 1000) : 0;
  console.log(
    JSON.stringify(
      {
        root,
        mode: 'scanTree',
        clusterSize,
        status: stats.aborted ? 'cancelled' : 'complete',
        files: stats.filesScanned,
        bytes: stats.bytesSeen,
        folders,
        errors: stats.errors,
        markers: stats.markers.length,
        elapsedMs,
        filesPerSecond,
        rssMb: Math.round(process.memoryUsage().rss / 1024 / 1024),
      },
      null,
      2,
    ),
  );
}

main();
