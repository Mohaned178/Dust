import { spawn } from 'node:child_process';
import electronPath from 'electron';
import { createServer } from 'vite';
import { bundleMain } from './bundle-main.mjs';

await bundleMain();

// DUST_DEV_PORT lets a second dev server run while another one holds 5173.
const port = Number(process.env.DUST_DEV_PORT) || 5173;
const server = await createServer({ server: { port, strictPort: true } });
await server.listen();
server.printUrls();

const child = spawn(electronPath, ['.'], {
  stdio: 'inherit',
  env: { ...process.env, DUST_DEV_SERVER_URL: `http://localhost:${port}` },
});

child.on('exit', async (code) => {
  await server.close();
  process.exit(code ?? 0);
});
