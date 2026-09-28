import { describe, expect, it } from 'vitest';
import { buildCsp, isAllowedNavigation } from '../src/main/security';

describe('buildCsp', () => {
  it('locks the renderer to local content without eval', () => {
    const csp = buildCsp();
    expect(csp).toContain("default-src 'self'");
    expect(csp).toContain("script-src 'self'");
    expect(csp).toContain("object-src 'none'");
    expect(csp).toContain("base-uri 'none'");
    expect(csp).not.toContain('unsafe-eval');
    expect(csp).not.toContain('http:');
    expect(csp).not.toContain('https:');
  });
});

describe('isAllowedNavigation', () => {
  const appUrl = 'file:///C:/Dust/renderer/index.html';

  it('allows the loaded app URL only', () => {
    expect(isAllowedNavigation(appUrl, { appUrl })).toBe(true);
    expect(isAllowedNavigation('file:///C:/Windows/System32/evil.html', { appUrl })).toBe(false);
    expect(isAllowedNavigation('https://example.com', { appUrl })).toBe(false);
  });

  it('allows the dev-server origin in development', () => {
    const policy = { appUrl, devServerUrl: 'http://localhost:5173' };
    expect(isAllowedNavigation('http://localhost:5173/', policy)).toBe(true);
    expect(isAllowedNavigation('http://localhost:5173/index.html', policy)).toBe(true);
    expect(isAllowedNavigation('http://localhost:9999/', policy)).toBe(false);
    expect(isAllowedNavigation('https://localhost:5173/', policy)).toBe(false);
  });
});
