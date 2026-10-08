import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { DustApi, UninstallEvent, UninstallLaunchHint } from '../../src/shared/ipc';
import { UninstallView } from '../../renderer/src/pages/UninstallView';
import { makeApi, makeRemovalReport, makeUninstallApp, makeUninstallPreview } from './fakes';

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

const twoApps: DustApi['listUninstallApps'] = async () => ({
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
      caution: 'runtime',
      installLocation: 'C:\\Program Files\\Microsoft Office',
    }),
    makeUninstallApp({ id: 'app-3', displayName: 'Orphan', publisher: '', hasUninstaller: false }),
  ],
});

describe('UninstallView', () => {
  it('lists installed apps with badges and filters by search', async () => {
    renderView(apiWithApps({ listUninstallApps: twoApps }));

    expect(await screen.findByRole('heading', { name: 'Uninstall apps' })).toBeInTheDocument();
    expect(await screen.findByRole('button', { name: 'Remove Spotify' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Remove Office' })).toBeInTheDocument();
    expect(screen.getByText('Runtime')).toBeInTheDocument();
    expect(screen.getByText('Needs admin')).toBeInTheDocument();
    expect(screen.getByText('Leftovers only')).toBeInTheDocument();
    expect(screen.getByText(/^Unknown publisher/)).toBeInTheDocument();
    expect(screen.getByText('3 apps')).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText('Search installed apps'), { target: { value: 'office' } });
    expect(screen.queryByRole('button', { name: 'Remove Spotify' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Remove Office' })).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText('Search installed apps'), { target: { value: 'zzz' } });
    expect(screen.getByText('No apps match this search.')).toBeInTheDocument();
  });

  it('sorts by size using sizes that arrive in the background', async () => {
    const handlers = new Set<(event: UninstallEvent) => void>();
    const api = apiWithApps({
      listUninstallApps: twoApps,
      onUninstallEvent: (handler) => {
        handlers.add(handler);
        return () => handlers.delete(handler);
      },
    });
    renderView(api);
    await screen.findByRole('button', { name: 'Remove Spotify' });

    act(() => {
      for (const handler of handlers) handler({ type: 'app-size', appId: 'app-2', bytes: 5 * 1024 ** 3 });
    });
    expect(screen.getByText('5.0 GB')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Size' }));
    const names = within(screen.getByRole('region', { name: 'Installed apps' }))
      .getAllByRole('button', { name: /^Remove / })
      .map((button) => button.getAttribute('aria-label'));
    expect(names[0]).toBe('Remove Office');
  });

  it('shows a recoverable error and reloads on Try again', async () => {
    const listUninstallApps = vi
      .fn<DustApi['listUninstallApps']>()
      .mockResolvedValueOnce({ ok: false, message: 'Registry unavailable' })
      .mockResolvedValue({ ok: true, trusted: true, elevated: false, loadedAt: 2, apps: [makeUninstallApp()] });
    renderView(makeApi({ listUninstallApps }));

    expect(await screen.findByRole('alert')).toHaveTextContent('Registry unavailable');
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));

    expect(await screen.findByRole('button', { name: 'Remove Spotify' })).toBeInTheDocument();
    expect(screen.queryByRole('alert')).toBeNull();
    expect(listUninstallApps).toHaveBeenLastCalledWith(true);
  });

  it('shows a thrown list failure with Try again', async () => {
    const listUninstallApps = vi
      .fn<DustApi['listUninstallApps']>()
      .mockRejectedValueOnce(new Error('boom'))
      .mockResolvedValue({ ok: true, trusted: true, elevated: false, loadedAt: 2, apps: [makeUninstallApp()] });
    renderView(makeApi({ listUninstallApps }));

    expect(await screen.findByRole('alert')).toHaveTextContent('boom');
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(await screen.findByRole('button', { name: 'Remove Spotify' })).toBeInTheDocument();
  });

  it('opens the wizard for the chosen app and closes it with Cancel', async () => {
    renderView(apiWithApps());

    fireEvent.click(await screen.findByRole('button', { name: 'Remove Spotify' }));

    const dialog = await screen.findByRole('dialog', { name: 'Uninstall Spotify' });
    expect(within(dialog).getByText("Run the app's own uninstaller")).toBeInTheDocument();
    fireEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }));
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('runs the uninstaller, reviews leftovers, removes them, and refreshes the list', async () => {
    const listUninstallApps = vi.fn(twoApps);
    const api = apiWithApps({
      listUninstallApps,
      runUninstaller: async () => ({
        ok: true,
        outcome: { ran: true, exitCode: 0, verifiedGone: true, rebootRequired: false, skippedWaiting: false, skippedReason: null },
      }),
      previewUninstall: async () => ({
        ok: true,
        preview: {
          planId: 'plan-1',
          createdAt: 1,
          app: makeUninstallApp(),
          uninstaller: null,
          items: [],
          kept: [],
          totals: { bytes: 0, items: 0, reviewBytes: 0, reviewItems: 0, userDataBytes: 0, userDataItems: 0, adminItems: 0 },
        },
      }),
      executeUninstall: async () => ({ ok: true, report: makeRemovalReport() }),
    });
    renderView(api);

    fireEvent.click(await screen.findByRole('button', { name: 'Remove Spotify' }));
    const dialog = await screen.findByRole('dialog', { name: 'Uninstall Spotify' });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Uninstall' }));

    expect(await within(dialog).findByText('Nothing left behind')).toBeInTheDocument();
    expect(within(dialog).getByText('Spotify is fully removed.')).toBeInTheDocument();
    await waitFor(() => expect(listUninstallApps).toHaveBeenLastCalledWith(true));

    fireEvent.click(within(dialog).getByRole('button', { name: 'Done' }));
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('shows a notice when a pending elevated run did not start', async () => {
    const onHintShown = vi.fn();
    render(
      <UninstallView
        api={makeApi()}
        hint={{ open: true, appId: null, notice: null, stalePending: true, runningJobId: null }}
        onHintShown={onHintShown}
      />,
    );

    expect(await screen.findByText(/didn't start/)).toBeInTheDocument();
    expect(onHintShown).toHaveBeenCalledTimes(1);
  });

  it('opens the removal flow for the hinted app once the elevated list loads', async () => {
    const previewUninstall = vi.fn<DustApi['previewUninstall']>(async () => ({
      ok: true,
      preview: makeUninstallPreview(),
    }));
    const api = makeApi({
      listUninstallApps: async () => ({
        ok: true,
        trusted: true,
        elevated: true,
        loadedAt: 1,
        apps: [makeUninstallApp({ id: 'x' })],
      }),
      previewUninstall,
    });
    const { onHintShown } = renderView(api, {
      open: true,
      appId: 'x',
      notice: null,
      stalePending: false,
      runningJobId: null,
    });

    expect(await screen.findByRole('dialog')).toBeInTheDocument();
    await waitFor(() => expect(previewUninstall).toHaveBeenCalledWith('x'));
    expect(onHintShown).toHaveBeenCalledTimes(1);
  });

  it('toasts instead of opening the flow when the hinted app is gone', async () => {
    const previewUninstall = vi.fn<DustApi['previewUninstall']>();
    const api = apiWithApps({ previewUninstall });
    const { onHintShown } = renderView(api, {
      open: true,
      appId: 'x',
      notice: null,
      stalePending: false,
      runningJobId: null,
    });

    expect(await screen.findByText('That app is no longer installed. Nothing was changed.')).toBeInTheDocument();
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(previewUninstall).not.toHaveBeenCalled();
    expect(onHintShown).toHaveBeenCalledTimes(1);
  });

  it('adopts a running elevated job from the launch hint and shows its report', async () => {
    const handlers = new Set<(event: UninstallEvent) => void>();
    const api = apiWithApps({
      onUninstallEvent: (handler) => {
        handlers.add(handler);
        return () => handlers.delete(handler);
      },
    });
    renderView(api, { open: true, appId: null, notice: null, stalePending: false, runningJobId: 'job-9' });

    const dialog = await screen.findByRole('dialog');
    act(() => {
      for (const handler of handlers) handler({ type: 'finished', jobId: 'job-9', report: makeRemovalReport() });
    });
    expect(await within(dialog).findByText('Uninstalled')).toBeInTheDocument();
  });
});
