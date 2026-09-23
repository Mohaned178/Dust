import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { BrowseView } from '../../renderer/src/pages/BrowseView';
import type { BrowseRow, ScanEvent } from '../../src/shared/ipc';
import { makeApi } from './fakes';

function browseRow(path: string, bytes: number, parent: string | null, overrides: Partial<BrowseRow> = {}): BrowseRow {
  return {
    path,
    name: path.replace(/[\\/]+$/, '').split(/[\\/]/).pop() ?? path,
    parent,
    bytes,
    allocatedBytes: bytes,
    fileCount: 1,
    folderCount: 0,
    linkCount: 0,
    newestMtimeMs: 0,
    errorCount: 0,
    partial: false,
    complete: true,
    childCount: 0,
    ...overrides,
  };
}

function makeHarness(overrides: Parameters<typeof makeApi>[0] = {}) {
  const handlers: Array<(event: ScanEvent) => void> = [];
  const api = makeApi({
    onScanEvent: (handler) => {
      handlers.push(handler);
      return () => {};
    },
    ...overrides,
  });
  return {
    api,
    emit: (event: ScanEvent) => {
      for (const handler of handlers) handler(event);
    },
  };
}

describe('BrowseView', () => {
  it('streams rows without a Safety column', async () => {
    const { api, emit } = makeHarness();
    render(<BrowseView api={api} root="E:\\" runId="b1" />);

    act(() => {
      emit({
        type: 'browse-folders',
        runId: 'b1',
        folders: [browseRow('E:\\Games', 100, 'E:\\'), browseRow('E:\\Games\\save', 40, 'E:\\Games')],
      });
    });

    expect(await screen.findByText('Games')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Expand Games' }));
    expect(await screen.findByText('save')).toBeInTheDocument();
    expect(screen.queryByRole('columnheader', { name: 'Safety' })).toBeNull();
    expect(screen.getByRole('columnheader', { name: 'Action' })).toBeInTheDocument();
  });

  it('deletes a row after confirmation and removes it from the tree', async () => {
    const deleteBrowsePath = vi.fn(async (path: string) => ({
      path,
      status: 'done' as const,
      deletedBytes: 40,
      skippedLocked: 0,
      errors: [],
    }));
    const { api, emit } = makeHarness({ deleteBrowsePath });
    render(<BrowseView api={api} root="E:\\" runId="b1" />);

    act(() => {
      emit({
        type: 'browse-folders',
        runId: 'b1',
        folders: [browseRow('E:\\Games', 100, 'E:\\'), browseRow('E:\\Games\\save', 40, 'E:\\Games')],
      });
    });

    fireEvent.click(await screen.findByRole('button', { name: 'Expand Games' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Delete save' }));
    expect(await screen.findByRole('dialog', { name: 'Delete E:\\Games\\save' })).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Delete permanently' }));

    await waitFor(() => expect(deleteBrowsePath).toHaveBeenCalledWith('E:\\Games\\save'));
    await waitFor(() => expect(screen.queryByText('save')).toBeNull());
  });

  it('keeps the row and shows the refusal when the guard blocks a delete', async () => {
    const deleteBrowsePath = vi.fn(async (path: string) => ({
      path,
      status: 'refused' as const,
      deletedBytes: 0,
      skippedLocked: 0,
      errors: [],
      refusal: 'inside-protected',
    }));
    const { api, emit } = makeHarness({ deleteBrowsePath });
    render(<BrowseView api={api} root="E:\\" runId="b1" />);

    act(() => {
      emit({ type: 'browse-folders', runId: 'b1', folders: [browseRow('E:\\Games', 100, 'E:\\')] });
    });

    fireEvent.click(await screen.findByRole('button', { name: 'Delete Games' }));
    fireEvent.click(screen.getByRole('button', { name: 'Delete permanently' }));

    expect(await screen.findByText(/Delete refused/)).toBeInTheDocument();
    expect(screen.getByText('Games')).toBeInTheDocument();
  });
});
