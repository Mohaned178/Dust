import { useCallback, useDeferredValue, useEffect, useMemo, useRef, useState } from 'react';
import type { UninstallAppSummary, UninstallLaunchHint } from '../../../../src/shared/ipc';
import { useDialogs } from '../../app/dialogs';
import { useNavStore } from '../../app/nav';
import { useApi } from '../../lib/api';
import { formatBytes, formatCount } from '../../lib/format';
import { useAppsStore } from '../../stores/apps';
import { Button } from '../../ui/Button';
import { Card } from '../../ui/Card';
import { EmptyState, ErrorState } from '../../ui/EmptyState';
import { RefreshIcon } from '../../ui/icons';
import { Notice } from '../../ui/Notice';
import { PageHeader } from '../../ui/PageHeader';
import { SearchBox } from '../../ui/SearchBox';
import { SegmentedControl } from '../../ui/SegmentedControl';
import { Skeleton } from '../../ui/Skeleton';
import { useToast } from '../../ui/toast-store';
import { VirtualList } from '../../ui/VirtualList';
import { APP_ROW_HEIGHT, AppRow, estimatedBytes } from './AppRow';
import { openResumeFlow, openUninstallWizard } from './openUninstall';

type SortKey = 'name' | 'size';

const SORT_OPTIONS = [
  { value: 'name', label: 'Name' },
  { value: 'size', label: 'Size' },
] as const;

const NO_APPS: UninstallAppSummary[] = [];
const getKey = (app: UninstallAppSummary) => app.id;

/** The total of every app's size, as far as known. Reads the store itself, so only this line redraws as sizes arrive. */
function TotalSize({ apps }: { apps: ReadonlyArray<UninstallAppSummary> }) {
  const sizes = useAppsStore((state) => state.sizes);
  let total = 0;
  for (const app of apps) total += sizes.get(app.id) ?? estimatedBytes(app) ?? 0;
  return <>{total > 0 ? ` · ${formatBytes(total)}` : ''}</>;
}

function ListSkeleton() {
  return (
    <div className="flex flex-col gap-2 p-4" aria-busy="true">
      {[0, 1, 2, 3, 4, 5].map((index) => (
        <Skeleton key={index} className="h-10 w-full" />
      ))}
    </div>
  );
}

export function AppsPage() {
  const api = useApi();
  const dialogs = useDialogs();
  const toast = useToast();
  const list = useAppsStore((state) => state.list);
  const load = useAppsStore((state) => state.load);
  const measured = useAppsStore((state) => state.sizes.size);
  const hint = useNavStore((state) => state.params.apps?.hint ?? null);
  const clearParams = useNavStore((state) => state.clearParams);
  const [query, setQuery] = useState('');
  const deferredQuery = useDeferredValue(query);
  const [sort, setSort] = useState<SortKey>('name');
  // The order by size is worked out from the sizes known when it was asked for. Sizes that arrive later do not move
  // rows under the pointer; a link offers to sort again.
  const [sizesAtSort, setSizesAtSort] = useState<ReadonlyMap<string, number>>(() => useAppsStore.getState().sizes);
  const [pendingAppId, setPendingAppId] = useState<string | null>(null);
  const handledHint = useRef<UninstallLaunchHint | null>(null);

  // Shows the last list at once and reads it again behind it; a hidden page stops doing this.
  useEffect(() => {
    void load(api);
  }, [api, load]);

  const result = list.data;
  const apps = result?.ok === true ? result.apps : NO_APPS;
  const elevated = result?.ok === true && result.elevated;
  const failure = result?.ok === false ? result.message : list.error;
  const unreadable = result?.ok === true && !result.trusted;

  const refresh = useCallback(() => void load(api, true), [api, load]);

  const uninstall = useCallback(
    (app: UninstallAppSummary) =>
      openUninstallWizard(dialogs, { app, elevated, onChanged: () => void load(api, true) }),
    // `dialogs.open` is stable; the object around it is new every render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [dialogs.open, elevated, api, load],
  );

  // Dust relaunched as administrator leaves a hint: resume that app's removal, or adopt a job that is running.
  useEffect(() => {
    if (hint === null || handledHint.current === hint) return;
    handledHint.current = hint;
    clearParams('apps');
    if (hint.runningJobId !== null) {
      openResumeFlow(dialogs, { appId: null, adoptJobId: hint.runningJobId, elevated, onChanged: refresh });
    } else if (hint.appId !== null) {
      setPendingAppId(hint.appId);
    } else if (hint.stalePending) {
      toast({ title: 'The last uninstall did not start', description: 'Nothing was changed.' });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hint]);

  // The flow only opens once the list says whether this copy of Dust really is elevated.
  useEffect(() => {
    if (pendingAppId === null || result?.ok !== true) return;
    setPendingAppId(null);
    if (result.apps.some((app) => app.id === pendingAppId)) {
      openResumeFlow(dialogs, { appId: pendingAppId, adoptJobId: null, elevated: result.elevated, onChanged: refresh });
    } else {
      toast({ title: 'That app is no longer installed', description: 'Nothing was changed.' });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pendingAppId, result]);

  const visible = useMemo(() => {
    const needle = deferredQuery.trim().toLowerCase();
    const filtered =
      needle === '' ? apps : apps.filter((app) => `${app.displayName} ${app.publisher}`.toLowerCase().includes(needle));
    const bytesOf = (app: UninstallAppSummary) => sizesAtSort.get(app.id) ?? estimatedBytes(app) ?? 0;
    return [...filtered].sort((a, b) =>
      sort === 'size'
        ? bytesOf(b) - bytesOf(a) || a.displayName.localeCompare(b.displayName)
        : a.displayName.localeCompare(b.displayName, undefined, { sensitivity: 'base' }),
    );
  }, [apps, deferredQuery, sort, sizesAtSort]);

  const sortAgain = () => setSizesAtSort(useAppsStore.getState().sizes);
  const onSort = (next: SortKey) => {
    setSort(next);
    if (next === 'size') sortAgain();
  };
  const sizesChanged = sort === 'size' && measured !== sizesAtSort.size;

  const renderRow = useCallback(
    (app: UninstallAppSummary) => <AppRow app={app} elevated={elevated} onUninstall={uninstall} />,
    [elevated, uninstall],
  );

  let body;
  if (failure != null && apps.length === 0) {
    body = (
      <ErrorState
        title="Dust could not read your installed apps"
        description="Check that Windows is working normally, then try again."
        onRetry={refresh}
      />
    );
  } else if (unreadable) {
    body = (
      <ErrorState
        title="Dust could not read your installed apps"
        description="The list from Windows could not be trusted."
        onRetry={refresh}
      />
    );
  } else if (result === null && list.loading) {
    body = <ListSkeleton />;
  } else if (result !== null && apps.length === 0) {
    body = <EmptyState title="No apps found" description="Windows does not list any installed apps." />;
  } else if (visible.length === 0) {
    body = <EmptyState title="No apps match this search" description="Try part of the name or the publisher." />;
  } else {
    body = (
      <div className="h-[calc(100vh-18rem)] min-h-80">
        <VirtualList
          items={visible}
          rowHeight={APP_ROW_HEIGHT}
          getKey={getKey}
          label="Installed apps"
          renderRow={renderRow}
        />
      </div>
    );
  }

  return (
    <>
      <PageHeader
        title="Apps"
        subtitle={
          result?.ok === true ? (
            <>
              {formatCount(apps.length)} {apps.length === 1 ? 'app' : 'apps'}
              <TotalSize apps={apps} />
            </>
          ) : (
            'Uninstall apps you no longer use.'
          )
        }
        actions={
          <Button
            icon={<RefreshIcon className="size-4" aria-hidden="true" />}
            onClick={refresh}
            loading={list.loading && result !== null}
          >
            Refresh
          </Button>
        }
      />
      <div className="flex flex-col gap-4">
        {failure != null && apps.length > 0 ? (
          <Notice
            variant="warning"
            action={
              <Button variant="secondary" onClick={refresh}>
                Try again
              </Button>
            }
          >
            Dust could not refresh the list. These are the apps it saw last.
          </Notice>
        ) : null}
        <div className="flex flex-wrap items-center justify-between gap-3">
          <SearchBox label="Search apps" placeholder="Search apps" onSearch={setQuery} className="w-80" />
          <div className="flex items-center gap-3">
            {sizesChanged ? (
              <Button variant="subtle" onClick={sortAgain}>
                Sizes updated. Sort again
              </Button>
            ) : null}
            <SegmentedControl label="Sort apps by" options={SORT_OPTIONS} value={sort} onChange={onSort} />
          </div>
        </div>
        <Card className="overflow-hidden">{body}</Card>
      </div>
    </>
  );
}
