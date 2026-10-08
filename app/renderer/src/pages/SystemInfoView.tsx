import { useCallback, useEffect, useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import type { SystemInfoLive, SystemInfoStatic } from '@dust/core';
import type { DashboardState, DustApi } from '../../../src/shared/ipc';
import { StartupToast } from '../components/StartupToast';
import { RefreshIcon } from '../components/icons';
import { Alert, Badge, Button, Card, Meter, PageHeader, SectionTitle } from '../components/ui';
import { formatBytes } from '../format';
import { useCachedResource } from '../page-cache';
import {
  VRAM_CAVEAT,
  formatBios,
  formatCapturedAt,
  formatMemory,
  formatOsName,
  formatSystemInfoText,
  formatUptime,
  formatVram,
  joinBoard,
  toStorageVolumes,
} from '../system-info';
import type { StorageVolume } from '../system-info';

const LIVE_INTERVAL_MS = 1500;
const HARDWARE_POLL_MS = 750;
const HARDWARE_POLL_LIMIT_MS = 30_000;

export interface SystemInfoViewProps {
  api: DustApi;
}

interface InfoRowProps {
  label: string;
  value: ReactNode | null;
}

function Page({ children }: { children: ReactNode }) {
  return (
    <main className="min-h-full bg-canvas text-ink">
      <div className="mx-auto max-w-5xl px-6 py-10 sm:px-10">{children}</div>
    </main>
  );
}

function InfoRow({ label, value }: InfoRowProps) {
  return (
    <div className="flex items-baseline justify-between gap-6 px-5 py-2.5">
      <span className="min-w-0 text-sm text-ink-muted">{label}</span>
      {value !== null && <span className="shrink-0 text-right font-mono text-sm text-ink">{value}</span>}
    </div>
  );
}

function InfoSection({ title, children, className = '' }: { title: string; children: ReactNode; className?: string }) {
  return (
    <section aria-label={title} className={className}>
      <SectionTitle>{title}</SectionTitle>
      <Card className="divide-y divide-hairline overflow-hidden">{children}</Card>
    </section>
  );
}

function LiveTile({ label, children }: { label: string; children: ReactNode }) {
  return (
    <section aria-label={label}>
      <Card className="p-5">
        <h2 className="text-xs font-semibold uppercase tracking-[0.16em] text-ink-muted">{label}</h2>
        {children}
      </Card>
    </section>
  );
}

/** Same thresholds as the drive cards on Home: review above 80%, danger above 90%. */
function usageTone(percent: number): 'accent' | 'review' | 'danger' {
  return percent > 90 ? 'danger' : percent > 80 ? 'review' : 'accent';
}

function StorageRow({ volume }: { volume: StorageVolume }) {
  const { usedBytes, totalBytes } = volume;
  const percent = usedBytes !== null && totalBytes ? (usedBytes / totalBytes) * 100 : null;
  return (
    <div className="px-5 py-3.5">
      <div className="flex items-baseline justify-between gap-6">
        <p className="flex min-w-0 items-center gap-2 text-sm">
          <span className="font-semibold text-ink">{volume.drive}</span>
          {volume.label !== null && <span className="truncate text-ink-muted">{volume.label}</span>}
          {volume.media !== null && <Badge>{volume.media}</Badge>}
        </p>
        <span className="shrink-0 text-right font-mono text-sm text-ink">
          {usedBytes !== null && totalBytes !== null
            ? `${formatBytes(usedBytes)} of ${formatBytes(totalBytes)}`
            : 'Size unavailable'}
        </span>
      </div>
      {usedBytes !== null && totalBytes !== null && percent !== null && (
        <Meter
          value={usedBytes}
          max={totalBytes}
          label={`${volume.drive} used space`}
          tone={usageTone(percent)}
          className="mt-2.5 h-2"
        />
      )}
    </div>
  );
}

function SkeletonBlock({ className }: { className: string }) {
  return <div className={`animate-pulse rounded-2xl border border-hairline bg-surface ${className}`} />;
}

export function SystemInfoView({ api }: SystemInfoViewProps) {
  const info = useCachedResource<SystemInfoStatic>('system-info', () => api.getSystemInfo(false));
  // Volumes come from the dashboard; a failure there only hides the Storage section.
  const dashboard = useCachedResource<DashboardState>('dashboard', () => api.getDashboard());
  const [live, setLive] = useState<SystemInfoLive | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [toastKey, setToastKey] = useState(0);
  const { data: snapshot, error, reload: reloadInfo } = info;
  const { reload: reloadDashboard } = dashboard;
  const hardwarePending = snapshot?.hardwarePending === true;
  const storage = useMemo(
    () => (dashboard.data === null ? null : toStorageVolumes(dashboard.data.volumes)),
    [dashboard.data],
  );

  // Live values refresh only while the window is visible; coming back polls immediately.
  useEffect(() => {
    let cancelled = false;
    let timer: number | null = null;
    const poll = () => {
      api
        .getSystemInfoLive()
        .then((next) => {
          if (!cancelled) setLive(next);
        })
        .catch(() => {});
    };
    const start = () => {
      if (timer !== null) return;
      poll();
      timer = window.setInterval(poll, LIVE_INTERVAL_MS);
    };
    const stop = () => {
      if (timer === null) return;
      window.clearInterval(timer);
      timer = null;
    };
    const onVisibility = () => (document.hidden ? stop() : start());
    if (!document.hidden) start();
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      cancelled = true;
      stop();
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, [api]);

  // Graphics arrive after the rest of the page; ask again until they do.
  useEffect(() => {
    if (!hardwarePending) return;
    const startedAt = Date.now();
    const timer = window.setInterval(() => {
      if (Date.now() - startedAt >= HARDWARE_POLL_LIMIT_MS) {
        window.clearInterval(timer);
        return;
      }
      void reloadInfo();
    }, HARDWARE_POLL_MS);
    return () => window.clearInterval(timer);
  }, [hardwarePending, reloadInfo]);

  const forceReload = useCallback(
    () => Promise.all([reloadInfo(() => api.getSystemInfo(true)), reloadDashboard()]),
    [api, reloadInfo, reloadDashboard],
  );

  const refresh = useCallback(() => {
    setRefreshing(true);
    void forceReload().finally(() => setRefreshing(false));
  }, [forceReload]);

  const retry = useCallback(() => {
    void forceReload();
  }, [forceReload]);

  const copy = useCallback(() => {
    if (snapshot === null) return;
    const text = formatSystemInfoText(snapshot, live, storage ?? []);
    void navigator.clipboard
      ?.writeText(text)
      .then(() => setToastKey((value) => value + 1))
      .catch(() => {});
  }, [snapshot, live, storage]);

  if (snapshot === null) {
    return (
      <Page>
        <PageHeader title="System Info" subtitle="Hardware and system details for this PC." />
        {error !== null ? (
          <Alert
            tone="danger"
            className="mt-8"
            action={
              <Button size="sm" onClick={retry}>
                Try again
              </Button>
            }
          >
            Couldn&apos;t read system information. {error}
          </Alert>
        ) : (
          <div role="status" aria-live="polite" className="mt-8">
            <span className="sr-only">Loading system information.</span>
            <div className="grid gap-4 sm:grid-cols-2" aria-hidden="true">
              <SkeletonBlock className="h-28" />
              <SkeletonBlock className="h-28" />
            </div>
            <SkeletonBlock className="mt-8 h-32" />
            <div className="mt-8 grid items-start gap-6 md:grid-cols-2" aria-hidden="true">
              <SkeletonBlock className="h-56" />
              <SkeletonBlock className="h-40" />
            </div>
          </div>
        )}
      </Page>
    );
  }

  const uptime = snapshot.uptimeMs === null ? null : formatUptime(snapshot.uptimeMs);
  const osName = formatOsName(snapshot.os);
  const processorRows: Array<{ label: string; value: string | null }> =
    snapshot.cpu === null
      ? []
      : [
          { label: 'Model', value: snapshot.cpu.model },
          {
            label: 'Cores',
            value: snapshot.cpu.physicalCores === null ? null : String(snapshot.cpu.physicalCores),
          },
          {
            label: 'Threads',
            value: snapshot.cpu.logicalThreads === null ? null : String(snapshot.cpu.logicalThreads),
          },
        ];
  const board = snapshot.board === null ? null : joinBoard(snapshot.board.manufacturer, snapshot.board.product);
  const bios = snapshot.bios === null ? null : formatBios(snapshot.bios);
  const firmwareRows: Array<{ label: string; value: string | null }> = [];
  if (board !== null) firmwareRows.push({ label: 'Motherboard', value: board });
  if (bios !== null) firmwareRows.push({ label: 'BIOS', value: bios });
  const hasSystemRows =
    osName !== null ||
    snapshot.os.build !== null ||
    snapshot.os.arch !== null ||
    snapshot.hostname !== null ||
    uptime !== null;

  const cpuPercent = live === null ? null : live.cpuPercent;
  const memPercent =
    live !== null && live.memTotalBytes > 0 ? Math.round((live.memUsedBytes / live.memTotalBytes) * 100) : null;
  const threads = snapshot.cpu?.logicalThreads ?? null;

  return (
    <Page>
      <PageHeader
        title="System Info"
        subtitle={
          <>
            Captured <span className="font-mono text-ink">{formatCapturedAt(snapshot.capturedAt)}</span>
          </>
        }
        actions={
          <>
            <Button size="sm" onClick={refresh} disabled={refreshing}>
              <RefreshIcon className={`h-4 w-4 ${refreshing ? 'animate-spin' : ''}`} aria-hidden="true" />
              {refreshing ? 'Refreshing…' : 'Refresh'}
            </Button>
            <Button size="sm" variant="primary" onClick={copy}>
              Copy system info
            </Button>
          </>
        }
      />

      {error !== null && (
        <Alert tone="danger" className="mt-8">
          Couldn&apos;t refresh system information. {error}
        </Alert>
      )}

      <div className="mt-8 grid gap-4 sm:grid-cols-2">
        <LiveTile label="CPU usage">
          <p className="mt-2 font-mono text-3xl font-semibold tabular-nums text-ink">
            {cpuPercent === null ? '—' : `${cpuPercent}%`}
          </p>
          <Meter
            value={cpuPercent ?? 0}
            max={100}
            label="CPU usage"
            tone={usageTone(cpuPercent ?? 0)}
            className="mt-3 h-2.5"
          />
          <p className="mt-2 text-xs text-ink-muted">{threads === null ? 'All cores' : `Across ${threads} threads`}</p>
        </LiveTile>
        <LiveTile label="Memory usage">
          <p className="mt-2 font-mono text-3xl font-semibold tabular-nums text-ink">
            {memPercent === null ? '—' : `${memPercent}%`}
          </p>
          <Meter
            value={live?.memUsedBytes ?? 0}
            max={live?.memTotalBytes ?? 0}
            label="Memory usage"
            tone={usageTone(memPercent ?? 0)}
            className="mt-3 h-2.5"
          />
          <p className="mt-2 font-mono text-xs tabular-nums text-ink-muted">
            {live === null ? '—' : `${formatMemory(live.memUsedBytes)} used of ${formatMemory(live.memTotalBytes)}`}
          </p>
        </LiveTile>
      </div>

      {!snapshot.hardwareAvailable && <Alert className="mt-8">Hardware details unavailable on this machine.</Alert>}

      {storage !== null && storage.length > 0 && (
        <InfoSection title="Storage" className="mt-8">
          {storage.map((volume) => (
            <StorageRow key={volume.drive} volume={volume} />
          ))}
        </InfoSection>
      )}

      <div className="mt-8 grid items-start gap-x-6 gap-y-8 md:grid-cols-2">
        {hasSystemRows && (
          <InfoSection title="This PC">
            <InfoRow label="OS" value={osName} />
            <InfoRow label="Build" value={snapshot.os.build} />
            <InfoRow label="Architecture" value={snapshot.os.arch} />
            <InfoRow label="Hostname" value={snapshot.hostname} />
            <InfoRow label="Uptime" value={uptime} />
          </InfoSection>
        )}

        {processorRows.length > 0 && (
          <InfoSection title="Processor">
            {processorRows.map((row) => (
              <InfoRow key={row.label} label={row.label} value={row.value} />
            ))}
          </InfoSection>
        )}

        {snapshot.hardwarePending && snapshot.gpus.length === 0 && (
          <InfoSection title="Graphics">
            <div role="status" aria-live="polite" className="px-5 py-3.5">
              <p className="animate-pulse text-sm text-ink-muted">Reading graphics hardware…</p>
            </div>
          </InfoSection>
        )}

        {snapshot.gpus.length > 0 && (
          <InfoSection title="Graphics">
            {snapshot.gpus.map((gpu, index) => {
              const vram = formatVram(gpu.vramBytes);
              return (
                <div key={`${gpu.name}-${index}`} className="divide-y divide-hairline">
                  <h3 className="px-5 py-2.5 text-sm font-semibold text-ink">{gpu.name}</h3>
                  {gpu.driverVersion !== null && <InfoRow label="Driver" value={gpu.driverVersion} />}
                  {vram !== null && (
                    <InfoRow
                      label="VRAM"
                      value={
                        <>
                          {vram}
                          {gpu.vramUncertain && (
                            <span className="cursor-help" title={VRAM_CAVEAT} aria-label={VRAM_CAVEAT}>
                              *
                            </span>
                          )}
                        </>
                      }
                    />
                  )}
                </div>
              );
            })}
          </InfoSection>
        )}

        {firmwareRows.length > 0 && (
          <InfoSection title="Firmware">
            {firmwareRows.map((row) => (
              <InfoRow key={row.label} label={row.label} value={row.value} />
            ))}
          </InfoSection>
        )}
      </div>

      {toastKey > 0 && (
        <StartupToast key={toastKey} message="System info copied." durationMs={3000} onDismiss={() => setToastKey(0)} />
      )}
    </Page>
  );
}
