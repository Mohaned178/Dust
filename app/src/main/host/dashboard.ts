import { RULES_VERSION, volumeRootOf } from '@dust/core';
import type { SnapshotLoadResult, VolumeInfo, VolumeUsage } from '@dust/core';
import type { DashboardSnapshotInfo, DashboardState, DashboardVolumeCard, ScanState } from '../../shared/ipc';

export interface DashboardLiveResult {
  root: string;
  finishedAt: number;
  reclaimableBytes: number;
}

export interface DashboardInput {
  volumes: VolumeInfo[];
  usage: VolumeUsage[];
  snapshot: SnapshotLoadResult;
  /** Each volume's own snapshot; without it only the system snapshot is consulted. */
  snapshotFor?: (root: string) => SnapshotLoadResult;
  scan: ScanState | null;
  systemRoot: string;
  appsChangedAt?: number | null;
  live?: DashboardLiveResult | null;
}

export function buildDashboardState(input: DashboardInput): DashboardState {
  const snapshot = input.snapshot.kind === 'ok' ? input.snapshot.snapshot : null;
  const snapshotVolume = snapshot ? volumeRootOf(snapshot.root) : null;
  const live = input.live ?? null;
  const liveVolume = live ? volumeRootOf(live.root) : null;
  const systemVolume = input.systemRoot.toLowerCase();
  const usageByVolume = new Map(input.usage.map((entry) => [entry.volume.toLowerCase(), entry]));

  const volumes: DashboardVolumeCard[] = input.volumes.map((volume) => {
    const usage = usageByVolume.get(volume.root.toLowerCase());
    const root = volume.root.toLowerCase();
    const liveMatch = liveVolume !== null && liveVolume.toLowerCase() === root;
    const own = input.snapshotFor?.(volume.root);
    const volumeSnapshot = own !== undefined ? (own.kind === 'ok' ? own.snapshot : null) : snapshot;
    const ownVolume = volumeSnapshot ? volumeRootOf(volumeSnapshot.root) : snapshotVolume;
    const snapshotMatch = !liveMatch && volumeSnapshot !== null && ownVolume !== null && ownVolume.toLowerCase() === root;

    let lastAnalyzedAt: number | null = null;
    let lastCleanedAt: number | null = null;
    let reclaimableBytes: number | null = null;
    let sessionOnly = false;
    if (liveMatch && live !== null) {
      lastAnalyzedAt = live.finishedAt;
      reclaimableBytes = live.reclaimableBytes;
      sessionOnly = true;
    } else if (snapshotMatch && volumeSnapshot !== null) {
      lastAnalyzedAt = volumeSnapshot.finishedAt;
      lastCleanedAt = volumeSnapshot.cleanedAt;
      reclaimableBytes = sumBytes(volumeSnapshot.categories);
    }

    return {
      root: volume.root,
      label: volume.label,
      driveType: volume.driveType,
      mediaType: volume.mediaType ?? 'unknown',
      role: root === systemVolume ? 'system' : 'browse',
      external: volume.driveType === 'removable' || volume.driveType === 'network',
      totalBytes: usage?.totalBytes ?? null,
      freeBytes: usage?.freeBytes ?? null,
      lastAnalyzedAt,
      lastCleanedAt,
      reclaimableBytes,
      sessionOnly,
    };
  });

  return { volumes, scan: input.scan, snapshot: describeSnapshot(input.snapshot, input.appsChangedAt ?? null) };
}

function describeSnapshot(result: SnapshotLoadResult, appsChangedAt: number | null): DashboardSnapshotInfo {
  const base = {
    root: null,
    finishedAt: null,
    scanStatus: null,
    reclaimableBytes: null,
    cleanedAt: null,
    rulesStale: false,
    installedAppsStale: false,
  } as const;
  if (result.kind === 'missing') return { status: 'missing', ...base };
  if (result.kind === 'corrupt') return { status: 'corrupt', reason: result.reason, ...base };
  return {
    status: 'ok',
    root: result.snapshot.root,
    finishedAt: result.snapshot.finishedAt,
    scanStatus: result.snapshot.status,
    reclaimableBytes: sumBytes(result.snapshot.categories),
    cleanedAt: result.snapshot.cleanedAt,
    rulesStale: result.snapshot.rulesVersion !== RULES_VERSION,
    installedAppsStale: appsChangedAt !== null && result.snapshot.finishedAt < appsChangedAt,
  };
}

function sumBytes(categories: Array<{ bytes: number }>): number {
  return categories.reduce((sum, entry) => sum + entry.bytes, 0);
}
