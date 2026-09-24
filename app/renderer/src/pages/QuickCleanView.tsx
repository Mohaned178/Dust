import type { DustApi } from '../../../src/shared/ipc';
import { CleanFlow } from '../components/CleanFlow';

export interface QuickCleanViewProps {
  api: DustApi;
  onDone: () => void;
  onViewResults: (root: string) => void;
}

export function QuickCleanView({ api, onDone, onViewResults }: QuickCleanViewProps) {
  return (
    <CleanFlow
      api={api}
      scope="quick"
      label="Quick Clean"
      onClose={onDone}
      onPrimary={(report) => onViewResults(report.root)}
      primaryLabel="View Updated Disk"
      offerRelaunch
    />
  );
}
