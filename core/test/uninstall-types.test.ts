import { describe, expect, it } from 'vitest';
import {
  UNINSTALL_BACKUP_TTL_MS,
  UNINSTALL_JOURNAL_VERSION,
  UNINSTALL_PENDING_TTL_MS,
  UNINSTALL_VERIFY_GRACE_MS,
  UNINSTALL_VERIFY_POLL_MS,
  uninstallItemId,
} from '../src/uninstall/types';

describe('uninstall constants', () => {
  it('pins the verification cadence', () => {
    expect(UNINSTALL_VERIFY_POLL_MS).toBe(2_000);
    expect(UNINSTALL_VERIFY_GRACE_MS).toBe(16_000);
  });

  it('pins backup retention to 30 days', () => {
    expect(UNINSTALL_BACKUP_TTL_MS).toBe(30 * 24 * 60 * 60_000);
  });

  it('pins pending job validity to 15 minutes', () => {
    expect(UNINSTALL_PENDING_TTL_MS).toBe(15 * 60_000);
  });

  it('pins the journal schema version', () => {
    expect(UNINSTALL_JOURNAL_VERSION).toBe(1);
  });
});

describe('uninstallItemId', () => {
  it('is a stable 16-character hex id', () => {
    const id = uninstallItemId('file', 'C:\\Users\\x\\AppData\\Local\\Vendor');
    expect(id).toMatch(/^[a-f0-9]{16}$/);
    expect(uninstallItemId('file', 'C:\\Users\\x\\AppData\\Local\\Vendor')).toBe(id);
  });

  it('is case-insensitive and ignores trailing separators', () => {
    const base = uninstallItemId('file', 'C:\\Vendor\\App');
    expect(uninstallItemId('file', 'c:\\vendor\\app')).toBe(base);
    expect(uninstallItemId('file', 'C:\\Vendor\\App\\')).toBe(base);
    expect(uninstallItemId('file', 'C:\\Vendor\\App\\\\')).toBe(base);
  });

  it('separates targets by item kind', () => {
    const target = 'Vendor\\App';
    expect(uninstallItemId('registry', target)).not.toBe(uninstallItemId('startup', target));
    expect(uninstallItemId('file', target)).not.toBe(uninstallItemId('registry', target));
  });

  it('does not collide across targets', () => {
    expect(uninstallItemId('file', 'C:\\A')).not.toBe(uninstallItemId('file', 'C:\\B'));
  });
});
