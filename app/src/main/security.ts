import type { Session, WebContents } from 'electron';

export interface NavigationPolicy {
  appUrl: string;
  devServerUrl?: string;
}

const PRODUCTION_CSP = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data:",
  "font-src 'self' data:",
  "connect-src 'self'",
  "object-src 'none'",
  "base-uri 'none'",
  "form-action 'none'",
  "frame-ancestors 'none'",
].join('; ');

export function buildCsp(): string {
  return PRODUCTION_CSP;
}

function sameOrigin(a: string, b: string): boolean {
  try {
    const left = new URL(a);
    const right = new URL(b);
    if (left.protocol === 'file:' || right.protocol === 'file:') return false;
    return left.origin === right.origin;
  } catch {
    return false;
  }
}

export function isAllowedNavigation(url: string, policy: NavigationPolicy): boolean {
  if (url === policy.appUrl) return true;
  if (policy.devServerUrl !== undefined && sameOrigin(url, policy.devServerUrl)) return true;
  return false;
}

export function hardenWebContents(contents: WebContents, policy: NavigationPolicy): void {
  contents.setWindowOpenHandler(() => ({ action: 'deny' }));
  contents.on('will-navigate', (event, url) => {
    if (!isAllowedNavigation(url, policy)) event.preventDefault();
  });
}

export function installSessionSecurity(ses: Session, options: { dev: boolean }): void {
  ses.setPermissionRequestHandler((_contents, _permission, callback) => callback(false));
  ses.setPermissionCheckHandler(() => false);
  if (options.dev) return;
  ses.webRequest.onHeadersReceived((details, callback) => {
    callback({
      responseHeaders: {
        ...details.responseHeaders,
        'Content-Security-Policy': [PRODUCTION_CSP],
      },
    });
  });
}
