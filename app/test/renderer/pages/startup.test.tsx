import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { App } from '../../../renderer/src/app/App';
import { useNavStore } from '../../../renderer/src/app/nav';
import { useStartupStore } from '../../../renderer/src/stores/startup';
import type {
  DustApi,
  StartupEntry,
  StartupListResult,
  StartupListState,
  StartupNotice,
  StartupToggleResult,
} from '../../../src/shared/ipc';
import { makeApi, makeStartupState } from '../../renderer/fakes';

const DISCORD = 'a1b2c3d4e5f60718';
const STEAM = 'b2c3d4e5f6071829';
const SLACK = 'c3d4e5f607182930';
const ONEDRIVE = 'd4e5f607182930a1';

const withCounts = (entries: StartupEntry[]): StartupListState => ({
  entries,
  counts: {
    total: entries.length,
    enabled: entries.filter((entry) => entry.state === 'enabled').length,
    disabled: entries.filter((entry) => entry.state === 'disabled').length,
  },
  loadedAt: 1,
});

/** The state a toggle returns: the same list with one entry changed. */
function after(id: string, patch: Partial<StartupEntry>): StartupListState {
  const base = makeStartupState();
  return withCounts(base.entries.map((entry) => (entry.id === id ? { ...entry, ...patch } : entry)));
}

async function openStartup(overrides: Partial<DustApi> = {}, notice?: StartupNotice) {
  const api = makeApi({ getStartup: async () => ({ ok: true, state: makeStartupState() }), ...overrides });
  render(<App api={api} />);
  act(() => {
    if (notice === undefined) useNavStore.getState().navigate('startup');
    else useNavStore.getState().navigate('startup', { notice });
  });
  // A dialog opened at once hides the page from the accessibility tree.
  await screen.findByRole('heading', { level: 1, name: 'Startup', hidden: true });
  return api;
}

const names = () =>
  within(screen.getByRole('list', { name: 'Startup apps' }))
    .getAllByRole('listitem')
    .map((item) => item.querySelector('p')?.textContent);
const toggle = (name: string) => screen.getByRole('switch', { name });

describe('Startup list', () => {
  it('lists every entry by name with where it starts from, and a summary that does not score anything', async () => {
    await openStartup();
    await screen.findByRole('list', { name: 'Startup apps' });
    expect(names()).toEqual(['Discord', 'OneDrive', 'SecurityHealth', 'Slack', 'Steam']);
    expect(screen.getByText('5 apps start with Windows · 3 on')).toBeInTheDocument();
    expect(screen.getAllByText('Registry · this user')).toHaveLength(5);
    expect(screen.getByText('Valve Corporation')).toBeInTheDocument();
    expect(screen.getByText('Turned off in Windows settings')).toBeInTheDocument();
    // No impact figures and no verdicts until the backend provides them.
    expect(screen.queryByText(/impact|boot|safe to turn off/i)).toBeNull();
  });

  it('filters to what is on or off', async () => {
    const user = userEvent.setup();
    await openStartup();
    await screen.findByRole('list', { name: 'Startup apps' });
    await user.click(screen.getByRole('radio', { name: 'On' }));
    expect(names()).toEqual(['Discord', 'SecurityHealth', 'Steam']);
    await user.click(screen.getByRole('radio', { name: 'Off' }));
    expect(names()).toEqual(['OneDrive', 'Slack']);
    await user.click(screen.getByRole('radio', { name: 'All' }));
    expect(names()).toHaveLength(5);
  });

  it('shows a locked row with its reason, and does not let it move', async () => {
    const user = userEvent.setup();
    const disableStartupEntry = vi.fn<DustApi['disableStartupEntry']>();
    await openStartup({ disableStartupEntry });
    await screen.findByRole('list', { name: 'Startup apps' });
    const locked = screen.getByRole('switch', { name: 'SecurityHealth is locked' });
    expect(locked).toBeDisabled();
    expect(screen.getByText('Dust protects this entry, so it cannot be turned off.')).toBeInTheDocument();
    await user.click(locked);
    expect(disableStartupEntry).not.toHaveBeenCalled();
  });

  it('shows publishers and icons that arrive later, without losing anything the backend sent', async () => {
    const entries = makeStartupState().entries.map((entry) =>
      entry.id === STEAM ? { ...entry, publisher: null } : entry,
    );
    await openStartup({ getStartup: async () => ({ ok: true, state: withCounts(entries) }) });
    await screen.findByRole('list', { name: 'Startup apps' });
    expect(screen.queryByText('Valve Corporation')).not.toBeInTheDocument();
    act(() => {
      useStartupStore
        .getState()
        .mergeDetails(
          new Map([[STEAM, { publisher: 'Valve Corporation', iconDataUrl: 'data:image/png;base64,AAAA' }]]),
        );
    });
    expect(await screen.findByText('Valve Corporation')).toBeInTheDocument();
    expect(document.querySelectorAll('img[src^="data:image"]')).toHaveLength(1);
  });

  it('says so when nothing starts with Windows, and retries a failed read', async () => {
    const user = userEvent.setup();
    const getStartup = vi
      .fn<DustApi['getStartup']>()
      .mockResolvedValueOnce({ ok: false, message: 'boom' })
      .mockResolvedValue({ ok: true, state: withCounts([]) });
    await openStartup({ getStartup });
    await user.click(await screen.findByRole('button', { name: 'Try again' }));
    expect(await screen.findByText('No apps start with Windows')).toBeInTheDocument();
  });

  it('keeps the last list when a refresh fails', async () => {
    const getStartup = vi
      .fn<DustApi['getStartup']>()
      .mockResolvedValueOnce({ ok: true, state: makeStartupState() })
      .mockResolvedValue({ ok: false, message: 'later' } as StartupListResult);
    await openStartup({ getStartup });
    await screen.findByRole('list', { name: 'Startup apps' });
    // Leaving and coming back reads the list again.
    act(() => useNavStore.getState().navigate('home'));
    act(() => useNavStore.getState().navigate('startup'));
    expect(await screen.findByText(/Dust could not refresh the list/)).toBeInTheDocument();
    expect(names()).toHaveLength(5);
  });
});

describe('Turning an entry off and on', () => {
  it('moves the switch at once, then confirms with a toast that can undo it', async () => {
    const user = userEvent.setup();
    let answer: (result: StartupToggleResult) => void = () => {};
    const disableStartupEntry = vi.fn<DustApi['disableStartupEntry']>(
      () => new Promise((resolve) => (answer = resolve)),
    );
    const enableStartupEntry = vi.fn<DustApi['enableStartupEntry']>(async () => ({
      ok: true,
      state: makeStartupState(),
    }));
    await openStartup({ disableStartupEntry, enableStartupEntry });
    await screen.findByRole('list', { name: 'Startup apps' });

    await user.click(toggle('Turn off Discord'));
    // Before the backend has answered: already off, and the count follows.
    expect(screen.getByRole('switch', { name: 'Turn on Discord' })).toHaveAttribute('aria-checked', 'false');
    expect(screen.getByText('5 apps start with Windows · 2 on')).toBeInTheDocument();
    expect(screen.getByRole('switch', { name: 'Turn on Discord' })).toBeDisabled();

    await act(async () => answer({ ok: true, state: after(DISCORD, { state: 'disabled', disabledKind: 'dust' }) }));
    expect(await screen.findByText('Discord turned off')).toBeInTheDocument();
    expect(screen.getByText('It will not start with Windows.')).toBeInTheDocument();
    expect(disableStartupEntry).toHaveBeenCalledWith(DISCORD);

    await user.click(screen.getByRole('button', { name: 'Undo' }));
    await waitFor(() => expect(enableStartupEntry).toHaveBeenCalledWith(DISCORD));
    expect(await screen.findByText('Discord turned on')).toBeInTheDocument();
    expect(screen.getByRole('switch', { name: 'Turn off Discord' })).toHaveAttribute('aria-checked', 'true');
  });

  it('turns an entry that Dust turned off back on', async () => {
    const user = userEvent.setup();
    const enableStartupEntry = vi.fn<DustApi['enableStartupEntry']>(async () => ({
      ok: true,
      state: after(SLACK, { state: 'enabled', disabledKind: null }),
    }));
    await openStartup({ enableStartupEntry });
    await screen.findByRole('list', { name: 'Startup apps' });
    await user.click(toggle('Turn on Slack'));
    expect(await screen.findByText('Slack turned on')).toBeInTheDocument();
    expect(screen.getByText('5 apps start with Windows · 4 on')).toBeInTheDocument();
  });

  it.each([
    ['failed', '', 'Windows did not allow this change.'],
    [
      'protected',
      'Dust protects this entry, so it cannot be turned off.',
      'Dust protects this entry, so it cannot be turned off.',
    ],
  ] as const)(
    'puts the switch back and says why when the backend refuses (%s)',
    async (reason, backendMessage, shown) => {
      const user = userEvent.setup();
      await openStartup({ disableStartupEntry: async () => ({ ok: false, reason, message: backendMessage }) });
      await screen.findByRole('list', { name: 'Startup apps' });
      await user.click(toggle('Turn off Steam'));
      expect(await screen.findByText(shown, { selector: '[role=status] p' })).toBeInTheDocument();
      expect(toggle('Turn off Steam')).toHaveAttribute('aria-checked', 'true');
      expect(screen.getByText('5 apps start with Windows · 3 on')).toBeInTheDocument();
    },
  );

  it('reads the list again when the entry is gone or was changed by someone else', async () => {
    const user = userEvent.setup();
    const getStartup = vi.fn<DustApi['getStartup']>(async () => ({ ok: true, state: makeStartupState() }));
    const disableStartupEntry = vi.fn<DustApi['disableStartupEntry']>(async () => ({
      ok: false,
      reason: 'not-found',
      message: 'gone',
    }));
    await openStartup({ getStartup, disableStartupEntry });
    await screen.findByRole('list', { name: 'Startup apps' });
    await user.click(toggle('Turn off Steam'));
    expect(await screen.findByText('That entry is gone. The list was refreshed.')).toBeInTheDocument();
    await waitFor(() => expect(getStartup.mock.calls.length).toBeGreaterThan(1));

    disableStartupEntry.mockResolvedValueOnce({ ok: false, reason: 'conflict', message: 'changed' });
    await user.click(toggle('Turn off Steam'));
    expect(
      await screen.findByText('Windows or another app changed this entry. The list was refreshed.'),
    ).toBeInTheDocument();
  });

  it('asks for administrator rights when the backend says the entry needs them', async () => {
    const user = userEvent.setup();
    const relaunchElevated = vi.fn(async () => {});
    await openStartup({
      disableStartupEntry: async () => ({ ok: false, reason: 'needs-admin', message: 'admin' }),
      relaunchElevated,
    });
    await screen.findByRole('list', { name: 'Startup apps' });
    await user.click(toggle('Turn off Steam'));
    const dialog = await screen.findByRole('dialog', { name: 'Administrator rights needed' });
    expect(screen.getByRole('switch', { name: 'Turn off Steam', hidden: true })).toHaveAttribute(
      'aria-checked',
      'true',
    );
    await user.click(within(dialog).getByRole('button', { name: 'Relaunch as administrator' }));
    expect(relaunchElevated).toHaveBeenCalledWith(STEAM);
  });

  it('opens the turn-on question when Windows says the entry is turned off in its own settings', async () => {
    const user = userEvent.setup();
    await openStartup({ disableStartupEntry: async () => ({ ok: false, reason: 'windows-disabled', message: 'w' }) });
    await screen.findByRole('list', { name: 'Startup apps' });
    await user.click(toggle('Turn off Steam'));
    expect(await screen.findByRole('dialog', { name: 'Turn on Steam?' })).toBeInTheDocument();
  });

  it('puts the switch back when the call itself throws', async () => {
    const user = userEvent.setup();
    await openStartup({
      disableStartupEntry: async () => {
        throw new Error('ipc down');
      },
    });
    await screen.findByRole('list', { name: 'Startup apps' });
    await user.click(toggle('Turn off Steam'));
    expect(await screen.findByText('Windows did not allow this change.')).toBeInTheDocument();
    expect(toggle('Turn off Steam')).toHaveAttribute('aria-checked', 'true');
  });
});

describe('Administrator and Windows-disabled entries', () => {
  const adminEntries = () =>
    makeStartupState().entries.map((entry) =>
      entry.id === STEAM
        ? { ...entry, requiresAdmin: true }
        : entry.id === ONEDRIVE
          ? { ...entry, requiresAdmin: true }
          : entry,
    );

  it('asks first for an entry that belongs to every user, focusing Cancel, and relaunches on request', async () => {
    const user = userEvent.setup();
    const relaunchElevated = vi.fn(async () => {});
    const disableStartupEntry = vi.fn<DustApi['disableStartupEntry']>();
    await openStartup({
      getStartup: async () => ({ ok: true, state: withCounts(adminEntries()) }),
      relaunchElevated,
      disableStartupEntry,
    });
    await screen.findByRole('list', { name: 'Startup apps' });
    expect(screen.getAllByText('Needs administrator rights')).toHaveLength(2);
    await user.click(toggle('Turn off Steam'));
    const dialog = await screen.findByRole('dialog', { name: 'Administrator rights needed' });
    expect(within(dialog).getByRole('button', { name: 'Cancel' })).toHaveFocus();
    expect(disableStartupEntry).not.toHaveBeenCalled();
    await user.click(within(dialog).getByRole('button', { name: 'Relaunch as administrator' }));
    expect(relaunchElevated).toHaveBeenCalledWith(STEAM);
  });

  it('says so, and stays open, when Windows refuses the relaunch', async () => {
    const user = userEvent.setup();
    await openStartup({
      getStartup: async () => ({ ok: true, state: withCounts(adminEntries()) }),
      relaunchElevated: async () => {
        throw new Error('no');
      },
    });
    await screen.findByRole('list', { name: 'Startup apps' });
    await user.click(toggle('Turn off Steam'));
    const dialog = await screen.findByRole('dialog');
    await user.click(within(dialog).getByRole('button', { name: 'Relaunch as administrator' }));
    expect(await within(dialog).findByText(/could not restart with administrator rights/)).toBeInTheDocument();
    await user.click(within(dialog).getByRole('button', { name: 'Cancel' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  });

  it('turns on an entry that was switched off in Windows, after asking', async () => {
    const user = userEvent.setup();
    const enableStartupEntry = vi.fn<DustApi['enableStartupEntry']>(async () => ({
      ok: true,
      state: after(ONEDRIVE, { state: 'enabled', disabledKind: null }),
    }));
    await openStartup({ enableStartupEntry });
    await screen.findByRole('list', { name: 'Startup apps' });
    await user.click(toggle('Turn on OneDrive'));
    const dialog = await screen.findByRole('dialog', { name: 'Turn on OneDrive?' });
    expect(within(dialog).getByRole('button', { name: 'Cancel' })).toHaveFocus();
    expect(enableStartupEntry).not.toHaveBeenCalled();
    await user.click(within(dialog).getByRole('button', { name: 'Turn on' }));
    expect(await screen.findByText('OneDrive turned on')).toBeInTheDocument();
    expect(screen.getByText('It starts at your next sign-in.')).toBeInTheDocument();
    expect(enableStartupEntry).toHaveBeenCalledWith(ONEDRIVE);
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  });

  it('keeps the question open with a plain message when Windows will not allow it', async () => {
    const user = userEvent.setup();
    await openStartup({ enableStartupEntry: async () => ({ ok: false, reason: 'failed', message: 'x' }) });
    await screen.findByRole('list', { name: 'Startup apps' });
    await user.click(toggle('Turn on OneDrive'));
    const dialog = await screen.findByRole('dialog');
    await user.click(within(dialog).getByRole('button', { name: 'Turn on' }));
    expect(await within(dialog).findByText('Windows did not allow this change.')).toBeInTheDocument();
  });

  it('relaunches to turn on a Windows-disabled entry that needs administrator rights', async () => {
    const user = userEvent.setup();
    const relaunchElevated = vi.fn(async () => {});
    await openStartup({
      getStartup: async () => ({ ok: true, state: withCounts(adminEntries()) }),
      relaunchElevated,
    });
    await screen.findByRole('list', { name: 'Startup apps' });
    await user.click(toggle('Turn on OneDrive'));
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByText(/Dust will restart first/)).toBeInTheDocument();
    await user.click(within(dialog).getByRole('button', { name: 'Relaunch and turn on' }));
    expect(relaunchElevated).toHaveBeenCalledWith(ONEDRIVE, 'enable');
  });

  it('does nothing when a Windows-disabled entry is switched off again', async () => {
    const disable = vi.fn<DustApi['disableStartupEntry']>();
    await openStartup({ disableStartupEntry: disable });
    await screen.findByRole('list', { name: 'Startup apps' });
    // OneDrive is off, so the only move is on. Cancelling the question changes nothing.
    const user = userEvent.setup();
    await user.click(toggle('Turn on OneDrive'));
    await user.click(await screen.findByRole('button', { name: 'Cancel' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(toggle('Turn on OneDrive')).toHaveAttribute('aria-checked', 'false');
    expect(disable).not.toHaveBeenCalled();
  });
});

describe('After Dust relaunched as administrator', () => {
  it('says what was turned off, once, with Undo, and forgets the hint', async () => {
    const user = userEvent.setup();
    const enableStartupEntry = vi.fn<DustApi['enableStartupEntry']>(async () => ({
      ok: true,
      state: makeStartupState(),
    }));
    await openStartup({ enableStartupEntry }, { entryId: STEAM, name: 'Steam', to: 'disabled' });
    expect(await screen.findByText('Steam turned off')).toBeInTheDocument();
    expect(useNavStore.getState().params.startup).toBeUndefined();
    await user.click(screen.getByRole('button', { name: 'Undo' }));
    await waitFor(() => expect(enableStartupEntry).toHaveBeenCalledWith(STEAM));
  });

  it('says what was turned on, and that a Windows-disabled entry starts at the next sign-in', async () => {
    await openStartup({}, { entryId: ONEDRIVE, name: 'OneDrive', to: 'enabled', disabledKind: 'windows' });
    expect(await screen.findByText('OneDrive turned on')).toBeInTheDocument();
    expect(screen.getByText('It starts at your next sign-in.')).toBeInTheDocument();
  });

  it('says what was turned on', async () => {
    await openStartup({}, { entryId: SLACK, name: 'Slack', to: 'enabled' });
    expect(await screen.findByText('Slack turned on')).toBeInTheDocument();
  });
});
