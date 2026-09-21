import type { CleanReport } from '../../../src/shared/ipc';
import { formatBytes } from '../format';

export interface CleanSummaryProps {
  report: CleanReport;
  onDone: () => void;
  doneLabel?: string;
}

export function CleanSummary({ report, onDone, doneLabel = 'View updated disk' }: CleanSummaryProps) {
  const issues = report.items.filter((item) => item.status !== 'done');
  const commands = report.items.filter((item) => item.restoreCommand !== null);

  return (
    <section aria-label="Cleanup summary" className="rounded-xl border border-neutral-800 bg-neutral-900 p-5">
      <h2 className="text-lg font-medium text-neutral-100">Cleanup complete</h2>
      <p className="mt-2 text-sm text-neutral-300">
        Freed <span className="font-medium text-emerald-300">{formatBytes(report.deletedBytes)}</span> -{' '}
        {formatBytes(report.remainingReclaimableBytes)} still reclaimable.
      </p>
      {report.skippedLocked > 0 && (
        <p className="mt-1 text-sm text-amber-300">
          Partially cleaned: {report.skippedLocked} file(s) in use were skipped.
        </p>
      )}
      {report.itemErrors > 0 && (
        <p className="mt-1 text-sm text-red-300">{report.itemErrors} error(s) - see the item list below.</p>
      )}

      {issues.length > 0 && (
        <ul className="mt-4 space-y-1 text-sm">
          {issues.map((item) => (
            <li key={`${item.ruleId}:${item.path}`} className="rounded-lg border border-neutral-800 p-2">
              <p className="break-all text-xs text-neutral-400">{item.path}</p>
              <p className="mt-1 text-neutral-300">
                {item.status === 'partial'
                  ? `partially cleaned: ${item.skippedLocked} file(s) in use`
                  : item.status === 'already-gone'
                    ? 'already gone'
                    : 'could not be cleaned'}
              </p>
            </li>
          ))}
        </ul>
      )}

      {commands.length > 0 && (
        <div className="mt-4">
          <p className="text-xs uppercase tracking-wide text-neutral-500">Restore commands</p>
          <ul className="mt-2 space-y-2 text-sm">
            {commands.map((item) => (
              <li key={`${item.ruleId}:${item.path}`} className="rounded-lg border border-neutral-800 p-2">
                <p className="break-all text-xs text-neutral-400">{item.path}</p>
                <div className="mt-1 flex items-center justify-between gap-2">
                  <code className="text-neutral-200">{item.restoreCommand}</code>
                  <button
                    type="button"
                    aria-label={`Copy command for ${item.path}`}
                    onClick={() => {
                      void navigator.clipboard?.writeText(item.restoreCommand ?? '').catch(() => {});
                    }}
                    className="shrink-0 rounded-md border border-neutral-700 px-2 py-1 text-xs text-neutral-200"
                  >
                    Copy
                  </button>
                </div>
              </li>
            ))}
          </ul>
        </div>
      )}

      <button
        type="button"
        onClick={onDone}
        className="mt-4 rounded-md bg-emerald-600 px-3 py-1.5 text-sm font-medium text-white"
      >
        {doneLabel}
      </button>
    </section>
  );
}
