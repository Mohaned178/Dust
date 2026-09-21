import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { CleanSummary } from '../../renderer/src/components/CleanSummary';
import { makeCleanReport } from './fakes';

describe('CleanSummary', () => {
  it('reports freed bytes, remaining reclaimable space and restore commands', () => {
    const onDone = vi.fn();
    render(
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
      />,
    );

    expect(screen.getByText('2.0 KB')).toBeInTheDocument();
    expect(screen.getByText(/4.0 KB still reclaimable/)).toBeInTheDocument();
    expect(screen.getByText('npm ci')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'View updated disk' }));
    expect(onDone).toHaveBeenCalledTimes(1);
  });

  it('reports locked files as partially cleaned', () => {
    render(
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
      />,
    );

    expect(screen.getByText(/Partially cleaned: 2 file\(s\) in use were skipped\./)).toBeInTheDocument();
    expect(screen.getByText(/partially cleaned: 2 file\(s\) in use/)).toBeInTheDocument();
  });
});
