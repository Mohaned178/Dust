import { describe, expect, it } from 'vitest';
import {
  UNINSTALL_PHASES,
  blockReasonText,
  defaultUninstallSelection,
  groupUninstallItems,
  keptReasonText,
  outcomeText,
  phaseLabel,
  selectedReviewItems,
  uninstallSelectionTotals,
} from '../renderer/src/uninstall';
import type { UninstallItemPreview } from '../src/shared/ipc';

function item(overrides: Partial<UninstallItemPreview> & { id: string; kind: UninstallItemPreview['kind'] }): UninstallItemPreview {
  return {
    target: overrides.id,
    label: overrides.id,
    bytes: null,
    grade: 'safe',
    evidence: [],
    adminRequired: false,
    defaultSelected: false,
    ...overrides,
  };
}

const items: UninstallItemPreview[] = [
  item({ id: 'install', kind: 'file', dataClass: 'install-dir', bytes: 100, defaultSelected: true }),
  item({ id: 'local', kind: 'file', dataClass: 'app-data', bytes: 20, defaultSelected: true }),
  item({ id: 'roaming', kind: 'file', dataClass: 'user-data', bytes: 30 }),
  item({ id: 'program', kind: 'file', dataClass: 'program-data', bytes: 40, adminRequired: true }),
  item({ id: 'tmp', kind: 'file', dataClass: 'temp', bytes: 5 }),
  item({ id: 'reg', kind: 'registry', grade: 'review', adminRequired: true, defaultSelected: false }),
  item({ id: 'reg-safe', kind: 'registry', defaultSelected: true }),
  item({ id: 'start', kind: 'startup' }),
];

describe('groupUninstallItems', () => {
  it('groups by class with registry and startup last, omitting empty sections', () => {
    const sections = groupUninstallItems(items);
    expect(sections.map((section) => section.id)).toEqual([
      'install-dir',
      'app-data',
      'program-data',
      'user-data',
      'temp',
      'registry',
      'startup',
    ]);
    expect(sections[0]).toMatchObject({ title: 'Install folder' });
    expect(sections[0]!.items.map((entry) => entry.id)).toEqual(['install']);
    expect(sections.find((section) => section.id === 'user-data')!.description).toContain('Kept by default');
    expect(sections.find((section) => section.id === 'registry')!.description).toContain('backup');
  });

  it('skips unknown items and empty groups', () => {
    const sections = groupUninstallItems([item({ id: 'reg', kind: 'registry' })]);
    expect(sections.map((section) => section.id)).toEqual(['registry']);
  });
});

describe('selection helpers', () => {
  it('defaults to the preview flags', () => {
    expect(defaultUninstallSelection(items)).toEqual(['install', 'local', 'reg-safe']);
  });

  it('totals only the selected items', () => {
    const totals = uninstallSelectionTotals(items, ['install', 'local', 'reg']);
    expect(totals).toMatchObject({ items: 3, bytes: 120 });
    expect(totals.reviewItems).toBe(1);
    expect(totals.adminItems).toBe(1);
  });

  it('counts selected review and admin items', () => {
    const totals = uninstallSelectionTotals(items, ['reg', 'program', 'install']);
    expect(totals).toMatchObject({ items: 3, bytes: 140, reviewItems: 1, adminItems: 2 });
  });

  it('lists selected review items for acknowledgement', () => {
    expect(selectedReviewItems(items, ['reg', 'install']).map((entry) => entry.id)).toEqual(['reg']);
    expect(selectedReviewItems(items, ['install'])).toEqual([]);
  });
});

describe('phases and copy', () => {
  it('orders and labels the execution phases', () => {
    expect(UNINSTALL_PHASES.map((phase) => phase.id)).toEqual([
      'prepare',
      'backup',
      'uninstaller',
      'verify',
      'files',
      'registry',
      'startup',
      'finish',
    ]);
    expect(phaseLabel('uninstaller')).toBe("Running the app's uninstaller");
    expect(phaseLabel('something-else')).toBe('Working');
  });

  it('translates kept reasons into product language', () => {
    expect(keptReasonText('needs-admin')).toBe('Needs administrator rights');
    expect(keptReasonText('user-data-not-included')).toBe('User data was kept');
    expect(keptReasonText('synced-folder')).toBe('Inside a syncing folder, so it was not touched');
    expect(keptReasonText('reparse-point')).toBe('A link, so it was not followed');
    expect(keptReasonText('registry-untrusted')).toBe("Couldn't read parts of the registry");
    expect(keptReasonText('mystery')).toBe('mystery');
  });

  it('translates uninstaller block reasons', () => {
    expect(blockReasonText('missing-exe')).toContain('missing');
    expect(blockReasonText('url-protocol')).toContain('website');
    expect(blockReasonText('malformed')).toContain('recognized');
    expect(blockReasonText(null)).toBeNull();
  });

  it('describes each outcome', () => {
    expect(outcomeText('complete').title).toBe('Uninstalled');
    expect(outcomeText('partial').title).toContain('Partly');
    expect(outcomeText('failed').title).toContain('Cleanup');
    expect(outcomeText('reboot-required').title).toContain('restart');
    expect(outcomeText('not-started').title).toContain('did not start');
  });
});
