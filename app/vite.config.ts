import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';

// DUST_RENDERER=next builds the rebuilt renderer (docs/FRONTEND-PLAN.md); phase 11 makes it the default.
const rendererDir = process.env.DUST_RENDERER === 'next' ? './renderer-next' : './renderer';

export default defineConfig({
  root: fileURLToPath(new URL(rendererDir, import.meta.url)),
  base: './',
  plugins: [react(), tailwindcss()],
  build: {
    outDir: fileURLToPath(new URL('./dist/renderer', import.meta.url)),
    emptyOutDir: true,
  },
  server: { port: 5173, strictPort: true },
});
