import { createColumnHelper, flexRender, getCoreRowModel, useReactTable } from '@tanstack/react-table';
import { useVirtualizer } from '@tanstack/react-virtual';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { CATEGORY_LABELS } from '../../../src/shared/categories';
import type { BrowseRow, ResultRow } from '../../../src/shared/ipc';
import type { BrowseFlatRow } from '../browse-tree';
import type { FlatRow, SortKey, SortState } from '../tree';
import { pathKey } from '../tree';
import { formatBytes, formatCount, formatRelativeTime } from '../format';
import { GradePill, gradeWord } from './GradePill';
import { ArrowDownIcon, ArrowUpIcon, ChevronRightIcon, FolderIcon } from './icons';

const GRID_ANALYZE =
  'grid grid-cols-[minmax(12rem,2.4fr)_84px_118px_108px_128px_128px_92px] items-center gap-1 min-w-[54rem]';
const GRID_BROWSE =
  'grid grid-cols-[minmax(12rem,2.4fr)_84px_150px_116px_170px] items-center gap-1 min-w-[46rem]';
const EASE = 'ease-[cubic-bezier(0.16,1,0.3,1)]';

const RIGHT_ALIGNED = new Set(['size', 'allocated', 'items', 'percent', 'action']);

const SORTABLE_ANALYZE: Record<string, SortKey | null> = {
  name: 'name',
  size: 'size',
  items: 'items',
  percent: 'percent',
  grade: 'grade',
  modified: 'modified',
  action: null,
};

const SORTABLE_BROWSE: Record<string, SortKey | null> = {
  name: 'name',
  size: 'size',
  items: 'items',
  modified: 'modified',
  action: null,
};

type TreeRow = ResultRow | BrowseRow;

interface TableFlatRow {
  row: TreeRow;
  depth: number;
  hasChildren: boolean;
}

const columnHelper = createColumnHelper<TableFlatRow>();

export interface TreeTableProps {
  mode?: 'analyze' | 'browse';
  rows: FlatRow[] | BrowseFlatRow[];
  totalBytes: number;
  sort: SortState;
  onSortChange: (sort: SortState) => void;
  expanded: ReadonlySet<string>;
  onToggle: (path: string) => void;
  onReveal: (path: string) => void;
  onSelect?: (path: string) => void;
  onDelete?: (path: string) => void;
  selectedPath?: string | null;
  toolbar?: ReactNode;
  empty?: ReactNode;
}

export function TreeTable({
  mode = 'analyze',
  rows,
  totalBytes,
  sort,
  onSortChange,
  expanded,
  onToggle,
  onReveal,
  onSelect,
  onDelete,
  selectedPath = null,
  toolbar,
  empty,
}: TreeTableProps) {
  const browse = mode === 'browse';
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const data = rows as unknown as TableFlatRow[];
  const selectedKey = selectedPath !== null ? pathKey(selectedPath) : null;
  const [scrollState, setScrollState] = useState({ overflowing: false, atEnd: false });

  const updateScrollState = useCallback(() => {
    const element = scrollRef.current;
    if (element === null) return;
    const overflowing = element.scrollWidth - element.clientWidth > 1;
    const atEnd = element.scrollLeft + element.clientWidth >= element.scrollWidth - 1;
    setScrollState((current) =>
      current.overflowing === overflowing && current.atEnd === atEnd
        ? current
        : { overflowing, atEnd },
    );
  }, []);

  useEffect(() => {
    const element = scrollRef.current;
    if (element === null) return;
    updateScrollState();
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(updateScrollState);
    observer?.observe(element);
    element.addEventListener('scroll', updateScrollState, { passive: true });
    return () => {
      observer?.disconnect();
      element.removeEventListener('scroll', updateScrollState);
    };
  }, [updateScrollState, data.length]);

  const columns = useMemo(() => {
    const name = columnHelper.accessor((item) => item.row.name, {
      id: 'name',
      header: 'Name',
      cell: (info) => {
        const item = info.row.original;
        const row = item.row;
        const isExpanded = expanded.has(pathKey(row.path));
        const dim = 'grade' in row && row.grade === 'danger';
        return (
          <div className="flex min-w-0 items-center gap-1.5" style={{ paddingLeft: `${item.depth * 16}px` }}>
            {item.hasChildren ? (
              <button
                type="button"
                aria-label={`${isExpanded ? 'Collapse' : 'Expand'} ${row.name}`}
                aria-expanded={isExpanded}
                onClick={() => onToggle(row.path)}
                className={`inline-flex h-5 w-5 shrink-0 items-center justify-center rounded text-ink-muted transition duration-150 ${EASE} hover:bg-canvas hover:text-ink focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-accent ${
                  isExpanded ? 'rotate-90' : ''
                }`}
              >
                <ChevronRightIcon className="h-3.5 w-3.5" />
              </button>
            ) : (
              <span className="w-5 shrink-0" />
            )}
            <FolderIcon className="h-4 w-4 shrink-0 text-ink-muted" />
            <span
              className={`min-w-0 truncate ${dim ? 'text-ink-muted' : 'text-ink'}`}
              title={row.path}
              onDoubleClick={() => onReveal(row.path)}
            >
              {row.name}
            </span>
            {!row.complete && <span className="shrink-0 text-xs text-ink-muted">scanning…</span>}
            {row.partial && <span className="shrink-0 text-xs text-ink-muted">partial</span>}
          </div>
        );
      },
    });

    const size = columnHelper.accessor((item) => item.row.bytes, {
      id: 'size',
      header: 'Size',
      cell: (info) => <span className="font-mono text-ink">{formatBytes(info.getValue())}</span>,
    });

    const items = columnHelper.accessor((item) => item.row.fileCount + item.row.folderCount, {
      id: 'items',
      header: 'Files / Folders',
      cell: (info) => (
        <span className="font-mono text-ink-muted">
          {formatCount(info.row.original.row.fileCount)} / {formatCount(info.row.original.row.folderCount)}
        </span>
      ),
    });

    const percent = columnHelper.accessor((item) => item.row.bytes, {
      id: 'percent',
      header: '%',
      cell: (info) => {
        if (totalBytes <= 0) {
          return <span className="font-mono text-xs text-ink-muted">—</span>;
        }
        const value = (info.getValue() / totalBytes) * 100;
        const clamped = Math.min(Math.max(value, 0), 100);
        return (
          <div className="flex items-center justify-end gap-2">
            <div className="h-1.5 w-10 shrink-0 overflow-hidden rounded-full bg-track">
              <div className="h-full rounded-full bg-accent" style={{ width: `${clamped}%` }} />
            </div>
            <span className="font-mono text-xs text-ink-muted">
              {value > 0 && value < 0.1 ? '<0.1%' : `${value.toFixed(1)}%`}
            </span>
          </div>
        );
      },
    });

    const modified = columnHelper.accessor((item) => item.row.newestMtimeMs, {
      id: 'modified',
      header: 'Last modified',
      cell: (info) => (
        <span className="text-xs text-ink-muted">
          {info.getValue() > 0 ? formatRelativeTime(info.getValue()) : '—'}
        </span>
      ),
    });

    const exploreButton = (path: string, name: string) => (
      <button
        type="button"
        aria-label={`Explore ${name}`}
        onClick={() => onReveal(path)}
        className="inline-flex items-center rounded-lg px-2.5 py-1 text-xs font-medium text-ink-muted transition-colors hover:bg-canvas hover:text-ink focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-accent"
      >
        Explore
      </button>
    );

    if (browse) {
      return [
        name,
        size,
        items,
        modified,
        columnHelper.display({
          id: 'action',
          header: 'Action',
          cell: (info) => {
            const row = info.row.original.row;
            return (
              <div className="flex justify-end gap-1">
                <button
                  type="button"
                  aria-label={`Delete ${row.name}`}
                  onClick={() => onDelete?.(row.path)}
                  className="inline-flex items-center rounded-lg border border-hairline bg-surface px-2.5 py-1 text-xs font-semibold text-ink transition-colors hover:border-accent hover:text-accent focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-accent"
                >
                  Delete
                </button>
                {exploreButton(row.path, row.name)}
              </div>
            );
          },
        }),
      ];
    }

    return [
      name,
      size,
      items,
      percent,
      columnHelper.accessor((item) => ('grade' in item.row ? item.row.grade : 'review'), {
        id: 'grade',
        header: 'Safety',
        cell: (info) => {
          const row = info.row.original.row as ResultRow;
          const grade = row.action ? row.action.grade : row.grade;
          const word = gradeWord(grade);
          const open = selectedKey !== null && selectedKey === pathKey(row.path);
          return (
            <button
              type="button"
              onClick={() => onSelect?.(row.path)}
              aria-expanded={open}
              aria-label={`Why ${row.name} is graded ${word}`}
              className="flex min-w-0 items-center gap-1.5 text-left focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-accent"
            >
              <GradePill grade={grade} />
              <ChevronRightIcon
                className={`h-3.5 w-3.5 shrink-0 text-ink-muted transition-transform duration-150 ${EASE} ${
                  open ? 'rotate-90' : ''
                }`}
              />
            </button>
          );
        },
      }),
      modified,
      columnHelper.display({
        id: 'action',
        header: 'Action',
        cell: (info) => {
          const row = info.row.original.row as ResultRow;
          const protectedRow = row.grade === 'danger';
          return (
            <div className="flex justify-end gap-1">
              {!protectedRow && exploreButton(row.path, row.name)}
            </div>
          );
        },
      }),
    ];
  }, [browse, expanded, onDelete, onReveal, onSelect, onToggle, totalBytes, selectedKey]);

  const table = useReactTable({ data, columns, getCoreRowModel: getCoreRowModel() });
  const virtualizer = useVirtualizer({
    count: data.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => 38,
    overscan: 12,
  });

  const sortable = browse ? SORTABLE_BROWSE : SORTABLE_ANALYZE;
  const grid = browse ? GRID_BROWSE : GRID_ANALYZE;
  const headers = table.getHeaderGroups()[0]?.headers ?? [];
  const virtualItems = virtualizer.getVirtualItems();

  return (
    <div className="relative overflow-hidden rounded-2xl border border-hairline bg-surface">
      {toolbar !== undefined && (
        <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 border-b border-hairline px-3 py-2.5">
          {toolbar}
        </div>
      )}
      <div
        ref={scrollRef}
        role="table"
        aria-label="Folder tree"
        aria-rowcount={data.length + 1}
        aria-colcount={headers.length}
        tabIndex={0}
        className="h-[560px] overflow-auto focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-accent"
      >
        <div
          role="row"
          aria-rowindex={1}
          className={`${grid} sticky top-0 z-10 border-b border-hairline bg-surface`}
        >
          {headers.map((header) => {
            const sortKey = sortable[header.id] ?? null;
            const active = sortKey !== null && sort.key === sortKey;
            const align = RIGHT_ALIGNED.has(header.id) ? 'text-right' : 'text-left';
            return (
              <div
                key={header.id}
                role="columnheader"
                aria-sort={
                  sortKey === null ? undefined : active ? (sort.desc ? 'descending' : 'ascending') : 'none'
                }
                className={`whitespace-nowrap px-2 py-2.5 text-xs font-semibold uppercase tracking-[0.08em] text-ink-muted ${align}`}
              >
                {sortKey === null ? (
                  <span>{flexRender(header.column.columnDef.header, header.getContext())}</span>
                ) : (
                  <button
                    type="button"
                    onClick={() => onSortChange({ key: sortKey, desc: active ? !sort.desc : sortKey !== 'name' })}
                    className={`inline-flex items-center transition-colors duration-150 ${EASE} hover:text-ink focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-accent`}
                  >
                    {flexRender(header.column.columnDef.header, header.getContext())}
                    {active && (
                      <span aria-hidden="true" className="ml-1 inline-flex">
                        {sort.desc ? <ArrowDownIcon className="h-3.5 w-3.5" /> : <ArrowUpIcon className="h-3.5 w-3.5" />}
                      </span>
                    )}
                  </button>
                )}
              </div>
            );
          })}
        </div>
        {data.length === 0 && empty !== undefined ? (
          <div role="row">
            <div role="cell">{empty}</div>
          </div>
        ) : (
        <div role="rowgroup" style={{ height: `${virtualizer.getTotalSize()}px`, position: 'relative' }}>
          {virtualItems.map((item) => {
            const flat = data[item.index];
            const tableRow = table.getRowModel().rows[item.index];
            if (!flat || !tableRow) return null;
            const row = flat.row;
            const protectedRow = 'grade' in row && row.grade === 'danger';
            const open = selectedKey !== null && selectedKey === pathKey(row.path);
            return (
              <div
                key={item.key}
                role="row"
                aria-rowindex={item.index + 2}
                data-index={item.index}
                ref={virtualizer.measureElement}
                className={`${grid} absolute left-0 top-0 w-full border-b border-hairline text-sm transition-colors duration-150 ${EASE} ${
                  open ? 'bg-accent-soft/50' : protectedRow ? 'bg-canvas/50' : 'hover:bg-canvas/60'
                }`}
                style={{ transform: `translateY(${item.start}px)` }}
              >
                {tableRow.getVisibleCells().map((cell) => (
                  <div
                    key={cell.id}
                    role="cell"
                    className={`min-w-0 truncate px-2 py-2 ${RIGHT_ALIGNED.has(cell.column.id) ? 'text-right' : ''}`}
                  >
                    {flexRender(cell.column.columnDef.cell, cell.getContext())}
                  </div>
                ))}
                {open && !browse && (
                  <div role="cell" style={{ gridColumn: '1 / -1' }} className="min-w-0">
                    <GradeDisclosure row={row as ResultRow} />
                  </div>
                )}
              </div>
            );
          })}
        </div>
        )}
      </div>
      {scrollState.overflowing && !scrollState.atEnd && (
        <div
          aria-hidden="true"
          className="pointer-events-none absolute bottom-3 right-3 top-0 w-12 bg-linear-to-l from-surface via-surface/80 to-transparent"
        />
      )}
    </div>
  );
}

function GradeDisclosure({ row }: { row: ResultRow }) {
  const reason = row.action ? row.action.evidence : row.gradeReason;
  const ruleId = row.action?.ruleId ?? null;
  const category = row.action?.category ?? null;
  return (
    <div className="dust-disclose border-t border-hairline bg-canvas/40 px-4 py-3">
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <p className="text-xs font-semibold uppercase tracking-[0.14em] text-ink-muted">Why this grade</p>
        {category !== null && <p className="text-xs text-ink-muted">Category: {CATEGORY_LABELS[category]}</p>}
      </div>
      <p className="mt-1 text-sm text-ink">{reason}</p>
      {ruleId !== null && <p className="mt-1 font-mono text-xs text-ink-muted">{`Rule: ${ruleId}`}</p>}
    </div>
  );
}
