import type { CategoryId } from '@dust/core';
import type { CategorySummaryRow } from '../../../src/shared/ipc';
import { formatBytes } from '../format';
import { CategoryIcon } from './CategoryIcon';
import { GridIcon } from './icons';
import { FOCUS } from './ui';

const EASE = 'ease-[cubic-bezier(0.16,1,0.3,1)]';

export interface CategoryStripProps {
  categories: CategorySummaryRow[];
  active: CategoryId | null;
  onSelect: (category: CategoryId | null) => void;
}

/** Vertical category filter: one row per category with its share of the total. */
export function CategoryStrip({ categories, active, onSelect }: CategoryStripProps) {
  const total = categories.reduce((sum, row) => sum + row.bytes, 0);
  const sorted = [...categories].sort((a, b) => b.bytes - a.bytes);
  return (
    <section aria-label="Filter by category">
      <p className="px-3 pb-2 text-[11px] font-semibold uppercase tracking-[0.14em] text-ink-muted">Categories</p>
      <ul className="space-y-0.5">
        <li>
          <button
            type="button"
            aria-label="All"
            aria-pressed={active === null}
            onClick={() => onSelect(null)}
            className={`${rowClass(active === null)} ${FOCUS}`}
          >
            <span className="flex items-center gap-2.5">
              <span
                aria-hidden="true"
                className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-lg ${
                  active === null ? 'bg-surface text-accent-strong' : 'bg-canvas text-ink-muted'
                }`}
              >
                <GridIcon className="h-3.5 w-3.5" />
              </span>
              <span className="flex-1 text-sm font-medium">All</span>
              <span className="font-mono text-xs tabular-nums text-ink-muted">{formatBytes(total)}</span>
            </span>
          </button>
        </li>
        {sorted.map((row) => {
          const empty = row.bytes === 0;
          const selected = active === row.category;
          const share = total > 0 ? (row.bytes / total) * 100 : 0;
          return (
            <li key={row.category}>
              <button
                type="button"
                disabled={empty}
                aria-pressed={selected}
                onClick={() => onSelect(selected ? null : row.category)}
                className={`${rowClass(selected)} disabled:cursor-not-allowed disabled:opacity-45 ${FOCUS}`}
              >
                <span className="flex items-center gap-2.5">
                  <span
                    aria-hidden="true"
                    className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-lg ${
                      selected ? 'bg-surface text-accent-strong' : 'bg-canvas text-ink-muted'
                    }`}
                  >
                    <CategoryIcon category={row.category} className="h-3.5 w-3.5" />
                  </span>
                  <span className="min-w-0 flex-1 truncate text-sm font-medium">{row.label}</span>
                  <span className="shrink-0 font-mono text-xs tabular-nums text-ink-muted">
                    {empty ? '—' : formatBytes(row.bytes)}
                  </span>
                </span>
                {!empty && (
                  <span aria-hidden="true" className="ml-[2.375rem] mt-1.5 block h-1 overflow-hidden rounded-full bg-track">
                    <span
                      className={`dust-bar-fill block h-full rounded-full ${selected ? 'bg-accent' : 'bg-ink-muted/40'}`}
                      style={{ width: `${Math.max(share, 2)}%` }}
                    />
                  </span>
                )}
              </button>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

function rowClass(selected: boolean): string {
  return `block w-full rounded-lg px-3 py-2 text-left transition-colors duration-150 ${EASE} ${
    selected ? 'bg-accent-soft text-accent-strong' : 'text-ink enabled:hover:bg-surface-hover'
  }`;
}
