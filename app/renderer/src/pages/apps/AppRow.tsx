import { memo, useState } from 'react';
import type { UninstallAppSummary } from '../../../../src/shared/ipc';
import { probeRowRender } from '../../lib/renderProbe';
import { formatBytes } from '../../lib/format';
import { useAppsStore } from '../../stores/apps';
import { Badge } from '../../ui/Badge';
import { Button } from '../../ui/Button';

export const APP_ROW_HEIGHT = 56;

const CAUTION_LABEL: Record<NonNullable<UninstallAppSummary['caution']>, string> = {
  hardware: 'Driver',
  security: 'Security',
  runtime: 'Runtime',
};

/** The size to show before the real one has been measured: what the app registered with Windows. */
export function estimatedBytes(app: UninstallAppSummary): number | null {
  if (app.sizeBytes !== null) return app.sizeBytes;
  return app.estimatedSizeKb === null ? null : app.estimatedSizeKb * 1024;
}

/** A letter on a tile, for an app whose icon is missing or failed to load. */
function LetterTile({ name }: { name: string }) {
  const initial = name.trim().charAt(0).toUpperCase() || '?';
  return (
    <span
      aria-hidden="true"
      className="flex size-8 shrink-0 items-center justify-center rounded-control bg-surface-pressed text-body font-semibold text-ink-2"
    >
      {initial}
    </span>
  );
}

/** Subscribes to this app's icon only, so an icon arriving redraws one tile and nothing else. */
function RowIcon({ id, name, initial }: { id: string; name: string; initial: string | null }) {
  const streamed = useAppsStore((state) => state.icons.get(id));
  const src = streamed ?? initial;
  // Remember which address failed, so a later icon for the same app still gets its chance.
  const [failed, setFailed] = useState<string | null>(null);
  if (src === null || src === failed) return <LetterTile name={name} />;
  return (
    <span
      aria-hidden="true"
      className="flex size-8 shrink-0 items-center justify-center overflow-hidden rounded-control"
    >
      <img src={src} alt="" draggable={false} onError={() => setFailed(src)} className="size-8 object-contain" />
    </span>
  );
}

/** Subscribes to this app's measured size only. */
function RowSize({ app }: { app: UninstallAppSummary }) {
  const measured = useAppsStore((state) => state.sizes.get(app.id));
  const bytes = measured ?? estimatedBytes(app);
  return (
    <span className="w-20 shrink-0 text-right text-body tabular-nums text-ink-2">
      {bytes === null ? '—' : formatBytes(bytes)}
    </span>
  );
}

export interface AppRowProps {
  app: UninstallAppSummary;
  elevated: boolean;
  /** Keep this stable (useCallback), or every row redraws when the page does. */
  onUninstall: (app: UninstallAppSummary) => void;
}

/**
 * One installed app. The row itself reads nothing from the store: its size and icon are small child components
 * that each read only their own entry, so sizes and icons streaming in never redraw the rows.
 */
export const AppRow = memo(function AppRow({ app, elevated, onUninstall }: AppRowProps) {
  probeRowRender(app.id);
  return (
    <div className="group flex h-14 items-center gap-3 px-4 hover:bg-surface-hover focus-within:bg-surface-hover">
      <RowIcon id={app.id} name={app.displayName} initial={app.iconDataUrl} />
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <p className="truncate text-body font-semibold">{app.displayName}</p>
          {app.caution !== null ? <Badge>{CAUTION_LABEL[app.caution]}</Badge> : null}
          {!app.hasUninstaller ? <Badge>Leftovers only</Badge> : null}
          {!elevated && app.requiresAdmin ? <Badge>Needs administrator</Badge> : null}
        </div>
        <p className="truncate text-caption text-ink-2">
          {app.publisher.length > 0 ? app.publisher : 'Unknown publisher'}
          {app.version.length > 0 ? ` · ${app.version}` : ''}
        </p>
      </div>
      <RowSize app={app} />
      <Button
        variant="subtle"
        aria-label={`Uninstall ${app.displayName}`}
        className="opacity-0 group-focus-within:opacity-100 group-hover:opacity-100 focus-visible:opacity-100"
        onClick={() => onUninstall(app)}
      >
        Uninstall
      </Button>
    </div>
  );
});
