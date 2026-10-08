import { useCallback, useEffect, useState } from 'react';
import type { CategoryId } from '@dust/core';
import type {
  CategorySummaryRow,
  DashboardState,
  DashboardVolumeCard,
  DustApi,
  StartAnalyzeResult,
} from '../../../src/shared/ipc';
import { formatBytes, formatRelativeTime } from '../format';
import { Badge, Button, Card, FOCUS, Meter, PageHeader, SectionTitle } from '../components/ui';
import { CodeIcon, HardDriveIcon, PowerIcon, UninstallIcon } from '../components/icons';

export type ToolKey = 'uninstall' | 'startup' | 'dev-cleanup';

export interface HomeViewProps {
  api: DustApi;
  onScan: (root: string, usedBytes: number | null) => Promise<StartAnalyzeResult>;
  onViewResults: (root: string, category?: CategoryId | null) => void;
  onQuickClean: () => void;
  onOpenTool: (tool: ToolKey) => void;
  onSystemDrive?: (root: string | null) => void;
}

const CATEGORY_ORDER: CategoryId[] = ['temp', 'app-caches', 'npm-cache', 'recycle-bin', 'npm-projects'];

function usedBytes(volume: DashboardVolumeCard): number | null {
  if (volume.totalBytes === null || volume.freeBytes === null) return null;
  return Math.max(volume.totalBytes - volume.freeBytes, 0);
}

export function HomeView({ api, onScan, onViewResults, onQuickClean, onOpenTool, onSystemDrive }: HomeViewProps) {
  const [state, setState] = useState<DashboardState | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [categories, setCategories] = useState<CategorySummaryRow[] | null>(null);
  const [startError, setStartError] = useState<string | null>(null);
  const [starting, setStarting] = useState<string | null>(null);
  const [busyWith, setBusyWith] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    let active = true;
    setError(null);
    api
      .getDashboard()
      .then((next) => {
        if (active) setState(next);
      })
      .catch((cause: unknown) => {
        if (active) setError(cause instanceof Error ? cause.message : String(cause));
      });
    return () => {
      active = false;
    };
  }, [api, reloadKey]);

  const system = state?.volumes.find((volume) => volume.role === 'system') ?? null;
  const systemRoot = system?.root ?? null;

  useEffect(() => {
    onSystemDrive?.(systemRoot);
  }, [onSystemDrive, systemRoot]);

  useEffect(() => {
    if (system === null || system.lastAnalyzedAt === null) {
      setCategories(null);
      return;
    }
    let active = true;
    api
      .getResultCategories(system.root)
      .then((result) => {
        if (active) setCategories(result.categories);
      })
      .catch(() => {
        if (active) setCategories(null);
      });
    return () => {
      active = false;
    };
  }, [api, system]);

  const scan = useCallback(
    async (volume: DashboardVolumeCard) => {
      setStarting(volume.root);
      setStartError(null);
      setBusyWith(null);
      try {
        const result = await onScan(volume.root, usedBytes(volume));
        if (!result.ok) {
          if (result.reason === 'busy') setBusyWith(volume.root);
          else setStartError(result.message);
        }
      } catch (cause) {
        setStartError(cause instanceof Error ? cause.message : String(cause));
      } finally {
        setStarting(null);
      }
    },
    [onScan],
  );

  const cancelRunning = useCallback(async () => {
    const target = state?.volumes.find((volume) => volume.root === busyWith);
    setBusyWith(null);
    await api.cancelScan().catch(() => {});
    if (target) await scan(target);
  }, [api, busyWith, scan, state]);

  if (error !== null) {
    return (
      <Page>
        <Card className="p-8 text-center">
          <p className="text-sm text-ink">Couldn&rsquo;t read your drives.</p>
          <Button className="mt-4" onClick={() => setReloadKey((key) => key + 1)}>
            Try again
          </Button>
        </Card>
      </Page>
    );
  }

  const volumes = state?.volumes ?? [];
  const reclaimable = (categories ?? []).filter((row) => row.bytes > 0 && row.category !== 'npm-projects');
  const reclaimableBytes = reclaimable.reduce((sum, row) => sum + row.bytes, 0);
  const projects = categories?.find((row) => row.category === 'npm-projects') ?? null;

  return (
    <Page>
      <PageHeader title="Home" subtitle="Scan a drive to see what takes up space and what is safe to remove." />

      {startError !== null && (
        <p
          role="alert"
          className="mt-6 rounded-xl border border-grade-danger-soft bg-grade-danger-soft px-4 py-3 text-sm text-grade-danger"
        >
          {startError}
        </p>
      )}
      {busyWith !== null && (
        <div
          role="alert"
          className="mt-6 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-notice-border bg-notice px-4 py-3"
        >
          <p className="text-sm text-ink">A scan is already running.</p>
          <div className="flex gap-2">
            <Button size="sm" onClick={() => setBusyWith(null)}>
              Wait
            </Button>
            <Button size="sm" variant="primary" onClick={() => void cancelRunning()}>
              Cancel it and scan
            </Button>
          </div>
        </div>
      )}

      <section aria-label="Drives" className="mt-8">
        <SectionTitle>Drives</SectionTitle>
        {state === null ? (
          <div className="grid gap-4 md:grid-cols-2">
            {[0, 1].map((index) => (
              <div key={index} className="h-44 animate-pulse rounded-2xl border border-hairline bg-surface" />
            ))}
          </div>
        ) : (
          <div className="grid gap-4 md:grid-cols-2">
            {volumes.map((volume) => (
              <DriveCard
                key={volume.root}
                volume={volume}
                starting={starting === volume.root}
                scanning={state.scan !== null && state.scan.root.toLowerCase() === volume.root.toLowerCase()}
                onScan={() => void scan(volume)}
                onView={() => onViewResults(volume.root)}
              />
            ))}
          </div>
        )}
      </section>

      {system !== null && system.lastAnalyzedAt !== null && categories !== null && (
        <section aria-label="Ready to clean" className="mt-10">
          <SectionTitle
            aside={
              <button
                type="button"
                onClick={() => onViewResults(system.root)}
                className={`rounded text-sm font-medium text-accent hover:underline ${FOCUS}`}
              >
                See everything
              </button>
            }
          >
            Ready to clean on {system.root}
          </SectionTitle>
          <Card className="p-6">
            {reclaimableBytes === 0 ? (
              <p className="text-sm text-ink-muted">
                Nothing to clean here. Your caches and temp files are already small.
              </p>
            ) : (
              <div className="flex flex-wrap items-start justify-between gap-6">
                <div>
                  <p className="font-mono text-[2.5rem] font-semibold leading-none tracking-tight text-ink">
                    {formatBytes(reclaimableBytes)}
                  </p>
                  <p className="mt-2 text-sm text-ink-muted">
                    Temp files, caches, and the Recycle Bin. All of it comes back on its own or is junk.
                  </p>
                </div>
                <Button variant="primary" size="lg" onClick={onQuickClean}>
                  Review and clean
                </Button>
              </div>
            )}
            {reclaimable.length > 0 && (
              <ul className="mt-6 grid gap-x-8 gap-y-4 sm:grid-cols-2">
                {[...reclaimable]
                  .sort((a, b) => CATEGORY_ORDER.indexOf(a.category) - CATEGORY_ORDER.indexOf(b.category))
                  .map((row) => (
                    <li key={row.category}>
                      <button
                        type="button"
                        onClick={() => onViewResults(system.root, row.category)}
                        className={`group w-full rounded-lg text-left ${FOCUS}`}
                      >
                        <div className="flex items-baseline justify-between gap-3 text-sm">
                          <span className="font-medium text-ink group-hover:text-accent">{row.label}</span>
                          <span className="font-mono text-ink-muted">{formatBytes(row.bytes)}</span>
                        </div>
                        <Meter
                          className="mt-2 h-1.5"
                          value={row.bytes}
                          max={reclaimableBytes}
                          label={`${row.label} share`}
                        />
                      </button>
                    </li>
                  ))}
              </ul>
            )}
          </Card>
        </section>
      )}

      <section aria-label="Tools" className="mt-10">
        <SectionTitle>Tools</SectionTitle>
        <div className="grid gap-4 md:grid-cols-3">
          <ToolTile
            icon={<UninstallIcon className="h-5 w-5" />}
            title="Uninstall apps"
            text="Remove an app and the files it leaves behind."
            onClick={() => onOpenTool('uninstall')}
          />
          <ToolTile
            icon={<PowerIcon className="h-5 w-5" />}
            title="Startup apps"
            text="Choose what starts when you sign in."
            onClick={() => onOpenTool('startup')}
          />
          <ToolTile
            icon={<CodeIcon className="h-5 w-5" />}
            title="Developer cleanup"
            text={
              projects !== null && projects.bytes > 0
                ? `${formatBytes(projects.bytes)} in old node_modules.`
                : 'Old node_modules from projects you stopped using.'
            }
            onClick={() => onOpenTool('dev-cleanup')}
          />
        </div>
      </section>
    </Page>
  );
}

function Page({ children }: { children: React.ReactNode }) {
  return (
    <main className="min-h-full bg-canvas text-ink">
      <div className="mx-auto max-w-5xl px-6 py-10 sm:px-10">{children}</div>
    </main>
  );
}

function DriveCard({
  volume,
  starting,
  scanning,
  onScan,
  onView,
}: {
  volume: DashboardVolumeCard;
  starting: boolean;
  scanning: boolean;
  onScan: () => void;
  onView: () => void;
}) {
  const used = usedBytes(volume);
  const total = volume.totalBytes;
  const fullness = used !== null && total ? used / total : 0;
  const analyzed = volume.lastAnalyzedAt !== null;
  const media = volume.mediaType === 'ssd' ? 'SSD' : volume.mediaType === 'hdd' ? 'HDD' : null;
  return (
    <Card className="flex flex-col p-6">
      <div className="flex items-start justify-between gap-4">
        <div className="flex items-center gap-3">
          <span className="flex h-11 w-11 items-center justify-center rounded-xl bg-accent-soft text-accent">
            <HardDriveIcon className="h-5 w-5" />
          </span>
          <div>
            <p className="flex items-center gap-2">
              <span className="text-xl font-semibold text-ink">{volume.root.replace(/\\$/, '')}</span>
              {volume.role === 'system' && <Badge tone="accent">Windows</Badge>}
              {media !== null && <Badge>{media}</Badge>}
              {volume.external && <Badge>External</Badge>}
            </p>
            <p className="mt-0.5 text-sm text-ink-muted">{volume.label ?? 'Local disk'}</p>
          </div>
        </div>
      </div>

      <div className="mt-5">
        {used !== null && total !== null ? (
          <>
            <Meter
              value={used}
              max={total}
              label={`${volume.root} used space`}
              tone={fullness > 0.9 ? 'danger' : fullness > 0.8 ? 'review' : 'accent'}
            />
            <p className="mt-2 flex justify-between text-xs text-ink-muted">
              <span>
                <span className="font-mono text-ink">{formatBytes(used)}</span> used of {formatBytes(total)}
              </span>
              <span>
                <span className="font-mono text-ink">{formatBytes(volume.freeBytes)}</span> free
              </span>
            </p>
          </>
        ) : (
          <p className="text-xs text-ink-muted">Size unavailable.</p>
        )}
      </div>

      <div className="mt-5 flex flex-1 items-end justify-between gap-3 border-t border-hairline pt-4">
        <p className="text-xs text-ink-muted">
          {scanning
            ? 'Scanning now'
            : analyzed
              ? `Scanned ${formatRelativeTime(volume.lastAnalyzedAt)}${
                  volume.reclaimableBytes ? ` · ${formatBytes(volume.reclaimableBytes)} to clean` : ''
                }`
              : 'Not scanned yet'}
        </p>
        <div className="flex gap-2">
          {analyzed && (
            <Button size="sm" onClick={onView}>
              Results
            </Button>
          )}
          <Button
            size="sm"
            variant={analyzed ? 'secondary' : 'primary'}
            disabled={starting || scanning}
            aria-label={`Scan ${volume.root}`}
            onClick={onScan}
          >
            {starting ? 'Starting…' : analyzed ? 'Rescan' : 'Scan'}
          </Button>
        </div>
      </div>
    </Card>
  );
}

function ToolTile({
  icon,
  title,
  text,
  onClick,
}: {
  icon: React.ReactNode;
  title: string;
  text: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`group flex flex-col items-start rounded-2xl border border-hairline bg-surface p-5 text-left transition-colors hover:border-accent-border hover:bg-surface-hover ${FOCUS}`}
    >
      <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-canvas text-ink-muted group-hover:bg-accent-soft group-hover:text-accent">
        {icon}
      </span>
      <span className="mt-4 text-sm font-semibold text-ink">{title}</span>
      <span className="mt-1 text-sm text-ink-muted">{text}</span>
    </button>
  );
}
