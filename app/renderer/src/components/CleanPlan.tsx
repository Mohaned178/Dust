import type { CleanPreview } from '../../../src/shared/ipc';
import { CATEGORY_LABELS } from '../../../src/shared/categories';
import { formatBytes, formatRelativeTime } from '../format';
import { groupItemsByCategory, recoveryText } from '../clean';

export interface CleanPlanProps {
  preview: CleanPreview;
  acknowledge: boolean;
  onAcknowledge: (value: boolean) => void;
  onConfirm: () => void;
  onCancel: () => void;
  onReveal: (path: string) => void;
  onRelaunchElevated?: () => void;
  busy: boolean;
}

export function CleanPlan({
  preview,
  acknowledge,
  onAcknowledge,
  onConfirm,
  onCancel,
  onReveal,
  onRelaunchElevated,
  busy,
}: CleanPlanProps) {
  const needsAck = preview.totals.reviewItems > 0;
  const adminItems = preview.items.filter((item) => item.adminRequired);
  const sourceText =
    preview.source === 'live'
      ? `Using Analyze data from ${formatRelativeTime(Date.now() - (preview.scanAgeMs ?? 0))}.`
      : preview.source === 'snapshot'
        ? `Using the saved scan from ${formatRelativeTime(Date.now() - (preview.scanAgeMs ?? 0))}.`
        : 'Measured just now.';
  const itemWord = preview.totals.items === 1 ? 'item' : 'items';

  return (
    <section aria-label="Cleanup plan" className="rounded-xl border border-neutral-800 bg-neutral-900 p-5">
      <h2 className="text-lg font-medium text-neutral-100">Review what will be deleted</h2>
      <p className="mt-1 text-sm text-neutral-400">{sourceText}</p>
      <p className="mt-2 text-sm text-neutral-300">
        {formatBytes(preview.totals.bytes)} across {preview.totals.items} {itemWord}.
        {needsAck && (
          <span className="ml-1 text-amber-300">
            {preview.totals.reviewItems} {preview.totals.reviewItems === 1 ? 'item' : 'items'} cannot be restored.
          </span>
        )}
      </p>

      <ul className="mt-4 space-y-3">
        {groupItemsByCategory(preview.items).map(([category, items]) => (
          <li key={category}>
            <p className="text-xs uppercase tracking-wide text-neutral-500">{CATEGORY_LABELS[category]}</p>
            <ul className="mt-1 space-y-1">
              {items.map((item) => (
                <li
                  key={`${item.ruleId}:${item.path}`}
                  className="rounded-lg border border-neutral-800 p-2 text-sm"
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="min-w-0 truncate text-neutral-200" title={item.path}>
                      {item.path}
                    </span>
                    <span className="shrink-0 tabular-nums text-neutral-400">{formatBytes(item.bytes)}</span>
                  </div>
                  <div className="mt-1 flex flex-wrap items-center gap-2 text-xs">
                    <span
                      className={`rounded px-2 py-0.5 font-medium ${
                        item.grade === 'safe'
                          ? 'bg-emerald-500/15 text-emerald-300'
                          : 'bg-amber-500/15 text-amber-300'
                      }`}
                    >
                      {item.grade === 'safe' ? 'Green' : 'Yellow'}
                    </span>
                    <span className="text-neutral-400">{recoveryText(item)}</span>
                  </div>
                  <p className="mt-1 text-xs text-neutral-500">{item.evidence}</p>
                  {item.adminRequired && <p className="mt-1 text-xs text-amber-300">Needs administrator rights.</p>}
                  {item.action === 'empty-recycle-bin' && (
                    <button
                      type="button"
                      onClick={() => onReveal(item.path)}
                      className="mt-1 text-xs text-emerald-300 underline"
                    >
                      Open the Recycle Bin in Explorer first
                    </button>
                  )}
                </li>
              ))}
            </ul>
          </li>
        ))}
      </ul>

      {adminItems.length > 0 && onRelaunchElevated !== undefined && (
        <button
          type="button"
          onClick={onRelaunchElevated}
          className="mt-4 rounded-md border border-amber-700 px-3 py-1.5 text-sm text-amber-200"
        >
          Relaunch as Administrator
        </button>
      )}

      {needsAck && (
        <label className="mt-4 flex items-start gap-2 text-sm text-neutral-300">
          <input
            type="checkbox"
            checked={acknowledge}
            onChange={(event) => onAcknowledge(event.target.checked)}
          />
          I understand that {preview.totals.reviewItems} {preview.totals.reviewItems === 1 ? 'item' : 'items'} cannot
          be restored after deletion.
        </label>
      )}

      <div className="mt-4 flex justify-end gap-2">
        <button
          type="button"
          onClick={onCancel}
          className="rounded-md border border-neutral-700 px-3 py-1.5 text-sm text-neutral-300"
        >
          Cancel
        </button>
        <button
          type="button"
          disabled={busy || (needsAck && !acknowledge)}
          onClick={onConfirm}
          className="rounded-md bg-red-600 px-3 py-1.5 text-sm font-medium text-white disabled:opacity-40"
        >
          Delete permanently
        </button>
      </div>
    </section>
  );
}
