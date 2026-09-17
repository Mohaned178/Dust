import { describe, expect, it } from 'vitest';
import { CORE_PACKAGE } from '../src/index';

describe('core package', () => {
  it('is importable', () => {
    expect(CORE_PACKAGE).toBe('@dust/core');
  });
});
