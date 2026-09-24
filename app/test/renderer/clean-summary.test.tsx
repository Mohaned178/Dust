import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { CleanDialog } from '../../renderer/src/components/CleanDialog';
import { CleanSummary } from '../../renderer/src/components/CleanSummary';
import { makeCleanReport } from './fakes';

describe('CleanSummary', () => {
  it('reports freed bytes, remaining reclaimable space and restore commands', () => {
    const onDone = vi.fn();
    render(
      <CleanDialog label="Cleanup complete" onClose={onDone}>
        <CleanSummary
          report={makeCleanReport({
            deletedBytes: 2048,
            remainingReclaimableBytes: 4096,
            items: [
              {
                ruleId: 'npm-project-modules',
                path: 'C:\\dev\\app\\node_modules',
                category: 'npm-projects',
                action: 'delete-path',
                status: 'done',
                plannedBytes: 2048,
                deletedBytes: 2048,
                skippedLocked: 0,
                errorCount: 0,
                restoreCommand: 'npm ci',
              },
            ],
          })}
          onDone={onDone}
        />
      </CleanDialog>,
    );

    expect(screen.getByRole('dialog', { name: 'Cleanup complete' })).toBeInTheDocument();
    expect(screen.getAllByText('2.0 KB').length).toBeGreaterThan(0);
    expect(screen.getByText('freed')).toBeInTheDocument();
    expect(screen.getByText(/still reclaimable/)).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'npm projects, 2.0 KB, 1 item' }));
    expect(screen.getByText('npm ci')).toBeInTheDocument();
    expect(screen.getByText('Cleaned.')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'View Updated Disk' }));
    expect(onDone).toHaveBeenCalledTimes(1);
  });

  it('reports locked files as partially cleaned', () => {
    render(
      <CleanDialog label="Cleanup complete" onClose={vi.fn()}>
        <CleanSummary
          report={makeCleanReport({
            skippedLocked: 2,
            remainingReclaimableBytes: 0,
            items: [
              {
                ruleId: 'system-temp',
                path: 'C:\\Temp',
                category: 'temp',
                action: 'delete-path',
                status: 'partial',
                plannedBytes: 100,
                deletedBytes: 60,
                skippedLocked: 2,
                errorCount: 0,
                restoreCommand: null,
              },
            ],
          })}
          onDone={vi.fn()}
        />
      </CleanDialog>,
    );

    expect(screen.getAllByText('Partially cleaned: 2 files in use were skipped.').length).toBeGreaterThan(0);
  });

  it('pluralizes skipped files and errors with correct singular and plural forms', () => {
    const { rerender } = render(
      <CleanDialog label="Cleanup complete" onClose={vi.fn()}>
        <CleanSummary report={makeCleanReport({ skippedLocked: 1, itemErrors: 1 })} onDone={vi.fn()} />
      </CleanDialog>,
    );
    expect(screen.getByText('Partially cleaned: 1 file in use was skipped.')).toBeInTheDocument();
    expect(screen.getByText('1 item could not be cleaned — see the item list below.')).toBeInTheDocument();

    rerender(
      <CleanDialog label="Cleanup complete" onClose={vi.fn()}>
        <CleanSummary report={makeCleanReport({ skippedLocked: 6, itemErrors: 3 })} onDone={vi.fn()} />
      </CleanDialog>,
    );
    expect(screen.getByText('Partially cleaned: 6 files in use were skipped.')).toBeInTheDocument();
    expect(screen.getByText('3 items could not be cleaned — see the item list below.')).toBeInTheDocument();
  });
});
