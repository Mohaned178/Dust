import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { App } from '../../../renderer-next/src/app/App';
import { startEvents } from '../../../renderer-next/src/app/events';
import { useNavStore } from '../../../renderer-next/src/app/nav';
import { DATA_FOLDER, SOURCE_URL, updateText } from '../../../renderer-next/src/pages/settings/SettingsPage';
import { useUpdatesStore } from '../../../renderer-next/src/stores/updates';
import { useToastStore } from '../../../renderer-next/src/ui/toast-store';
import type { DustApi, UpdateStatus } from '../../../src/shared/ipc';
import { makeApi } from '../../renderer/fakes';

const status = (overrides: Partial<UpdateStatus>): UpdateStatus => ({
  phase: 'idle',
  version: null,
  percent: null,
  message: null,
  ...overrides,
});

async function openSettings(overrides: Partial<DustApi> = {}) {
  const api = makeApi(overrides);
  render(<App api={api} />);
  act(() => useNavStore.getState().navigate('settings'));
  await screen.findByRole('heading', { level: 1, name: 'Settings' });
  return api;
}

const setUpdate = (next: UpdateStatus) => act(() => useUpdatesStore.getState().setStatus(next));

describe('Settings: About and privacy', () => {
  it('shows the version, the license and where the source is, and says what Dust does with your data', async () => {
    await openSettings();
    const about = screen.getByRole('region', { name: 'About' });
    expect(within(about).getByText('Version')).toBeInTheDocument();
    expect(within(about).getByText('MIT. Dust is open source.')).toBeInTheDocument();
    expect(within(about).getByText('github.com/Mohaned178/Dust')).toBeInTheDocument();
    expect(within(about).getByText('Dust runs on this PC. It has no account.')).toBeInTheDocument();
    expect(within(about).getByText('It sends no usage data and has no telemetry.')).toBeInTheDocument();
    expect(within(about).getByText(/only place it connects to is GitHub/)).toBeInTheDocument();
    expect(within(about).getByText(DATA_FOLDER)).toBeInTheDocument();
    expect(within(about).getByText(SOURCE_URL)).toBeInTheDocument();
  });

  it('copies the data folder and the source link', async () => {
    const user = userEvent.setup();
    const writeText = vi.fn(async () => {});
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } });
    await openSettings();
    await user.click(screen.getByRole('button', { name: 'Copy the folder where Dust keeps its files' }));
    await user.click(screen.getByRole('button', { name: "Copy the link to Dust's source code" }));
    expect(writeText).toHaveBeenNthCalledWith(1, DATA_FOLDER);
    expect(writeText).toHaveBeenNthCalledWith(2, SOURCE_URL);
    Reflect.deleteProperty(navigator, 'clipboard');
  });
});

describe('Settings: administrator access', () => {
  it('explains why, and restarts Dust as administrator on request', async () => {
    const user = userEvent.setup();
    const relaunchElevated = vi.fn(async () => {});
    await openSettings({ relaunchElevated });
    expect(screen.getByText(/only be changed when Dust runs as administrator/)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Relaunch as administrator' }));
    expect(relaunchElevated).toHaveBeenCalledOnce();
  });

  it('says so in plain words when Windows refuses, and offers the button again', async () => {
    const user = userEvent.setup();
    await openSettings({
      relaunchElevated: async () => {
        throw new Error('The operation was canceled by the user');
      },
    });
    await user.click(screen.getByRole('button', { name: 'Relaunch as administrator' }));
    expect(await screen.findByText(/could not restart with administrator rights/)).toBeInTheDocument();
    expect(screen.queryByText(/canceled by the user/)).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Relaunch as administrator' })).toBeEnabled();
  });

  it('does not offer it when Dust already is administrator', async () => {
    // Home's Apps tile reads the list when the app opens, which is how Settings comes to know.
    await openSettings({
      listUninstallApps: async () => ({ ok: true, apps: [], trusted: true, elevated: true, loadedAt: 1 }),
    });
    expect(await screen.findByText(/Dust is running as administrator/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Relaunch as administrator' })).not.toBeInTheDocument();
  });
});

describe('Settings: updates', () => {
  it('describes each stage of an update in plain words', () => {
    expect(updateText(status({ phase: 'checking' }))).toBe('Checking for a new version.');
    expect(updateText(status({ phase: 'available', version: '1.3.0' }))).toBe(
      'Dust 1.3.0 is available. Downloading it now.',
    );
    expect(updateText(status({ phase: 'downloading', version: '1.3.0', percent: 40 }))).toBe(
      'Downloading Dust 1.3.0, 40%.',
    );
    expect(updateText(status({ phase: 'downloaded', version: '1.3.0' }))).toBe(
      'Dust 1.3.0 is ready. Restart Dust to finish updating.',
    );
    expect(updateText(status({ phase: 'up-to-date' }))).toBe('You have the latest version.');
    expect(updateText(status({ phase: 'error', message: 'net::ERR_INTERNET_DISCONNECTED' }))).not.toMatch(/ERR_/);
    expect(updateText(status({ phase: 'idle', message: 'Updates are available in packaged builds only.' }))).toBe(
      'Updates are available in the installed version of Dust.',
    );
  });

  it('checks on request and shows the answer that arrives', async () => {
    const user = userEvent.setup();
    const checkForUpdates = vi.fn(async () => status({ phase: 'checking' }));
    await openSettings({ checkForUpdates });
    await user.click(screen.getByRole('button', { name: 'Check for updates' }));
    expect(checkForUpdates).toHaveBeenCalledOnce();
    setUpdate(status({ phase: 'up-to-date' }));
    expect(await screen.findByText('You have the latest version.')).toBeInTheDocument();
  });

  it('shows download progress, and Restart to update once it is ready', async () => {
    const user = userEvent.setup();
    const installUpdate = vi.fn(async () => {});
    await openSettings({ installUpdate });
    setUpdate(status({ phase: 'downloading', version: '1.3.0', percent: 40 }));
    expect(await screen.findByText('Downloading Dust 1.3.0, 40%.')).toBeInTheDocument();
    expect(screen.getByRole('progressbar', { name: 'Downloading the update' })).toHaveAttribute('aria-valuenow', '40');
    expect(screen.getByRole('button', { name: 'Check for updates' })).toBeDisabled();

    setUpdate(status({ phase: 'downloaded', version: '1.3.0', percent: 100 }));
    await user.click(await screen.findByRole('button', { name: 'Restart to update' }));
    expect(installUpdate).toHaveBeenCalledOnce();
  });

  it('keeps the technical detail of a failed check out of the way', async () => {
    const user = userEvent.setup();
    await openSettings();
    setUpdate(status({ phase: 'error', message: 'net::ERR_INTERNET_DISCONNECTED' }));
    expect(await screen.findByText(/could not check for updates/)).toBeInTheDocument();
    expect(screen.getByText('net::ERR_INTERNET_DISCONNECTED')).not.toBeVisible();
    await user.click(screen.getByText('Details'));
    expect(screen.getByText('net::ERR_INTERNET_DISCONNECTED')).toBeVisible();
  });
});

describe('Update-ready notice', () => {
  const stops: Array<() => void> = [];
  afterEach(() => {
    for (const stop of stops.splice(0)) stop();
  });

  it('tells the user once, without a dialog, when an update is ready, and can restart', async () => {
    let emit: (value: UpdateStatus) => void = () => {};
    const installUpdate = vi.fn(async () => {});
    const api = makeApi({
      installUpdate,
      onUpdateEvent: (handler) => {
        emit = handler;
        return () => {};
      },
    });
    stops.push(startEvents(api));
    act(() => emit(status({ phase: 'downloading', version: '1.3.0', percent: 50 })));
    expect(useToastStore.getState().toasts).toHaveLength(0);

    act(() => emit(status({ phase: 'downloaded', version: '1.3.0', percent: 100 })));
    const toasts = useToastStore.getState().toasts;
    expect(toasts).toHaveLength(1);
    expect(toasts[0]).toMatchObject({ title: 'Dust 1.3.0 is ready', description: 'Restart Dust to finish updating.' });
    toasts[0]!.action!.onAction();
    expect(installUpdate).toHaveBeenCalledOnce();

    // The same status again is not announced a second time.
    act(() => emit(status({ phase: 'downloaded', version: '1.3.0', percent: 100 })));
    expect(useToastStore.getState().toasts).toHaveLength(1);
  });

  it('shows the notice in the app, and it does not take focus', async () => {
    let emit: (value: UpdateStatus) => void = () => {};
    const api = makeApi({
      onUpdateEvent: (handler) => {
        emit = handler;
        return () => {};
      },
    });
    render(<App api={api} />);
    stops.push(startEvents(api));
    const before = document.activeElement;
    act(() => emit(status({ phase: 'downloaded', version: '1.3.0', percent: 100 })));
    expect(await screen.findByText('Dust 1.3.0 is ready')).toBeInTheDocument();
    expect(document.activeElement).toBe(before);
    await waitFor(() => expect(screen.getByRole('button', { name: 'Restart to update' })).toBeInTheDocument());
  });
});
