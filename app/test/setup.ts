import '@testing-library/jest-dom/vitest';
import { cleanup } from '@testing-library/react';
import { afterEach } from 'vitest';
import { resetLiveScan } from '../renderer/src/live-scan';

afterEach(() => {
  cleanup();
  resetLiveScan();
});
