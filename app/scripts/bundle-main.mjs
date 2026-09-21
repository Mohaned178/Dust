import { build } from 'esbuild';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const appRoot = dirname(dirname(fileURLToPath(import.meta.url)));

const shared = {
  bundle: true,
  platform: 'node',
  target: 'node22',
  format: 'cjs',
  sourcemap: true,
  external: ['electron'],
  logLevel: 'info',
};

export async function bundleMain() {
  await build({
    ...shared,
    entryPoints: [join(appRoot, 'src', 'main', 'index.ts')],
    outfile: join(appRoot, 'dist', 'main', 'main.cjs'),
  });
  await build({
    ...shared,
    entryPoints: [join(appRoot, 'src', 'preload', 'index.ts')],
    outfile: join(appRoot, 'dist', 'main', 'preload.cjs'),
  });
  await build({
    ...shared,
    entryPoints: [join(appRoot, '..', 'core', 'src', 'scan', 'worker-entry.ts')],
    outfile: join(appRoot, 'dist', 'main', 'worker.cjs'),
  });
}
