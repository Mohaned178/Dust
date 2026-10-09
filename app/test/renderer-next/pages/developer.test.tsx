import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { App } from '../../../renderer-next/src/app/App';
import { useNavStore } from '../../../renderer-next/src/app/nav';
import type { DevCleanupState, DevGroup, DevProject, DustApi } from '../../../src/shared/ipc';
import {
  makeApi,
  makeCategories,
  makeCleanPreview,
  makeCleanReport,
  makeDevCleanupState,
  makeDevProject,
} from '../../renderer/fakes';

const MB = 1024 ** 2;
const DAY = 86_400_000;
const ROOT = 'C:\\';

const project = (name: string, overrides: Partial<DevProject> = {}): DevProject =>
  makeDevProject({
    path: `C:\\dev\\${name}`,
    name,
    nodeModulesPaths: [`C:\\dev\\${name}\\node_modules`],
    nodeModulesBytes: 100 * MB,
    activityMs: Date.now() - 400 * DAY,
    ...overrides,
  });

const DEAD_GREEN = project('dead-app', { nodeModulesBytes: 500 * MB });
const DEAD_GREEN_2 = project('old-site', { nodeModulesBytes: 300 * MB, restoreCommand: 'pnpm install' });
const DEAD_YELLOW = project('old-api', { nodeModulesBytes: 200 * MB, grade: 'yellow', restoreCommand: null });
const OCCASIONAL = project('side-project', {
  recency: 'occasional',
  activityMs: Date.now() - 90 * DAY,
  nodeModulesBytes: 80 * MB,
});
const ACTIVE = project('web-app', { recency: 'active', activityMs: Date.now() - 2 * DAY, nodeModulesBytes: 60 * MB });
const LOOSE = project('loose', {
  kind: 'orphaned-node-modules',
  recency: 'unknown',
  activityMs: null,
  restoreCommand: null,
  nodeModulesBytes: 40 * MB,
  grade: 'yellow',
});
const KEPT = project('kept-one', { pinned: true, offered: false, nodeModulesBytes: 20 * MB });

function groups(overrides: Partial<Record<DevGroup['id'], DevProject[]>> = {}): DevGroup[] {
  const by: Record<DevGroup['id'], DevProject[]> = {
    dead: [DEAD_GREEN, DEAD_GREEN_2, DEAD_YELLOW],
    occasional: [OCCASIONAL],
    active: [ACTIVE],
    orphaned: [LOOSE],
    pinned: [KEPT],
    ...overrides,
  };
  return (['dead', 'occasional', 'active', 'orphaned', 'pinned'] as const).map((id) => ({
    id,
    label: id,
    projects: by[id],
  }));
}

function state(overrides: Partial<DevCleanupState> = {}): DevCleanupState {
  return makeDevCleanupState({ groups: groups(), finishedAt: Date.now() - 5 * 60_000, ...overrides });
}

async function openDeveloper(overrides: Partial<DustApi> = {}) {
  const api = makeApi({ getDevCleanup: async () => state(), ...overrides });
  render(<App api={api} />);
  act(() => useNavStore.getState().navigate('developer', { root: ROOT }));
  await screen.findByRole('heading', { level: 1, name: 'Developer', hidden: true });
  return api;
}

const names = () =>
  [...document.querySelectorAll('[role=treeitem]')].map((item) => item.getAttribute('aria-label')?.split(',')[0]);
const footer = () => document.querySelector<HTMLElement>('p[aria-live="polite"]');

describe('Developer: the list', () => {
  it('groups projects by when they were last used, in plain words, with the kept group closed', async () => {
    await openDeveloper();
    await screen.findByRole('tree', { name: 'Projects by when they were last used' });
    expect(names()).toEqual([
      'Not used for 6+ months',
      'dead-app',
      'old-site',
      'old-api',
      'Used now and then',
      'side-project',
      'Used recently',
      'web-app',
      'Loose node_modules',
      'loose',
      'Kept',
    ]);
    expect(screen.queryByText('kept-one')).not.toBeInTheDocument();
    expect(screen.getAllByText('Not touched for 1 year')).toHaveLength(3);
    expect(screen.getByText('Not touched for 3 months')).toBeInTheDocument();
    expect(screen.getByText('Used 2 days ago')).toBeInTheDocument();
    expect(screen.getByText('Last use unknown')).toBeInTheDocument();
    expect(screen.getAllByText('Rebuild with npm ci').length).toBeGreaterThan(0);
    expect(screen.getByText('Rebuild with pnpm install')).toBeInTheDocument();
    // The total is the sum of the rows, and nothing is scored.
    expect(screen.getByText('1.2 GB')).toBeInTheDocument();
    expect(screen.getByText(/across 7 projects/)).toBeInTheDocument();
    expect(screen.queryByText(/^Dead$|score|issues/i)).toBeNull();
  });

  it('says in words, not colour alone, whether a project can be rebuilt', async () => {
    await openDeveloper();
    await screen.findByRole('tree');
    expect(screen.getAllByText('Can be rebuilt').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Check first').length).toBeGreaterThan(0);
  });

  it('opens and closes a group, and shows the kept projects only when asked', async () => {
    const user = userEvent.setup();
    await openDeveloper();
    await screen.findByRole('tree');
    await user.click(screen.getByRole('treeitem', { name: /^Kept/ }));
    expect(await screen.findByText('kept-one')).toBeInTheDocument();
    expect(screen.queryByRole('checkbox', { name: 'Select kept-one' })).not.toBeInTheDocument();
    await user.click(screen.getByRole('treeitem', { name: /^Not used for 6\+ months/ }));
    expect(screen.queryByText('dead-app')).not.toBeInTheDocument();
  });

  it('selects only the unused projects that rebuild from a lockfile when asked for the safe ones', async () => {
    const user = userEvent.setup();
    await openDeveloper();
    await user.click(await screen.findByRole('button', { name: 'Select all safe and unused' }));
    expect(screen.getByRole('checkbox', { name: 'Select dead-app' })).toBeChecked();
    expect(screen.getByRole('checkbox', { name: 'Select old-site' })).toBeChecked();
    expect(screen.getByRole('checkbox', { name: 'Select old-api' })).not.toBeChecked();
    expect(screen.getByRole('checkbox', { name: 'Select web-app' })).not.toBeChecked();
    expect(footer()).toHaveTextContent('2 projects · 800 MB selected');
  });

  it('suggests nothing when no project has gone unused long enough', async () => {
    await openDeveloper({ getDevCleanup: async () => state({ groups: groups({ dead: [DEAD_YELLOW] }) }) });
    expect(await screen.findByText('Nothing to suggest')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Select all safe and unused' })).not.toBeInTheDocument();
  });

  it('ticks a whole group with a tri-state checkbox, and clears the selection', async () => {
    const user = userEvent.setup();
    await openDeveloper();
    await screen.findByRole('tree');
    const all = screen.getByRole('checkbox', { name: 'Select all in Not used for 6+ months' });
    await user.click(screen.getByRole('checkbox', { name: 'Select dead-app' }));
    expect(all).toHaveAttribute('aria-checked', 'mixed');
    await user.click(all);
    expect(all).toBeChecked();
    expect(footer()).toHaveTextContent('3 projects · 1000 MB selected');
    await user.click(screen.getByRole('button', { name: 'Clear' }));
    expect(footer()).toBeNull();
  });

  it('can be driven from the keyboard: arrows move, Right and Left open and close, Space ticks', async () => {
    const user = userEvent.setup();
    await openDeveloper();
    await screen.findByRole('tree');
    const first = screen.getByRole('treeitem', { name: /^Not used for 6\+ months/ });
    expect(first).toHaveAttribute('tabindex', '0');
    act(() => first.focus());
    await user.keyboard('{ArrowDown}');
    await waitFor(() => expect(screen.getByRole('treeitem', { name: /^dead-app/ })).toHaveFocus());
    await user.keyboard(' ');
    expect(screen.getByRole('checkbox', { name: 'Select dead-app' })).toBeChecked();
    await user.keyboard('{ArrowLeft}');
    await waitFor(() => expect(screen.getByRole('treeitem', { name: /^Not used for 6\+ months/ })).toHaveFocus());
    await user.keyboard('{ArrowLeft}');
    await waitFor(() => expect(screen.queryByText('old-site')).not.toBeInTheDocument());
    await user.keyboard('{ArrowRight}');
    expect(await screen.findByText('old-site')).toBeInTheDocument();
    await user.keyboard('{End}');
    await waitFor(() => expect(screen.getByRole('treeitem', { name: /^Kept/ })).toHaveFocus());
    await user.keyboard('{Enter}');
    expect(await screen.findByText('kept-one')).toBeInTheDocument();
  });
});

describe('Developer: keeping a project', () => {
  it('keeps a project, reads the list again, and offers Undo', async () => {
    const user = userEvent.setup();
    const setPin = vi.fn<DustApi['setPin']>(async () => ({ ok: true, pins: [] }));
    const getDevCleanup = vi.fn<DustApi['getDevCleanup']>(async () => state());
    await openDeveloper({ setPin, getDevCleanup });
    await user.click(await screen.findByRole('checkbox', { name: 'Select old-site' }));
    await user.click(screen.getByRole('button', { name: 'Keep old-site' }));
    await waitFor(() => expect(setPin).toHaveBeenCalledWith('C:\\dev\\old-site', true));
    expect(await screen.findByText('old-site will be kept')).toBeInTheDocument();
    // A project that is kept is no longer ticked.
    expect(footer()).toBeNull();
    await waitFor(() => expect(getDevCleanup.mock.calls.length).toBeGreaterThan(1));
    await user.click(screen.getByRole('button', { name: 'Undo' }));
    await waitFor(() => expect(setPin).toHaveBeenLastCalledWith('C:\\dev\\old-site', false));
  });

  it('says so when the change could not be saved', async () => {
    const user = userEvent.setup();
    await openDeveloper({ setPin: async () => ({ ok: false, message: 'The pin file is locked.' }) });
    await user.click(await screen.findByRole('button', { name: 'Keep old-site' }));
    expect(await screen.findByText('The pin file is locked.')).toBeInTheDocument();
  });
});

describe('Developer: cleaning', () => {
  const plan = (paths: string[]) => {
    const base = makeCleanPreview().items[0]!;
    const items = paths.map((path) => ({
      ...base,
      ruleId: 'npm-project-modules',
      category: 'npm-projects' as const,
      path: `${path}\\node_modules`,
      name: 'node_modules',
      bytes: 100 * MB,
      recovery: { kind: 'regenerate' as const, text: 'npm ci' },
      evidence: 'Dependencies for a project you have not used in a long time',
    }));
    return makeCleanPreview({
      items,
      totals: { bytes: items.length * 100 * MB, items: items.length, reviewBytes: 0, reviewItems: 0 },
    });
  };

  it('plans exactly the ticked projects, shows how to rebuild each, and reads everything again afterwards', async () => {
    const user = userEvent.setup();
    const previewClean = vi.fn<DustApi['previewClean']>(async (request) => ({
      ok: true,
      preview: plan('paths' in request ? request.paths : []),
    }));
    const executeClean = vi.fn<DustApi['executeClean']>(async () => ({
      ok: true,
      report: makeCleanReport({
        scope: 'dev',
        items: [
          {
            ruleId: 'npm-project-modules',
            path: 'C:\\dev\\dead-app\\node_modules',
            category: 'npm-projects',
            action: 'delete-path',
            status: 'done',
            plannedBytes: 100 * MB,
            deletedBytes: 100 * MB,
            skippedLocked: 0,
            errorCount: 0,
            restoreCommand: 'npm ci',
          },
        ],
        deletedBytes: 100 * MB,
      }),
    }));
    const getDevCleanup = vi.fn<DustApi['getDevCleanup']>(async () => state());
    await openDeveloper({ previewClean, executeClean, getDevCleanup });
    await user.click(await screen.findByRole('checkbox', { name: 'Select dead-app' }));
    await user.click(screen.getByRole('button', { name: 'Review and clean' }));

    const dialog = await screen.findByRole('dialog', { name: 'Clean project dependencies' });
    expect(previewClean).toHaveBeenCalledWith({ scope: 'dev', root: ROOT, paths: ['C:\\dev\\dead-app'] });
    // The rebuild command is in mono, with a button to copy it, before anything is deleted.
    expect(await within(dialog).findByText('npm ci')).toBeInTheDocument();
    expect(within(dialog).getByRole('button', { name: /Copy the rebuild command/ })).toBeInTheDocument();
    await user.click(within(dialog).getByRole('button', { name: 'Delete 100 MB' }));

    expect(await within(dialog).findByRole('region', { name: 'Rebuild commands' })).toBeInTheDocument();
    expect(
      within(dialog).getByRole('button', { name: /Copy the rebuild command for C:\\dev\\dead-app/ }),
    ).toBeInTheDocument();
    // The selection is cleared and the list is read again.
    expect(footer()).toBeNull();
    await waitFor(() => expect(getDevCleanup.mock.calls.length).toBeGreaterThan(1));
  });

  it('holds back the confirm button for projects that cannot be rebuilt until it is acknowledged', async () => {
    const user = userEvent.setup();
    const reviewPlan = plan(['C:\\dev\\old-api']);
    reviewPlan.items[0] = {
      ...reviewPlan.items[0]!,
      grade: 'review',
      recovery: { kind: 'junk', text: 'Cannot be recovered' },
    };
    await openDeveloper({ previewClean: async () => ({ ok: true, preview: reviewPlan }) });
    await user.click(await screen.findByRole('checkbox', { name: 'Select old-api' }));
    await user.click(screen.getByRole('button', { name: 'Review and clean' }));
    const dialog = await screen.findByRole('dialog');
    const confirm = await within(dialog).findByRole('button', { name: 'Delete 100 MB' });
    expect(confirm).toBeDisabled();
    await user.click(within(dialog).getByRole('checkbox', { name: /cannot be recovered/ }));
    expect(confirm).toBeEnabled();
  });
});

describe('Developer: the rest of the page', () => {
  it('lists what was cleaned recently with its rebuild command', async () => {
    await openDeveloper({
      getDevCleanup: async () =>
        state({
          recentlyCleaned: [
            {
              root: ROOT,
              path: 'C:\\dev\\gone',
              name: 'gone',
              bytes: 50 * MB,
              restoreCommand: 'npm ci',
              cleanedAt: Date.now() - 3600_000,
            },
          ],
        }),
    });
    const summary = await screen.findByText(/Recently cleaned \(1\)/);
    expect(summary).toHaveTextContent('50 MB freed');
    expect(screen.getByRole('button', { name: 'Copy the rebuild command for gone' })).toBeInTheDocument();
  });

  it('shows the package cache as its own row and links to Clean up', async () => {
    const user = userEvent.setup();
    const categories = makeCategories().map((row) =>
      row.category === 'npm-cache' ? { ...row, bytes: 2 * 1024 * MB, items: 1 } : row,
    );
    await openDeveloper({
      getResultCategories: async (root) => ({
        source: 'snapshot',
        root,
        finishedAt: 1,
        status: 'complete',
        rulesStale: false,
        depthLimited: false,
        categories,
      }),
    });
    const section = await screen.findByRole('region', { name: 'Toolchain caches' });
    expect(await within(section).findByText('2.0 GB')).toBeInTheDocument();
    await user.click(within(section).getByRole('button', { name: /Review in Clean up/ }));
    expect(useNavStore.getState().page).toBe('cleanup');
    expect(useNavStore.getState().params.cleanup).toEqual({ view: 'results', root: ROOT, category: 'npm-cache' });
  });

  it('asks for a scan when there is none', async () => {
    const user = userEvent.setup();
    const startAnalyze = vi.fn<DustApi['startAnalyze']>(async () => ({ ok: true, runId: 'run-5' }));
    await openDeveloper({
      getDevCleanup: async () => makeDevCleanupState({ source: 'empty', groups: [] }),
      startAnalyze,
    });
    await user.click(await screen.findByRole('button', { name: 'Scan C:\\' }));
    expect(startAnalyze).toHaveBeenCalledWith(ROOT);
  });

  it('retries a failed read', async () => {
    const user = userEvent.setup();
    const getDevCleanup = vi
      .fn<DustApi['getDevCleanup']>()
      .mockRejectedValueOnce(new Error('boom'))
      .mockResolvedValue(state());
    await openDeveloper({ getDevCleanup });
    await user.click(await screen.findByRole('button', { name: 'Try again' }));
    expect(await screen.findByRole('tree')).toBeInTheDocument();
  });

  it('finds the system drive itself when opened from the sidebar', async () => {
    const getDevCleanup = vi.fn<DustApi['getDevCleanup']>(async () => state());
    render(<App api={makeApi({ getDevCleanup })} />);
    act(() => useNavStore.getState().navigate('developer'));
    await screen.findByRole('tree');
    expect(getDevCleanup).toHaveBeenCalledWith('C:\\');
  });
});
