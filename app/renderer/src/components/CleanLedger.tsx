import { useState } from 'react';
import type { ReactNode } from 'react';
import { formatBytes } from '../format';
import { ChevronRightIcon } from './icons';

const FOCUS = 'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent';

export interface CleanLedgerRow {
  id: string;
  label: string;
  bytes: number;
  note: string;
  detail: ReactNode;
}

export interface CleanLedgerProps {
  rows: CleanLedgerRow[];
  ariaLabel: string;
}

export function CleanLedger({ rows, ariaLabel }: CleanLedgerProps) {
  const [open, setOpen] = useState<ReadonlySet<string>>(new Set());

  const toggle = (id: string) => {
    setOpen((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  return (
    <ul aria-label={ariaLabel} className="divide-y divide-hairline border-t border-hairline">
      {rows.map((row) => {
        const expanded = open.has(row.id);
        return (
          <li key={row.id}>
            <button
              type="button"
              aria-expanded={expanded}
              aria-label={`${row.label}, ${formatBytes(row.bytes)}, ${row.note}`}
              onClick={() => toggle(row.id)}
              className={`grid w-full grid-cols-[1rem_minmax(0,1fr)_auto] items-center gap-x-3 gap-y-1 py-3 text-left transition-colors hover:bg-canvas/60 sm:grid-cols-[1rem_minmax(0,1fr)_auto_11rem] ${FOCUS}`}
            >
              <ChevronRightIcon
                className={`h-3.5 w-3.5 text-ink-muted transition-transform duration-150 ${
                  expanded ? 'rotate-90' : ''
                }`}
              />
              <span className="min-w-0 truncate text-sm text-ink">{row.label}</span>
              <span className="justify-self-end font-mono text-sm tabular-nums text-ink">{formatBytes(row.bytes)}</span>
              <span className="col-start-2 col-end-4 text-xs text-ink-muted sm:col-start-4 sm:col-end-5 sm:text-right">
                {row.note}
              </span>
            </button>
            {expanded && <div className="dust-disclose pb-4 pl-7 pr-1">{row.detail}</div>}
          </li>
        );
      })}
    </ul>
  );
}
