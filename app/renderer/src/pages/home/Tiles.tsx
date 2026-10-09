import { useEffect, useMemo } from 'react';
import { useNavStore } from '../../app/nav';
import { useApi } from '../../lib/api';
import { formatBytes, formatCount } from '../../lib/format';
import { useAppsStore } from '../../stores/apps';
import { useDevStore } from '../../stores/dev';
import { useHealthStore } from '../../stores/health';
import { useStartupStore } from '../../stores/startup';
import { Tile } from './Tile';

const UNAVAILABLE = 'Unavailable right now';
/** How often the PC Health tile re-reads memory and processor use. Paused while Home is hidden. */
const LIVE_POLL_MS = 5000;

export function StartupTile() {
  const api = useApi();
  const list = useStartupStore((state) => state.list);
  const load = useStartupStore((state) => state.load);
  const navigate = useNavStore((state) => state.navigate);
  useEffect(() => {
    void load(api);
  }, [api, load]);

  const result = list.data;
  const ready = result?.ok ? result.state : null;
  return (
    <Tile
      title="Startup"
      loading={result === null && list.error === null}
      figure={ready ? formatCount(ready.counts.enabled) : '—'}
      detail={ready ? `${ready.counts.enabled === 1 ? 'app starts' : 'apps start'} with Windows` : UNAVAILABLE}
      onOpen={() => navigate('startup')}
    />
  );
}

export function AppsTile() {
  const api = useApi();
  const list = useAppsStore((state) => state.list);
  const load = useAppsStore((state) => state.load);
  const navigate = useNavStore((state) => state.navigate);
  useEffect(() => {
    void load(api);
  }, [api, load]);

  const result = list.data;
  const count = result?.ok ? result.apps.length : null;
  return (
    <Tile
      title="Apps"
      loading={result === null && list.error === null}
      figure={count === null ? '—' : formatCount(count)}
      detail={count === null ? UNAVAILABLE : count === 1 ? 'app installed' : 'apps installed'}
      onOpen={() => navigate('apps')}
    />
  );
}

export function HealthTile() {
  const api = useApi();
  const live = useHealthStore((state) => state.live);
  const loadLive = useHealthStore((state) => state.loadLive);
  const navigate = useNavStore((state) => state.navigate);
  useEffect(() => {
    void loadLive(api);
    const timer = setInterval(() => void loadLive(api), LIVE_POLL_MS);
    return () => clearInterval(timer);
  }, [api, loadLive]);

  const data = live.data;
  const memory = data && data.memTotalBytes > 0 ? Math.round((data.memUsedBytes / data.memTotalBytes) * 100) : null;
  return (
    <Tile
      title="PC Health"
      loading={data === null && live.error === null}
      figure={memory === null ? '—' : `${memory}%`}
      detail={
        data && memory !== null
          ? `memory in use${data.cpuPercent === null ? '' : ` · CPU ${Math.round(data.cpuPercent)}%`}`
          : UNAVAILABLE
      }
      onOpen={() => navigate('health')}
    />
  );
}

export function DeveloperTile({ root, scanned }: { root: string | null; scanned: boolean }) {
  const api = useApi();
  const cleanup = useDevStore((state) => state.cleanup);
  const load = useDevStore((state) => state.load);
  const navigate = useNavStore((state) => state.navigate);
  useEffect(() => {
    if (root !== null && scanned) void load(api, root);
  }, [api, load, root, scanned]);

  const bytes = useMemo(() => {
    const state = cleanup.data;
    if (!state || state.source === 'empty') return null;
    let total = 0;
    for (const group of state.groups) {
      for (const project of group.projects) if (project.offered && !project.pinned) total += project.nodeModulesBytes;
    }
    return total;
  }, [cleanup.data]);

  const waiting = root === null || (scanned && cleanup.data === null && cleanup.error === null);
  return (
    <Tile
      title="Developer"
      loading={waiting}
      figure={bytes === null ? '—' : formatBytes(bytes)}
      detail={bytes === null ? (scanned ? UNAVAILABLE : 'Scan to find project caches') : 'in project caches'}
      onOpen={() => navigate('developer', root === null ? undefined : { root })}
    />
  );
}
