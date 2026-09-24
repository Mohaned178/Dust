import type { CleanItemResult, CleanReport } from '../../../src/shared/ipc';
import { CATEGORY_LABELS } from '../../../src/shared/categories';
import { formatBytes, formatCount } from '../format';
import { groupResultsByCategory } from '../clean';
import { CleanLedger } from './CleanLedger';
import type { CleanLedgerRow } from './CleanLedger';
import { CopyButton } from './CopyButton';
import { CheckIcon, InfoIcon } from './icons';

const FOCUS = 'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent';
const PRIMARY = `inline-flex w-full items-center justify-center rounded-lg bg-accent px-6 py-3 text-sm font-semibold text-white transition-colors hover:bg-accent-strong ${FOCUS}`;

export interface CleanSummaryProps {
  report: CleanReport;
  onDone: () => void;
  doneLabel?: string;
}

export function CleanSummary({ report, onDone, doneLabel = 'View Updated Disk' }: CleanSummaryProps) {
  const rows: CleanLedgerRow[] = groupResultsByCategory(report.items).map(([category, items]) => ({
    id: category,
    label: CATEGORY_LABELS[category],
    bytes: items.reduce((sum, item) => sum + item.deletedBytes, 0),
    note: items.length === 1 ? '1 item' : `${items.length} items`,
    detail: (
      <ul className="space-y-2">
        {items.map((item) => (
          <ResultItem key={`${item.ruleId}:${item.path}`} item={item} />
        ))}
      </ul>
    ),
  }));

  const caveats: string[] = [];
  if (report.skippedLocked > 0) {
    caveats.push(
      report.skippedLocked === 1
        ? 'Partially cleaned: 1 file in use was skipped.'
        : `Partially cleaned: ${formatCount(report.skippedLocked)} files in use were skipped.`,
    );
  }
  if (report.itemErrors > 0) {
    caveats.push(
      report.itemErrors === 1
        ? '1 item could not be cleaned — see the item list below.'
        : `${formatCount(report.itemErrors)} items could not be cleaned — see the item list below.`,
    );
  }

  return (
    <>
      <div role="status" aria-live="polite" aria-atomic="true">
        <span className="mx-auto flex h-11 w-11 items-center justify-center rounded-full bg-accent-soft text-accent">
          <CheckIcon className="h-5 w-5" />
        </span>
        <p className="mt-3 text-center font-mono text-[2.5rem] font-semibold leading-none tracking-tight text-ink">
          {formatBytes(report.deletedBytes)}
        </p>
        <p className="mt-2 text-center text-sm text-ink-muted">freed</p>
      </div>

      <div className="mt-6 h-px w-full bg-hairline" aria-hidden="true" />

      {rows.length > 0 ? (
        <CleanLedger rows={rows} ariaLabel="What was cleaned, by category" />
      ) : (
        <p className="py-6 text-center text-sm text-ink-muted">Nothing was deleted.</p>
      )}

      {report.remainingReclaimableBytes > 0 && (
        <p className="mt-3 text-sm text-ink-muted">
          <span className="font-mono text-ink">{formatBytes(report.remainingReclaimableBytes)}</span> still reclaimable
          across all categories
        </p>
      )}
      {caveats.length > 0 && (
        <div className="mt-3 flex items-start gap-2.5 rounded-lg border border-notice-border bg-notice px-3.5 py-2.5 text-sm text-ink">
          <InfoIcon className="mt-0.5 h-4 w-4 shrink-0 text-accent" />
          <div className="min-w-0 space-y-1">
            {caveats.map((line) => (
              <p key={line}>{line}</p>
            ))}
          </div>
        </div>
      )}

      <div className="mt-6">
        <button type="button" onClick={onDone} className={PRIMARY}>
          {doneLabel}
        </button>
      </div>
    </>
  );
}

function ResultItem({ item }: { item: CleanItemResult }) {
  return (
    <li className="rounded-lg border border-hairline bg-canvas/40 p-3">
      <div className="flex items-start justify-between gap-3">
        <span className="min-w-0 break-all font-mono text-xs text-ink-muted">{item.path}</span>
        <span className="shrink-0 font-mono text-xs tabular-nums text-ink">{formatBytes(item.deletedBytes)}</span>
      </div>
      <p className="mt-1.5 text-xs text-ink-muted">{statusText(item)}</p>
      {item.restoreCommand !== null && (
        <div className="mt-2 flex items-center justify-between gap-2">
          <code className="min-w-0 break-all font-mono text-xs text-ink">{item.restoreCommand}</code>
          <CopyButton text={item.restoreCommand} label={`Copy command for ${item.path}`} />
        </div>
      )}
    </li>
  );
}

function statusText(item: CleanItemResult): string {
  if (item.status === 'partial') {
    return item.skippedLocked === 1
      ? 'Partially cleaned: 1 file in use was skipped.'
      : `Partially cleaned: ${formatCount(item.skippedLocked)} files in use were skipped.`;
  }
  if (item.status === 'already-gone') return 'Already gone.';
  if (item.status === 'failed') return 'Could not be cleaned.';
  return 'Cleaned.';
}
