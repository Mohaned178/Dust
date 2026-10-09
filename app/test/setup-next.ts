import '@testing-library/jest-dom/vitest';
import { cleanup } from '@testing-library/react';
import { afterEach } from 'vitest';

// The old renderer's setup.ts imports its page cache, which is deleted in phase 11, so the new tests have their own.
afterEach(() => {
  cleanup();
});
