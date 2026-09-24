import type { CategoryId } from '@dust/core';
import type { CategorySummaryRow } from '../../../src/shared/ipc';
import { formatBytes } from '../format';

const FOCUS = 'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent';
const EASE = 'ease-[cubic-bezier(0.16,1,0.3,1)]';

export interface CategoryStripProps {
  categories: CategorySummaryRow[];
  active: CategoryId | null;
  onSelect: (category: CategoryId | null) => void;
}

export function CategoryStrip({ categories, active, onSelect }: CategoryStripProps) {
  return (
    <section aria-label="Filter by category" className="flex flex-wrap items-center gap-1.5">
      <button
        type="button"
        aria-pressed={active === null}
        onClick={() => onSelect(null)}
        className={`inline-flex items-center rounded-full border px-3 py-1 text-xs font-medium transition-colors duration-150 ${EASE} ${FOCUS} ${
          active === null
            ? 'border-accent bg-accent-soft text-accent-strong'
            : 'border-hairline bg-surface text-ink-muted hover:border-hairline-strong hover:text-ink'
        }`}
      >
        All
      </button>
      {categories.map((row) => {
        const empty = row.bytes === 0;
        const selected = active === row.category;
        return (
          <button
            key={row.category}
            type="button"
            disabled={empty}
            aria-pressed={selected}
            onClick={() => onSelect(selected ? null : row.category)}
            className={`inline-flex items-center gap-2 rounded-full border py-1 pl-3 pr-2.5 text-xs transition-colors duration-150 ${EASE} ${FOCUS} ${
              selected
                ? 'border-accent bg-accent-soft text-accent-strong'
                : 'border-hairline bg-surface text-ink enabled:hover:border-hairline-strong'
            } disabled:cursor-not-allowed disabled:opacity-55`}
          >
            <span className={`font-medium ${selected ? 'text-accent-strong' : 'text-ink'}`}>{row.label}</span>
            <span className={`font-mono ${empty ? 'text-ink-muted' : selected ? 'text-accent-strong' : 'text-ink-muted'}`}>
              {empty ? '—' : formatBytes(row.bytes)}
            </span>
          </button>
        );
      })}
    </section>
  );
}
