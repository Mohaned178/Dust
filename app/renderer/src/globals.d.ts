/// <reference types="vite/client" />
import type { DustApi } from '../../src/shared/ipc';

declare global {
  /** Set by Vite from package.json. Not defined under the test runner. */
  const __APP_VERSION__: string;

  interface Window {
    dust: DustApi;
  }
}

export {};
