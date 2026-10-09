import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { StrictMode } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { App } from '../../../renderer/src/app/App';
import { useNavStore } from '../../../renderer/src/app/nav';
import { useCleanStore } from '../../../renderer/src/stores/clean';
import { useScanStore } from '../../../renderer/src/stores/scan';
import type {
  CategorySummaryRow,
  CleanItemPreview,
  CleanPreview,
  CleanReport,
  DustApi,
  ResultRow,
  ResultsSummaryState,
} from '../../../src/shared/ipc';
import { makeApi, makeCleanPreview, makeCleanReport, makeResultsRows } from '../../renderer/fakes';

const MB = 1024 ** 2;
const GB = 1024 ** 3;

function resultRow(
  path: string,
  bytes: number,
  category: 'temp' | 'app-caches' | 'recycle-bin',
  grade: 'safe' | 'review' = 'safe',
): ResultRow {
  return {
    ...makeResultsRows()[3]!,
    path,
    name: path.split(/[\\/]/).pop() ?? path,
    bytes,
    grade,
    action: { ruleId: `${category}-rule`, category, grade, evidence: `Why ${path}` },
  };
}

const TEMP_A = resultRow('C:\\Users\\x\\AppData\\Local\\Temp', 2 * GB, 'temp');
// A folder under Windows is graded system-critical as a folder, but its rule still lists its contents as safe.
const TEMP_B: ResultRow = {
  ...resultRow('C:\\Windows\\SystemTemp', 1 * GB, 'temp'),
  grade: 'danger',
  gradeReason: 'System-critical — read-only',
};
const CACHE_SAFE = resultRow('C:\\Users\\x\\AppData\\Local\\Chrome', 500 * MB, 'app-caches');
const CACHE_REVIEW = resultRow('C:\\Users\\x\\AppData\\Local\\Unknown', 300 * MB, 'app-caches', 'review');
const BIN = resultRow('C:\\$Recycle.Bin', 800 * MB, 'recycle-bin', 'review');

function categoryRow(category: CategorySummaryRow['category'], bytes: number, items: number): CategorySummaryRow {
  return { category, label: category, bytes, items, ruleIds: [] };
}

function summary(overrides: Partial<ResultsSummaryState> = {}): ResultsSummaryState {
  return {
    source: 'snapshot',
    root: 'C:\\',
    finishedAt: Date.now() - 5 * 60_000,
    status: 'complete',
    rulesStale: false,
    depthLimited: false,
    categories: [
      categoryRow('temp', 3 * GB, 2),
      categoryRow('recycle-bin', 800 * MB, 1),
      categoryRow('npm-cache', 0, 0),
      categoryRow('app-caches', 800 * MB, 2),
      categoryRow('npm-projects', 5 * GB, 4),
    ],
    contributors: {
      temp: [TEMP_A, TEMP_B],
      'recycle-bin': [BIN],
      'npm-cache': [],
      'app-caches': [CACHE_SAFE, CACHE_REVIEW],
      'npm-projects': [],
    },
    ...overrides,
  };
}

function previewItem(row: ResultRow, overrides: Partial<CleanItemPreview> = {}): CleanItemPreview {
  return {
    ...makeCleanPreview().items[0]!,
    ruleId: row.action!.ruleId,
    category: row.action!.category,
    path: row.path,
    name: row.name,
    bytes: row.bytes,
    grade: row.action!.grade,
    ...overrides,
  };
}

function previewFor(items: CleanItemPreview[], overrides: Partial<CleanPreview> = {}): CleanPreview {
  const bytes = items.reduce((sum, item) => sum + item.bytes, 0);
  const review = items.filter((item) => item.grade === 'review');
  return makeCleanPreview({
    items,
    totals: {
      bytes,
      items: items.length,
      reviewBytes: review.reduce((sum, item) => sum + item.bytes, 0),
      reviewItems: review.length,
    },
    ...overrides,
  });
}

function reportFor(items: CleanItemPreview[], overrides: Partial<CleanReport> = {}): CleanReport {
  return makeCleanReport({
    scope: 'row',
    items: items.map((item) => ({
      ruleId: item.ruleId,
      path: item.path,
      category: item.category,
      action: item.action,
      status: 'done',
      plannedBytes: item.bytes,
      deletedBytes: item.bytes,
      skippedLocked: 0,
      errorCount: 0,
      restoreCommand: null,
    })),
    deletedBytes: items.reduce((sum, item) => sum + item.bytes, 0),
    ...overrides,
  });
}

async function openResults(overrides: Partial<DustApi> = {}, params: { category?: 'temp' } = {}) {
  const api = makeApi({ getResultsSummary: async () => summary(), ...overrides });
  render(<App api={api} />);
  act(() => {
    useNavStore.getState().navigate('cleanup', { view: 'results', root: 'C:\\', ...params });
  });
  await screen.findByRole('list', { name: 'Categories that can be cleaned' });
  return api;
}

const footer = () => document.querySelector<HTMLElement>('p[aria-live="polite"]')!;

describe('Clean up results', () => {
  it('preselects only safe items and keeps review-only categories apart', async () => {
    await openResults();
    const ready = screen.getByRole('list', { name: 'Categories that can be cleaned' });
    expect(within(ready).getByRole('checkbox', { name: 'Select all in Temporary files' })).toBeChecked();
    // One safe and one review item: partly selected.
    expect(within(ready).getByRole('checkbox', { name: 'Select all in App caches' })).toHaveAttribute(
      'aria-checked',
      'mixed',
    );
    expect(within(ready).queryByText('Recycle Bin')).not.toBeInTheDocument();

    expect(screen.getByRole('heading', { level: 2, name: /Take a look first/ })).toBeInTheDocument();
    const look = screen.getByRole('list', { name: 'Categories to look at first' });
    expect(within(look).getByRole('checkbox', { name: 'Select all in Recycle Bin' })).not.toBeChecked();

    // 2 GB + 1 GB + 500 MB: the review items are not in the figure.
    expect(footer()).toHaveTextContent('2 categories · 3.5 GB selected');
    // Developer dependencies are not part of this list, only a link to their own section.
    expect(screen.queryByText('Project dependencies')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Developer caches 5\.0 GB/ })).toBeInTheDocument();
  });

  it('shows the real item count when a category list was capped', async () => {
    const user = userEvent.setup();
    await openResults({
      getResultsSummary: async () =>
        summary({ categories: [categoryRow('temp', 9 * GB, 450), categoryRow('npm-projects', 0, 0)] }),
    });
    await user.click(screen.getByRole('button', { name: /Temporary files/ }));
    expect(screen.getByText('Showing the largest 2 of 450 items.')).toBeInTheDocument();
  });

  it('opens a category in place, and Keep removes an item from the figure until Undo', async () => {
    const user = userEvent.setup();
    await openResults();
    await user.click(screen.getByRole('button', { name: /Temporary files/ }));
    const items = screen.getByRole('list', { name: 'Temporary files items' });
    expect(within(items).getByText('Why C:\\Windows\\SystemTemp')).toBeInTheDocument();

    await user.click(within(items).getByRole('button', { name: 'Keep SystemTemp' }));
    expect(footer()).toHaveTextContent('2 categories · 2.5 GB selected');
    expect(await screen.findByText('SystemTemp will be kept')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Undo' }));
    await waitFor(() => expect(footer()).toHaveTextContent('3.5 GB selected'));
  });

  it('lets the user untick one item and tick a review item', async () => {
    const user = userEvent.setup();
    await openResults();
    await user.click(screen.getByRole('checkbox', { name: 'Select all in Temporary files' }));
    expect(footer()).toHaveTextContent('1 category · 500 MB selected');
    await user.click(screen.getByRole('checkbox', { name: 'Select all in Recycle Bin' }));
    expect(footer()).toHaveTextContent('2 categories · 1.3 GB selected');
  });

  it('opens the category named by a link from Home', async () => {
    await openResults({}, { category: 'temp' });
    expect(await screen.findByRole('list', { name: 'Temporary files items' })).toBeInTheDocument();
  });

  it('says so when there is nothing to clean', async () => {
    const api = makeApi({
      getResultsSummary: async () =>
        summary({
          contributors: { temp: [], 'recycle-bin': [], 'npm-cache': [], 'app-caches': [], 'npm-projects': [] },
        }),
    });
    render(<App api={api} />);
    act(() => {
      useNavStore.getState().navigate('cleanup', { view: 'results', root: 'C:\\' });
    });
    expect(await screen.findByText('C:\\ is in good shape')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Review and clean' })).not.toBeInTheDocument();
  });
});

describe('notices', () => {
  it('explains a cancelled scan', async () => {
    await openResults({ getResultsSummary: async () => summary({ status: 'cancelled' }) });
    expect(screen.getByText('Scan cancelled. Showing what was found.')).toBeInTheDocument();
  });

  it('offers a first scan when none exists', async () => {
    const api = makeApi({ getResultsSummary: async () => summary({ source: 'empty' }) });
    render(<App api={api} />);
    act(() => {
      useNavStore.getState().navigate('cleanup', { view: 'results', root: 'C:\\' });
    });
    expect(await screen.findByRole('button', { name: 'Scan C:\\' })).toBeInTheDocument();
  });

  it('retries a failed read', async () => {
    const user = userEvent.setup();
    const getResultsSummary = vi
      .fn<DustApi['getResultsSummary']>()
      .mockRejectedValueOnce(new Error('boom'))
      .mockResolvedValue(summary());
    const api = makeApi({ getResultsSummary });
    render(<App api={api} />);
    act(() => {
      useNavStore.getState().navigate('cleanup', { view: 'results', root: 'C:\\' });
    });
    await user.click(await screen.findByRole('button', { name: 'Try again' }));
    expect(await screen.findByRole('list', { name: 'Categories that can be cleaned' })).toBeInTheDocument();
  });
});

describe('Clean dialog', () => {
  const planItems = [previewItem(TEMP_A), previewItem(TEMP_B), previewItem(CACHE_SAFE)];

  it('plans exactly the selected rows, names the amount, and focuses Cancel', async () => {
    const user = userEvent.setup();
    const previewClean = vi.fn<DustApi['previewClean']>(async () => ({ ok: true, preview: previewFor(planItems) }));
    await openResults({ previewClean });
    await user.click(screen.getByRole('button', { name: 'Review and clean' }));

    const dialog = await screen.findByRole('dialog');
    expect(previewClean).toHaveBeenCalledWith({
      scope: 'row',
      root: 'C:\\',
      paths: [TEMP_A.path, TEMP_B.path, CACHE_SAFE.path],
    });
    const confirm = await within(dialog).findByRole('button', { name: 'Delete 3.5 GB' });
    expect(confirm).toBeEnabled();
    expect(within(dialog).getByRole('button', { name: 'Cancel' })).toHaveFocus();
    // No acknowledgement for safe items only.
    expect(within(dialog).queryByRole('checkbox')).not.toBeInTheDocument();
    expect(within(dialog).getByRole('list', { name: 'What will be deleted, by category' })).toBeInTheDocument();
  });

  it('holds back the confirm button until irreversible items are acknowledged, and sends them', async () => {
    const user = userEvent.setup();
    const items = [...planItems, previewItem(BIN, { action: 'empty-recycle-bin' })];
    const executeClean = vi.fn<DustApi['executeClean']>(async () => ({ ok: true, report: reportFor(items) }));
    await openResults({
      previewClean: async () => ({ ok: true, preview: previewFor(items) }),
      executeClean,
    });
    await user.click(screen.getByRole('checkbox', { name: 'Select all in Recycle Bin' }));
    await user.click(screen.getByRole('button', { name: 'Review and clean' }));

    const dialog = await screen.findByRole('dialog');
    const confirm = await within(dialog).findByRole('button', { name: 'Delete 4.3 GB' });
    expect(confirm).toBeDisabled();
    await user.click(within(dialog).getByRole('checkbox', { name: /cannot be recovered/ }));
    expect(confirm).toBeEnabled();
    await user.click(confirm);

    await waitFor(() => expect(executeClean).toHaveBeenCalled());
    expect(executeClean.mock.calls[0]![0]).toMatchObject({ planId: 'plan-1', acknowledge: [BIN.path] });
  });

  it('shows progress, then a summary with the drive read again, and clears the selection', async () => {
    const user = userEvent.setup();
    let finish: (report: CleanReport) => void = () => {};
    const executeClean = vi.fn<DustApi['executeClean']>(
      () => new Promise((resolve) => (finish = (report) => resolve({ ok: true, report }))),
    );
    let used = 800 * MB;
    const base = makeApi();
    const getDashboard = vi.fn<DustApi['getDashboard']>(async () => {
      const state = await base.getDashboard();
      return {
        ...state,
        volumes: state.volumes.map((volume) =>
          volume.role === 'system' ? { ...volume, totalBytes: GB, freeBytes: GB - used } : volume,
        ),
      };
    });
    await openResults({
      getDashboard,
      previewClean: async () => ({ ok: true, preview: previewFor(planItems) }),
      executeClean,
    });
    await user.click(screen.getByRole('button', { name: 'Review and clean' }));
    const dialog = await screen.findByRole('dialog');
    await user.click(await within(dialog).findByRole('button', { name: 'Delete 3.5 GB' }));

    await waitFor(() => expect(executeClean).toHaveBeenCalled());
    const { cleanId } = executeClean.mock.calls[0]![0];
    // While deleting the window cannot be dismissed.
    expect(within(dialog).queryByRole('button', { name: 'Close' })).not.toBeInTheDocument();
    act(() => {
      useCleanStore.getState().applyBatch(new Map([[cleanId, reportFor(planItems).items.slice(0, 1)]]), new Map());
    });
    expect(await within(dialog).findByText(/Deleted 1 of 3 items · 2\.0 GB freed/)).toBeInTheDocument();
    // Weighted by size: 2 of the 3.5 GB.
    expect(within(dialog).getByRole('progressbar', { name: 'Deleting' })).toHaveAttribute('aria-valuenow', '57');

    used = 300 * MB;
    await act(async () => finish(reportFor(planItems)));
    expect(await within(dialog).findByText('3.5 GB')).toBeInTheDocument();
    expect(within(dialog).getByText('freed')).toBeInTheDocument();
    // The "now" figure is the one the backend reported after the clean.
    expect(await within(dialog).findByText('Now: 300 MB of 1.0 GB used')).toBeInTheDocument();
    expect(within(dialog).getByText('Before: 800 MB of 1.0 GB used')).toBeInTheDocument();
    expect(within(dialog).getByRole('button', { name: 'Done' })).toHaveFocus();
    expect(dialog).toContainElement(document.activeElement as HTMLElement);
  });

  it('reports what could not be cleaned in plain words and offers an administrator relaunch', async () => {
    const user = userEvent.setup();
    const adminItem = previewItem(TEMP_B, { adminRequired: true });
    const items = [previewItem(TEMP_A), adminItem];
    const relaunchElevated = vi.fn(async () => {});
    const report = reportFor(items);
    report.items[1] = { ...report.items[1]!, status: 'failed', deletedBytes: 0, errorCount: 1 };
    report.deletedBytes = TEMP_A.bytes;
    await openResults({
      previewClean: async () => ({ ok: true, preview: previewFor(items) }),
      executeClean: async () => ({ ok: true, report }),
      relaunchElevated,
    });
    await user.click(screen.getByRole('button', { name: 'Review and clean' }));
    const dialog = await screen.findByRole('dialog');
    expect(await within(dialog).findByText(/1 item needs administrator rights/)).toBeInTheDocument();
    await user.click(await within(dialog).findByRole('button', { name: /^Delete / }));

    expect(await within(dialog).findByText('1 item could not be fully cleaned.')).toBeInTheDocument();
    expect(within(dialog).getByText(/Could not be cleaned/)).toBeInTheDocument();
    await user.click(within(dialog).getByRole('button', { name: 'Relaunch as administrator' }));
    expect(relaunchElevated).toHaveBeenCalled();
  });

  it('explains a refused plan and can try again', async () => {
    const user = userEvent.setup();
    const previewClean = vi
      .fn<DustApi['previewClean']>()
      .mockResolvedValueOnce({ ok: false, reason: 'busy', running: 'analyze' })
      .mockResolvedValue({ ok: true, preview: previewFor(planItems) });
    await openResults({ previewClean });
    await user.click(screen.getByRole('button', { name: 'Review and clean' }));
    const dialog = await screen.findByRole('dialog');
    expect(await within(dialog).findByText(/A scan is running right now/)).toBeInTheDocument();
    await user.click(within(dialog).getByRole('button', { name: 'Try again' }));
    expect(await within(dialog).findByRole('button', { name: 'Delete 3.5 GB' })).toBeInTheDocument();
    expect(previewClean).toHaveBeenCalledTimes(2);
  });

  it('keeps the list when the dialog is cancelled', async () => {
    const user = userEvent.setup();
    const executeClean = vi.fn<DustApi['executeClean']>();
    await openResults({ previewClean: async () => ({ ok: true, preview: previewFor(planItems) }), executeClean });
    await user.click(screen.getByRole('button', { name: 'Review and clean' }));
    const dialog = await screen.findByRole('dialog');
    await user.click(await within(dialog).findByRole('button', { name: 'Cancel' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(executeClean).not.toHaveBeenCalled();
    expect(footer()).toHaveTextContent('3.5 GB selected');
    // Focus goes back to the button that opened it.
    expect(screen.getByRole('button', { name: 'Review and clean' })).toHaveFocus();
  });
});

describe('Quick clean', () => {
  it('builds a quick plan from Home, shows its scope, and cancels the scan if closed early', async () => {
    const user = userEvent.setup();
    const cancelScan = vi.fn(async () => {});
    const previewClean = vi.fn<DustApi['previewClean']>(() => new Promise(() => {}));
    const api = makeApi({
      cancelScan,
      previewClean,
      getResultCategories: async () => ({
        source: 'snapshot',
        root: 'C:\\',
        finishedAt: Date.now() - 60_000,
        status: 'complete',
        rulesStale: false,
        depthLimited: false,
        categories: [categoryRow('temp', GB, 2)],
      }),
    });
    render(<App api={api} />);
    await user.click(await screen.findByRole('button', { name: 'Quick clean' }));
    expect(previewClean).toHaveBeenCalledWith({ scope: 'quick' });
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByText(/never touches project dependencies/)).toBeInTheDocument();
    await user.click(within(dialog).getByRole('button', { name: 'Cancel' }));
    expect(cancelScan).toHaveBeenCalled();
  });

  it('asks for the quick plan once, even when the dialog mounts twice', async () => {
    const user = userEvent.setup();
    const previewClean = vi.fn<DustApi['previewClean']>(async () => ({
      ok: true,
      preview: previewFor([previewItem(TEMP_A)], { source: 'targeted' }),
    }));
    const api = makeApi({
      previewClean,
      getResultCategories: async () => ({
        source: 'snapshot',
        root: 'C:\\',
        finishedAt: Date.now() - 60_000,
        status: 'complete',
        rulesStale: false,
        depthLimited: false,
        categories: [categoryRow('temp', GB, 2)],
      }),
    });
    // Development builds run every effect twice; a second quick scan would be refused as busy.
    render(
      <StrictMode>
        <App api={api} />
      </StrictMode>,
    );
    await user.click(await screen.findByRole('button', { name: 'Quick clean' }));
    expect(await screen.findByRole('button', { name: 'Delete 2.0 GB' })).toBeInTheDocument();
    expect(previewClean).toHaveBeenCalledTimes(1);
  });
});

describe('Scan view', () => {
  function startRun(patch: Record<string, unknown> = {}) {
    act(() => {
      useScanStore.getState().applyPatches(
        new Map([
          [
            'run-1',
            {
              root: 'C:\\',
              startedAt: Date.now() - 65_000,
              progress: {
                filesScanned: 645_475,
                bytesSeen: 93 * GB,
                currentPath: `C:\\Users\\x\\AppData\\Local\\${'Deep\\'.repeat(30)}file.tmp`,
                dirsCompleted: 1,
                errors: 0,
                elapsedMs: 1000,
              },
              categories: [categoryRow('temp', GB, 3)],
              ...patch,
            },
          ],
        ]),
      );
    });
  }

  it('shows progress, the elapsed time, a shortened path and what was found so far', async () => {
    const api = makeApi({ getResultsSummary: async () => summary() });
    render(<App api={api} />);
    startRun();
    act(() => {
      useNavStore.getState().navigate('cleanup', { view: 'scan', root: 'C:\\', runId: 'run-1', usedBytes: 186 * GB });
    });
    expect(await screen.findByText('Scanning C:\\ — 645,475 files')).toBeInTheDocument();
    expect(screen.getByText(/01:0\d elapsed/)).toBeInTheDocument();
    expect(screen.getByRole('progressbar', { name: 'Scanning C:\\' })).toHaveAttribute('aria-valuenow', '50');
    const path = document.querySelector('p[title^="C:\\\\Users"]')!;
    expect(path.textContent).toContain('…');
    expect(path.textContent!.length).toBeLessThanOrEqual(72);
    expect(screen.getByText('Temporary files · 1.0 GB')).toBeInTheDocument();
  });

  it('cancels the scan on request', async () => {
    const user = userEvent.setup();
    const cancelScan = vi.fn(async () => {});
    render(<App api={makeApi({ cancelScan })} />);
    startRun();
    act(() => {
      useNavStore.getState().navigate('cleanup', { view: 'scan', root: 'C:\\', runId: 'run-1', usedBytes: null });
    });
    await user.click(await screen.findByRole('button', { name: 'Cancel' }));
    expect(cancelScan).toHaveBeenCalled();
  });

  it('goes to the results of a cancelled scan with a notice, after reading them again', async () => {
    const getResultsSummary = vi.fn<DustApi['getResultsSummary']>(async () => summary({ status: 'cancelled' }));
    render(<App api={makeApi({ getResultsSummary })} />);
    startRun();
    act(() => {
      useNavStore.getState().navigate('cleanup', { view: 'scan', root: 'C:\\', runId: 'run-1', usedBytes: null });
    });
    await screen.findByText(/files$/);
    startRun({ outcome: { type: 'finished', status: 'cancelled' } });
    expect(await screen.findByText('Scan cancelled. Showing what was found.')).toBeInTheDocument();
    expect(useNavStore.getState().params.cleanup).toEqual({ view: 'results', root: 'C:\\' });
    expect(getResultsSummary).toHaveBeenCalled();
  });

  it('opens a scan that is already finished when the page mounts', async () => {
    render(<App api={makeApi({ getResultsSummary: async () => summary() })} />);
    startRun({ outcome: { type: 'finished', status: 'complete' } });
    act(() => {
      useNavStore.getState().navigate('cleanup', { view: 'scan', root: 'C:\\', runId: 'run-1', usedBytes: null });
    });
    expect(await screen.findByRole('list', { name: 'Categories that can be cleaned' })).toBeInTheDocument();
  });

  it('shows a failed scan in plain words with a way to retry', async () => {
    const startAnalyze = vi.fn(async () => ({ ok: true as const, runId: 'run-2' }));
    const user = userEvent.setup();
    render(<App api={makeApi({ startAnalyze })} />);
    startRun({ outcome: { type: 'failed', message: 'The drive went away.' } });
    act(() => {
      useNavStore.getState().navigate('cleanup', { view: 'scan', root: 'C:\\', runId: 'run-1', usedBytes: null });
    });
    expect(await screen.findByText('The scan did not finish')).toBeInTheDocument();
    expect(screen.getByText('The drive went away.')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Try again' }));
    expect(startAnalyze).toHaveBeenCalledWith('C:\\');
  });

  it('opens the running scan from the sidebar', async () => {
    const user = userEvent.setup();
    render(<App api={makeApi()} />);
    startRun();
    await user.click(
      within(screen.getByRole('navigation', { name: 'Main' })).getByRole('button', { name: 'Clean up' }),
    );
    expect(await screen.findByText('Scanning C:\\ — 645,475 files')).toBeInTheDocument();
  });
});
