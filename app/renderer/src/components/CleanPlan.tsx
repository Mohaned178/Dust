import type { CleanItemPreview, CleanPreview } from '../../../src/shared/ipc';
import { CATEGORY_LABELS } from '../../../src/shared/categories';
import { formatBytes, formatRelativeTime } from '../format';
import { categoryRecoveryNote, groupItemsByCategory, refusedReasonText, recoveryLabel } from '../clean';
import { CleanLedger } from './CleanLedger';
import type { CleanLedgerRow } from './CleanLedger';
import { CopyButton } from './CopyButton';
import { GradePill } from './GradePill';
import { ChevronRightIcon, InfoIcon } from './icons';

const FOCUS = 'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent';
const PRIMARY = `inline-flex items-center justify-center rounded-lg bg-accent px-6 py-3 text-sm font-semibold text-white transition-colors hover:bg-accent-strong disabled:cursor-not-allowed disabled:opacity-45 ${FOCUS}`;
const SECONDARY = `inline-flex items-center justify-center rounded-lg border border-hairline bg-surface px-6 py-3 text-sm font-medium text-ink transition-colors hover:border-hairline-strong hover:bg-surface-hover disabled:cursor-not-allowed disabled:opacity-45 ${FOCUS}`;

export interface CleanPlanProps {
  preview: CleanPreview;
  acknowledge: boolean;
  onAcknowledge: (value: boolean) => void;
  onConfirm: () => void;
  onCancel: () => void;
  onReveal: (path: string) => void;
  onRelaunchElevated?: () => void;
  busy: boolean;
  error?: string | null;
  scopeNote?: string | null;
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
  error = null,
  scopeNote = null,
}: CleanPlanProps) {
  const adminItems = preview.items.filter((item) => item.adminRequired);
  const sourceText =
    preview.source === 'live'
      ? `Using Analyze data from ${formatRelativeTime(Date.now() - (preview.scanAgeMs ?? 0))}.`
      : preview.source === 'snapshot'
        ? `Using the saved scan from ${formatRelativeTime(Date.now() - (preview.scanAgeMs ?? 0))}.`
        : 'Measured just now.';

  const rows: CleanLedgerRow[] = groupItemsByCategory(preview.items).map(([category, items]) => ({
    id: category,
    label: CATEGORY_LABELS[category],
    bytes: items.reduce((sum, item) => sum + item.bytes, 0),
    note: categoryRecoveryNote(category, items),
    detail: (
      <ul className="space-y-2">
        {items.map((item) => (
          <PlanItem key={`${item.ruleId}:${item.path}`} item={item} onReveal={onReveal} />
        ))}
      </ul>
    ),
  }));

  return (
    <>
      <p className="text-center font-mono text-[2.5rem] font-semibold leading-none tracking-tight text-ink">
        {formatBytes(preview.totals.bytes)}
      </p>
      <p className="mt-2 text-center text-sm text-ink-muted">will be freed</p>
      {scopeNote !== null && (
        <p className="mt-1.5 text-center text-xs text-ink-muted">{scopeNote}</p>
      )}

      <div className="mt-6 h-px w-full bg-hairline" aria-hidden="true" />

      {rows.length === 0 ? (
        <p className="py-6 text-center text-sm text-ink-muted">Nothing to clean here.</p>
      ) : (
        <CleanLedger rows={rows} ariaLabel="What will be deleted, by category" />
      )}

      <p className="mt-3 text-xs text-ink-muted">{sourceText}</p>

      {preview.refused.length > 0 && <RefusedItems refused={preview.refused} />}

      {adminItems.length > 0 && onRelaunchElevated !== undefined && (
        <button
          type="button"
          onClick={onRelaunchElevated}
          className={`mt-4 inline-flex items-center rounded-lg border border-hairline bg-surface px-3.5 py-1.5 text-sm font-medium text-ink transition-colors hover:border-hairline-strong hover:bg-surface-hover ${FOCUS}`}
        >
          Relaunch as Administrator
        </button>
      )}

      <label className="mt-5 flex items-start gap-2.5 text-sm text-ink">
        <input
          type="checkbox"
          checked={acknowledge}
          onChange={(event) => onAcknowledge(event.target.checked)}
          className={`mt-0.5 h-4 w-4 shrink-0 rounded border-hairline accent-accent ${FOCUS}`}
        />
        <span>I understand some items cannot be recovered</span>
      </label>

      {error !== null && (
        <div
          role="alert"
          className="mt-4 flex items-start gap-2.5 rounded-lg border border-notice-border bg-notice px-3.5 py-2.5 text-sm text-ink"
        >
          <InfoIcon className="mt-0.5 h-4 w-4 shrink-0 text-accent" />
          <p className="min-w-0">{error}</p>
        </div>
      )}

      <div className="mt-6 flex justify-end gap-2">
        <button type="button" onClick={onCancel} disabled={busy} className={SECONDARY}>
          Cancel
        </button>
        <button type="button" disabled={busy || !acknowledge} onClick={onConfirm} className={PRIMARY}>
          {busy ? 'Cleaning…' : 'Confirm & Clean'}
        </button>
      </div>
    </>
  );
}

function PlanItem({ item, onReveal }: { item: CleanItemPreview; onReveal: (path: string) => void }) {
  return (
    <li className="rounded-lg border border-hairline bg-canvas/40 p-3">
      <div className="flex items-start justify-between gap-3">
        <span className="min-w-0 break-all font-mono text-xs text-ink-muted">{item.path}</span>
        <span className="shrink-0 font-mono text-xs tabular-nums text-ink">{formatBytes(item.bytes)}</span>
      </div>
      <div className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1">
        <GradePill grade={item.grade} />
        <span className="text-xs text-ink-muted">{recoveryLabel(item)}</span>
      </div>
      {item.recovery.kind === 'regenerate' && (
        <div className="mt-2 flex items-center justify-between gap-2">
          <code className="min-w-0 break-all font-mono text-xs text-ink">{item.recovery.text}</code>
          <CopyButton text={item.recovery.text} label={`Copy rebuild command for ${item.path}`} />
        </div>
      )}
      <p className="mt-1.5 text-xs text-ink-muted">{item.evidence}</p>
      {item.adminRequired && <p className="mt-1.5 text-xs text-ink-muted">Needs administrator rights.</p>}
      {item.action === 'empty-recycle-bin' && (
        <button
          type="button"
          onClick={() => onReveal(item.path)}
          className={`mt-1.5 text-xs font-medium text-accent hover:underline ${FOCUS}`}
        >
          Open the Recycle Bin in Explorer first
        </button>
      )}
    </li>
  );
}

function RefusedItems({ refused }: { refused: CleanPreview['refused'] }) {
  const count = refused.length;
  return (
    <details className="group mt-3 rounded-lg border border-hairline bg-canvas/40">
      <summary
        className={`flex cursor-pointer list-none items-center gap-1.5 rounded-lg px-3 py-2 text-xs text-ink-muted transition-colors hover:bg-canvas/60 ${FOCUS}`}
      >
        <ChevronRightIcon className="h-3.5 w-3.5 shrink-0 transition-transform duration-150 group-open:rotate-90" />
        {count === 1 ? '1 matched item was not included' : `${count} matched items were not included`}
      </summary>
      <ul className="space-y-2 border-t border-hairline px-3 py-2.5">
        {refused.map((entry) => (
          <li key={`${entry.ruleId}:${entry.path}`} className="flex flex-col gap-0.5">
            <span className="break-all font-mono text-xs text-ink-muted">{entry.path}</span>
            <span className="text-xs text-ink-muted">{refusedReasonText(entry.reason)}</span>
          </li>
        ))}
      </ul>
    </details>
  );
}
