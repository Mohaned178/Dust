import type { CategoryId } from '@dust/core';
import type { CategorySummaryRow } from '../../../src/shared/ipc';
import { formatBytes, formatCount } from '../format';

export interface CategoryStripProps {
  categories: CategorySummaryRow[];
  active: CategoryId | null;
  onSelect: (category: CategoryId | null) => void;
}

export function CategoryStrip({ categories, active, onSelect }: CategoryStripProps) {
  return (
    <section aria-label="Reclaimable by category" className="grid gap-2 sm:grid-cols-3 lg:grid-cols-5">
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
            className={`rounded-xl border p-3 text-left transition-colors ${
              selected
                ? 'border-emerald-600 bg-emerald-950/40'
                : 'border-neutral-800 bg-neutral-900 enabled:hover:border-neutral-600'
            } disabled:opacity-60`}
          >
            <span className="block text-xs text-neutral-400">{row.label}</span>
            <span className="mt-1 block text-lg font-medium text-neutral-100">{formatBytes(row.bytes)}</span>
            <span className="mt-1 block text-xs text-neutral-500">
              {empty ? 'nothing to clean' : row.items === 1 ? '1 item' : `${formatCount(row.items)} items`}
            </span>
          </button>
        );
      })}
    </section>
  );
}
