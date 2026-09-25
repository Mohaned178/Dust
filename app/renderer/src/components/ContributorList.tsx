import { useCallback, useEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import type { CategoryId, DisplayGrade } from '@dust/core';
import { CATEGORY_LABELS } from '../../../src/shared/categories';
import type { CleanItemPreview, ResultAction } from '../../../src/shared/ipc';
import { formatBytes, formatCount } from '../format';
import { pathKey, pathParent } from '../tree';
import { recoveryText } from '../clean';
import { GradePill, gradeWord } from './GradePill';
import { ChevronRightIcon, FolderIcon } from './icons';

const FOCUS = 'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent';
const EASE = 'ease-[cubic-bezier(0.16,1,0.3,1)]';

export interface Contributor {
  path: string;
  name: string;
  bytes: number;
  grade: DisplayGrade;
  action: ResultAction;
}

export interface SelectAllControl {
  count: number;
  bytes: number;
  allSelected: boolean;
  someSelected: boolean;
  noun: string;
  onToggle: () => void;
}

type RecoveryEntry =
  | { status: 'loading' }
  | { status: 'error' }
  | { status: 'loaded'; item: CleanItemPreview | null };

export interface ContributorListProps {
  contributors: Contributor[];
  totalCount: number;
  selected: ReadonlySet<string>;
  keptCount: number;
  selectAll?: SelectAllControl;
  onToggleSelect: (path: string) => void;
  onKeep: (path: string) => void;
  onUndoKept: () => void;
  onAnnounce?: (message: string, force?: boolean) => void;
  loadRecovery: (path: string) => Promise<CleanItemPreview | null>;
  empty: ReactNode;
}

export function ContributorList({
  contributors,
  totalCount,
  selected,
  keptCount,
  selectAll,
  onToggleSelect,
  onKeep,
  onUndoKept,
  onAnnounce,
  loadRecovery,
  empty,
}: ContributorListProps) {
  const [openKey, setOpenKey] = useState<string | null>(null);
  const [recovery, setRecovery] = useState<Record<string, RecoveryEntry>>({});
  const inFlightRef = useRef<Set<string>>(new Set());
  const selectAllRef = useRef<HTMLInputElement>(null);

  const startLoad = useCallback(
    (key: string, path: string, force = false) => {
      if (inFlightRef.current.has(key)) return;
      if (!force && key in recovery) return;
      inFlightRef.current.add(key);
      setRecovery((current) => ({ ...current, [key]: { status: 'loading' } }));
      onAnnounce?.(`Loading recovery details for ${path}.`, true);
      loadRecovery(path)
        .then((item) => {
          setRecovery((current) => ({ ...current, [key]: { status: 'loaded', item } }));
          onAnnounce?.(
            item === null ? `No restore command for ${path}.` : `Recovery details ready for ${path}.`,
            true,
          );
        })
        .catch(() => {
          setRecovery((current) => ({ ...current, [key]: { status: 'error' } }));
          onAnnounce?.(`Couldn't load recovery details for ${path}.`, true);
        })
        .finally(() => {
          inFlightRef.current.delete(key);
        });
    },
    [loadRecovery, onAnnounce, recovery],
  );

  useEffect(() => {
    if (selectAllRef.current !== null) selectAllRef.current.indeterminate = selectAll?.someSelected === true;
  }, [selectAll?.someSelected]);

  if (contributors.length === 0) {
    return (
      <div className="rounded-2xl border border-hairline bg-surface shadow-card">
        {empty}
        {keptCount > 0 && <KeptLine count={keptCount} onUndo={onUndoKept} />}
      </div>
    );
  }

  return (
    <div className="overflow-hidden rounded-2xl border border-hairline bg-surface shadow-card">
      {selectAll !== undefined && (
        <label className="flex cursor-pointer select-none items-center gap-2.5 border-b border-hairline px-3 py-2.5 transition-colors hover:bg-canvas/60 sm:px-4">
          <input
            ref={selectAllRef}
            type="checkbox"
            checked={selectAll.allSelected}
            aria-label={
              selectAll.allSelected
                ? `Deselect all ${selectAll.noun}`
                : `Select all ${selectAll.noun} (${formatCount(selectAll.count)} items, ${formatBytes(selectAll.bytes)})`
            }
            onChange={selectAll.onToggle}
            className={`h-4 w-4 shrink-0 rounded border-hairline accent-accent ${FOCUS}`}
          />
          <span className="text-xs font-medium text-ink-muted">
            {selectAll.allSelected ? 'Deselect all' : `Select all ${selectAll.noun}`}
          </span>
          <span className="font-mono text-xs tabular-nums text-ink-muted">
            ({formatCount(selectAll.count)} · {formatBytes(selectAll.bytes)})
          </span>
        </label>
      )}
      <ul className="divide-y divide-hairline">
        {contributors.map((row) => {
          const key = pathKey(row.path);
          const open = openKey === key;
          const checked = selected.has(key);
          const drillId = `contributor-${key.replace(/[^a-z0-9]+/g, '-')}`;
          const parent = pathParent(row.path);
          return (
            <li key={row.path}>
              <div className="flex items-start gap-3 px-3 py-2.5 transition-colors duration-150 hover:bg-canvas/60 sm:px-4">
                <input
                  type="checkbox"
                  aria-label={`Select ${row.name}`}
                  checked={checked}
                  onChange={() => onToggleSelect(row.path)}
                  className={`mt-0.5 h-4 w-4 shrink-0 rounded border-hairline accent-accent ${FOCUS}`}
                />
                <button
                  type="button"
                  aria-expanded={open}
                  aria-controls={drillId}
                  aria-label={`Why ${row.name} is graded ${gradeWord(row.grade)}`}
                  onClick={() => {
                    setOpenKey(open ? null : key);
                    if (!open) startLoad(key, row.path);
                  }}
                  className={`flex min-w-0 flex-1 items-center gap-3 text-left ${FOCUS}`}
                >
                  <FolderIcon className="h-4 w-4 shrink-0 text-ink-muted" />
                  <span className="min-w-0 flex-1">
                    <span className="flex items-center gap-1.5">
                      <span className="min-w-0 truncate text-sm font-medium text-ink">{row.name}</span>
                      {row.action.origin === 'detected' && (
                        <span className="shrink-0 rounded-full border border-hairline bg-canvas px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-[0.08em] text-ink-muted">
                          Detected
                        </span>
                      )}
                    </span>
                    {parent !== null && (
                      <span className="mt-0.5 block truncate font-mono text-xs text-ink-muted">{parent}</span>
                    )}
                  </span>
                  <span className="shrink-0 font-mono text-sm tabular-nums text-ink">{formatBytes(row.bytes)}</span>
                  <GradePill grade={row.grade} />
                  <ChevronRightIcon
                    className={`h-3.5 w-3.5 shrink-0 text-ink-muted transition-transform duration-150 ${EASE} ${
                      open ? 'rotate-90' : ''
                    }`}
                  />
                </button>
              </div>
              {open && (
                <Drill
                  id={drillId}
                  row={row}
                  recovery={recovery[key]}
                  onRetry={() => startLoad(key, row.path, true)}
                  onKeep={() => {
                    setOpenKey(null);
                    onKeep(row.path);
                  }}
                />
              )}
            </li>
          );
        })}
      </ul>
      {totalCount > contributors.length && (
        <p className="border-t border-hairline px-4 py-2.5 text-xs text-ink-muted">
          Showing the {formatCount(contributors.length)} largest of {formatCount(totalCount)} contributors. Use search or a
          category to narrow.
        </p>
      )}
      {keptCount > 0 && <KeptLine count={keptCount} onUndo={onUndoKept} />}
    </div>
  );
}

function Drill({
  id,
  row,
  recovery,
  onRetry,
  onKeep,
}: {
  id: string;
  row: Contributor;
  recovery: RecoveryEntry | undefined;
  onRetry: () => void;
  onKeep: () => void;
}) {
  const category: CategoryId = row.action.category;
  return (
    <div id={id} className="dust-disclose border-t border-hairline bg-canvas/40 px-4 py-3 sm:px-5">
      <p className="break-all font-mono text-xs text-ink-muted">{row.path}</p>

      <div className="mt-2.5 flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <p className="text-xs font-semibold uppercase tracking-[0.14em] text-ink-muted">Why this grade</p>
        <p className="text-xs text-ink-muted">Category: {CATEGORY_LABELS[category]}</p>
      </div>
      <p className="mt-1 text-sm text-ink">{row.action.evidence}</p>
      <p className="mt-1 font-mono text-xs text-ink-muted">{`Rule: ${row.action.ruleId}`}</p>

      <div className="mt-3">
        {recovery === undefined || recovery.status === 'loading' ? (
          <p className="text-xs text-ink-muted">Loading recovery…</p>
        ) : recovery.status === 'error' ? (
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
            <p className="text-xs text-ink-muted">Couldn’t load recovery details.</p>
            <button
              type="button"
              onClick={onRetry}
              className={`shrink-0 rounded-lg border border-hairline bg-surface px-2.5 py-1 text-xs font-medium text-ink transition-colors hover:border-hairline-strong hover:bg-surface-hover ${FOCUS}`}
            >
              Try again
            </button>
          </div>
        ) : recovery.item === null ? (
          <p className="text-xs text-ink-muted">Recovery details will appear before you clean.</p>
        ) : (
          <Recovery item={recovery.item} />
        )}
      </div>

      <div className="mt-3 flex justify-end">
        <button
          type="button"
          onClick={onKeep}
          className={`inline-flex items-center rounded-lg px-2.5 py-1 text-xs font-medium text-ink-muted transition-colors duration-150 ${EASE} hover:bg-canvas hover:text-ink ${FOCUS}`}
        >
          Keep
        </button>
      </div>
    </div>
  );
}

function Recovery({ item }: { item: CleanItemPreview }) {
  const regenerate = item.recovery.kind === 'regenerate';
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
      <p className="text-xs text-ink-muted">{recoveryText(item)}</p>
      {regenerate && (
        <span className="inline-flex min-w-0 items-center gap-2">
          <code className="min-w-0 break-all rounded-md border border-hairline bg-surface px-2 py-0.5 font-mono text-xs text-ink">
            {item.recovery.text}
          </code>
          <button
            type="button"
            onClick={() => {
              void navigator.clipboard?.writeText(item.recovery.text).catch(() => {});
            }}
            className={`shrink-0 rounded-lg border border-hairline bg-surface px-2.5 py-1 text-xs font-medium text-ink transition-colors hover:border-hairline-strong hover:bg-surface-hover ${FOCUS}`}
          >
            Copy
          </button>
        </span>
      )}
      {item.adminRequired && <span className="text-xs text-ink-muted">Needs administrator rights.</span>}
    </div>
  );
}

function KeptLine({ count, onUndo }: { count: number; onUndo: () => void }) {
  return (
    <div className="flex items-center justify-between gap-3 border-t border-hairline px-4 py-2.5 text-xs text-ink-muted">
      <span>
        {count} {count === 1 ? 'item' : 'items'} kept
      </span>
      <button
        type="button"
        onClick={onUndo}
        className={`rounded-lg px-2 py-1 text-xs font-medium text-accent transition-colors hover:bg-accent-soft ${FOCUS}`}
      >
        Undo
      </button>
    </div>
  );
}
