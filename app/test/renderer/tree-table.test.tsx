import { fireEvent, render, screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { TreeTable } from '../../renderer/src/components/TreeTable';
import { createRowStore, flattenVisible, pathKey, upsertRows } from '../../renderer/src/tree';
import type { SortState } from '../../renderer/src/tree';
import { makeResultsRows } from './fakes';

function setup(
  overrides: {
    expanded?: ReadonlySet<string>;
    sort?: SortState;
    totalBytes?: number;
    selectedPath?: string | null;
    rows?: ReturnType<typeof makeResultsRows>;
  } = {},
) {
  const store = createRowStore('C:\\');
  upsertRows(store, overrides.rows ?? makeResultsRows());
  const expanded = overrides.expanded ?? new Set([pathKey('C:\\Users')]);
  const sort = overrides.sort ?? { key: 'size' as const, desc: true };
  const onToggle = vi.fn();
  const onReveal = vi.fn();
  const onSelect = vi.fn();
  const onSortChange = vi.fn();
  const rows = flattenVisible(store, expanded, sort, null);
  render(
    <TreeTable
      rows={rows}
      totalBytes={overrides.totalBytes ?? 1024 * 1024}
      sort={sort}
      onSortChange={onSortChange}
      expanded={expanded}
      onToggle={onToggle}
      onReveal={onReveal}
      onSelect={onSelect}
      selectedPath={overrides.selectedPath ?? null}
    />,
  );
  return { onToggle, onReveal, onSelect, onSortChange, rows };
}

describe('TreeTable', () => {
  it('renders the tree with all seven columns and formatted cells', () => {
    setup();

    for (const header of ['Name', 'Size', 'Files / Folders', '%', 'Safety', 'Last modified', 'Action']) {
      expect(screen.getByRole('columnheader', { name: new RegExp(header) })).toBeInTheDocument();
    }
    expect(screen.getByText('Users')).toBeInTheDocument();
    expect(screen.getByText('Temp')).toBeInTheDocument();
    expect(screen.getAllByText('256 KB')).toHaveLength(1);
    expect(screen.getByText('4 / 0')).toBeInTheDocument();
    expect(screen.getByText('25.0%')).toBeInTheDocument();
  });

  it('toggles expansion and reveals paths', () => {
    const { onToggle, onReveal } = setup();

    fireEvent.click(screen.getByRole('button', { name: 'Collapse Users' }));
    expect(onToggle).toHaveBeenCalledWith('C:\\Users');

    fireEvent.doubleClick(screen.getByText('Temp'));
    expect(onReveal).toHaveBeenCalledWith('C:\\Temp');

    fireEvent.click(screen.getAllByRole('button', { name: /^Explore/ })[0]!);
    expect(onReveal).toHaveBeenCalledTimes(2);
  });

  it('reports sort changes and shows the active sort direction', () => {
    const { onSortChange } = setup();

    fireEvent.click(screen.getByRole('button', { name: /Name/ }));
    expect(onSortChange).toHaveBeenCalledWith({ key: 'name', desc: false });

    fireEvent.click(screen.getByRole('button', { name: /Size/ }));
    expect(onSortChange).toHaveBeenCalledWith({ key: 'size', desc: false });
  });

  it('nests the sort control inside the columnheader and omits a disabled Action header button', () => {
    setup();

    const nameHeader = screen.getByRole('columnheader', { name: /Name/ });
    expect(within(nameHeader).getByRole('button', { name: /Name/ })).toBeInTheDocument();

    const actionHeader = screen.getByRole('columnheader', { name: 'Action' });
    expect(within(actionHeader).queryByRole('button')).toBeNull();
  });

  it('makes the virtualized ledger region keyboard-scrollable', () => {
    setup();

    expect(screen.getByRole('table', { name: 'Folder tree' })).toHaveAttribute('tabindex', '0');
  });

  it('exposes the full row count and virtual row positions to assistive tech', () => {
    const { rows } = setup();

    const table = screen.getByRole('table', { name: 'Folder tree' });
    expect(table).toHaveAttribute('aria-rowcount', String(rows.length + 1));
    expect(table).toHaveAttribute('aria-colcount', '7');

    const indexed = table.querySelectorAll('[role="row"][aria-rowindex]');
    expect(indexed).toHaveLength(rows.length + 1);
    expect(indexed[0]).toHaveAttribute('aria-rowindex', '1');
    expect(indexed[1]).toHaveAttribute('aria-rowindex', '2');
  });

  it('shows a percent placeholder before the total size is known', () => {
    setup({ totalBytes: 0 });

    expect(screen.queryByText('25.0%')).toBeNull();
    expect(screen.queryAllByText('0.0%')).toHaveLength(0);
    expect(screen.getAllByText('—').length).toBeGreaterThan(0);
  });

  it('shows the grade pill and expands the why-this-grade disclosure for a matched row', () => {
    setup({ selectedPath: 'C:\\Temp' });

    expect(screen.getByText('Safe')).toBeInTheDocument();
    expect(screen.getByText('Why this grade')).toBeInTheDocument();
    expect(screen.getByText('User TEMP directory - junk by definition')).toBeInTheDocument();
    expect(screen.getByText('Rule: system-temp')).toBeInTheDocument();
  });

  it('opens the grade disclosure when the safety cell is clicked', () => {
    const { onSelect } = setup();

    fireEvent.click(screen.getByRole('button', { name: 'Why Temp is graded Safe' }));
    expect(onSelect).toHaveBeenCalledWith('C:\\Temp');
  });

  it('offers Explore for non-protected rows and no per-row Clean action', () => {
    const { onReveal } = setup();

    expect(screen.queryByRole('button', { name: 'Clean Temp' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Explore Temp' }));
    expect(onReveal).toHaveBeenCalledWith('C:\\Temp');
    expect(screen.queryByRole('button', { name: 'Explore Windows' })).toBeNull();
  });

  it('labels detected rows and keeps them display-only', () => {
    setup({
      rows: makeResultsRows().map((row) =>
        row.path === 'C:\\Temp'
          ? {
              ...row,
              action: null,
              grade: 'review' as const,
              gradeReason: 'Leftover cache from Spotify (not installed)',
              detected: true,
            }
          : row,
      ),
      selectedPath: 'C:\\Temp',
    });

    expect(screen.getByText('Detected')).toBeInTheDocument();
    expect(screen.getByText('Leftover cache from Spotify (not installed)')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Clean Temp' })).toBeNull();
  });
});
