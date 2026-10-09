import react from '@vitejs/plugin-react';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  plugins: [react()],
  test: {
    projects: [
      {
        extends: true,
        test: {
          name: 'host',
          environment: 'node',
          include: ['test/*.test.ts'],
        },
      },
      {
        extends: true,
        resolve: {
          alias: {
            '@tanstack/react-virtual': fileURLToPath(new URL('./test/renderer/virtual-mock.ts', import.meta.url)),
          },
        },
        test: {
          name: 'renderer',
          environment: 'jsdom',
          include: ['test/renderer/**/*.test.{ts,tsx}'],
          setupFiles: ['test/setup.ts'],
        },
      },
    ],
  },
});
