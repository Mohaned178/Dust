import type { DustApi } from '../../../src/shared/ipc';

declare global {
  interface Window {
    dust: DustApi;
  }
}

export {};
