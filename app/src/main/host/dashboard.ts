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
  scan: ScanState | null;
  systemRoot: string;
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
    const snapshotMatch =
      !liveMatch && snapshotVolume !== null && snapshotVolume.toLowerCase() === root;

    let lastAnalyzedAt: number | null = null;
    let lastCleanedAt: number | null = null;
    let reclaimableBytes: number | null = null;
    let sessionOnly = false;
    if (liveMatch && live !== null) {
      lastAnalyzedAt = live.finishedAt;
      reclaimableBytes = live.reclaimableBytes;
      sessionOnly = true;
    } else if (snapshotMatch && snapshot !== null) {
      lastAnalyzedAt = snapshot.finishedAt;
      lastCleanedAt = snapshot.cleanedAt;
      reclaimableBytes = sumBytes(snapshot.categories);
    }

    return {
      root: volume.root,
      label: volume.label,
      driveType: volume.driveType,
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

  return { volumes, scan: input.scan, snapshot: describeSnapshot(input.snapshot) };
}

function describeSnapshot(result: SnapshotLoadResult): DashboardSnapshotInfo {
  const base = {
    root: null,
    finishedAt: null,
    scanStatus: null,
    reclaimableBytes: null,
    cleanedAt: null,
    rulesStale: false,
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
  };
}

function sumBytes(categories: Array<{ bytes: number }>): number {
  return categories.reduce((sum, entry) => sum + entry.bytes, 0);
}
