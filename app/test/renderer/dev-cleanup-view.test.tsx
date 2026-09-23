import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { DevCleanupView } from '../../renderer/src/pages/DevCleanupView';
import type { CleanExecuteRequest, CleanExecuteResult, ScanEvent } from '../../src/shared/ipc';
import { makeApi, makeCleanReport, makeDevCleanupState } from './fakes';

describe('DevCleanupView', () => {
  it('renders groups and selects all dead green projects', async () => {
    const api = makeApi({ getDevCleanup: async () => makeDevCleanupState() });
    render(<DevCleanupView api={api} root="C:\\" onBack={vi.fn()} onViewResults={vi.fn()} />);

    expect(await screen.findByText('dead-app')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Select all Dead + green' }));
    expect(screen.getByText('1 selected · 512 KB')).toBeInTheDocument();
  });

  it('reviews and executes the selected projects with restore commands', async () => {
    const executeClean = vi.fn(async () => ({
      ok: true as const,
      report: makeCleanReport({
        scope: 'dev',
        deletedBytes: 512,
        items: [
          {
            ruleId: 'npm-project-modules',
            path: 'C:\\dev\\dead-app\\node_modules',
            category: 'npm-projects',
            action: 'delete-path',
            status: 'done',
            plannedBytes: 512,
            deletedBytes: 512,
            skippedLocked: 0,
            errorCount: 0,
            restoreCommand: 'npm ci',
          },
        ],
      }),
    }));
    const api = makeApi({ getDevCleanup: async () => makeDevCleanupState(), executeClean });
    render(<DevCleanupView api={api} root="C:\\" onBack={vi.fn()} onViewResults={vi.fn()} />);

    fireEvent.click(await screen.findByRole('button', { name: 'Select all Dead + green' }));
    fireEvent.click(screen.getByRole('button', { name: 'Review cleanup' }));

    expect(await screen.findByRole('region', { name: 'Cleanup plan' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Delete permanently' }));

    await waitFor(() => expect(executeClean).toHaveBeenCalledTimes(1));
    expect(await screen.findByText('Cleanup complete')).toBeInTheDocument();
    expect(screen.getByText('npm ci')).toBeInTheDocument();
  });

  it('pins a project through the api and reloads', async () => {
    const setPin = vi.fn(async () => ({ ok: true as const, pins: ['C:\\dev\\dead-app'] }));
    const getDevCleanup = vi.fn(async () => makeDevCleanupState());
    const api = makeApi({ getDevCleanup, setPin });
    render(<DevCleanupView api={api} root="C:\\" onBack={vi.fn()} onViewResults={vi.fn()} />);

    fireEvent.click(await screen.findByRole('button', { name: 'Keep dead-app' }));
    await waitFor(() => expect(setPin).toHaveBeenCalledWith('C:\\dev\\dead-app', true));
    await waitFor(() => expect(getDevCleanup).toHaveBeenCalledTimes(2));
  });

  it('shows the session-only recently cleaned group', async () => {
    const api = makeApi({
      getDevCleanup: async () =>
        makeDevCleanupState({
          recentlyCleaned: [
            {
              root: 'C:\\',
              path: 'C:\\dev\\old',
              name: 'old',
              bytes: 2048,
              restoreCommand: 'npm ci',
              cleanedAt: Date.UTC(2026, 0, 3),
            },
          ],
        }),
    });
    render(<DevCleanupView api={api} root="C:\\" onBack={vi.fn()} onViewResults={vi.fn()} />);

    expect(await screen.findByText('Recently cleaned (1)')).toBeInTheDocument();
    expect(screen.getByText('old')).toBeInTheDocument();
  });

  it('shows per-project progress while the cleanup executes', async () => {
    let resolveExecute: (result: CleanExecuteResult) => void = () => {};
    const executeClean = vi.fn(
      (_request: CleanExecuteRequest) =>
        new Promise<CleanExecuteResult>((resolve) => {
          resolveExecute = resolve;
        }),
    );
    const handlers: Array<(event: ScanEvent) => void> = [];
    const api = makeApi({
      getDevCleanup: async () => makeDevCleanupState(),
      executeClean,
      onScanEvent: (handler) => {
        handlers.push(handler);
        return () => {};
      },
    });
    render(<DevCleanupView api={api} root="C:\\" onBack={vi.fn()} onViewResults={vi.fn()} />);

    fireEvent.click(await screen.findByRole('button', { name: 'Select all Dead + green' }));
    fireEvent.click(screen.getByRole('button', { name: 'Review cleanup' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Delete permanently' }));

    await waitFor(() => expect(executeClean).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(handlers.length).toBeGreaterThan(0));
    const cleanId = executeClean.mock.calls[0]?.[0]?.cleanId;
    expect(cleanId).toBeDefined();

    act(() => {
      handlers[0]?.({
        type: 'clean-item',
        cleanId: cleanId ?? '',
        item: {
          ruleId: 'npm-project-modules',
          path: 'C:\\dev\\dead-app\\node_modules',
          category: 'npm-projects',
          action: 'delete-path',
          status: 'done',
          plannedBytes: 512,
          deletedBytes: 512,
          skippedLocked: 0,
          errorCount: 0,
          restoreCommand: 'npm ci',
        },
      });
    });

    const status = screen.getByRole('status');
    expect(status).toHaveTextContent('C:\\dev\\dead-app\\node_modules');
    expect(status).toHaveTextContent('done');
    expect(screen.getByRole('button', { name: 'Delete permanently' })).toBeDisabled();

    await act(async () => {
      resolveExecute({ ok: true, report: makeCleanReport({ scope: 'dev' }) });
    });
    expect(await screen.findByText('Cleanup complete')).toBeInTheDocument();
  });
});
