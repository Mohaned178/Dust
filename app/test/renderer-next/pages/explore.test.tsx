import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { App } from '../../../renderer-next/src/app/App';
import { useNavStore } from '../../../renderer-next/src/app/nav';
import type { DustApi, FolderChildrenOptions, ResultRow, ResultsSearchResult } from '../../../src/shared/ipc';
import { makeApi, makeResultsRows } from '../../renderer/fakes';

const MB = 1024 ** 2;
const ROOT = 'C:\\';

function folder(path: string, mb: number, childCount: number, grade: ResultRow['grade'] = 'review'): ResultRow {
  return {
    ...makeResultsRows()[1]!,
    path,
    name: path.split('\\').pop() ?? path,
    bytes: mb * MB,
    childCount,
    grade,
    action: null,
  };
}

const USERS = folder('C:\\Users', 1000, 2);
const WINDOWS = folder('C:\\Windows', 800, 1, 'danger');
const BIG = folder('C:\\Big', 500, 1100);
const PC = folder('C:\\Users\\pc', 700, 0);
const PUBLIC = folder('C:\\Users\\Public', 100, 0);
const LEAFLESS = folder('C:\\Lost', 50, 3);
const BIG_KIDS = Array.from({ length: 1100 }, (_, index) => folder(`C:\\Big\\n${index}`, 1, 0));

const TREE: Record<string, ResultRow[]> = {
  '': [USERS, WINDOWS, BIG, LEAFLESS],
  'c:\\users': [PC, PUBLIC],
  'c:\\big': BIG_KIDS,
  'c:\\lost': [],
};

function fakeChildren(calls: Array<{ path: string; options: FolderChildrenOptions | undefined }>) {
  return async (_root: string, path: string, options?: FolderChildrenOptions) => {
    calls.push({ path, options });
    const all = (TREE[path.toLowerCase()] ?? []).filter(
      (row) => !(options?.hideDanger === true && row.grade === 'danger'),
    );
    const sorted = [...all].sort((a, b) => b.bytes - a.bytes);
    const offset = options?.offset ?? 0;
    return { rows: sorted.slice(offset, offset + (options?.limit ?? 200)), total: sorted.length };
  };
}

function setup(overrides: Partial<DustApi> = {}) {
  const childCalls: Array<{ path: string; options: FolderChildrenOptions | undefined }> = [];
  const searchCalls: Array<{ query: string; options: unknown }> = [];
  const api = makeApi({
    getFolderChildren: fakeChildren(childCalls),
    searchResults: async (_root, query, options) => {
      searchCalls.push({ query, options });
      return { rows: [], total: 0 };
    },
    ...overrides,
  });
  return { api, childCalls, searchCalls };
}

async function openExplore(api: DustApi) {
  render(<App api={api} />);
  act(() => {
    useNavStore.getState().navigate('cleanup', { view: 'explore', root: ROOT });
  });
  await screen.findByRole('tree', { name: 'Folders' });
}

const treeItem = (name: RegExp | string) => screen.getByRole('treeitem', { name });

beforeAll(() => {
  // jsdom has no layout; give the map a width to draw into.
  Object.defineProperty(HTMLElement.prototype, 'clientWidth', { configurable: true, get: () => 800 });
});

afterEach(() => {
  vi.useRealTimers();
});

describe('Explore disk: folders', () => {
  it('opens from Clean up, focuses its heading, and lists the largest folders without protected ones', async () => {
    const user = userEvent.setup();
    const { api } = setup({ getResultsSummary: async () => ({ ...(await makeApi().getResultsSummary(ROOT)) }) });
    render(<App api={api} />);
    act(() => {
      useNavStore.getState().navigate('cleanup', { view: 'results', root: ROOT });
    });
    await user.click(await screen.findByRole('button', { name: /Explore disk/ }));

    // The page is a lazy chunk with its own placeholder heading; wait for the real one.
    await waitFor(() => expect(screen.getAllByRole('treeitem')).toHaveLength(3));
    const items = screen.getAllByRole('treeitem');
    const heading = screen.getByRole('heading', { level: 1, name: 'Explore disk' });
    await waitFor(() => expect(heading).toHaveFocus());
    expect(items.map((item) => item.getAttribute('aria-label'))).toEqual([
      'Users, 1000 MB',
      'Big, 500 MB',
      'Lost, 50 MB',
    ]);
    expect(screen.queryByText('Windows')).not.toBeInTheDocument();
  });

  it('opens a folder in place, one level deeper, asking only for its direct children', async () => {
    const user = userEvent.setup();
    const { api, childCalls } = setup();
    await openExplore(api);
    await user.click(treeItem(/^Users/));
    const pc = await screen.findByRole('treeitem', { name: /^pc/ });
    expect(pc).toHaveAttribute('aria-level', '2');
    expect(treeItem(/^Users/)).toHaveAttribute('aria-expanded', 'true');
    expect(childCalls.at(-1)).toEqual({
      path: 'C:\\Users',
      options: { limit: 1000, offset: 0, sort: 'size', hideDanger: true },
    });
    // Folders without subfolders cannot be opened.
    expect(pc).not.toHaveAttribute('aria-expanded');
    await user.click(treeItem(/^Users/));
    expect(screen.queryByRole('treeitem', { name: /^pc/ })).not.toBeInTheDocument();
  });

  it('loads a folder with 1,100 subfolders a page at a time', async () => {
    const user = userEvent.setup();
    const { api, childCalls } = setup();
    await openExplore(api);
    await user.click(treeItem(/^Big/));
    const prefix = 'c:\\big\\n';
    const folders = () =>
      [...document.querySelectorAll('[role=treeitem]')].filter((item) =>
        item.getAttribute('data-key')?.startsWith(prefix),
      ).length;
    // The end of the first page is drawn at once here (the test double draws every row), which asks for the next
    // page by itself, as scrolling to the end does in the app.
    await waitFor(() => expect(folders()).toBe(1100));
    expect(screen.queryByRole('button', { name: /more/ })).not.toBeInTheDocument();
    const big = childCalls.filter((call) => call.path === 'C:\\Big');
    expect(big.map((call) => call.options?.offset)).toEqual([0, 1000]);
    // The test double draws every row (the real list draws only those in view), so this one is slow.
  }, 30_000);

  it('says so when a folder has subfolders the saved scan did not keep', async () => {
    const user = userEvent.setup();
    const { api } = setup();
    await openExplore(api);
    await user.click(treeItem(/^Lost/));
    expect(await screen.findByText('Folders this deep were not saved. Scan again to see them.')).toBeInTheDocument();
  });

  it('shows protected folders, marked, only when asked, and starts again from the top', async () => {
    const user = userEvent.setup();
    const { api, childCalls } = setup();
    await openExplore(api);
    await user.click(treeItem(/^Users/));
    await screen.findByRole('treeitem', { name: /^pc/ });

    await user.click(screen.getByRole('switch', { name: 'Show protected items' }));
    const windows = await screen.findByRole('treeitem', { name: /^Windows/ });
    expect(within(windows).getByText('Protected')).toBeInTheDocument();
    expect(childCalls.at(-1)?.options).toMatchObject({ hideDanger: false });
    // Everything that was open is closed again.
    expect(screen.queryByRole('treeitem', { name: /^pc/ })).not.toBeInTheDocument();
  });

  it('can be driven from the keyboard: arrows move, right opens, left closes or goes up, End jumps', async () => {
    const user = userEvent.setup();
    const { api } = setup();
    await openExplore(api);
    const users = treeItem(/^Users/);
    // One row is the tab stop.
    expect(users).toHaveAttribute('tabindex', '0');
    expect(treeItem(/^Big/)).toHaveAttribute('tabindex', '-1');
    act(() => users.focus());

    await user.keyboard('{ArrowDown}');
    await waitFor(() => expect(treeItem(/^Big/)).toHaveFocus());
    await user.keyboard('{ArrowUp}{ArrowRight}');
    await screen.findByRole('treeitem', { name: /^pc/ });
    expect(treeItem(/^Users/)).toHaveFocus();
    // On an open folder, Right moves to its first child; Left from there goes back up.
    await user.keyboard('{ArrowRight}');
    await waitFor(() => expect(treeItem(/^pc/)).toHaveFocus());
    await user.keyboard('{ArrowLeft}');
    await waitFor(() => expect(treeItem(/^Users/)).toHaveFocus());
    await user.keyboard('{ArrowLeft}');
    await waitFor(() => expect(screen.queryByRole('treeitem', { name: /^pc/ })).not.toBeInTheDocument());

    await user.keyboard('{End}');
    await waitFor(() => expect(treeItem(/^Lost/)).toHaveFocus());
    await user.keyboard('{Home}');
    await waitFor(() => expect(treeItem(/^Users/)).toHaveFocus());
    await user.keyboard('{Enter}');
    await screen.findByRole('treeitem', { name: /^pc/ });
  });

  it('opens Explorer on a folder', async () => {
    const user = userEvent.setup();
    const revealPath = vi.fn(async () => {});
    const { api } = setup({ revealPath });
    await openExplore(api);
    await user.click(screen.getByRole('button', { name: 'Show Users in Explorer' }));
    expect(revealPath).toHaveBeenCalledWith('C:\\Users');
  });

  it('asks the backend to build its search index once, early', async () => {
    const { api, searchCalls } = setup();
    await openExplore(api);
    await waitFor(() => expect(searchCalls).toHaveLength(1));
    expect(searchCalls[0]).toMatchObject({ query: '<dust-index-warm-up>', options: { limit: 1 } });
  });

  it('has no scan to show when none was made, and a way back', async () => {
    const user = userEvent.setup();
    const { api } = setup({
      getResultsSummary: async () => ({
        ...(await makeApi().getResultsSummary(ROOT)),
        source: 'empty',
        finishedAt: null,
      }),
    });
    render(<App api={api} />);
    act(() => {
      useNavStore.getState().navigate('cleanup', { view: 'explore', root: ROOT });
    });
    expect(await screen.findByText('There is no scan to explore yet')).toBeInTheDocument();
    await user.click(within(screen.getByRole('main')).getByRole('button', { name: 'Clean up' }));
    expect(useNavStore.getState().params.cleanup).toEqual({ view: 'results', root: ROOT });
  });

  it('goes back to the results and puts focus on their heading', async () => {
    const user = userEvent.setup();
    const { api } = setup();
    await openExplore(api);
    await user.click(within(screen.getByRole('main')).getByRole('button', { name: 'Clean up' }));
    const heading = await screen.findByRole('heading', { level: 1, name: 'Clean up' });
    await waitFor(() => expect(heading).toHaveFocus());
  });
});

describe('Explore disk: search', () => {
  const hit = (path: string, mb: number) => folder(path, mb, 0);

  it('sends one request for a burst of typing, shows the count, and restores the tree on clear', async () => {
    const user = userEvent.setup();
    const searchResults = vi.fn(async (): Promise<ResultsSearchResult> => ({
      rows: [hit('C:\\Users\\pc', 700), hit('C:\\Users\\Public', 100)],
      total: 2,
    }));
    const { api } = setup({ searchResults });
    await openExplore(api);
    await waitFor(() => expect(searchResults).toHaveBeenCalledTimes(1)); // the warm-up

    const box = screen.getByRole('searchbox', { name: 'Search folders' });
    await user.type(box, 'users pc public');
    await screen.findByRole('list', { name: 'Search results' });
    expect(searchResults).toHaveBeenCalledTimes(2);
    expect(searchResults).toHaveBeenLastCalledWith(ROOT, 'users pc public', { limit: 500, hideDanger: true });
    expect(screen.getByText('2 matches')).toBeInTheDocument();
    expect(screen.queryByRole('tree')).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Clear search' }));
    expect(await screen.findByRole('tree', { name: 'Folders' })).toBeInTheDocument();
    expect(searchResults).toHaveBeenCalledTimes(2);
  });

  it('is honest when the results are capped, and when nothing matches', async () => {
    const user = userEvent.setup();
    const many = Array.from({ length: 5 }, (_, index) => hit(`C:\\Users\\x${index}`, 5 - index));
    const searchResults = vi.fn(async (_root: string, query: string): Promise<ResultsSearchResult> =>
      query === 'users' ? { rows: many, total: 1234 } : { rows: [], total: 0 },
    );
    const { api } = setup({ searchResults });
    await openExplore(api);
    const box = screen.getByRole('searchbox', { name: 'Search folders' });
    await user.type(box, 'users');
    expect(await screen.findByText(/Showing the largest 5 of 1,234 matches/)).toBeInTheDocument();
    await user.clear(box);
    await user.type(box, 'zzz');
    expect(await screen.findByText('Nothing matches “zzz”')).toBeInTheDocument();
  });

  it('shows only the newest answer when replies arrive out of order', async () => {
    const user = userEvent.setup();
    const resolvers = new Map<string, (result: ResultsSearchResult) => void>();
    const searchResults = vi.fn(
      (_root: string, query: string) =>
        new Promise<ResultsSearchResult>((resolve) => {
          if (query.startsWith('<')) resolve({ rows: [], total: 0 });
          else resolvers.set(query, resolve);
        }),
    );
    const { api } = setup({ searchResults });
    await openExplore(api);
    const box = screen.getByRole('searchbox', { name: 'Search folders' });
    await user.type(box, 'first');
    await waitFor(() => expect(resolvers.has('first')).toBe(true));
    await user.clear(box);
    await user.type(box, 'second');
    await waitFor(() => expect(resolvers.has('second')).toBe(true));

    await act(async () => resolvers.get('second')!({ rows: [hit('C:\\second', 1)], total: 1 }));
    await act(async () => resolvers.get('first')!({ rows: [hit('C:\\first', 1)], total: 1 }));
    expect(await screen.findByRole('listitem', { name: /C:\\second/ })).toBeInTheDocument();
    expect(screen.queryByRole('listitem', { name: /C:\\first/ })).not.toBeInTheDocument();
  });

  it('searches protected items too once they are switched on', async () => {
    const user = userEvent.setup();
    const searchResults = vi.fn(async (): Promise<ResultsSearchResult> => ({
      rows: [hit('C:\\Users\\pc', 1)],
      total: 1,
    }));
    const { api } = setup({ searchResults });
    await openExplore(api);
    await user.type(screen.getByRole('searchbox', { name: 'Search folders' }), 'pc');
    await screen.findByRole('list', { name: 'Search results' });
    await user.click(screen.getByRole('switch', { name: 'Show protected items' }));
    await waitFor(() => expect(searchResults).toHaveBeenLastCalledWith(ROOT, 'pc', { limit: 500, hideDanger: false }));
  });

  it('shows a result on the map', async () => {
    const user = userEvent.setup();
    const searchResults = vi.fn(async (_root: string, query: string): Promise<ResultsSearchResult> =>
      query === 'pc' ? { rows: [PC], total: 1 } : { rows: [], total: 0 },
    );
    const { api } = setup({ searchResults });
    await openExplore(api);
    await user.type(screen.getByRole('searchbox', { name: 'Search folders' }), 'pc');
    await user.click(await screen.findByRole('button', { name: 'Show pc on the map' }));
    // The search is still open over the tabs, so clear it to see the map.
    await user.click(screen.getByRole('button', { name: 'Clear search' }));
    const path = await screen.findByRole('navigation', { name: 'Folder path' });
    expect(
      within(path)
        .getAllByRole('listitem')
        .map((item) => item.textContent),
    ).toEqual(['C:\\', 'Users', 'pc']);
  });
});

describe('Explore disk: map', () => {
  it('draws the folders of a folder by size, drills in, and walks back out through the breadcrumb', async () => {
    const user = userEvent.setup();
    const { api } = setup();
    await openExplore(api);
    await user.click(screen.getByRole('tab', { name: 'Map' }));

    const map = await screen.findByRole('group', { name: 'Folders in C:\\, drawn by size' });
    const tiles = within(map).getAllByRole('button');
    expect(tiles.map((tile) => tile.getAttribute('aria-label')).sort()).toEqual([
      'Big, 500 MB. Open',
      'Lost, 50 MB. Open',
      'Users, 1000 MB. Open',
    ]);

    await user.click(within(map).getByRole('button', { name: /^Users/ }));
    const inner = await screen.findByRole('group', { name: 'Folders in Users, drawn by size' });
    // pc and Public leave 200 MB of Users for files and anything else.
    expect(within(inner).getByRole('img', { name: 'Everything else, 200 MB' })).toBeInTheDocument();
    // Folders without subfolders are shown but cannot be opened.
    expect(within(inner).getByRole('button', { name: 'pc, 700 MB' })).toBeInTheDocument();
    expect(screen.getByText('Users holds 1000 MB. Select a folder to look inside it.')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'C:\\' }));
    expect(await screen.findByRole('group', { name: 'Folders in C:\\, drawn by size' })).toBeInTheDocument();
  });

  it('keeps the tiles inside the frame and labels only the ones with room', async () => {
    const user = userEvent.setup();
    const { api } = setup();
    await openExplore(api);
    await user.click(screen.getByRole('tab', { name: 'Map' }));
    const map = await screen.findByRole('group', { name: /drawn by size/ });
    for (const tile of within(map).getAllByRole('button')) {
      const left = parseFloat(tile.style.left);
      const width = parseFloat(tile.style.width);
      expect(left + width).toBeLessThanOrEqual(800);
      expect(tile).toHaveAttribute('title');
    }
  });

  it('opens Explorer on the folder being viewed', async () => {
    const user = userEvent.setup();
    const revealPath = vi.fn(async () => {});
    const { api } = setup({ revealPath });
    await openExplore(api);
    await user.click(screen.getByRole('tab', { name: 'Map' }));
    await user.click(await screen.findByRole('button', { name: /^Users, / }));
    await user.click(await screen.findByRole('button', { name: 'Show in Explorer' }));
    expect(revealPath).toHaveBeenCalledWith('C:\\Users');
  });

  it('survives the tab being switched back and forth', async () => {
    const user = userEvent.setup();
    const { api } = setup();
    await openExplore(api);
    await user.click(screen.getByRole('tab', { name: 'Map' }));
    await screen.findByRole('group', { name: /drawn by size/ });
    await user.click(screen.getByRole('tab', { name: 'Folders' }));
    expect(await screen.findByRole('tree', { name: 'Folders' })).toBeInTheDocument();
    fireEvent.keyDown(document.body, { key: 'Escape' });
  });
});
