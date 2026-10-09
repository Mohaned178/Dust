import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { App } from '../../../renderer-next/src/app/App';
import { useNavStore } from '../../../renderer-next/src/app/nav';
import { setRowRenderProbe } from '../../../renderer-next/src/lib/renderProbe';
import { emptyJob, useAppsStore } from '../../../renderer-next/src/stores/apps';
import type { DustApi, UninstallAppSummary, UninstallLaunchHint, UninstallListResult } from '../../../src/shared/ipc';
import {
  makeApi,
  makeRemovalReport,
  makeUninstallApp,
  makeUninstallItem,
  makeUninstallPreview,
} from '../../renderer/fakes';

const MB = 1024 ** 2;

const SPOTIFY = makeUninstallApp({ iconDataUrl: null });
const OFFICE = makeUninstallApp({
  id: 'app-2',
  displayName: 'Office',
  publisher: 'Microsoft Corporation',
  hive: 'hklm',
  kind: 'msi',
  requiresAdmin: true,
  caution: 'runtime',
  estimatedSizeKb: 4096,
});
const ORPHAN = makeUninstallApp({
  id: 'app-3',
  displayName: 'Orphan',
  publisher: '',
  hasUninstaller: false,
  estimatedSizeKb: 512,
});

function list(apps: UninstallAppSummary[], extra: { elevated?: boolean } = {}): DustApi['listUninstallApps'] {
  return async () => ({ ok: true, trusted: true, elevated: extra.elevated ?? false, loadedAt: 1, apps });
}

function setup(overrides: Partial<DustApi> = {}) {
  const api = makeApi({ listUninstallApps: list([SPOTIFY, OFFICE, ORPHAN]), ...overrides });
  render(<App api={api} />);
  return api;
}

async function openApps(api?: DustApi, hint?: UninstallLaunchHint) {
  const target = api ?? setup();
  if (api !== undefined) render(<App api={api} />);
  act(() => {
    if (hint === undefined) useNavStore.getState().navigate('apps');
    else useNavStore.getState().navigate('apps', { hint });
  });
  // A dialog opened at once (an adopted removal) hides the rest of the page from the accessibility tree.
  await screen.findByRole('heading', { level: 1, name: 'Apps', hidden: true });
  return target;
}

const rowNames = () =>
  [...document.querySelectorAll('[role=listitem] p.font-semibold')].map((node) => node.textContent);

const sizeMap = (entries: Array<[string, number]>) => new Map(entries);
function stream(sizes: Array<[string, number]> = [], icons: Array<[string, string]> = []) {
  act(() => {
    useAppsStore.getState().applyBatch({ sizes: sizeMap(sizes), icons: new Map(icons), jobs: new Map() });
  });
}

afterEach(() => {
  setRowRenderProbe(null);
});

describe('Apps list', () => {
  it('lists the apps with the total, badges, and filters by name or publisher', async () => {
    const user = userEvent.setup();
    await openApps();
    await waitFor(() => expect(rowNames()).toHaveLength(3));
    expect(rowNames()).toEqual(['Office', 'Orphan', 'Spotify']);
    expect(screen.getByText(/3 apps/)).toHaveTextContent('3 apps · 6.5 MB');
    expect(screen.getByText('Runtime')).toBeInTheDocument();
    expect(screen.getByText('Leftovers only')).toBeInTheDocument();
    expect(screen.getByText('Needs administrator')).toBeInTheDocument();
    expect(screen.getByText(/^Unknown publisher/)).toBeInTheDocument();

    await user.type(screen.getByRole('searchbox', { name: 'Search apps' }), 'microsoft');
    await waitFor(() => expect(rowNames()).toEqual(['Office']));
    await user.clear(screen.getByRole('searchbox', { name: 'Search apps' }));
    await user.type(screen.getByRole('searchbox', { name: 'Search apps' }), 'zzz');
    expect(await screen.findByText('No apps match this search')).toBeInTheDocument();
  });

  it('shows measured sizes, icons and fallback letters as they arrive', async () => {
    await openApps();
    await waitFor(() => expect(rowNames()).toHaveLength(3));
    expect(screen.getByText('2.0 MB')).toBeInTheDocument();
    stream([['app-1', 12 * MB]], [['app-1', 'data:image/png;base64,AAAA']]);
    expect(await screen.findByText('12 MB')).toBeInTheDocument();
    expect(document.querySelectorAll('img[src^="data:image"]')).toHaveLength(1);
    // The others show a letter tile.
    const office = screen.getByText('Office').closest('[role=listitem]')!;
    expect(within(office as HTMLElement).getByText('O')).toBeInTheDocument();
  });

  it('falls back to the letter when an icon cannot be drawn', async () => {
    await openApps();
    await waitFor(() => expect(rowNames()).toHaveLength(3));
    stream([], [['app-1', 'data:image/png;base64,BROKEN']]);
    const image = await waitFor(() => {
      const found = document.querySelector('img[src^="data:image"]');
      expect(found).not.toBeNull();
      return found!;
    });
    act(() => {
      image.dispatchEvent(new Event('error'));
    });
    const spotify = screen.getByText('Spotify').closest('[role=listitem]')! as HTMLElement;
    expect(await within(spotify).findByText('S')).toBeInTheDocument();
  });

  it('keeps the order while sizes stream in, and offers to sort again', async () => {
    const user = userEvent.setup();
    await openApps();
    await waitFor(() => expect(rowNames()).toHaveLength(3));
    await user.click(screen.getByRole('radio', { name: 'Size' }));
    // Estimated sizes: Office 4 MB, Spotify 2 MB, Orphan 0.5 MB.
    expect(rowNames()).toEqual(['Office', 'Spotify', 'Orphan']);

    stream([['app-3', 900 * MB]]);
    // The measured size shows, but nothing moved.
    expect(await screen.findByText('900 MB')).toBeInTheDocument();
    expect(rowNames()).toEqual(['Office', 'Spotify', 'Orphan']);
    await user.click(screen.getByRole('button', { name: 'Sizes updated. Sort again' }));
    expect(rowNames()).toEqual(['Orphan', 'Office', 'Spotify']);
    expect(screen.queryByRole('button', { name: 'Sizes updated. Sort again' })).not.toBeInTheDocument();
  });

  it('retries a failed read, and keeps showing the last list if a refresh fails', async () => {
    const user = userEvent.setup();
    const listUninstallApps = vi
      .fn<DustApi['listUninstallApps']>()
      .mockResolvedValueOnce({ ok: false, message: 'boom' })
      .mockResolvedValue({ ok: true, trusted: true, elevated: false, loadedAt: 1, apps: [SPOTIFY] });
    await openApps(makeApi({ listUninstallApps }));
    await user.click(await screen.findByRole('button', { name: 'Try again' }));
    await waitFor(() => expect(rowNames()).toEqual(['Spotify']));

    listUninstallApps.mockRejectedValueOnce(new Error('later'));
    await user.click(screen.getByRole('button', { name: 'Refresh' }));
    expect(await screen.findByText(/Dust could not refresh the list/)).toBeInTheDocument();
    expect(rowNames()).toEqual(['Spotify']);
  });

  it('says so when the list from Windows cannot be trusted', async () => {
    await openApps(
      makeApi({
        listUninstallApps: async (): Promise<UninstallListResult> => ({
          ok: true,
          trusted: false,
          elevated: false,
          loadedAt: 1,
          apps: [],
        }),
      }),
    );
    expect(await screen.findByText('Dust could not read your installed apps')).toBeInTheDocument();
  });
});

describe('Apps list: streaming data', () => {
  it('does not redraw any row when sizes and icons arrive for 300 apps', async () => {
    const many = Array.from({ length: 300 }, (_, index) =>
      makeUninstallApp({ id: `a${index}`, displayName: `App ${String(index).padStart(3, '0')}`, estimatedSizeKb: 100 }),
    );
    await openApps(makeApi({ listUninstallApps: list(many) }));
    await waitFor(() => expect(rowNames()).toHaveLength(300), { timeout: 10_000 });

    const renders = new Map<string, number>();
    setRowRenderProbe((id) => renders.set(id, (renders.get(id) ?? 0) + 1));
    // Three waves, as the backend sends them: every app gets a size and an icon.
    for (let wave = 0; wave < 3; wave += 1) {
      stream(
        many.slice(wave * 100, wave * 100 + 100).map((app, index): [string, number] => [app.id, (index + 1) * MB]),
        many.slice(wave * 100, wave * 100 + 100).map((app): [string, string] => [app.id, 'data:image/png;base64,AAAA']),
      );
    }
    await waitFor(() => expect(document.querySelectorAll('img[src^="data:image"]')).toHaveLength(300));
    expect(screen.getAllByText('100 MB')).toHaveLength(3);
    // Not one row body ran again; only each row's own size and icon changed.
    expect([...renders.values()].reduce((sum, count) => sum + count, 0)).toBe(0);
  }, 30_000);
});

describe('Uninstall wizard', () => {
  const items = [
    makeUninstallItem({
      id: 'file-local',
      kind: 'file',
      label: 'Local data',
      dataClass: 'app-data',
      bytes: MB,
      defaultSelected: true,
      target: 'C:\\Users\\x\\AppData\\Local\\Spotify',
    }),
    makeUninstallItem({
      id: 'file-user',
      kind: 'file',
      label: 'Saved playlists',
      dataClass: 'user-data',
      bytes: 2 * MB,
      target: 'C:\\Users\\x\\Documents\\Spotify',
    }),
    makeUninstallItem({
      id: 'reg-vendor',
      kind: 'registry',
      grade: 'review',
      label: 'Vendor key',
      target: 'HKCU\\Software\\Spotify',
    }),
    makeUninstallItem({
      id: 'reg-uninstall',
      kind: 'registry',
      label: 'Uninstall key',
      defaultSelected: true,
      target: 'HKCU\\Software\\Uninstall\\Spotify',
    }),
  ];
  const preview = makeUninstallPreview({ items });

  function wizardApi(overrides: Partial<DustApi> = {}) {
    return makeApi({
      listUninstallApps: list([SPOTIFY]),
      runUninstaller: async () => ({
        ok: true,
        outcome: {
          ran: true,
          exitCode: 0,
          verifiedGone: true,
          rebootRequired: false,
          skippedWaiting: false,
          skippedReason: null,
        },
      }),
      previewUninstall: async () => ({ ok: true, preview }),
      executeUninstall: async () => ({
        ok: true,
        report: makeRemovalReport({
          files: { ...makeRemovalReport().files, deletedItems: 1, deletedBytes: MB, recycledItems: 0 },
        }),
      }),
      ...overrides,
    });
  }

  async function startWizard(api: DustApi) {
    const user = userEvent.setup();
    await openApps(api);
    await user.click(await screen.findByRole('button', { name: 'Uninstall Spotify' }));
    const dialog = await screen.findByRole('dialog', { name: 'Uninstall Spotify' });
    return { user, dialog };
  }

  it('explains the steps first, focuses Cancel, and does nothing until asked', async () => {
    const runUninstaller = vi.fn<DustApi['runUninstaller']>();
    const { user, dialog } = await startWizard(wizardApi({ runUninstaller }));
    expect(within(dialog).getByText("Run the app's own uninstaller")).toBeInTheDocument();
    expect(within(dialog).getByRole('button', { name: 'Cancel' })).toHaveFocus();
    await user.click(within(dialog).getByRole('button', { name: 'Cancel' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(runUninstaller).not.toHaveBeenCalled();
  });

  it('runs the uninstaller, reviews the leftovers, removes the chosen ones, and refreshes the list', async () => {
    const executeUninstall = vi.fn<DustApi['executeUninstall']>(async () => ({
      ok: true,
      report: makeRemovalReport({
        files: { ...makeRemovalReport().files, deletedItems: 1, deletedBytes: MB, recycledItems: 0 },
      }),
    }));
    const listUninstallApps = vi.fn(list([SPOTIFY]));
    const api = wizardApi({ executeUninstall, listUninstallApps });
    const { user, dialog } = await startWizard(api);
    await user.click(within(dialog).getByRole('button', { name: 'Uninstall' }));

    expect(await within(dialog).findByText(/Spotify left these behind/)).toBeInTheDocument();
    // Safe items start ticked; review items and user data do not.
    expect(within(dialog).getByRole('checkbox', { name: 'Select Local data' })).toBeChecked();
    expect(within(dialog).getByRole('checkbox', { name: 'Select Uninstall key' })).toBeChecked();
    expect(within(dialog).getByRole('checkbox', { name: 'Select Vendor key' })).not.toBeChecked();
    expect(within(dialog).getByRole('checkbox', { name: 'Select Saved playlists' })).not.toBeChecked();
    expect(within(dialog).getByRole('button', { name: 'Keep everything' })).toHaveFocus();

    // The user opts in to the review item; it is acknowledged, and the amount is on the button.
    await user.click(within(dialog).getByRole('checkbox', { name: 'Select Vendor key' }));
    await user.click(within(dialog).getByRole('button', { name: 'Remove 1.0 MB' }));

    expect(await within(dialog).findByText(/Spotify is removed, and 1\.0 MB of leftovers freed/)).toBeInTheDocument();
    expect(executeUninstall).toHaveBeenCalledOnce();
    expect(executeUninstall.mock.calls[0]![0]).toMatchObject({
      planId: 'plan-1',
      selection: ['file-local', 'reg-vendor', 'reg-uninstall'],
      includeUserData: false,
      runUninstaller: false,
      acknowledge: ['reg-vendor'],
    });
    // The list was read again as soon as the app was changed.
    expect(listUninstallApps.mock.calls.length).toBeGreaterThan(1);
    await user.click(within(dialog).getByRole('button', { name: 'Done' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  });

  it('selects and clears each group on its own, and includes user data only when ticked', async () => {
    const executeUninstall = vi.fn<DustApi['executeUninstall']>(async () => ({
      ok: true,
      report: makeRemovalReport(),
    }));
    const { user, dialog } = await startWizard(wizardApi({ executeUninstall }));
    await user.click(within(dialog).getByRole('button', { name: 'Uninstall' }));
    await within(dialog).findByText(/left these behind/);

    await user.click(within(dialog).getByRole('button', { name: 'Select none of registry entries' }));
    expect(within(dialog).getByRole('checkbox', { name: 'Select Uninstall key' })).not.toBeChecked();
    expect(within(dialog).getByRole('checkbox', { name: 'Select Local data' })).toBeChecked();
    await user.click(within(dialog).getByRole('button', { name: 'Select all files and folders' }));
    expect(within(dialog).getByRole('checkbox', { name: 'Select Saved playlists' })).toBeChecked();
    expect(within(dialog).getByText(/includes your data/)).toBeInTheDocument();

    await user.click(within(dialog).getByRole('button', { name: /^Remove / }));
    await waitFor(() => expect(executeUninstall).toHaveBeenCalled());
    expect(executeUninstall.mock.calls[0]![0]).toMatchObject({
      selection: ['file-local', 'file-user'],
      includeUserData: true,
      acknowledge: [],
    });
  });

  it('says the app is still installed when the uninstaller left it registered, and goes on to leftovers on request', async () => {
    const api = wizardApi({
      runUninstaller: async () => ({
        ok: true,
        outcome: {
          ran: true,
          exitCode: 1,
          verifiedGone: false,
          rebootRequired: false,
          skippedWaiting: false,
          skippedReason: null,
        },
      }),
    });
    const { user, dialog } = await startWizard(api);
    await user.click(within(dialog).getByRole('button', { name: 'Uninstall' }));
    expect(await within(dialog).findByText(/the app is still registered/)).toBeInTheDocument();
    await user.click(within(dialog).getByRole('button', { name: 'Look for leftovers' }));
    expect(await within(dialog).findByText(/Spotify left these behind/)).toBeInTheDocument();
  });

  it('asks for a restart when the uninstaller needs one', async () => {
    const api = wizardApi({
      runUninstaller: async () => ({
        ok: true,
        outcome: {
          ran: true,
          exitCode: 3010,
          verifiedGone: false,
          rebootRequired: true,
          skippedWaiting: false,
          skippedReason: null,
        },
      }),
    });
    const { user, dialog } = await startWizard(api);
    await user.click(within(dialog).getByRole('button', { name: 'Uninstall' }));
    expect(await within(dialog).findByText(/needs a restart/)).toBeInTheDocument();
  });

  it('goes straight to the leftover scan for an app with no uninstaller, and claims only leftovers', async () => {
    const user = userEvent.setup();
    const previewUninstall = vi.fn<DustApi['previewUninstall']>(async () => ({ ok: true, preview }));
    const runUninstaller = vi.fn<DustApi['runUninstaller']>();
    await openApps(makeApi({ listUninstallApps: list([ORPHAN]), previewUninstall, runUninstaller }));
    await user.click(await screen.findByRole('button', { name: 'Uninstall Orphan' }));
    const dialog = await screen.findByRole('dialog');
    expect(await within(dialog).findByText(/Orphan left these behind/)).toBeInTheDocument();
    expect(previewUninstall).toHaveBeenCalledWith('app-3', { leftoversOnly: true });
    expect(runUninstaller).not.toHaveBeenCalled();
  });

  it('says nothing was left behind when there is nothing to remove', async () => {
    const empty = makeUninstallPreview({ items: [] });
    const { user, dialog } = await startWizard(
      wizardApi({ previewUninstall: async () => ({ ok: true, preview: empty }) }),
    );
    await user.click(within(dialog).getByRole('button', { name: 'Uninstall' }));
    expect(await within(dialog).findByText('Nothing left behind')).toBeInTheDocument();
    expect(within(dialog).getByText('Spotify is fully removed.')).toBeInTheDocument();
  });

  it('cannot be dismissed while the uninstaller runs or leftovers are removed', async () => {
    let finishRun: () => void = () => {};
    const runUninstaller = vi.fn<DustApi['runUninstaller']>(
      () =>
        new Promise((resolve) => {
          finishRun = () =>
            resolve({
              ok: true,
              outcome: {
                ran: true,
                exitCode: 0,
                verifiedGone: true,
                rebootRequired: false,
                skippedWaiting: false,
                skippedReason: null,
              },
            });
        }),
    );
    const skipUninstallWaiting = vi.fn(async () => {});
    const { user, dialog } = await startWizard(wizardApi({ runUninstaller, skipUninstallWaiting }));
    await user.click(within(dialog).getByRole('button', { name: 'Uninstall' }));
    expect(await within(dialog).findByText('Running the Spotify uninstaller')).toBeInTheDocument();
    await user.keyboard('{Escape}');
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    expect(within(dialog).queryByRole('button', { name: 'Close' })).not.toBeInTheDocument();
    await user.click(within(dialog).getByRole('button', { name: 'It has finished' }));
    expect(skipUninstallWaiting).toHaveBeenCalled();
    await act(async () => finishRun());
    await within(dialog).findByText(/left these behind/);
  });

  it('shows the removal progress for this job only', async () => {
    let finish: () => void = () => {};
    const executeUninstall = vi.fn<DustApi['executeUninstall']>(
      () => new Promise((resolve) => (finish = () => resolve({ ok: true, report: makeRemovalReport() }))),
    );
    const { user, dialog } = await startWizard(wizardApi({ executeUninstall }));
    await user.click(within(dialog).getByRole('button', { name: 'Uninstall' }));
    await within(dialog).findByText(/left these behind/);
    await user.click(within(dialog).getByRole('button', { name: /^Remove / }));
    await waitFor(() => expect(executeUninstall).toHaveBeenCalled());
    const { jobId } = executeUninstall.mock.calls[0]![0];
    expect(await within(dialog).findByText('Removing 0 of 2')).toBeInTheDocument();

    act(() => {
      useAppsStore.getState().applyBatch({
        sizes: new Map(),
        icons: new Map(),
        jobs: new Map([
          [jobId, (job) => ({ ...job, itemsDone: 1 })],
          ['someone-else', (job) => ({ ...job, itemsDone: 2 })],
        ]),
      });
    });
    expect(await within(dialog).findByText('Removing 1 of 2')).toBeInTheDocument();
    expect(within(dialog).getByRole('progressbar', { name: 'Removing leftovers' })).toHaveAttribute(
      'aria-valuenow',
      '50',
    );
    await act(async () => finish());
    await screen.findByRole('dialog', { name: 'Finished' });
    // Now it can be closed with Escape.
    await user.keyboard('{Escape}');
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  });

  it('says what went wrong when the removal is refused', async () => {
    const { user, dialog } = await startWizard(
      wizardApi({ executeUninstall: async () => ({ ok: false, reason: 'busy', running: 'analyze' }) }),
    );
    await user.click(within(dialog).getByRole('button', { name: 'Uninstall' }));
    await within(dialog).findByText(/left these behind/);
    await user.click(within(dialog).getByRole('button', { name: /^Remove / }));
    expect(await within(dialog).findByText(/Another scan or removal is running/)).toBeInTheDocument();
    const footerClose = within(dialog)
      .getAllByRole('button', { name: 'Close' })
      .find((button) => button.textContent === 'Close');
    expect(footerClose).toHaveFocus();
  });

  describe('relaunch as administrator', () => {
    const adminItem = makeUninstallItem({ id: 'file-admin', kind: 'file', label: 'Shared data', adminRequired: true });
    const adminPreview = makeUninstallPreview({ items: [adminItem, ...items] });

    it('is offered for a leftovers-only review of an app that needs it, and sends the plan id', async () => {
      const user = userEvent.setup();
      const relaunchElevatedUninstall = vi.fn(async () => {});
      await openApps(
        makeApi({
          listUninstallApps: list([ORPHAN]),
          previewUninstall: async () => ({ ok: true, preview: adminPreview }),
          relaunchElevatedUninstall,
        }),
      );
      await user.click(await screen.findByRole('button', { name: 'Uninstall Orphan' }));
      const dialog = await screen.findByRole('dialog');
      await user.click(await within(dialog).findByRole('button', { name: 'Relaunch as administrator' }));
      expect(relaunchElevatedUninstall).toHaveBeenCalledWith('plan-1');
    });

    it('shows a notice when the relaunch is rejected', async () => {
      const user = userEvent.setup();
      await openApps(
        makeApi({
          listUninstallApps: list([ORPHAN]),
          previewUninstall: async () => ({ ok: true, preview: adminPreview }),
          relaunchElevatedUninstall: async () => {
            throw new Error('Windows said no');
          },
        }),
      );
      await user.click(await screen.findByRole('button', { name: 'Uninstall Orphan' }));
      const dialog = await screen.findByRole('dialog');
      await user.click(await within(dialog).findByRole('button', { name: 'Relaunch as administrator' }));
      expect(await within(dialog).findByText(/could not restart with administrator rights/)).toBeInTheDocument();
      expect(within(dialog).queryByText('Windows said no')).not.toBeInTheDocument();
    });

    it('is absent after a verified uninstall, when nothing needs it, and when already elevated', async () => {
      const user = userEvent.setup();
      // After a verified uninstall: the elevated copy could not see the leftovers of a removed app.
      const { dialog } = await startWizard(
        wizardApi({ previewUninstall: async () => ({ ok: true, preview: adminPreview }) }),
      );
      await user.click(within(dialog).getByRole('button', { name: 'Uninstall' }));
      await within(dialog).findByText(/left these behind/);
      expect(within(dialog).getByText(/Some items need administrator rights/)).toBeInTheDocument();
      expect(within(dialog).queryByRole('button', { name: 'Relaunch as administrator' })).not.toBeInTheDocument();
    });
  });
});

describe('Removal after relaunching as administrator', () => {
  const plan = makeUninstallPreview();

  function resumeApi(overrides: Partial<DustApi> = {}) {
    return makeApi({
      listUninstallApps: list([SPOTIFY], { elevated: true }),
      previewUninstall: async () => ({ ok: true, preview: plan }),
      executeUninstall: async () => ({ ok: true, report: makeRemovalReport() }),
      ...overrides,
    });
  }
  const hint = (overrides: Partial<UninstallLaunchHint> = {}): UninstallLaunchHint => ({
    open: true,
    appId: 'app-1',
    notice: null,
    stalePending: false,
    runningJobId: null,
    ...overrides,
  });

  it('opens the plan for the hinted app once the list says this copy is elevated, and runs it in one go', async () => {
    const user = userEvent.setup();
    const executeUninstall = vi.fn<DustApi['executeUninstall']>(async () => ({
      ok: true,
      report: makeRemovalReport({ outcome: 'complete' }),
    }));
    await openApps(resumeApi({ executeUninstall }), hint());
    const dialog = await screen.findByRole('dialog', { name: 'Remove Spotify' });
    expect(within(dialog).getByRole('checkbox', { name: "Run the app's own uninstaller" })).toBeChecked();
    // The hint is used up.
    expect(useNavStore.getState().params.apps).toBeUndefined();

    await user.click(within(dialog).getByRole('button', { name: 'Uninstall' }));
    await within(dialog).findByText('Uninstalled');
    expect(executeUninstall.mock.calls[0]![0]).toMatchObject({
      planId: 'plan-1',
      jobId: 'plan-1',
      runUninstaller: true,
      acknowledge: [],
    });
  });

  it('holds back the confirm button until items marked Review are acknowledged', async () => {
    const user = userEvent.setup();
    const reviewPlan = makeUninstallPreview({
      items: [
        makeUninstallItem({ id: 'rv', kind: 'registry', grade: 'review', label: 'Vendor key', defaultSelected: true }),
      ],
    });
    const executeUninstall = vi.fn<DustApi['executeUninstall']>(async () => ({
      ok: true,
      report: makeRemovalReport(),
    }));
    await openApps(
      resumeApi({ previewUninstall: async () => ({ ok: true, preview: reviewPlan }), executeUninstall }),
      hint(),
    );
    const dialog = await screen.findByRole('dialog', { name: 'Remove Spotify' });
    const confirm = within(dialog).getByRole('button', { name: 'Uninstall' });
    expect(confirm).toBeDisabled();
    await user.click(within(dialog).getByRole('checkbox', { name: /cannot be recovered/ }));
    await user.click(confirm);
    await waitFor(() => expect(executeUninstall).toHaveBeenCalled());
    expect(executeUninstall.mock.calls[0]![0]).toMatchObject({ acknowledge: ['rv'] });
  });

  it('relaunches instead of running when it needs administrator rights and Dust is not elevated', async () => {
    const user = userEvent.setup();
    const relaunchElevatedUninstall = vi.fn(async () => {});
    const executeUninstall = vi.fn<DustApi['executeUninstall']>();
    const adminPlan = makeUninstallPreview({
      totals: { ...plan.totals, adminItems: 1 },
    });
    await openApps(
      resumeApi({
        listUninstallApps: list([SPOTIFY], { elevated: false }),
        previewUninstall: async () => ({ ok: true, preview: adminPlan }),
        relaunchElevatedUninstall,
        executeUninstall,
      }),
      hint(),
    );
    const dialog = await screen.findByRole('dialog', { name: 'Remove Spotify' });
    await user.click(within(dialog).getByRole('button', { name: 'Uninstall' }));
    await waitFor(() => expect(relaunchElevatedUninstall).toHaveBeenCalledWith('plan-1'));
    expect(executeUninstall).not.toHaveBeenCalled();
  });

  it('says so, and changes nothing, when the hinted app is gone or the last run never started', async () => {
    await openApps(resumeApi({ listUninstallApps: list([OFFICE], { elevated: true }) }), hint());
    expect(await screen.findByText('That app is no longer installed')).toBeInTheDocument();
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('tells the user when the last uninstall did not start', async () => {
    await openApps(resumeApi(), hint({ appId: null, stalePending: true }));
    expect(await screen.findByText('The last uninstall did not start')).toBeInTheDocument();
  });

  it('adopts a removal that is already running, shows its steps, and then its report', async () => {
    await openApps(resumeApi(), hint({ appId: null, runningJobId: 'job-9' }));
    const dialog = await screen.findByRole('dialog', { name: 'Finishing the uninstall' });
    act(() => {
      useAppsStore.getState().applyBatch({
        sizes: new Map(),
        icons: new Map(),
        jobs: new Map([
          [
            'job-9',
            (job) => ({
              ...emptyJob('job-9'),
              ...job,
              phases: { prepare: { status: 'done' }, uninstaller: { status: 'started' } },
            }),
          ],
        ]),
      });
    });
    const steps = await within(dialog).findByRole('list', { name: 'Removal progress' });
    expect(within(steps).getAllByRole('listitem')).toHaveLength(8);

    act(() => {
      useAppsStore.getState().applyBatch({
        sizes: new Map(),
        icons: new Map(),
        jobs: new Map([['job-9', (job) => ({ ...job, outcome: { type: 'finished', report: makeRemovalReport() } })]]),
      });
    });
    expect(await within(dialog).findByText('Uninstalled')).toBeInTheDocument();
  });

  it('shows a failure of an adopted removal in plain words', async () => {
    await openApps(resumeApi(), hint({ appId: null, runningJobId: 'job-9' }));
    const dialog = await screen.findByRole('dialog');
    act(() => {
      useAppsStore.getState().applyBatch({
        sizes: new Map(),
        icons: new Map(),
        jobs: new Map([
          ['job-9', (job) => ({ ...emptyJob('job-9'), ...job, outcome: { type: 'failed', message: 'It stopped.' } })],
        ]),
      });
    });
    expect(await within(dialog).findByText('It stopped.')).toBeInTheDocument();
    expect(screen.getByRole('dialog', { name: 'Nothing was removed' })).toBeInTheDocument();
  });
});
