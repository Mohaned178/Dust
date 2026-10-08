import type { CleanItemPreview, CleanPreview } from '../../../src/shared/ipc';
import { CATEGORY_LABELS } from '../../../src/shared/categories';
import { formatBytes, formatCount, formatRelativeTime } from '../format';
import {
  categoryRecoveryNote,
  groupItemsByCategory,
  needsAcknowledgement,
  refusedReasonText,
  recoveryLabel,
} from '../clean';
import { CleanLedger } from './CleanLedger';
import type { CleanLedgerRow } from './CleanLedger';
import { CopyButton } from './CopyButton';
import { GradePill } from './GradePill';
import { ChevronRightIcon } from './icons';
import { Alert, Button, FOCUS, Meter } from './ui';

export interface CleanProgress {
  done: number;
  plannedBytes: number;
  freedBytes: number;
}

export interface CleanPlanProps {
  preview: CleanPreview;
  acknowledge: boolean;
  onAcknowledge: (value: boolean) => void;
  onConfirm: () => void;
  onCancel: () => void;
  onReveal: (path: string) => void;
  onRelaunchElevated?: () => void;
  busy: boolean;
  /** Items finished so far while deleting, from the per-item `clean-item` events. */
  progress?: CleanProgress | null;
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
  progress = null,
  error = null,
  scopeNote = null,
}: CleanPlanProps) {
  const adminItems = preview.items.filter((item) => item.adminRequired);
  const requiresAcknowledge = needsAcknowledgement(preview.items);
  const itemCount = preview.items.length;
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
      {scopeNote !== null && <p className="mt-1.5 text-center text-xs text-ink-muted">{scopeNote}</p>}

      <div className="mt-6 h-px w-full bg-hairline" aria-hidden="true" />

      {rows.length === 0 ? (
        <p className="py-6 text-center text-sm text-ink-muted">Nothing to clean here.</p>
      ) : (
        <CleanLedger rows={rows} ariaLabel="What will be deleted, by category" />
      )}

      <p className="mt-3 text-xs text-ink-muted">{sourceText}</p>

      {preview.refused.length > 0 && <RefusedItems refused={preview.refused} />}

      {adminItems.length > 0 && onRelaunchElevated !== undefined && (
        <Button size="sm" onClick={onRelaunchElevated} className="mt-4">
          Relaunch as Administrator
        </Button>
      )}

      {requiresAcknowledge && (
        <label className="mt-5 flex items-start gap-2.5 text-sm text-ink">
          <input
            type="checkbox"
            checked={acknowledge}
            disabled={busy}
            onChange={(event) => onAcknowledge(event.target.checked)}
            className={`mt-0.5 h-4 w-4 shrink-0 rounded border-hairline accent-accent ${FOCUS}`}
          />
          <span>I understand some items cannot be recovered</span>
        </label>
      )}

      {error !== null && (
        <Alert tone="danger" className="mt-4">
          {error}
        </Alert>
      )}

      {busy && (
        <div className="mt-4">
          <div role="status" className="flex items-center gap-2.5 text-sm text-ink-muted">
            <span
              aria-hidden="true"
              className="h-4 w-4 shrink-0 rounded-full border-2 border-track border-t-accent motion-safe:animate-spin"
            />
            {progress === null || progress.done === 0 ? (
              <p className="min-w-0">
                Deleting {formatCount(itemCount)} {itemCount === 1 ? 'item' : 'items'} ·{' '}
                <span className="font-mono">{formatBytes(preview.totals.bytes)}</span> — large folders can take a few
                minutes.
              </p>
            ) : (
              <p className="min-w-0">
                Deleted {formatCount(Math.min(progress.done, itemCount))} of {formatCount(itemCount)}{' '}
                {itemCount === 1 ? 'item' : 'items'} ·{' '}
                <span className="font-mono">{formatBytes(progress.freedBytes)}</span> freed
              </p>
            )}
          </div>
          {/* Weighted by planned size: one huge folder should not read as 1/N done. */}
          {progress !== null && progress.done > 0 && (
            <Meter
              value={progress.plannedBytes}
              max={preview.totals.bytes}
              label="Deletion progress"
              className="mt-2.5 h-1.5"
            />
          )}
        </div>
      )}

      <div className="mt-6 flex justify-end gap-2">
        <Button size="lg" onClick={onCancel} disabled={busy}>
          Cancel
        </Button>
        {/* Red only when the plan holds irreversible items; an all-green plan stays calm. */}
        <Button
          size="lg"
          variant={requiresAcknowledge ? 'danger' : 'primary'}
          disabled={busy || itemCount === 0 || (requiresAcknowledge && !acknowledge)}
          onClick={onConfirm}
        >
          {busy ? 'Deleting…' : `Delete ${formatBytes(preview.totals.bytes)}`}
        </Button>
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
        <Button variant="ghost" size="sm" onClick={() => onReveal(item.path)} className="mt-1.5 -ml-3">
          Open the Recycle Bin in Explorer first
        </Button>
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
