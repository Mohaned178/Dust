import '@testing-library/jest-dom/vitest';
import { cleanup, configure } from '@testing-library/react';
import { afterEach } from 'vitest';
import { resetDialogStore } from '../renderer-next/src/app/dialogs';
import { resetAllStores } from '../renderer-next/src/stores';

// Pages are lazy chunks that jsdom compiles on first use; under a full-suite load the default 1 s is too tight.
configure({ asyncUtilTimeout: 5000 });

// The old renderer's setup.ts imports its page cache, which is deleted in phase 11, so the new tests have their own.
afterEach(() => {
  cleanup();
  // Stores are module singletons, so each case starts from empty ones.
  resetAllStores();
  resetDialogStore();
});

// jsdom lacks a few browser APIs that Radix Primitives call.
class ResizeObserverStub {
  observe(): void {}
  unobserve(): void {}
  disconnect(): void {}
}
globalThis.ResizeObserver ??= ResizeObserverStub;
Element.prototype.hasPointerCapture ??= () => false;
Element.prototype.setPointerCapture ??= () => {};
Element.prototype.releasePointerCapture ??= () => {};
Element.prototype.scrollIntoView ??= () => {};
