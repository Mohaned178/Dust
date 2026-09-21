import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { TreeTable } from '../../renderer/src/components/TreeTable';
import { createRowStore, flattenVisible, pathKey, upsertRows } from '../../renderer/src/tree';
import type { SortState } from '../../renderer/src/tree';
import { makeResultsRows } from './fakes';

function setup(overrides: { expanded?: ReadonlySet<string>; sort?: SortState; totalBytes?: number } = {}) {
  const store = createRowStore('C:\\');
  upsertRows(store, makeResultsRows());
  const expanded = overrides.expanded ?? new Set([pathKey('C:\\Users')]);
  const sort = overrides.sort ?? { key: 'size' as const, desc: true };
  const onToggle = vi.fn();
  const onReveal = vi.fn();
  const onSelect = vi.fn();
  const onClean = vi.fn();
  const onSortChange = vi.fn();
  render(
    <TreeTable
      rows={flattenVisible(store, expanded, sort, null)}
      totalBytes={overrides.totalBytes ?? 1024 * 1024}
      sort={sort}
      onSortChange={onSortChange}
      expanded={expanded}
      onToggle={onToggle}
      onReveal={onReveal}
      onSelect={onSelect}
      onClean={onClean}
      selectedPath={null}
    />,
  );
  return { onToggle, onReveal, onSelect, onClean, onSortChange };
}

describe('TreeTable', () => {
  it('renders the tree with all eight columns and formatted cells', () => {
    setup();

    for (const header of ['Name', 'Size', 'Allocated', 'Files / Folders', '%', 'Safety', 'Last modified', 'Action']) {
      expect(screen.getByRole('columnheader', { name: new RegExp(header) })).toBeInTheDocument();
    }
    expect(screen.getByText('Users')).toBeInTheDocument();
    expect(screen.getByText('Temp')).toBeInTheDocument();
    expect(screen.getAllByText('256 KB')).toHaveLength(2);
    expect(screen.getByText('4 / 0')).toBeInTheDocument();
    expect(screen.getByText('25.0%')).toBeInTheDocument();
  });

  it('toggles expansion and reveals paths', () => {
    const { onToggle, onReveal } = setup();

    fireEvent.click(screen.getByRole('button', { name: 'Collapse Users' }));
    expect(onToggle).toHaveBeenCalledWith('C:\\Users');

    fireEvent.doubleClick(screen.getByText('Temp'));
    expect(onReveal).toHaveBeenCalledWith('C:\\Temp');

    fireEvent.click(screen.getAllByRole('button', { name: 'Explore' })[0]!);
    expect(onReveal).toHaveBeenCalledTimes(2);
  });

  it('reports sort changes and shows the active sort direction', () => {
    const { onSortChange } = setup();

    fireEvent.click(screen.getByRole('columnheader', { name: /Name/ }));
    expect(onSortChange).toHaveBeenCalledWith({ key: 'name', desc: false });

    fireEvent.click(screen.getByRole('columnheader', { name: /Size/ }));
    expect(onSortChange).toHaveBeenCalledWith({ key: 'size', desc: false });
  });

  it('shows a percent placeholder before the total size is known', () => {
    setup({ totalBytes: 0 });

    expect(screen.queryByText('25.0%')).toBeNull();
    expect(screen.queryAllByText('0.0%')).toHaveLength(0);
    expect(screen.getAllByText('—').length).toBeGreaterThan(0);
  });

  it('shows rule evidence and the action grade for matched rows', () => {
    const { onSelect } = setup();

    expect(screen.getByText('User TEMP directory - junk by definition')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Why Temp is graded safe' }));
    expect(onSelect).toHaveBeenCalledWith('C:\\Temp');
  });

  it('offers Clean only for rule-matched rows', () => {
    const { onClean } = setup();

    fireEvent.click(screen.getByRole('button', { name: 'Clean Temp' }));
    expect(onClean).toHaveBeenCalledWith('C:\\Temp');
    expect(screen.queryByRole('button', { name: 'Clean Users' })).toBeNull();
  });
});
