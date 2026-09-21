import { spawn } from 'node:child_process';
import electronPath from 'electron';
import { createServer } from 'vite';
import { bundleMain } from './bundle-main.mjs';

await bundleMain();

const server = await createServer({ server: { port: 5173, strictPort: true } });
await server.listen();
server.printUrls();

const child = spawn(electronPath, ['.'], {
  stdio: 'inherit',
  env: { ...process.env, DUST_DEV_SERVER_URL: 'http://localhost:5173' },
});

child.on('exit', async (code) => {
  await server.close();
  process.exit(code ?? 0);
});
