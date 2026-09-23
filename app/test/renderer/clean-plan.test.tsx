import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { CleanPlan } from '../../renderer/src/components/CleanPlan';
import type { CleanItemPreview } from '../../src/shared/ipc';
import { makeCleanPreview } from './fakes';

function reviewItem(overrides: Partial<CleanItemPreview> = {}): CleanItemPreview {
  return {
    ruleId: 'npm-project-modules',
    category: 'npm-projects',
    path: 'C:\\dev\\app\\node_modules',
    name: 'node_modules',
    bytes: 5000,
    grade: 'review',
    recovery: { kind: 'regenerate', text: 'npm install' },
    evidence: 'no lockfile - dependency versions may drift',
    action: 'delete-path',
    adminRequired: false,
    ...overrides,
  };
}

function setup(previewOverrides = {}, props: { acknowledge?: boolean; busy?: boolean } = {}) {
  const onConfirm = vi.fn();
  const onCancel = vi.fn();
  const onReveal = vi.fn();
  const onAcknowledge = vi.fn();
  const onRelaunchElevated = vi.fn();
  const preview = makeCleanPreview(previewOverrides);
  const view = render(
    <CleanPlan
      preview={preview}
      acknowledge={props.acknowledge ?? false}
      onAcknowledge={onAcknowledge}
      onConfirm={onConfirm}
      onCancel={onCancel}
      onReveal={onReveal}
      onRelaunchElevated={onRelaunchElevated}
      busy={props.busy ?? false}
    />,
  );
  return { onConfirm, onCancel, onReveal, onAcknowledge, onRelaunchElevated, view, preview };
}

describe('CleanPlan', () => {
  it('shows the totals, the recovery statement and the scan source', () => {
    setup();

    expect(screen.getByText(/Using Analyze data from/)).toBeInTheDocument();
    expect(screen.getByText('9.8 KB')).toBeInTheDocument();
    expect(screen.getByText(/across 1 item/)).toBeInTheDocument();
    expect(screen.getByText('Temporary files are recreated by the apps that need them')).toBeInTheDocument();
    expect(screen.getByText('User TEMP directory - junk by definition')).toBeInTheDocument();
  });

  it('confirms and cancels', () => {
    const { onConfirm, onCancel } = setup();

    fireEvent.click(screen.getByRole('button', { name: 'Delete permanently' }));
    expect(onConfirm).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  it('blocks confirmation until review items are acknowledged', () => {
    const preview = makeCleanPreview({
      items: [reviewItem()],
      totals: { bytes: 5000, items: 1, reviewBytes: 5000, reviewItems: 1 },
    });
    const onAcknowledge = vi.fn();
    const { rerender } = render(
      <CleanPlan
        preview={preview}
        acknowledge={false}
        onAcknowledge={onAcknowledge}
        onConfirm={vi.fn()}
        onCancel={vi.fn()}
        onReveal={vi.fn()}
        busy={false}
      />,
    );

    expect(screen.getByRole('button', { name: 'Delete permanently' })).toBeDisabled();
    expect(screen.getByText('1 item cannot be restored.')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('checkbox', { name: /cannot be restored/ }));
    expect(onAcknowledge).toHaveBeenCalledWith(true);

    rerender(
      <CleanPlan
        preview={preview}
        acknowledge
        onAcknowledge={onAcknowledge}
        onConfirm={vi.fn()}
        onCancel={vi.fn()}
        onReveal={vi.fn()}
        busy={false}
      />,
    );
    expect(screen.getByRole('button', { name: 'Delete permanently' })).toBeEnabled();
  });

  it('offers Explorer for the Recycle Bin and relaunch for admin items', () => {
    const recycle: CleanItemPreview = {
      ruleId: 'recycle-bin',
      category: 'recycle-bin',
      path: 'C:\\$Recycle.Bin',
      name: '$Recycle.Bin',
      bytes: 100,
      grade: 'review',
      recovery: { kind: 'junk', text: 'Emptied items are permanently gone' },
      evidence: '3 items on C:',
      action: 'empty-recycle-bin',
      adminRequired: false,
    };
    const admin = reviewItem({
      ruleId: 'system-temp',
      category: 'temp',
      path: 'C:\\Windows\\Temp',
      name: 'Temp',
      grade: 'safe',
      adminRequired: true,
      recovery: { kind: 'junk', text: 'Temporary files are recreated by the apps that need them' },
    });
    const { onReveal, onRelaunchElevated } = setup({
      items: [recycle, admin],
      totals: { bytes: 5100, items: 2, reviewBytes: 100, reviewItems: 1 },
    });

    fireEvent.click(screen.getByRole('button', { name: /Open the Recycle Bin in Explorer first/ }));
    expect(onReveal).toHaveBeenCalledWith('C:\\$Recycle.Bin');

    fireEvent.click(screen.getByRole('button', { name: 'Relaunch as Administrator' }));
    expect(onRelaunchElevated).toHaveBeenCalledTimes(1);
  });
});
