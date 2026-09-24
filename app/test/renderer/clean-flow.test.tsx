import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { CleanDialog } from '../../renderer/src/components/CleanDialog';
import { CleanFlow } from '../../renderer/src/components/CleanFlow';
import { CleanPlan } from '../../renderer/src/components/CleanPlan';
import { CleanSummary } from '../../renderer/src/components/CleanSummary';
import type { CleanItemPreview, CleanItemResult, CleanPreview, CleanReport, CleanPreviewResult } from '../../src/shared/ipc';
import { makeApi, makeCleanPreview } from './fakes';

const writeText = vi.fn().mockResolvedValue(undefined);

beforeEach(() => {
  writeText.mockClear();
  Object.defineProperty(navigator, 'clipboard', {
    value: { writeText },
    configurable: true,
  });
});

function item(overrides: Partial<CleanItemPreview> = {}): CleanItemPreview {
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

function preview(overrides: Partial<CleanPreview> = {}): CleanPreview {
  return {
    planId: 'plan-1',
    createdAt: 0,
    root: 'C:\\',
    source: 'live',
    scanAgeMs: null,
    items: [],
    totals: { bytes: 0, items: 0, reviewBytes: 0, reviewItems: 0 },
    refused: [],
    ...overrides,
  };
}

function reportItem(overrides: Partial<CleanItemResult> = {}): CleanItemResult {
  return {
    ruleId: 'npm-cache',
    path: 'C:\\Users\\x\\AppData\\Local\\npm-cache\\_cacache',
    category: 'npm-cache',
    action: 'delete-path',
    status: 'done',
    plannedBytes: 2048,
    deletedBytes: 2048,
    skippedLocked: 0,
    errorCount: 0,
    restoreCommand: null,
    ...overrides,
  };
}

function report(overrides: Partial<CleanReport> = {}): CleanReport {
  return {
    planId: 'plan-1',
    scope: 'quick',
    root: 'C:\\',
    startedAt: 0,
    finishedAt: 1000,
    items: [],
    deletedBytes: 0,
    skippedLocked: 0,
    itemErrors: 0,
    remainingReclaimableBytes: 0,
    cleanedAt: 1000,
    ...overrides,
  };
}

describe('CleanFlow', () => {
  it('keeps the open plan when the parent selection empties', async () => {
    const previewClean = vi.fn(async (request: { scope: string; paths?: string[] }): Promise<CleanPreviewResult> =>
      request.scope !== 'quick' && (request.paths ?? []).length === 0
        ? { ok: false, reason: 'empty-selection', message: 'Select at least one item to clean' }
        : { ok: true, preview: makeCleanPreview() },
    );
    const api = makeApi({ previewClean });
    const props = {
      api,
      scope: 'row' as const,
      root: 'C:\\',
      label: 'Clean 1 selected',
      onClose: () => {},
      onPrimary: () => {},
    };
    const { rerender } = render(<CleanFlow {...props} paths={['C:\\Users\\x\\AppData\\Local\\Temp']} />);
    expect(await screen.findByText('will be freed')).toBeInTheDocument();

    rerender(<CleanFlow {...props} paths={[]} />);

    await waitFor(() => expect(previewClean).toHaveBeenCalledTimes(1));
    expect(screen.queryByText('Select at least one item to clean')).not.toBeInTheDocument();
    expect(screen.getByText('will be freed')).toBeInTheDocument();
  });
});

describe('CleanDialog', () => {
  it('dismisses on Escape by default', () => {
    const onClose = vi.fn();
    render(
      <CleanDialog label="Test" onClose={onClose}>
        <p>Body</p>
      </CleanDialog>,
    );
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('ignores Escape and hides the close control while non-dismissible', () => {
    const onClose = vi.fn();
    render(
      <CleanDialog label="Test" onClose={onClose} dismissible={false}>
        <p>Body</p>
      </CleanDialog>,
    );
    expect(screen.queryByRole('button', { name: 'Close' })).not.toBeInTheDocument();
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(onClose).not.toHaveBeenCalled();
  });
});

describe('CleanPlan', () => {
  const baseProps = {
    acknowledge: true,
    onAcknowledge: () => {},
    onConfirm: () => {},
    onCancel: () => {},
    onReveal: () => {},
    busy: false,
  };

  it('shows a rebuild command with a copy control once the category is expanded', async () => {
    const command = 'npm install';
    render(
      <CleanPlan
        {...baseProps}
        preview={preview({
          items: [
            item({
              category: 'npm-cache',
              path: 'C:\\Users\\x\\AppData\\Local\\npm-cache',
              recovery: { kind: 'regenerate', text: command },
            }),
          ],
          totals: { bytes: 1024, items: 1, reviewBytes: 0, reviewItems: 0 },
        })}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: /npm cache/ }));
    const code = await screen.findByText(command);
    expect(code).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /Copy rebuild command/ }));
    expect(writeText).toHaveBeenCalledWith(command);
    expect(await screen.findByText('Copied')).toBeInTheDocument();
  });

  it('surfaces refused items instead of dropping them silently', () => {
    render(
      <CleanPlan
        {...baseProps}
        preview={preview({
          items: [item()],
          refused: [{ ruleId: 'temp-files', path: 'C:\\Windows\\Temp\\x', reason: 'protected-root' }],
        })}
      />,
    );
    expect(screen.getByText('1 matched item was not included')).toBeInTheDocument();
  });

  it('disables both cancel and confirm while executing', () => {
    render(<CleanPlan {...baseProps} busy preview={preview({ items: [item()] })} />);
    expect(screen.getByRole('button', { name: 'Cancel' })).toBeDisabled();
    expect(screen.getByRole('button', { name: /Cleaning/ })).toBeDisabled();
  });
});

describe('CleanSummary', () => {
  it('announces the freed figure through a live region', () => {
    render(<CleanSummary report={report({ deletedBytes: 2048 })} onDone={() => {}} />);
    const status = screen.getByRole('status');
    expect(within(status).getByText('2.0 KB')).toBeInTheDocument();
    expect(within(status).getByText('freed')).toBeInTheDocument();
  });

  it('groups partial and error caveats into one notice', () => {
    render(
      <CleanSummary report={report({ deletedBytes: 2048, skippedLocked: 2, itemErrors: 1 })} onDone={() => {}} />,
    );
    expect(screen.getByText('Partially cleaned: 2 files in use were skipped.')).toBeInTheDocument();
    expect(screen.getByText('1 item could not be cleaned — see the item list below.')).toBeInTheDocument();
  });

  it('offers a copy control for restore commands', async () => {
    render(
      <CleanSummary
        report={report({ deletedBytes: 2048, items: [reportItem({ restoreCommand: 'npm install' })] })}
        onDone={() => {}}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: /npm cache/ }));
    fireEvent.click(await screen.findByRole('button', { name: /Copy command/ }));
    await waitFor(() => expect(writeText).toHaveBeenCalledWith('npm install'));
  });
});
