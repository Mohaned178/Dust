import type { DashboardVolumeCard } from '../../../../src/shared/ipc';
import { formatBytes } from '../../lib/format';
import { Card, CardHeader } from '../../ui/Card';
import { UsageBar } from '../../ui/UsageBar';

function driveName(volume: DashboardVolumeCard): string {
  return volume.label ? `${volume.root} · ${volume.label}` : volume.root;
}

/** One row per drive other than Windows: how full it is. Dust only cleans the Windows drive. */
export function OtherDrives({ volumes }: { volumes: ReadonlyArray<DashboardVolumeCard> }) {
  if (volumes.length === 0) return null;
  return (
    <Card>
      <CardHeader title="Other drives" />
      <ul className="flex flex-col gap-4 px-4 pb-4">
        {volumes.map((volume) => {
          const { totalBytes, freeBytes } = volume;
          const used = totalBytes !== null && freeBytes !== null ? Math.max(totalBytes - freeBytes, 0) : null;
          return (
            <li key={volume.root} className="flex flex-col gap-1.5">
              <div className="flex items-baseline justify-between gap-3">
                <span className="text-body font-semibold">{driveName(volume)}</span>
                <span className="text-caption text-ink-2">
                  {used !== null && totalBytes !== null && freeBytes !== null
                    ? `${formatBytes(used)} used · ${formatBytes(freeBytes)} free of ${formatBytes(totalBytes)}`
                    : 'Size unavailable'}
                </span>
              </div>
              {used !== null && totalBytes !== null ? (
                <UsageBar
                  segments={[{ id: 'used', label: 'Used', bytes: used }]}
                  totalBytes={totalBytes}
                  label={`Space used on ${volume.root}`}
                  legend={false}
                />
              ) : null}
            </li>
          );
        })}
      </ul>
    </Card>
  );
}
