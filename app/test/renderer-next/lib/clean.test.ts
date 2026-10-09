import { describe, expect, it } from 'vitest';
import {
  acknowledgementPaths,
  cleanErrorMessage,
  needsAcknowledgement,
  recoveryNote,
} from '../../../renderer-next/src/lib/clean';
import type { CleanItemPreview } from '../../../src/shared/ipc';
import { makeCleanPreview } from '../../renderer/fakes';

const safeItem = makeCleanPreview().items[0]!;
const reviewItem: CleanItemPreview = { ...safeItem, path: 'C:\\x', grade: 'review' };
const binItem: CleanItemPreview = {
  ...safeItem,
  path: 'C:\\bin',
  category: 'recycle-bin',
  action: 'empty-recycle-bin',
};

describe('acknowledgement', () => {
  it('is needed for review items and for emptying the Recycle Bin, not for safe junk', () => {
    expect(needsAcknowledgement([safeItem])).toBe(false);
    expect(needsAcknowledgement([safeItem, reviewItem])).toBe(true);
    expect(needsAcknowledgement([binItem])).toBe(true);
  });

  it('lists the review-grade paths', () => {
    expect(acknowledgementPaths([safeItem, reviewItem, binItem])).toEqual(['C:\\x']);
  });
});

describe('recovery notes and messages', () => {
  it('says how each kind of item comes back', () => {
    expect(recoveryNote('recycle-bin', [binItem])).toBe('Cannot be recovered');
    expect(recoveryNote('temp', [safeItem])).toBe('Recreated by the apps that use them');
    const regenerate = { ...safeItem, recovery: { kind: 'regenerate' as const, text: 'npm install' } };
    expect(recoveryNote('npm-cache', [regenerate])).toBe('Downloaded again when needed');
    expect(recoveryNote('npm-cache', [regenerate, safeItem])).toBe('Some items cannot be recovered');
  });

  it('explains refusals without jargon', () => {
    expect(cleanErrorMessage({ reason: 'busy' })).toMatch(/scan is running/);
    expect(cleanErrorMessage({ reason: 'failed', message: 'Disk is busy' })).toBe('Disk is busy');
    expect(cleanErrorMessage({ reason: 'unknown-plan' })).not.toMatch(/expired|Analyze/);
  });
});
