import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type {
  DustApi,
  UninstallAppSummary,
  UninstallEvent,
  UninstallExecuteRequest,
  UninstallExecuteResult,
  UninstallRunOutcome,
} from '../../src/shared/ipc';
import { UninstallWizard } from '../../renderer/src/components/UninstallWizard';
import { makeApi, makeRemovalReport, makeUninstallApp, makeUninstallItem, makeUninstallPreview } from './fakes';

function makeBus() {
  const handlers = new Set<(event: UninstallEvent) => void>();
  return {
    onUninstallEvent: (handler: (event: UninstallEvent) => void) => {
      handlers.add(handler);
      return () => {
        handlers.delete(handler);
      };
    },
    emit: (event: UninstallEvent) => {
      for (const handler of [...handlers]) handler(event);
    },
  };
}

function outcome(overrides: Partial<UninstallRunOutcome> = {}): UninstallRunOutcome {
  return {
    ran: true,
    exitCode: 0,
    verifiedGone: true,
    rebootRequired: false,
    skippedWaiting: false,
    skippedReason: null,
    ...overrides,
  };
}

interface SetupOptions {
  app?: Partial<UninstallAppSummary>;
  api?: Partial<DustApi>;
  /** Item ids the fake main process reports as removed during executeUninstall. */
  removed?: string[];
}

function setup(options: SetupOptions = {}) {
  const bus = makeBus();
  const onClose = vi.fn();
  const onChanged = vi.fn();
  const requests: UninstallExecuteRequest[] = [];
  const removed = options.removed ?? ['file-local', 'reg-uninstall'];
  const api = makeApi({
    onUninstallEvent: bus.onUninstallEvent,
    runUninstaller: async () => ({ ok: true, outcome: outcome() }),
    previewUninstall: async () => ({ ok: true, preview: makeUninstallPreview() }),
    executeUninstall: async (request) => {
      requests.push(request);
      for (const itemId of removed) {
        bus.emit({ type: 'item', jobId: request.jobId, itemId, status: 'deleted', bytes: 0 });
      }
      return { ok: true, report: makeRemovalReport() };
    },
    ...options.api,
  });
  const app = makeUninstallApp(options.app);
  render(<UninstallWizard api={api} app={app} elevated={false} onClose={onClose} onChanged={onChanged} />);
  return { api, bus, onClose, onChanged, requests };
}

/** Confirm step -> run the uninstaller -> wait for the leftovers review. */
async function toReview() {
  fireEvent.click(screen.getByRole('button', { name: 'Uninstall' }));
  await screen.findByRole('button', { name: 'Remove selected' });
}

describe('UninstallWizard', () => {
  it('opens a dialog for the app and explains the steps before doing anything', () => {
    const runUninstaller = vi.fn();
    setup({ api: { runUninstaller } });

    const dialog = screen.getByRole('dialog', { name: 'Uninstall Spotify' });
    expect(within(dialog).getByRole('heading', { name: 'Spotify' })).toBeInTheDocument();
    expect(within(dialog).getByText("Run the app's own uninstaller")).toBeInTheDocument();
    expect(runUninstaller).not.toHaveBeenCalled();
  });

  describe('done copy by origin', () => {
    it('says the app is removed after a verified uninstall', async () => {
      const { onChanged } = setup();
      await toReview();
      fireEvent.click(screen.getByRole('button', { name: 'Remove selected' }));

      expect(await screen.findByText('Done. Spotify is removed, and 1.0 KB of leftovers freed.')).toBeInTheDocument();
      expect(screen.getByText(/2 items removed\./)).toBeInTheDocument();
      expect(onChanged).toHaveBeenCalledTimes(1);
    });

    it('says the app is still installed when the uninstaller left it registered', async () => {
      const { requests } = setup({
        api: { runUninstaller: async () => ({ ok: true, outcome: outcome({ verifiedGone: false }) }) },
      });
      fireEvent.click(screen.getByRole('button', { name: 'Uninstall' }));
      expect(await screen.findByText('Spotify still looks installed')).toBeInTheDocument();

      fireEvent.click(screen.getByRole('button', { name: 'Look for leftovers' }));
      fireEvent.click(await screen.findByRole('button', { name: 'Remove selected' }));

      expect(
        await screen.findByText('Leftovers removed, and 1.0 KB freed. Spotify is still installed.'),
      ).toBeInTheDocument();
      expect(requests[0]).toMatchObject({ runUninstaller: false });
    });

    it('claims only leftovers for an app with no uninstaller', async () => {
      setup({ app: { hasUninstaller: false } });

      fireEvent.click(await screen.findByRole('button', { name: 'Remove selected' }));

      expect(await screen.findByText('Leftovers removed, and 1.0 KB freed.')).toBeInTheDocument();
      expect(screen.queryByText(/is removed/)).toBeNull();
      expect(screen.queryByText(/still installed/)).toBeNull();
    });

    it('reports nothing removed when no item completed', async () => {
      setup({ removed: [] });
      await toReview();
      fireEvent.click(screen.getByRole('button', { name: 'Remove selected' }));

      expect(await screen.findByText('No leftovers were removed.')).toBeInTheDocument();
    });
  });

  it('selects and clears each group on its own', async () => {
    setup();
    await toReview();

    const files = screen.getByRole('heading', { name: 'Files and folders' }).closest('section')!;
    const registry = screen.getByRole('heading', { name: 'Registry entries' }).closest('section')!;
    const checked = (section: HTMLElement) =>
      within(section)
        .getAllByRole('checkbox')
        .map((box) => (box as HTMLInputElement).checked);

    // Defaults: file-local and reg-uninstall are on; file-roaming (your data) and reg-vendor (review) are off.
    expect(checked(files)).toEqual([true, false]);
    expect(checked(registry)).toEqual([false, true]);
    expect(screen.getByText(/^2 selected/)).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Select all files and folders' }));
    expect(checked(files)).toEqual([true, true]);
    expect(checked(registry)).toEqual([false, true]);
    expect(screen.getByText(/^3 selected/)).toBeInTheDocument();
    expect(screen.getByText(/includes your data/)).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Select none of files and folders' }));
    expect(checked(files)).toEqual([false, false]);
    expect(checked(registry)).toEqual([false, true]);
    expect(screen.getByText(/^1 selected/)).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Select none of registry entries' }));
    expect(screen.getByRole('button', { name: 'Remove selected' })).toBeDisabled();
  });

  it('sends the chosen items, acknowledging review ones, when removing', async () => {
    const { requests } = setup();
    await toReview();

    fireEvent.click(screen.getByRole('button', { name: 'Select all registry entries' }));
    fireEvent.click(screen.getByRole('button', { name: 'Remove selected' }));

    await waitFor(() => expect(requests).toHaveLength(1));
    expect(requests[0]!.selection).toEqual(expect.arrayContaining(['file-local', 'reg-vendor', 'reg-uninstall']));
    expect(requests[0]!.selection).not.toContain('file-roaming');
    expect(requests[0]!.acknowledge).toEqual(['reg-vendor']);
    expect(requests[0]!.includeUserData).toBe(false);
  });

  describe('dismissal', () => {
    it('closes on Escape while idle', () => {
      const { onClose } = setup();

      fireEvent.keyDown(document, { key: 'Escape' });
      expect(onClose).toHaveBeenCalledTimes(1);
      expect(screen.getByRole('button', { name: 'Close' })).toBeInTheDocument();
    });

    it('ignores Escape and hides the close control while the uninstaller runs', async () => {
      const { onClose } = setup({ api: { runUninstaller: () => new Promise(() => {}) } });
      fireEvent.click(screen.getByRole('button', { name: 'Uninstall' }));
      expect(await screen.findByText('Running the Spotify uninstaller')).toBeInTheDocument();

      fireEvent.keyDown(document, { key: 'Escape' });
      expect(onClose).not.toHaveBeenCalled();
      expect(screen.queryByRole('button', { name: 'Close' })).toBeNull();
    });

    it('ignores Escape while leftovers are being removed, then allows it once done', async () => {
      const held: { release: ((result: UninstallExecuteResult) => void) | null } = { release: null };
      const { onClose } = setup({
        api: {
          executeUninstall: () =>
            new Promise<UninstallExecuteResult>((resolve) => {
              held.release = resolve;
            }),
        },
      });
      await toReview();
      fireEvent.click(screen.getByRole('button', { name: 'Remove selected' }));
      expect(await screen.findByText(/^Removing /)).toBeInTheDocument();

      fireEvent.keyDown(document, { key: 'Escape' });
      expect(onClose).not.toHaveBeenCalled();

      await act(async () => {
        held.release?.({ ok: true, report: makeRemovalReport() });
      });
      expect(await screen.findByRole('button', { name: 'Done' })).toBeInTheDocument();
      fireEvent.keyDown(document, { key: 'Escape' });
      expect(onClose).toHaveBeenCalledTimes(1);
    });
  });

  it('updates the removing progress from item events for this job only', async () => {
    const held: { jobId: string | null } = { jobId: null };
    const { bus } = setup({
      api: {
        executeUninstall: async (request) => {
          held.jobId = request.jobId;
          return new Promise<UninstallExecuteResult>(() => {});
        },
      },
    });
    await toReview();
    fireEvent.click(screen.getByRole('button', { name: 'Remove selected' }));

    expect(await screen.findByText('Removing 0 of 2')).toBeInTheDocument();
    await waitFor(() => expect(held.jobId).not.toBeNull());

    act(() => bus.emit({ type: 'item', jobId: 'someone-else', itemId: 'file-local', status: 'deleted', bytes: 1 }));
    expect(screen.getByText('Removing 0 of 2')).toBeInTheDocument();

    act(() => bus.emit({ type: 'item', jobId: held.jobId!, itemId: 'file-local', status: 'deleted', bytes: 1024 }));
    expect(screen.getByText('Removing 1 of 2')).toBeInTheDocument();
    expect(screen.getByText('Removed')).toBeInTheDocument();

    act(() => bus.emit({ type: 'item', jobId: held.jobId!, itemId: 'reg-uninstall', status: 'failed', bytes: 0 }));
    expect(screen.getByText('Removing 2 of 2')).toBeInTheDocument();
    expect(screen.getByText('Could not be removed')).toBeInTheDocument();
    expect(screen.getByRole('meter', { name: 'Removal progress' })).toBeInTheDocument();
  });

  describe('relaunch as administrator', () => {
    const adminPreview = () =>
      makeUninstallPreview({
        planId: 'plan-admin',
        items: [
          makeUninstallItem({ id: 'file-pf', kind: 'file', adminRequired: true, defaultSelected: true }),
          makeUninstallItem({ id: 'file-local', kind: 'file', defaultSelected: true }),
        ],
      });
    const relaunchButton = () => screen.queryByRole('button', { name: 'Relaunch as administrator' });

    it('relaunches with the plan id from the leftovers-only review', async () => {
      const relaunchElevatedUninstall = vi.fn<DustApi['relaunchElevatedUninstall']>(async () => {});
      setup({
        app: { hasUninstaller: false },
        api: { previewUninstall: async () => ({ ok: true, preview: adminPreview() }), relaunchElevatedUninstall },
      });

      fireEvent.click(await screen.findByRole('button', { name: 'Relaunch as administrator' }));
      expect(relaunchElevatedUninstall).toHaveBeenCalledWith('plan-admin');
    });

    it('shows a danger alert when the relaunch is rejected', async () => {
      setup({
        app: { hasUninstaller: false },
        api: {
          previewUninstall: async () => ({ ok: true, preview: adminPreview() }),
          relaunchElevatedUninstall: async () => {
            throw new Error('UAC was declined');
          },
        },
      });

      fireEvent.click(await screen.findByRole('button', { name: 'Relaunch as administrator' }));
      expect(await screen.findByText('UAC was declined')).toBeInTheDocument();
    });

    it('is absent when nothing needs admin', async () => {
      setup({ app: { hasUninstaller: false } });
      await screen.findByRole('button', { name: 'Remove selected' });
      expect(relaunchButton()).toBeNull();
    });

    it('is absent after a verified uninstall', async () => {
      setup({ api: { previewUninstall: async () => ({ ok: true, preview: adminPreview() }) } });
      await toReview();
      expect(screen.getByText(/need administrator rights/)).toBeInTheDocument();
      expect(relaunchButton()).toBeNull();
    });

    it('is absent when already elevated', async () => {
      const api = makeApi({ previewUninstall: async () => ({ ok: true, preview: adminPreview() }) });
      render(
        <UninstallWizard
          api={api}
          app={makeUninstallApp({ hasUninstaller: false })}
          elevated
          onClose={vi.fn()}
          onChanged={vi.fn()}
        />,
      );
      await screen.findByRole('button', { name: 'Remove selected' });
      expect(relaunchButton()).toBeNull();
      expect(screen.queryByText(/need administrator rights/)).toBeNull();
    });
  });

  it('shows what went wrong and offers Close when the removal is refused', async () => {
    const { onClose } = setup({
      api: { executeUninstall: async () => ({ ok: false, reason: 'busy', running: 'analyze' }) },
    });
    await toReview();
    fireEvent.click(screen.getByRole('button', { name: 'Remove selected' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('Another scan or removal is running.');
    fireEvent.click(screen.getAllByRole('button', { name: 'Close' }).find((node) => node.textContent === 'Close')!);
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
