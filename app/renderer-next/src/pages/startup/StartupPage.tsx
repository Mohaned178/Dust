import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { StartupEntry, StartupListState, StartupNotice, StartupToggleRefusal } from '../../../../src/shared/ipc';
import { useDialogs } from '../../app/dialogs';
import { useNavStore } from '../../app/nav';
import { useApi } from '../../lib/api';
import { filterEntries, moveEntry, patchEntry, summaryText, withDetails } from '../../lib/startup';
import type { StartupFilter } from '../../lib/startup';
import { useStartupStore } from '../../stores/startup';
import { Card } from '../../ui/Card';
import { EmptyState, ErrorState } from '../../ui/EmptyState';
import { Notice } from '../../ui/Notice';
import { PageHeader } from '../../ui/PageHeader';
import { SegmentedControl } from '../../ui/SegmentedControl';
import { Skeleton } from '../../ui/Skeleton';
import { useToast } from '../../ui/toast-store';
import { StartupAdminDialog, StartupEnableDialog } from './StartupDialogs';
import { StartupRow } from './StartupRow';

const FILTERS = [
  { value: 'all', label: 'All' },
  { value: 'on', label: 'On' },
  { value: 'off', label: 'Off' },
] as const;

const EMPTY_TEXT: Record<StartupFilter, string> = {
  all: 'No apps start with Windows.',
  on: 'Nothing is turned on.',
  off: 'Nothing is turned off.',
};

const REFUSAL_TEXT: Record<StartupToggleRefusal, string> = {
  'not-found': 'That entry is gone. The list was refreshed.',
  protected: 'Dust protects this entry, so it cannot be turned off.',
  'needs-admin': 'This entry needs administrator rights.',
  conflict: 'Windows or another app changed this entry. The list was refreshed.',
  'windows-disabled': 'You turned this off in Windows settings.',
  failed: 'Windows did not allow this change.',
};

export function StartupPage() {
  const api = useApi();
  const dialogs = useDialogs();
  const toast = useToast();
  const list = useStartupStore((state) => state.list);
  const details = useStartupStore((state) => state.details);
  const load = useStartupStore((state) => state.load);
  const notice = useNavStore((state) => state.params.startup?.notice ?? null);
  const clearParams = useNavStore((state) => state.clearParams);
  const [filter, setFilter] = useState<StartupFilter>('all');
  const [busy, setBusy] = useState<ReadonlySet<string>>(new Set());
  const [problem, setProblem] = useState<string | null>(null);
  const handledNotice = useRef<StartupNotice | null>(null);

  // Shows the last list at once and reads it again behind it; a hidden page stops doing this.
  useEffect(() => {
    void load(api);
  }, [api, load]);

  const state = list.data?.ok === true ? list.data.state : null;
  const failure = list.data?.ok === false ? list.data.message : list.error;
  // The list stays as the backend sent it; publishers and icons are laid over it only for display.
  const shown = useMemo(() => (state === null ? null : withDetails(state, details)), [state, details]);
  const entries = useMemo(() => (shown === null ? [] : filterEntries(shown.entries, filter)), [shown, filter]);

  const setBusyFor = useCallback((id: string, on: boolean) => {
    setBusy((current) => {
      const next = new Set(current);
      if (on) next.add(id);
      else next.delete(id);
      return next;
    });
  }, []);

  const current = () => {
    const result = useStartupStore.getState().list.data;
    return result?.ok === true ? result.state : null;
  };
  const apply = (next: StartupListState) => useStartupStore.getState().setState(next);

  const undo = useCallback(
    async (entry: StartupEntry) => {
      setBusyFor(entry.id, true);
      setProblem(null);
      try {
        const result = await api.enableStartupEntry(entry.id);
        if (result.ok) {
          useStartupStore.getState().setState(result.state);
          toast({ title: `${entry.name} turned on` });
        } else {
          setProblem(REFUSAL_TEXT[result.reason]);
        }
      } catch {
        setProblem(REFUSAL_TEXT.failed);
      } finally {
        setBusyFor(entry.id, false);
      }
    },
    [api, setBusyFor, toast],
  );

  const openAdminDialog = useCallback(
    (entry: StartupEntry) =>
      dialogs.open(({ open, close }) => (
        <StartupAdminDialog
          open={open}
          onClose={close}
          entry={entry}
          onRelaunch={() => api.relaunchElevated(entry.id)}
        />
      )),
    // `dialogs.open` is stable; the object around it is new every render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [api, dialogs.open],
  );

  const openEnableDialog = useCallback(
    (entry: StartupEntry) =>
      dialogs.open(({ open, close }) => (
        <StartupEnableDialog
          open={open}
          onClose={close}
          entry={entry}
          onConfirm={async () => {
            if (entry.requiresAdmin) {
              await api.relaunchElevated(entry.id, 'enable');
              return null;
            }
            const result = await api.enableStartupEntry(entry.id);
            if (!result.ok) return REFUSAL_TEXT[result.reason];
            useStartupStore.getState().setState(result.state);
            toast({ title: `${entry.name} turned on`, description: 'It starts at your next sign-in.' });
            return null;
          }}
        />
      )),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [api, dialogs.open, toast],
  );

  const runToggle = useCallback(
    async (entry: StartupEntry, next: boolean) => {
      // Undo only this entry, so details and other changes that arrived meanwhile stay.
      const revert = () => {
        const latest = current();
        if (latest !== null)
          apply(patchEntry(latest, entry.id, { state: entry.state, disabledKind: entry.disabledKind }));
      };
      setBusyFor(entry.id, true);
      setProblem(null);
      const before = current();
      if (before !== null) apply(moveEntry(before, entry.id, next));
      try {
        const result = next ? await api.enableStartupEntry(entry.id) : await api.disableStartupEntry(entry.id);
        if (result.ok) {
          apply(result.state);
          if (next) {
            toast({ title: `${entry.name} turned on` });
          } else {
            toast({
              title: `${entry.name} turned off`,
              description: 'It will not start with Windows.',
              action: { label: 'Undo', onAction: () => void undo(entry) },
            });
          }
          return;
        }
        revert();
        switch (result.reason) {
          case 'needs-admin':
            openAdminDialog(entry);
            break;
          case 'windows-disabled':
            openEnableDialog({ ...entry, disabledKind: 'windows' });
            break;
          case 'not-found':
          case 'conflict':
            setProblem(REFUSAL_TEXT[result.reason]);
            void load(api, true);
            break;
          default:
            setProblem(result.message.length > 0 ? result.message : REFUSAL_TEXT[result.reason]);
        }
      } catch {
        revert();
        setProblem(REFUSAL_TEXT.failed);
      } finally {
        setBusyFor(entry.id, false);
      }
    },

    [api, load, openAdminDialog, openEnableDialog, setBusyFor, toast, undo],
  );

  const onToggle = useCallback(
    (entry: StartupEntry, next: boolean) => {
      if (entry.protected) return;
      if (entry.disabledKind === 'windows') {
        if (next) openEnableDialog(entry);
        return;
      }
      if (entry.requiresAdmin) {
        openAdminDialog(entry);
        return;
      }
      void runToggle(entry, next);
    },
    [openAdminDialog, openEnableDialog, runToggle],
  );

  // Dust relaunched as administrator to finish a change; say what happened once, then forget the hint.
  useEffect(() => {
    if (notice === null || handledNotice.current === notice || state === null) return;
    handledNotice.current = notice;
    clearParams('startup');
    if (notice.to === 'disabled') {
      const entry = state.entries.find((candidate) => candidate.id === notice.entryId) ?? null;
      toast({
        title: `${notice.name} turned off`,
        description: 'It will not start with Windows.',
        ...(entry === null ? {} : { action: { label: 'Undo', onAction: () => void undo(entry) } }),
      });
    } else if (notice.disabledKind === 'windows') {
      toast({ title: `${notice.name} turned on`, description: 'It starts at your next sign-in.' });
    } else {
      toast({ title: `${notice.name} turned on` });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [notice, state]);

  let body;
  if (shown === null) {
    body =
      failure != null ? (
        <ErrorState
          title="Dust could not read your startup apps"
          description="Check that Windows is working normally, then try again."
          onRetry={() => void load(api, true)}
        />
      ) : (
        <div className="flex flex-col gap-2 p-4" aria-busy="true">
          {[0, 1, 2, 3].map((index) => (
            <Skeleton key={index} className="h-10 w-full" />
          ))}
        </div>
      );
  } else if (shown.counts.total === 0) {
    body = <EmptyState title="No apps start with Windows" description="Nothing is set to run when you sign in." />;
  } else if (entries.length === 0) {
    body = <EmptyState title={EMPTY_TEXT[filter]} />;
  } else {
    body = (
      <ul aria-label="Startup apps" className="divide-y divide-border">
        {entries.map((entry) => (
          <StartupRow key={entry.id} entry={entry} busy={busy.has(entry.id)} onToggle={onToggle} />
        ))}
      </ul>
    );
  }

  return (
    <>
      <PageHeader
        title="Startup"
        subtitle={shown === null ? 'Choose what starts with Windows.' : summaryText(shown.counts)}
        actions={
          shown !== null && shown.counts.total > 0 ? (
            <SegmentedControl label="Show startup apps" options={FILTERS} value={filter} onChange={setFilter} />
          ) : null
        }
      />
      <div className="flex flex-col gap-4">
        {problem !== null ? <Notice variant="warning">{problem}</Notice> : null}
        {failure != null && shown !== null ? (
          <Notice variant="warning">Dust could not refresh the list. These are the apps it saw last.</Notice>
        ) : null}
        <Card className="overflow-hidden">{body}</Card>
      </div>
    </>
  );
}
