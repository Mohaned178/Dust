import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';

const { version } = JSON.parse(readFileSync(fileURLToPath(new URL('./package.json', import.meta.url)), 'utf8')) as {
  version: string;
};

// DUST_RENDERER=next builds the rebuilt renderer (docs/FRONTEND-PLAN.md); phase 11 makes it the default.
const rendererDir = process.env.DUST_RENDERER === 'next' ? './renderer-next' : './renderer';

export default defineConfig({
  root: fileURLToPath(new URL(rendererDir, import.meta.url)),
  base: './',
  // The version shown in Settings > About, read from package.json at build time.
  define: { __APP_VERSION__: JSON.stringify(version) },
  plugins: [react(), tailwindcss()],
  build: {
    outDir: fileURLToPath(new URL('./dist/renderer', import.meta.url)),
    emptyOutDir: true,
  },
  server: { port: 5173, strictPort: true },
});
