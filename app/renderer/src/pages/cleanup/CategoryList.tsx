import type { CategoryId } from '@dust/core';
import { memo, useCallback } from 'react';
import { CATEGORY_COPY, CATEGORY_ICONS } from '../../lib/categories';
import { formatBytes, formatCount } from '../../lib/format';
import { categoryChecked, isSelected, listedRows } from '../../lib/selection';
import type { OfferedRow, Selection } from '../../lib/selection';
import { cn } from '../../lib/cn';
import { GradePill } from '../../ui/Badge';
import { Button } from '../../ui/Button';
import { Checkbox } from '../../ui/Checkbox';
import { IconButton } from '../../ui/IconButton';
import { ChevronRightIcon, OpenIcon } from '../../ui/icons';
import { VirtualList } from '../../ui/VirtualList';

const ITEM_HEIGHT = 64;
/** An open category scrolls inside itself past this many pixels, so a long list never pushes the page around. */
const MAX_LIST_HEIGHT = 320;

export interface CategoryListHandlers {
  onToggleCategory: (rows: ReadonlyArray<OfferedRow>, checked: boolean) => void;
  onToggleRow: (row: OfferedRow) => void;
  onKeep: (row: OfferedRow) => void;
  onReveal: (path: string) => void;
  onToggleOpen: (category: CategoryId) => void;
}

export interface CategoryEntry {
  category: CategoryId;
  rows: ReadonlyArray<OfferedRow>;
  /** How many items the scan matched in this category; larger than `rows` when the list was capped. */
  matched: number;
}

function ItemRow({
  row,
  selected,
  handlers,
}: {
  row: OfferedRow;
  selected: boolean;
  handlers: Pick<CategoryListHandlers, 'onToggleRow' | 'onKeep' | 'onReveal'>;
}) {
  return (
    <div className="flex h-16 items-center gap-3 border-t border-border px-4 pl-12">
      <Checkbox
        checked={selected}
        onCheckedChange={() => handlers.onToggleRow(row)}
        aria-label={`Select ${row.name}, ${formatBytes(row.bytes)}`}
      />
      <div className="min-w-0 flex-1">
        <p className="truncate text-body font-semibold">{row.name}</p>
        <p className="truncate font-mono text-caption text-ink-2" title={row.path}>
          {row.path}
        </p>
        <p className="truncate text-caption text-ink-2" title={row.action.evidence}>
          {row.action.evidence}
        </p>
      </div>
      <GradePill grade={row.action.grade} />
      <span className="w-16 shrink-0 text-right text-body tabular-nums">{formatBytes(row.bytes)}</span>
      <Button variant="subtle" onClick={() => handlers.onKeep(row)} aria-label={`Keep ${row.name}`}>
        Keep
      </Button>
      <IconButton label={`Show ${row.name} in Explorer`} onClick={() => handlers.onReveal(row.path)}>
        <OpenIcon className="size-5" aria-hidden="true" />
      </IconButton>
    </div>
  );
}

interface CategoryRowProps {
  entry: CategoryEntry;
  selection: Selection;
  open: boolean;
  handlers: CategoryListHandlers;
}

const CategoryRow = memo(function CategoryRow({ entry, selection, open, handlers }: CategoryRowProps) {
  const { category, rows, matched } = entry;
  const Icon = CATEGORY_ICONS[category];
  const copy = CATEGORY_COPY[category];
  const listed = listedRows(rows, selection);
  const bytes = listed.reduce((sum, row) => sum + row.bytes, 0);
  const checked = categoryChecked(rows, selection);
  const listId = `cleanup-items-${category}`;

  const renderRow = useCallback(
    (row: OfferedRow) => <ItemRow row={row} selected={isSelected(selection, row)} handlers={handlers} />,
    [selection, handlers],
  );

  return (
    <li>
      <div className="flex items-center gap-3 px-4 py-3">
        <Checkbox
          checked={checked}
          onCheckedChange={(next) => handlers.onToggleCategory(rows, next)}
          disabled={listed.length === 0}
          aria-label={`Select all in ${copy.name}`}
        />
        <button
          type="button"
          aria-expanded={open}
          aria-controls={listId}
          onClick={() => handlers.onToggleOpen(category)}
          className="dur-faster flex min-w-0 flex-1 items-center gap-3 rounded-control text-left hover:bg-surface-hover"
        >
          <Icon className="size-6 shrink-0 text-ink-2" aria-hidden="true" />
          <span className="min-w-0 flex-1">
            <span className="block text-body font-semibold">{copy.name}</span>
            <span className="block text-caption text-ink-2">{copy.description}</span>
          </span>
          <span className="shrink-0 text-caption text-ink-2">
            {formatCount(listed.length)} {listed.length === 1 ? 'item' : 'items'}
          </span>
          <span className="w-20 shrink-0 text-right text-subtitle font-semibold tabular-nums">
            {formatBytes(bytes)}
          </span>
          <ChevronRightIcon
            className={cn('dur-faster size-5 shrink-0 text-ink-2 transition-transform', open && 'rotate-90')}
            aria-hidden="true"
          />
        </button>
      </div>
      {open ? (
        <div id={listId}>
          {matched > rows.length ? (
            <p className="border-t border-border px-4 py-2 pl-12 text-caption text-ink-2">
              Showing the largest {formatCount(rows.length)} of {formatCount(matched)} items.
            </p>
          ) : null}
          {listed.length === 0 ? (
            <p className="border-t border-border px-4 py-3 pl-12 text-caption text-ink-2">Everything here is kept.</p>
          ) : (
            <div style={{ height: Math.min(listed.length * ITEM_HEIGHT, MAX_LIST_HEIGHT) }}>
              <VirtualList
                items={listed}
                rowHeight={ITEM_HEIGHT}
                getKey={(row) => row.path}
                renderRow={renderRow}
                label={`${copy.name} items`}
              />
            </div>
          )}
        </div>
      ) : null}
    </li>
  );
});

export interface CategoryListProps {
  entries: ReadonlyArray<CategoryEntry>;
  selection: Selection;
  expanded: ReadonlySet<string>;
  handlers: CategoryListHandlers;
  label: string;
}

/** One card of categories. Each opens in place into its items. */
export function CategoryList({ entries, selection, expanded, handlers, label }: CategoryListProps) {
  return (
    <ul aria-label={label} className="divide-y divide-border">
      {entries.map((entry) => (
        <CategoryRow
          key={entry.category}
          entry={entry}
          selection={selection}
          open={expanded.has(entry.category)}
          handlers={handlers}
        />
      ))}
    </ul>
  );
}
