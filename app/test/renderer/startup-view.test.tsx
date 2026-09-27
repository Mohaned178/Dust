import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { StartupView } from '../../renderer/src/pages/StartupView';
import type {
  StartupEntry,
  StartupListResult,
  StartupNotice,
  StartupToggleResult,
} from '../../src/shared/ipc';
import { makeApi, makeStartupEntry, makeStartupState } from './fakes';

function renderView(api = makeApi(), notice: StartupNotice | null = null) {
  const onNoticeShown = vi.fn();
  render(<StartupView api={api} notice={notice} onNoticeShown={onNoticeShown} />);
  return { onNoticeShown };
}

async function flush(): Promise<void> {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
}

describe('StartupView', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('sorts both sections alphabetically and shows the stable total', async () => {
    renderView(makeApi({ getStartup: async () => ({ ok: true, state: makeStartupState() }) }));
    await flush();

    expect(screen.getByRole('heading', { name: 'Startup Manager' })).toBeInTheDocument();
    expect(screen.getByText('5')).toBeInTheDocument();
    expect(screen.getByText('entries')).toBeInTheDocument();

    const enabled = screen.getByRole('region', { name: 'Enabled' });
    expect(within(enabled).getByText('3')).toBeInTheDocument();
    expect(
      within(enabled)
        .getAllByRole('listitem')
        .map((item) => item.querySelector('p')?.textContent),
    ).toEqual(['Discord', 'SecurityHealth', 'Steam']);

    const disabled = screen.getByRole('region', { name: 'Disabled' });
    expect(within(disabled).getByText('2')).toBeInTheDocument();
    expect(
      within(disabled)
        .getAllByRole('listitem')
        .map((item) => item.querySelector('p')?.textContent),
    ).toEqual(['OneDrive', 'Slack']);

    expect(screen.queryByText(/impact/i)).toBeNull();
    expect(screen.queryByText(/boot/i)).toBeNull();
  });

  it('shows the disabled empty state', async () => {
    renderView(
      makeApi({
        getStartup: async () => ({
          ok: true,
          state: makeStartupState({ entries: [makeStartupEntry()] }),
        }),
      }),
    );
    await flush();

    const disabled = screen.getByRole('region', { name: 'Disabled' });
    expect(within(disabled).getByText('No disabled entries.')).toBeInTheDocument();
  });

  it('disables a normal entry and offers a five second undo', async () => {
    vi.useFakeTimers();
    const enabled: StartupEntry = makeStartupEntry({ id: 'a1b2c3d4e5f60718', name: 'Discord' });
    const disabled: StartupEntry = { ...enabled, state: 'disabled', disabledKind: 'dust', disabledAt: 1 };
    const disableStartupEntry = vi.fn(
      async (): Promise<StartupToggleResult> => ({
        ok: true,
        state: makeStartupState({ entries: [disabled] }),
      }),
    );
    renderView(
      makeApi({
        getStartup: async () => ({ ok: true, state: makeStartupState({ entries: [enabled] }) }),
        disableStartupEntry,
      }),
    );
    await flush();

    fireEvent.click(screen.getByRole('switch', { name: 'Disable Discord' }));
    await flush();

    expect(disableStartupEntry).toHaveBeenCalledWith('a1b2c3d4e5f60718');
    expect(screen.getByRole('status')).toHaveTextContent('Discord disabled');
    const disabledSection = screen.getByRole('region', { name: 'Disabled' });
    expect(within(disabledSection).getByText('Discord')).toBeInTheDocument();

    act(() => {
      vi.advanceTimersByTime(5000);
    });
    expect(screen.queryByRole('status')).toBeNull();
  });

  it('undoes a disable through enable and announces it', async () => {
    const enabled: StartupEntry = makeStartupEntry({ id: 'a1b2c3d4e5f60718', name: 'Discord' });
    const disabled: StartupEntry = { ...enabled, state: 'disabled', disabledKind: 'dust', disabledAt: 1 };
    let current: StartupListResult = { ok: true, state: makeStartupState({ entries: [enabled] }) };
    const disableStartupEntry = vi.fn(async (): Promise<StartupToggleResult> => {
      current = { ok: true, state: makeStartupState({ entries: [disabled] }) };
      return current as StartupToggleResult;
    });
    const enableStartupEntry = vi.fn(async (): Promise<StartupToggleResult> => {
      current = { ok: true, state: makeStartupState({ entries: [enabled] }) };
      return current as StartupToggleResult;
    });
    renderView(
      makeApi({ getStartup: async () => current, disableStartupEntry, enableStartupEntry }),
    );
    await flush();

    fireEvent.click(screen.getByRole('switch', { name: 'Disable Discord' }));
    await flush();
    fireEvent.click(screen.getByRole('button', { name: 'Undo' }));
    await flush();

    expect(enableStartupEntry).toHaveBeenCalledWith('a1b2c3d4e5f60718');
    expect(screen.getByRole('status')).toHaveTextContent('Discord enabled');
    expect(within(screen.getByRole('region', { name: 'Enabled' })).getByText('Discord')).toBeInTheDocument();
  });

  it('enables a disabled entry with a three second toast and no undo', async () => {
    vi.useFakeTimers();
    const disabled: StartupEntry = makeStartupEntry({
      id: 'a1b2c3d4e5f60718',
      name: 'Discord',
      state: 'disabled',
      disabledKind: 'dust',
      disabledAt: 1,
    });
    const enabled: StartupEntry = { ...disabled, state: 'enabled', disabledKind: null, disabledAt: null };
    const enableStartupEntry = vi.fn(
      async (): Promise<StartupToggleResult> => ({
        ok: true,
        state: makeStartupState({ entries: [enabled] }),
      }),
    );
    renderView(
      makeApi({
        getStartup: async () => ({ ok: true, state: makeStartupState({ entries: [disabled] }) }),
        enableStartupEntry,
      }),
    );
    await flush();

    fireEvent.click(screen.getByRole('switch', { name: 'Enable Discord' }));
    await flush();

    expect(enableStartupEntry).toHaveBeenCalledWith('a1b2c3d4e5f60718');
    expect(screen.getByRole('status')).toHaveTextContent('Discord enabled');
    expect(screen.queryByRole('button', { name: 'Undo' })).toBeNull();

    act(() => {
      vi.advanceTimersByTime(3000);
    });
    expect(screen.queryByRole('status')).toBeNull();
  });

  it('keeps protected entries locked', async () => {
    const disableStartupEntry = vi.fn();
    renderView(
      makeApi({
        getStartup: async () => ({ ok: true, state: makeStartupState() }),
        disableStartupEntry,
      }),
    );
    await flush();

    const protectedSwitch = screen.getByRole('switch', { name: 'SecurityHealth is locked' });
    expect(protectedSwitch).toBeDisabled();
    expect(protectedSwitch).toHaveAttribute('title', 'Protected by Dust. This entry cannot be disabled.');

    fireEvent.click(protectedSwitch);
    expect(disableStartupEntry).not.toHaveBeenCalled();
  });

  it('enables a Windows-disabled entry after confirmation', async () => {
    const oneDrive: StartupEntry = makeStartupEntry({
      id: 'd4e5f607182930a1',
      name: 'OneDrive',
      state: 'disabled',
      disabledKind: 'windows',
    });
    const enabled: StartupEntry = { ...oneDrive, state: 'enabled', disabledKind: null };
    let current: StartupListResult = { ok: true, state: makeStartupState({ entries: [oneDrive] }) };
    const enableStartupEntry = vi.fn(async (): Promise<StartupToggleResult> => {
      current = { ok: true, state: makeStartupState({ entries: [enabled] }) };
      return current as StartupToggleResult;
    });
    renderView(makeApi({ getStartup: async () => current, enableStartupEntry }));
    await flush();

    const windowsSwitch = screen.getByRole('switch', { name: 'Enable OneDrive' });
    expect(windowsSwitch).not.toBeDisabled();
    const tag = screen.getByText('Disabled outside Dust');
    expect(tag).toHaveAttribute('title', 'Turned off in Windows startup settings.');

    fireEvent.click(windowsSwitch);
    expect(screen.getByRole('dialog', { name: 'Turn on startup entry' })).toBeInTheDocument();
    expect(enableStartupEntry).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: 'Turn on' }));
    await flush();

    expect(enableStartupEntry).toHaveBeenCalledWith(oneDrive.id);
    expect(screen.getByRole('status')).toHaveTextContent('Turned on OneDrive — starts at next sign-in.');
    expect(within(screen.getByRole('region', { name: 'Enabled' })).getByText('OneDrive')).toBeInTheDocument();
  });

  it('cancels the Windows enable confirmation without calling the API', async () => {
    const oneDrive: StartupEntry = makeStartupEntry({
      id: 'd4e5f607182930a1',
      name: 'OneDrive',
      state: 'disabled',
      disabledKind: 'windows',
    });
    const enableStartupEntry = vi.fn();
    renderView(
      makeApi({
        getStartup: async () => ({ ok: true, state: makeStartupState({ entries: [oneDrive] }) }),
        enableStartupEntry,
      }),
    );
    await flush();

    fireEvent.click(screen.getByRole('switch', { name: 'Enable OneDrive' }));
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    await flush();

    expect(enableStartupEntry).not.toHaveBeenCalled();
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('surfaces a Windows write failure as a toast and keeps the entry disabled', async () => {
    const oneDrive: StartupEntry = makeStartupEntry({
      id: 'd4e5f607182930a1',
      name: 'OneDrive',
      state: 'disabled',
      disabledKind: 'windows',
    });
    const enableStartupEntry = vi.fn(
      async (): Promise<StartupToggleResult> => ({
        ok: false,
        reason: 'failed',
        message: "Windows didn't allow this change.",
      }),
    );
    renderView(
      makeApi({
        getStartup: async () => ({ ok: true, state: makeStartupState({ entries: [oneDrive] }) }),
        enableStartupEntry,
      }),
    );
    await flush();

    fireEvent.click(screen.getByRole('switch', { name: 'Enable OneDrive' }));
    fireEvent.click(screen.getByRole('button', { name: 'Turn on' }));
    await flush();

    expect(screen.getByRole('status')).toHaveTextContent("Windows didn't allow this change.");
    expect(within(screen.getByRole('region', { name: 'Disabled' })).getByText('OneDrive')).toBeInTheDocument();
  });

  it('routes a machine-wide Windows-disabled entry through the administrator flow', async () => {
    const steam: StartupEntry = makeStartupEntry({
      id: 'b2c3d4e5f6071829',
      name: 'Steam',
      source: 'hklm-run',
      requiresAdmin: true,
      state: 'disabled',
      disabledKind: 'windows',
    });
    const relaunchElevated = vi.fn(async () => {});
    renderView(
      makeApi({
        getStartup: async () => ({ ok: true, state: makeStartupState({ entries: [steam] }) }),
        relaunchElevated,
      }),
    );
    await flush();

    fireEvent.click(screen.getByRole('switch', { name: 'Enable Steam' }));
    const dialog = await screen.findByRole('dialog', { name: 'Turn on startup entry' });
    expect(within(dialog).getByText('This requires administrator rights.')).toBeInTheDocument();

    fireEvent.click(within(dialog).getByRole('button', { name: 'Relaunch and turn on' }));
    await waitFor(() => expect(relaunchElevated).toHaveBeenCalledWith(steam.id, 'enable'));
  });

  it('shows the turn-on copy for the elevated Windows notice', async () => {
    const oneDrive: StartupEntry = makeStartupEntry({
      id: 'd4e5f607182930a1',
      name: 'OneDrive',
      state: 'disabled',
      disabledKind: 'windows',
    });
    renderView(
      makeApi({ getStartup: async () => ({ ok: true, state: makeStartupState({ entries: [oneDrive] }) }) }),
      { entryId: oneDrive.id, name: oneDrive.name, to: 'enabled', disabledKind: 'windows' },
    );
    await flush();

    expect(screen.getByRole('status')).toHaveTextContent('Turned on OneDrive — starts at next sign-in.');
  });

  it('routes machine-wide toggles through the administrator dialog', async () => {
    const steam = makeStartupEntry({
      id: 'b2c3d4e5f6071829',
      name: 'Steam',
      source: 'hklm-run',
      requiresAdmin: true,
      command: '"C:\\Program Files (x86)\\Steam\\steam.exe" -silent',
    });
    const disableStartupEntry = vi.fn();
    const relaunchElevated = vi.fn(async () => {});
    renderView(
      makeApi({
        getStartup: async () => ({ ok: true, state: makeStartupState({ entries: [steam] }) }),
        disableStartupEntry,
        relaunchElevated,
      }),
    );
    await flush();

    fireEvent.click(screen.getByRole('switch', { name: 'Disable Steam' }));
    expect(await screen.findByRole('dialog', { name: 'Administrator required' })).toBeInTheDocument();
    expect(disableStartupEntry).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: 'Relaunch as Administrator' }));
    await waitFor(() => expect(relaunchElevated).toHaveBeenCalledWith(steam.id));
  });

  it('surfaces a refusal as a notice and keeps the entry in place', async () => {
    const discord = makeStartupEntry({ id: 'a1b2c3d4e5f60718', name: 'Discord' });
    renderView(
      makeApi({
        getStartup: async () => ({ ok: true, state: makeStartupState({ entries: [discord] }) }),
        disableStartupEntry: async () => ({
          ok: false,
          reason: 'needs-admin',
          message: 'Dust needs administrator rights to change this entry.',
        }),
      }),
    );
    await flush();

    fireEvent.click(screen.getByRole('switch', { name: 'Disable Discord' }));
    await flush();

    expect(screen.getByRole('alert')).toHaveTextContent('Dust needs administrator rights to change this entry.');
    expect(within(screen.getByRole('region', { name: 'Enabled' })).getByText('Discord')).toBeInTheDocument();
  });

  it('shows every entry on a machine with many of them', async () => {
    const entries = Array.from({ length: 25 }, (_, index) =>
      makeStartupEntry({
        id: index.toString(16).padStart(16, '0'),
        name: `App ${String(index + 1).padStart(2, '0')}`,
      }),
    );
    renderView(
      makeApi({
        getStartup: async () => ({ ok: true, state: makeStartupState({ entries }) }),
      }),
    );
    await flush();

    const header = screen.getByRole('heading', { name: 'Startup Manager' }).parentElement;
    expect(header).toHaveTextContent('25 entries');
    expect(screen.getAllByRole('switch')).toHaveLength(25);
  });

  it('shows the elevated relaunch notice with an undo once', async () => {
    const disabled: StartupEntry = makeStartupEntry({
      id: 'a1b2c3d4e5f60718',
      name: 'Discord',
      state: 'disabled',
      disabledKind: 'dust',
      disabledAt: 1,
    });
    const api = makeApi({
      getStartup: async () => ({ ok: true, state: makeStartupState({ entries: [disabled] }) }),
    });
    const { onNoticeShown } = renderView(api, {
      entryId: disabled.id,
      name: disabled.name,
      to: 'disabled',
    });
    await flush();

    expect(screen.getByRole('status')).toHaveTextContent('Discord disabled');
    expect(screen.getByRole('button', { name: 'Undo' })).toBeInTheDocument();
    expect(onNoticeShown).toHaveBeenCalledTimes(1);
  });
});
