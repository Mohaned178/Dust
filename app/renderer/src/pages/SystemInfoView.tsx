import { Fragment, useCallback, useEffect, useState } from 'react';
import type { ReactNode } from 'react';
import type { SystemInfoLive, SystemInfoStatic } from '@dust/core';
import type { DustApi } from '../../../src/shared/ipc';
import { StartupToast } from '../components/StartupToast';
import { UsageBar } from '../components/UsageBar';
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
} from '../system-info';

const LIVE_INTERVAL_MS = 1500;
const FOCUS = 'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent';
const CARD = 'rounded-2xl border border-hairline bg-surface shadow-[0_1px_2px_rgba(16,24,40,0.04)]';
const SECONDARY = `rounded-lg border border-hairline bg-surface px-3.5 py-1.5 text-sm font-medium text-ink transition-colors hover:border-hairline-strong hover:bg-surface-hover disabled:cursor-not-allowed disabled:opacity-45 ${FOCUS}`;
const PRIMARY = `rounded-lg bg-accent px-3.5 py-1.5 text-sm font-semibold text-white transition-colors hover:bg-accent-strong ${FOCUS}`;

export interface SystemInfoViewProps {
  api: DustApi;
}

interface InfoRowProps {
  label: string;
  value: ReactNode | null;
}

function InfoRow({ label, value }: InfoRowProps) {
  return (
    <div className="flex items-baseline justify-between gap-6 px-4 py-2.5">
      <span className="min-w-0 text-sm text-ink-muted">{label}</span>
      {value !== null && <span className="shrink-0 text-right font-mono text-sm text-ink">{value}</span>}
    </div>
  );
}

function InfoSection({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section aria-label={title} className={`overflow-hidden ${CARD}`}>
      <div className="px-4 py-3.5">
        <h2 className="text-sm font-semibold text-ink">{title}</h2>
      </div>
      <div className="h-px w-full bg-hairline" aria-hidden="true" />
      <div className="divide-y divide-hairline">{children}</div>
    </section>
  );
}

function LiveTile({ label, children }: { label: string; children: ReactNode }) {
  return (
    <section aria-label={label} className={`px-4 py-4 ${CARD}`}>
      <h2 className="text-xs font-semibold uppercase tracking-[0.16em] text-ink-muted">{label}</h2>
      {children}
    </section>
  );
}

function errorText(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause);
}

export function SystemInfoView({ api }: SystemInfoViewProps) {
  const [snapshot, setSnapshot] = useState<SystemInfoStatic | null>(null);
  const [live, setLive] = useState<SystemInfoLive | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [toastKey, setToastKey] = useState(0);

  const load = useCallback(
    (force: boolean) => {
      api
        .getSystemInfo(force)
        .then((next) => {
          setSnapshot(next);
          setError(null);
        })
        .catch((cause: unknown) => setError(errorText(cause)))
        .finally(() => setRefreshing(false));
    },
    [api],
  );

  useEffect(() => {
    load(false);
  }, [load]);

  useEffect(() => {
    let cancelled = false;
    const poll = () => {
      api
        .getSystemInfoLive()
        .then((next) => {
          if (!cancelled) setLive(next);
        })
        .catch(() => {});
    };
    poll();
    const timer = window.setInterval(poll, LIVE_INTERVAL_MS);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [api]);

  const refresh = useCallback(() => {
    setRefreshing(true);
    load(true);
  }, [load]);

  const copy = useCallback(() => {
    if (snapshot === null) return;
    const text = formatSystemInfoText(snapshot, live);
    void navigator.clipboard
      ?.writeText(text)
      .then(() => setToastKey((value) => value + 1))
      .catch(() => {});
  }, [snapshot, live]);

  if (snapshot === null) {
    return (
      <main className="dust-dashboard flex min-h-screen items-center justify-center bg-canvas px-6 text-sm text-ink-muted">
        {error ?? 'Loading system information.'}
      </main>
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
  const board =
    snapshot.board === null ? null : joinBoard(snapshot.board.manufacturer, snapshot.board.product);
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

  return (
    <main className="dust-dashboard min-h-screen bg-canvas text-ink">
      <header className="mx-auto w-full max-w-4xl px-6 pt-10 sm:px-8 sm:pt-12">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight text-ink">System Info</h1>
            <p className="mt-1.5 text-sm text-ink-muted">
              Captured <span className="font-mono text-ink">{formatCapturedAt(snapshot.capturedAt)}</span>
            </p>
          </div>
          <div className="flex items-center gap-2">
            <button type="button" onClick={refresh} disabled={refreshing} className={SECONDARY}>
              {refreshing ? 'Refreshing…' : 'Refresh'}
            </button>
            <button type="button" onClick={copy} className={PRIMARY}>
              Copy system info
            </button>
          </div>
        </div>
      </header>

      <div className="mx-auto w-full max-w-4xl px-6 pb-24 pt-8 sm:px-8">
        {error !== null && (
          <p
            role="alert"
            className="mb-6 rounded-lg border border-notice-border bg-notice px-3.5 py-2.5 text-sm text-ink"
          >
            {error}
          </p>
        )}

        <div className="grid gap-3 sm:grid-cols-2">
          <LiveTile label="CPU usage">
            <p className="mt-2 font-mono text-3xl font-semibold tabular-nums text-ink">
              {live === null || live.cpuPercent === null ? '—' : `${live.cpuPercent}%`}
            </p>
          </LiveTile>
          <LiveTile label="Memory usage">
            <p className="mt-2 font-mono text-sm tabular-nums text-ink">
              {live === null
                ? '—'
                : `${formatMemory(live.memUsedBytes)} used of ${formatMemory(live.memTotalBytes)}`}
            </p>
            <div className="mt-2">
              <UsageBar
                usedBytes={live?.memUsedBytes ?? null}
                totalBytes={live?.memTotalBytes ?? null}
                label="Memory usage"
                size="lg"
              />
            </div>
          </LiveTile>
        </div>

        {!snapshot.hardwareAvailable && (
          <p className="mt-6 rounded-lg border border-notice-border bg-notice px-3.5 py-2.5 text-sm text-ink">
            Hardware details unavailable on this machine.
          </p>
        )}

        <div className="mt-8 space-y-6">
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

          {snapshot.gpus.length > 0 && (
            <InfoSection title="Graphics">
              {snapshot.gpus.map((gpu, index) => {
                const vram = formatVram(gpu.vramBytes);
                return (
                  <Fragment key={`${gpu.name}-${index}`}>
                    <InfoRow label={gpu.name} value={gpu.driverVersion} />
                    {vram !== null && (
                      <InfoRow
                        label="VRAM"
                        value={
                          <>
                            {vram}
                            {gpu.vramUncertain && (
                              <span
                                className="cursor-help"
                                title={VRAM_CAVEAT}
                                aria-label={VRAM_CAVEAT}
                              >
                                *
                              </span>
                            )}
                          </>
                        }
                      />
                    )}
                  </Fragment>
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
      </div>

      {toastKey > 0 && (
        <StartupToast
          key={toastKey}
          message="System info copied."
          durationMs={3000}
          onDismiss={() => setToastKey(0)}
        />
      )}
    </main>
  );
}
