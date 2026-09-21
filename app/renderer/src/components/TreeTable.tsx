import { createColumnHelper, flexRender, getCoreRowModel, useReactTable } from '@tanstack/react-table';
import { useVirtualizer } from '@tanstack/react-virtual';
import { useMemo, useRef } from 'react';
import type { DisplayGrade } from '@dust/core';
import type { FlatRow, SortKey, SortState } from '../tree';
import { pathKey } from '../tree';
import { formatBytes, formatCount, formatRelativeTime } from '../format';

const GRID =
  'grid grid-cols-[minmax(0,2.5fr)_90px_90px_130px_120px_minmax(0,1.8fr)_110px_90px] items-center gap-1';

const SORTABLE: Record<string, SortKey | null> = {
  name: 'name',
  size: 'size',
  allocated: 'allocated',
  items: 'items',
  percent: 'percent',
  grade: 'grade',
  modified: 'modified',
  action: null,
};

const columnHelper = createColumnHelper<FlatRow>();

export interface TreeTableProps {
  rows: FlatRow[];
  totalBytes: number;
  sort: SortState;
  onSortChange: (sort: SortState) => void;
  expanded: ReadonlySet<string>;
  onToggle: (path: string) => void;
  onReveal: (path: string) => void;
  onSelect: (path: string) => void;
  selectedPath: string | null;
}

export function TreeTable({
  rows,
  totalBytes,
  sort,
  onSortChange,
  expanded,
  onToggle,
  onReveal,
  onSelect,
  selectedPath,
}: TreeTableProps) {
  const scrollRef = useRef<HTMLDivElement | null>(null);

  const columns = useMemo(
    () => [
      columnHelper.accessor((item) => item.row.name, {
        id: 'name',
        header: 'Name',
        cell: (info) => {
          const item = info.row.original;
          const row = item.row;
          const isExpanded = expanded.has(pathKey(row.path));
          return (
            <div className="flex min-w-0 items-center gap-1" style={{ paddingLeft: `${item.depth * 16}px` }}>
              {item.hasChildren ? (
                <button
                  type="button"
                  aria-label={`${isExpanded ? 'Collapse' : 'Expand'} ${row.name}`}
                  aria-expanded={isExpanded}
                  onClick={() => onToggle(row.path)}
                  className="w-5 shrink-0 text-neutral-400"
                >
                  {isExpanded ? '▾' : '▸'}
                </button>
              ) : (
                <span className="w-5 shrink-0" />
              )}
              <span
                className="min-w-0 truncate text-neutral-100"
                title={row.path}
                onDoubleClick={() => onReveal(row.path)}
              >
                {row.name}
              </span>
              {!row.complete && <span className="shrink-0 text-xs text-neutral-500">scanning…</span>}
              {row.partial && <span className="shrink-0 text-xs text-amber-400">partial</span>}
            </div>
          );
        },
      }),
      columnHelper.accessor((item) => item.row.bytes, {
        id: 'size',
        header: 'Size',
        cell: (info) => <span className="tabular-nums text-neutral-200">{formatBytes(info.getValue())}</span>,
      }),
      columnHelper.accessor((item) => item.row.allocatedBytes, {
        id: 'allocated',
        header: 'Allocated',
        cell: (info) => <span className="tabular-nums text-neutral-400">{formatBytes(info.getValue())}</span>,
      }),
      columnHelper.accessor((item) => item.row.fileCount + item.row.folderCount, {
        id: 'items',
        header: 'Files / Folders',
        cell: (info) => (
          <span className="tabular-nums text-neutral-400">
            {formatCount(info.row.original.row.fileCount)} / {formatCount(info.row.original.row.folderCount)}
          </span>
        ),
      }),
      columnHelper.accessor((item) => item.row.bytes, {
        id: 'percent',
        header: '%',
        cell: (info) => {
          if (totalBytes <= 0) {
            return <span className="tabular-nums text-xs text-neutral-400">—</span>;
          }
          const percent = (info.getValue() / totalBytes) * 100;
          const clamped = Math.min(Math.max(percent, 0), 100);
          return (
            <div className="flex items-center gap-2">
              <div className="h-1.5 w-12 shrink-0 overflow-hidden rounded-full bg-neutral-800">
                <div className="h-full bg-emerald-500" style={{ width: `${clamped}%` }} />
              </div>
              <span className="tabular-nums text-xs text-neutral-400">
                {percent > 0 && percent < 0.1 ? '<0.1%' : `${percent.toFixed(1)}%`}
              </span>
            </div>
          );
        },
      }),
      columnHelper.accessor((item) => item.row.grade, {
        id: 'grade',
        header: 'Safety',
        cell: (info) => {
          const row = info.row.original.row;
          const label = row.action ? row.action.grade : row.grade;
          const detail = row.action ? row.action.evidence : row.gradeReason;
          return (
            <button
              type="button"
              onClick={() => onSelect(row.path)}
              title={detail}
              aria-label={`Why ${row.name} is graded ${label}`}
              className="flex min-w-0 items-center gap-2 text-left"
            >
              <GradeBadge grade={label} />
              <span className="min-w-0 truncate text-xs text-neutral-400">{detail}</span>
            </button>
          );
        },
      }),
      columnHelper.accessor((item) => item.row.newestMtimeMs, {
        id: 'modified',
        header: 'Last modified',
        cell: (info) => (
          <span className="text-xs text-neutral-400">
            {info.getValue() > 0 ? formatRelativeTime(info.getValue()) : '—'}
          </span>
        ),
      }),
      columnHelper.display({
        id: 'action',
        header: 'Action',
        cell: (info) => (
          <button
            type="button"
            onClick={() => onReveal(info.row.original.row.path)}
            className="rounded-md border border-neutral-700 px-2 py-1 text-xs text-neutral-200"
          >
            Explore
          </button>
        ),
      }),
    ],
    [expanded, onReveal, onSelect, onToggle, totalBytes],
  );

  const table = useReactTable({ data: rows, columns, getCoreRowModel: getCoreRowModel() });
  const virtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => 36,
    overscan: 12,
  });

  const headers = table.getHeaderGroups()[0]?.headers ?? [];
  const virtualItems = virtualizer.getVirtualItems();

  return (
    <div
      ref={scrollRef}
      role="table"
      aria-label="Folder tree"
      className="h-[560px] overflow-auto rounded-xl border border-neutral-800 bg-neutral-900"
    >
      <div role="row" className={`${GRID} sticky top-0 z-10 border-b border-neutral-800 bg-neutral-900 px-2`}>
        {headers.map((header) => {
          const sortKey = SORTABLE[header.id] ?? null;
          const active = sortKey !== null && sort.key === sortKey;
          return (
            <button
              key={header.id}
              type="button"
              role="columnheader"
              aria-sort={active ? (sort.desc ? 'descending' : 'ascending') : 'none'}
              disabled={sortKey === null}
              onClick={() => {
                if (sortKey === null) return;
                onSortChange({ key: sortKey, desc: active ? !sort.desc : sortKey !== 'name' });
              }}
              className="px-1 py-2 text-left text-xs font-medium text-neutral-400 disabled:cursor-default"
            >
              {flexRender(header.column.columnDef.header, header.getContext())}
              {active ? (sort.desc ? ' ▼' : ' ▲') : ''}
            </button>
          );
        })}
      </div>
      <div role="rowgroup" style={{ height: `${virtualizer.getTotalSize()}px`, position: 'relative' }}>
        {virtualItems.map((item) => {
          const flat = rows[item.index];
          const tableRow = table.getRowModel().rows[item.index];
          if (!flat || !tableRow) return null;
          return (
            <div
              key={item.key}
              role="row"
              data-index={item.index}
              ref={virtualizer.measureElement}
              className={`${GRID} absolute left-0 top-0 w-full border-b border-neutral-900 px-2 text-sm ${
                selectedPath !== null && pathKey(selectedPath) === pathKey(flat.row.path) ? 'bg-neutral-800/60' : ''
              }`}
              style={{ transform: `translateY(${item.start}px)` }}
            >
              {tableRow.getVisibleCells().map((cell) => (
                <div key={cell.id} role="cell" className="min-w-0 truncate py-2">
                  {flexRender(cell.column.columnDef.cell, cell.getContext())}
                </div>
              ))}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function GradeBadge({ grade }: { grade: DisplayGrade }) {
  const styles =
    grade === 'safe'
      ? 'bg-emerald-500/15 text-emerald-300'
      : grade === 'review'
        ? 'bg-amber-500/15 text-amber-300'
        : 'bg-red-500/15 text-red-300';
  const label = grade === 'safe' ? 'Green' : grade === 'review' ? 'Yellow' : 'Red';
  return <span className={`shrink-0 rounded px-2 py-0.5 text-xs font-medium ${styles}`}>{label}</span>;
}
