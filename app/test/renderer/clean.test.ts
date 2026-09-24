import { describe, expect, it } from 'vitest';
import { recoveryLabel, recoveryText, refusedReasonText } from '../../renderer/src/clean';
import type { CleanItemPreview } from '../../src/shared/ipc';

function preview(overrides: Partial<CleanItemPreview> = {}): CleanItemPreview {
  return {
    ruleId: 'temp-files',
    category: 'temp',
    path: 'C:\\Users\\x\\AppData\\Local\\Temp\\a.tmp',
    name: 'a.tmp',
    bytes: 1024,
    grade: 'safe',
    recovery: { kind: 'junk', text: 'Junk by default' },
    evidence: 'Temp file older than 7 days',
    action: 'delete-path',
    adminRequired: false,
    ...overrides,
  };
}

describe('recoveryLabel', () => {
  it('labels a regenerable item without inlining the command', () => {
    const item = preview({ recovery: { kind: 'regenerate', text: 'npm install' } });
    expect(recoveryLabel(item)).toBe('Rebuild with');
    expect(recoveryText(item)).toBe('Rebuild with: npm install');
  });

  it('uses the recovery reason for junk items', () => {
    expect(recoveryLabel(preview())).toBe('Junk by default');
  });
});

describe('refusedReasonText', () => {
  it('maps internal reasons to calm, non-technical copy', () => {
    expect(refusedReasonText('duplicate')).toBe('Already covered by another item');
    expect(refusedReasonText('nested')).toBe('Inside another item being cleaned');
    expect(refusedReasonText('invalid-recovery')).toBe('No recovery method was available');
    expect(refusedReasonText('volume-root')).toBe('Drive roots are never cleaned');
    expect(refusedReasonText('protected-root')).toBe('In a protected location');
    expect(refusedReasonText('protected-ancestor')).toBe('In a protected location');
    expect(refusedReasonText('inside-protected')).toBe('In a protected location');
  });

  it('falls back to a neutral phrase for unknown reasons', () => {
    expect(refusedReasonText('something-new')).toBe('Left untouched');
  });
});
