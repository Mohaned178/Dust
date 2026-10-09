import { useCallback, useEffect, useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import { useApi } from '../../lib/api';
import { formatBytes } from '../../lib/format';
import {
  VRAM_CAVEAT,
  formatBios,
  formatMemory,
  formatOsName,
  formatSystemInfoText,
  formatUptime,
  formatVram,
  joinBoard,
  toStorageVolumes,
} from '../../lib/system-info';
import type { StorageVolume } from '../../lib/system-info';
import { useDashboardStore } from '../../stores/dashboard';
import { useHealthStore } from '../../stores/health';
import { Tag } from '../../ui/Badge';
import { Button } from '../../ui/Button';
import { Card, CardHeader } from '../../ui/Card';
import { ErrorState } from '../../ui/EmptyState';
import { CopyIcon, RefreshIcon } from '../../ui/icons';
import { Notice } from '../../ui/Notice';
import { PageHeader } from '../../ui/PageHeader';
import { Ring } from '../../ui/Ring';
import { Skeleton } from '../../ui/Skeleton';
import { useToast } from '../../ui/toast-store';
import { UsageBar } from '../../ui/UsageBar';

/** How often memory and processor use are read. The page's effects stop while another page is open. */
export const LIVE_POLL_MS = 2000;
const HARDWARE_POLL_MS = 750;
const HARDWARE_POLL_LIMIT_MS = 30_000;

/** A card far down the page is not laid out until it is near the screen. */
const LAZY_SECTION = '[content-visibility:auto] [contain-intrinsic-size:auto_220px]';

interface Row {
  label: string;
  value: ReactNode;
}

function SpecCard({ title, rows, loading = false }: { title: string; rows: Row[]; loading?: boolean }) {
  return (
    <Card className={LAZY_SECTION} aria-busy={loading || undefined}>
      <CardHeader title={title} />
      {loading ? (
        <div className="flex flex-col gap-2 px-4 pb-4">
          <Skeleton className="h-4 w-3/4" />
          <Skeleton className="h-4 w-1/2" />
          <Skeleton className="h-4 w-2/3" />
        </div>
      ) : (
        <dl className="flex flex-col px-4 pb-3">
          {rows.map((row) => (
            <div key={row.label} className="flex items-baseline justify-between gap-6 border-t border-border py-2">
              <dt className="text-body text-ink-2">{row.label}</dt>
              <dd className="text-right text-body">{row.value}</dd>
            </div>
          ))}
        </dl>
      )}
    </Card>
  );
}

function present(rows: Array<{ label: string; value: ReactNode | null }>): Row[] {
  return rows.filter((row): row is Row => row.value !== null && row.value !== '');
}

function LiveCard({ title, percent, detail }: { title: string; percent: number | null; detail: string }) {
  return (
    <Card className="flex items-center gap-5 p-5">
      <Ring
        value={percent === null ? 0 : percent / 100}
        label={percent === null ? `${title}, not available` : `${title}, ${percent}%`}
        size={96}
      >
        <span className="text-subtitle font-semibold tabular-nums">{percent === null ? '—' : `${percent}%`}</span>
      </Ring>
      <div>
        <h2 className="text-body font-semibold">{title}</h2>
        <p className="text-caption text-ink-2">{detail}</p>
      </div>
    </Card>
  );
}

function StorageRow({ volume }: { volume: StorageVolume }) {
  const { usedBytes, totalBytes } = volume;
  return (
    <div className="flex flex-col gap-2 px-4 py-3">
      <div className="flex items-baseline justify-between gap-6">
        <p className="flex min-w-0 items-center gap-2 text-body">
          <span className="font-semibold">{volume.drive}</span>
          {volume.label !== null ? <span className="truncate text-ink-2">{volume.label}</span> : null}
          {volume.media !== null ? <Tag>{volume.media}</Tag> : null}
        </p>
        <span className="shrink-0 text-body tabular-nums">
          {usedBytes !== null && totalBytes !== null
            ? `${formatBytes(usedBytes)} of ${formatBytes(totalBytes)} used`
            : 'Size not available'}
        </span>
      </div>
      {usedBytes !== null && totalBytes !== null ? (
        <UsageBar
          segments={[{ id: 'used', label: 'Used', bytes: usedBytes }]}
          totalBytes={totalBytes}
          label={`${volume.drive} used space`}
          legend={false}
        />
      ) : null}
    </div>
  );
}

export function HealthPage() {
  const api = useApi();
  const toast = useToast();
  const info = useHealthStore((state) => state.info);
  const live = useHealthStore((state) => state.live);
  const loadInfo = useHealthStore((state) => state.loadInfo);
  const loadLive = useHealthStore((state) => state.loadLive);
  const dashboard = useDashboardStore((state) => state.dashboard);
  const loadDashboard = useDashboardStore((state) => state.load);
  const [refreshing, setRefreshing] = useState(false);

  // The page's effects run only while it is on screen, so the polling below stops when another page is open.
  useEffect(() => {
    void loadInfo(api);
    void loadDashboard(api);
  }, [api, loadInfo, loadDashboard]);

  useEffect(() => {
    void loadLive(api);
    const timer = setInterval(() => void loadLive(api), LIVE_POLL_MS);
    return () => clearInterval(timer);
  }, [api, loadLive]);

  const snapshot = info.data;
  const hardwarePending = snapshot?.hardwarePending === true;
  // Graphics arrive after the rest; ask again until they do, for a while.
  useEffect(() => {
    if (!hardwarePending) return;
    const startedAt = Date.now();
    const timer = setInterval(() => {
      if (Date.now() - startedAt >= HARDWARE_POLL_LIMIT_MS) {
        clearInterval(timer);
        return;
      }
      void loadInfo(api);
    }, HARDWARE_POLL_MS);
    return () => clearInterval(timer);
  }, [api, hardwarePending, loadInfo]);

  const storage = useMemo(
    () => (dashboard.data === null ? null : toStorageVolumes(dashboard.data.volumes)),
    [dashboard.data],
  );
  const liveData = live.data;
  const memPercent =
    liveData !== null && liveData.memTotalBytes > 0
      ? Math.round((liveData.memUsedBytes / liveData.memTotalBytes) * 100)
      : null;
  const cpuPercent = liveData === null || liveData.cpuPercent === null ? null : Math.round(liveData.cpuPercent);

  const refresh = useCallback(() => {
    setRefreshing(true);
    void Promise.all([loadInfo(api, true), loadDashboard(api, true)]).finally(() => setRefreshing(false));
  }, [api, loadInfo, loadDashboard]);

  const copy = useCallback(() => {
    if (snapshot === null) return;
    const text = formatSystemInfoText(snapshot, liveData, storage ?? []);
    void navigator.clipboard
      ?.writeText(text)
      .then(() => toast({ title: 'Specs copied', description: 'They are on your clipboard as plain text.' }))
      .catch(() => toast({ title: 'Dust could not copy the specs' }));
  }, [snapshot, liveData, storage, toast]);

  const loadingInfo = snapshot === null && info.error === null;
  const uptime = snapshot?.uptimeMs == null ? null : formatUptime(snapshot.uptimeMs);
  const board = snapshot?.board == null ? null : joinBoard(snapshot.board.manufacturer, snapshot.board.product);
  const bios = snapshot?.bios == null ? null : formatBios(snapshot.bios);

  return (
    <>
      <PageHeader
        title="PC Health"
        subtitle="How this PC is doing right now, and what it is made of."
        actions={
          <>
            <Button
              variant="secondary"
              icon={<RefreshIcon className="size-4" aria-hidden="true" />}
              onClick={refresh}
              loading={refreshing}
            >
              Refresh
            </Button>
            <Button
              variant="primary"
              icon={<CopyIcon className="size-4" aria-hidden="true" />}
              onClick={copy}
              disabled={snapshot === null}
            >
              Copy specs
            </Button>
          </>
        }
      />
      <div className="flex flex-col gap-6">
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <LiveCard
            title="Processor in use"
            percent={cpuPercent}
            detail={
              snapshot?.cpu?.logicalThreads != null
                ? `Across ${snapshot.cpu.logicalThreads} threads`
                : 'Across all cores'
            }
          />
          <LiveCard
            title="Memory in use"
            percent={memPercent}
            detail={
              liveData === null
                ? 'Reading memory'
                : `${formatMemory(liveData.memUsedBytes)} of ${formatMemory(liveData.memTotalBytes)}`
            }
          />
        </div>

        {info.error !== null && snapshot === null ? (
          <Card>
            <ErrorState
              title="Dust could not read this PC's details"
              description="Check that Windows is working normally, then try again."
              onRetry={() => void loadInfo(api, true)}
            />
          </Card>
        ) : null}
        {info.error !== null && snapshot !== null ? (
          <Notice variant="warning">Dust could not refresh these details. This is what it saw last.</Notice>
        ) : null}
        {snapshot !== null && !snapshot.hardwareAvailable ? (
          <Notice>Hardware details are not available on this PC.</Notice>
        ) : null}

        {storage !== null && storage.length > 0 ? (
          <section aria-label="Storage" className="flex flex-col gap-2">
            <h2 className="text-subtitle">Storage</h2>
            <Card className="divide-y divide-border overflow-hidden">
              {storage.map((volume) => (
                <StorageRow key={volume.drive} volume={volume} />
              ))}
            </Card>
          </section>
        ) : null}

        {info.error === null || snapshot !== null ? (
          <section aria-label="Specs" className="flex flex-col gap-2">
            <h2 className="text-subtitle">Specs</h2>
            <div className="grid grid-cols-1 items-start gap-4 md:grid-cols-2">
              <SpecCard
                title="This PC"
                loading={loadingInfo}
                rows={present([
                  { label: 'Name', value: snapshot?.hostname ?? null },
                  { label: 'Up for', value: uptime },
                ])}
              />
              <SpecCard
                title="Windows"
                loading={loadingInfo}
                rows={present([
                  { label: 'Edition', value: snapshot === null ? null : formatOsName(snapshot.os) },
                  { label: 'Build', value: snapshot?.os.build ?? null },
                  { label: 'Architecture', value: snapshot?.os.arch ?? null },
                ])}
              />
              {loadingInfo || (snapshot?.cpu ?? null) !== null ? (
                <SpecCard
                  title="Processor"
                  loading={loadingInfo}
                  rows={present([
                    { label: 'Model', value: snapshot?.cpu?.model ?? null },
                    { label: 'Cores', value: snapshot?.cpu?.physicalCores?.toString() ?? null },
                    { label: 'Threads', value: snapshot?.cpu?.logicalThreads?.toString() ?? null },
                  ])}
                />
              ) : null}
              <SpecCard
                title="Memory"
                loading={liveData === null && live.error === null}
                rows={present([
                  { label: 'Installed', value: liveData === null ? null : formatMemory(liveData.memTotalBytes) },
                  { label: 'In use', value: liveData === null ? null : formatMemory(liveData.memUsedBytes) },
                ])}
              />
              {loadingInfo || hardwarePending || (snapshot?.gpus.length ?? 0) > 0 ? (
                <SpecCard
                  title="Graphics"
                  loading={loadingInfo || (hardwarePending && (snapshot?.gpus.length ?? 0) === 0)}
                  rows={(snapshot?.gpus ?? []).flatMap((gpu, index) => {
                    const vram = formatVram(gpu.vramBytes);
                    return present([
                      { label: index === 0 ? 'Card' : `Card ${index + 1}`, value: gpu.name },
                      { label: 'Driver', value: gpu.driverVersion },
                      {
                        label: 'Video memory',
                        value:
                          vram === null ? null : (
                            <>
                              {vram}
                              {gpu.vramUncertain ? (
                                <span className="cursor-help" title={VRAM_CAVEAT} aria-label={VRAM_CAVEAT}>
                                  *
                                </span>
                              ) : null}
                            </>
                          ),
                      },
                    ]);
                  })}
                />
              ) : null}
              {loadingInfo || board !== null || bios !== null ? (
                <SpecCard
                  title="Firmware"
                  loading={loadingInfo}
                  rows={present([
                    { label: 'Motherboard', value: board },
                    { label: 'BIOS', value: bios },
                  ])}
                />
              ) : null}
            </div>
          </section>
        ) : null}
      </div>
    </>
  );
}
