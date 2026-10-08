import '@testing-library/jest-dom/vitest';
import { cleanup } from '@testing-library/react';
import { afterEach } from 'vitest';
import { clearPageCache } from '../renderer/src/page-cache';
import { resetStartupDetails } from '../renderer/src/startup-details';

afterEach(() => {
  cleanup();
  clearPageCache();
  resetStartupDetails();
});
