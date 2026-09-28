import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { DustApi, UninstallEvent, UninstallExecuteRequest, UninstallLaunchHint } from '../../src/shared/ipc';
import { UninstallView } from '../../renderer/src/pages/UninstallView';
import {
  makeApi,
  makeRemovalReport,
  makeUninstallApp,
  makeUninstallPreview,
} from './fakes';

function renderView(api: DustApi, hint: UninstallLaunchHint | null = null) {
  const onHintShown = vi.fn();
  render(<UninstallView api={api} hint={hint} onHintShown={onHintShown} />);
  return { onHintShown };
}

function apiWithApps(overrides: Partial<DustApi> = {}): DustApi {
  return makeApi({
    listUninstallApps: async () => ({
      ok: true,
      trusted: true,
      elevated: false,
      loadedAt: 1,
      apps: [makeUninstallApp()],
    }),
    ...overrides,
  });
}

describe('UninstallView', () => {
  it('lists installed apps with badges and filters by search', async () => {
    const api = apiWithApps({
      listUninstallApps: async () => ({
        ok: true,
        trusted: true,
        elevated: false,
        loadedAt: 1,
        apps: [
          makeUninstallApp(),
          makeUninstallApp({
            id: 'app-2',
            displayName: 'Office',
            publisher: 'Microsoft Corporation',
            hive: 'hklm',
            kind: 'msi',
            requiresAdmin: true,
            installLocation: 'C:\\Program Files\\Microsoft Office',
          }),
        ],
      }),
    });
    renderView(api);

    expect(await screen.findByRole('heading', { name: 'Deep Uninstall' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Remove Spotify/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Remove Office/ })).toBeInTheDocument();
    expect(screen.getByText('MSI')).toBeInTheDocument();
    expect(screen.getByText('Per-user')).toBeInTheDocument();
    expect(screen.getAllByText('Needs admin').length).toBeGreaterThan(0);
    expect(screen.getByText('2 apps')).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText('Search installed apps'), { target: { value: 'office' } });
    expect(screen.queryByRole('button', { name: /Remove Spotify/ })).toBeNull();
    expect(screen.getByRole('button', { name: /Remove Office/ })).toBeInTheDocument();
  });

  it('builds a plan for the chosen app and shows sections, command and kept items', async () => {
    const api = apiWithApps({ previewUninstall: async () => ({ ok: true, preview: makeUninstallPreview() }) });
    renderView(api);

    fireEvent.click(await screen.findByRole('button', { name: /Remove Spotify/ }));

    const dialog = await screen.findByRole('dialog', { name: 'Remove Spotify' });
    expect(within(dialog).getByRole('heading', { name: 'Remove Spotify' })).toBeInTheDocument();
    expect(within(dialog).getByText(/uninstall\.exe/)).toBeInTheDocument();
    expect(within(dialog).getByRole('region', { name: 'App data' })).toBeInTheDocument();
    expect(within(dialog).getByRole('region', { name: 'User data' })).toBeInTheDocument();
    expect(within(dialog).getByRole('region', { name: 'Registry keys' })).toBeInTheDocument();
    expect(within(dialog).getByText(/will be removed/)).toBeInTheDocument();
    expect(within(dialog).getByText(/item will be kept/)).toBeInTheDocument();
  });

  it('requires acknowledgement for selected review items and executes with the selection', async () => {
    const calls: UninstallExecuteRequest[] = [];
    const api = apiWithApps({
      previewUninstall: async () => ({ ok: true, preview: makeUninstallPreview() }),
      executeUninstall: async (request) => {
        calls.push(request);
        return { ok: true, report: makeRemovalReport() };
      },
    });
    renderView(api);

    fireEvent.click(await screen.findByRole('button', { name: /Remove Spotify/ }));
    const dialog = await screen.findByRole('dialog', { name: 'Remove Spotify' });

    const confirm = within(dialog).getByRole('button', { name: 'Uninstall' });
    expect(confirm).toBeEnabled();
    fireEvent.click(within(dialog).getByLabelText('Select HKCU\\Software\\Spotify'));
    expect(confirm).toBeDisabled();
    fireEvent.click(within(dialog).getByLabelText(/I understand review items/));
    expect(confirm).toBeEnabled();
    fireEvent.click(confirm);

    await waitFor(() => expect(calls).toHaveLength(1));
    expect(calls[0]).toMatchObject({
      planId: 'plan-1',
      includeUserData: false,
      runUninstaller: true,
      quiet: false,
    });
    expect(calls[0]!.selection).toEqual(
      expect.arrayContaining(['file-local', 'reg-vendor', 'reg-uninstall']),
    );
    expect(calls[0]!.selection).not.toContain('file-roaming');
    expect(calls[0]!.acknowledge).toEqual(['reg-vendor']);

    expect(await within(dialog).findByText('Uninstalled')).toBeInTheDocument();
    expect(within(dialog).getByText('1.0 KB')).toBeInTheDocument();
    expect(within(dialog).getByText(/reg import/)).toBeInTheDocument();
  });

  it('opts user data in explicitly and includes it in the request', async () => {
    const calls: UninstallExecuteRequest[] = [];
    const api = apiWithApps({
      previewUninstall: async () => ({ ok: true, preview: makeUninstallPreview() }),
      executeUninstall: async (request) => {
        calls.push(request);
        return { ok: true, report: makeRemovalReport() };
      },
    });
    renderView(api);

    fireEvent.click(await screen.findByRole('button', { name: /Remove Spotify/ }));
    const dialog = await screen.findByRole('dialog', { name: 'Remove Spotify' });

    fireEvent.click(within(dialog).getByLabelText('Also remove user data'));
    fireEvent.click(within(dialog).getByLabelText(/I understand review items/));
    fireEvent.click(within(dialog).getByRole('button', { name: 'Uninstall' }));

    await waitFor(() => expect(calls).toHaveLength(1));
    expect(calls[0]).toMatchObject({ includeUserData: true });
    expect(calls[0]!.selection).toContain('file-roaming');
  });

  it('relaunches elevated instead of running an admin-flagged plan un-elevated', async () => {
    const calls: UninstallExecuteRequest[] = [];
    const relaunch = vi.fn(async () => {});
    const api = apiWithApps({
      previewUninstall: async () => ({
        ok: true,
        preview: makeUninstallPreview({
          uninstaller: {
            raw: 'MsiExec.exe /X{GUID}',
            argv: ['/X{GUID}'],
            kind: 'msi',
            launchable: true,
            requiresAdmin: true,
            interactiveOnly: false,
            silent: null,
            blockReason: null,
          },
        }),
      }),
      executeUninstall: async (request) => {
        calls.push(request);
        return { ok: true, report: makeRemovalReport({ degraded: true, outcome: 'partial' }) };
      },
      relaunchElevatedUninstall: relaunch,
    });
    renderView(api);

    fireEvent.click(await screen.findByRole('button', { name: /Remove Spotify/ }));
    const dialog = await screen.findByRole('dialog', { name: 'Remove Spotify' });
    fireEvent.click(within(dialog).getByLabelText(/I understand review items/));
    fireEvent.click(within(dialog).getByRole('button', { name: 'Uninstall' }));

    await waitFor(() => expect(relaunch).toHaveBeenCalledWith('plan-1'));
    expect(calls).toHaveLength(0);
    expect(within(dialog).getByRole('button', { name: 'Uninstall' })).toBeInTheDocument();
  });

  it('opens the preview carried by an elevated launch hint', async () => {
    const api = apiWithApps({ previewUninstall: async () => ({ ok: true, preview: makeUninstallPreview() }) });
    renderView(api, {
      open: true,
      appId: 'app-1',
      notice: null,
      stalePending: false,
      runningJobId: null,
    });

    expect(await screen.findByRole('dialog', { name: 'Remove Spotify' })).toBeInTheDocument();
  });

  it('streams the running phases, offers skip waiting, then shows the report', async () => {
    const bus: { emit: ((event: UninstallEvent) => void) | null } = { emit: null };
    const held: { release: ((report: ReturnType<typeof makeRemovalReport>) => void) | null } = { release: null };
    const execute = vi.fn(
      async () =>
        new Promise<Awaited<ReturnType<DustApi['executeUninstall']>>>((resolve) => {
          held.release = (report) => resolve({ ok: true, report });
        }),
    );
    const skipWaiting = vi.fn(async () => {});
    const api = apiWithApps({
      previewUninstall: async () => ({ ok: true, preview: makeUninstallPreview({ uninstaller: null }) }),
      executeUninstall: execute,
      skipUninstallWaiting: skipWaiting,
      onUninstallEvent: (handler) => {
        bus.emit = handler;
        return () => {};
      },
    });
    renderView(api);

    fireEvent.click(await screen.findByRole('button', { name: /Remove Spotify/ }));
    const dialog = await screen.findByRole('dialog', { name: 'Remove Spotify' });
    fireEvent.click(within(dialog).getByLabelText(/I understand review items/));
    fireEvent.click(within(dialog).getByRole('button', { name: 'Uninstall' }));

    expect(within(dialog).queryByRole('button', { name: 'Uninstall' })).toBeNull();
    bus.emit?.({ type: 'phase', jobId: 'plan-1', phase: 'uninstaller', status: 'started' });
    bus.emit?.({ type: 'uninstaller-started', jobId: 'plan-1', pid: 5, argv: ['/S'] });

    const skip = await within(dialog).findByRole('button', { name: 'Skip waiting' });
    fireEvent.click(skip);
    expect(skipWaiting).toHaveBeenCalledTimes(1);

    const report = makeRemovalReport();
    held.release?.(report);
    bus.emit?.({ type: 'finished', jobId: 'plan-1', report });

    expect(await within(dialog).findByText('Uninstalled')).toBeInTheDocument();
    fireEvent.click(within(dialog).getByRole('button', { name: 'Done' }));
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('shows a notice when a pending elevated run did not start', async () => {
    const api = makeApi();
    const onHintShown = vi.fn();
    render(
      <UninstallView
        api={api}
        hint={{ open: true, appId: null, notice: null, stalePending: true, runningJobId: null }}
        onHintShown={onHintShown}
      />,
    );

    expect(await screen.findByText(/didn't start/)).toBeInTheDocument();
    expect(onHintShown).toHaveBeenCalledTimes(1);
  });
});
