import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type {
  DustApi,
  StartupEntry,
  StartupListState,
  StartupNotice,
  StartupToggleResult,
} from '../../../src/shared/ipc';
import { StartupAdminDialog } from '../components/StartupAdminDialog';
import { StartupEnableDialog } from '../components/StartupEnableDialog';
import { StartupRow } from '../components/StartupRow';
import { StartupToast } from '../components/StartupToast';

export interface StartupViewProps {
  api: DustApi;
  notice: StartupNotice | null;
  onNoticeShown: () => void;
}

interface ToastState {
  key: number;
  message: string;
  durationMs: number;
  action?: { label: string; run: () => void };
}

function sortByName(entries: StartupEntry[]): StartupEntry[] {
  return [...entries].sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }));
}

function countsFor(entries: StartupEntry[]): StartupListState['counts'] {
  return {
    total: entries.length,
    enabled: entries.filter((entry) => entry.state === 'enabled').length,
    disabled: entries.filter((entry) => entry.state === 'disabled').length,
  };
}

function moveEntry(state: StartupListState, id: string, next: boolean): StartupListState {
  const entries = state.entries.map((entry) =>
    entry.id === id
      ? {
          ...entry,
          state: next ? ('enabled' as const) : ('disabled' as const),
          disabledKind: next ? null : ('dust' as const),
        }
      : entry,
  );
  return { ...state, entries, counts: countsFor(entries) };
}

function errorText(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause);
}

export function StartupView({ api, notice, onNoticeShown }: StartupViewProps) {
  const [state, setState] = useState<StartupListState | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [toast, setToast] = useState<ToastState | null>(null);
  const [adminEntry, setAdminEntry] = useState<StartupEntry | null>(null);
  const [adminBusy, setAdminBusy] = useState(false);
  const [adminError, setAdminError] = useState<string | null>(null);
  const [enableEntry, setEnableEntry] = useState<StartupEntry | null>(null);
  const [enableBusy, setEnableBusy] = useState(false);
  const [enableError, setEnableError] = useState<string | null>(null);
  const toastKey = useRef(0);
  const noticeShown = useRef(false);

  const load = useCallback(() => {
    api
      .getStartup()
      .then((result) => {
        if (result.ok) {
          setState(result.state);
          setError(null);
        } else {
          setError(result.message);
        }
      })
      .catch((cause: unknown) => setError(errorText(cause)));
  }, [api]);

  useEffect(() => {
    load();
  }, [load]);

  const showToast = useCallback((message: string, durationMs: number, action?: { label: string; run: () => void }) => {
    toastKey.current += 1;
    setToast({ key: toastKey.current, message, durationMs, action });
  }, []);

  const undo = useCallback(
    async (entry: StartupEntry) => {
      setBusyId(entry.id);
      setError(null);
      try {
        const result = await api.enableStartupEntry(entry.id);
        if (!result.ok) {
          setError(result.message);
        } else {
          setState(result.state);
          showToast(`${entry.name} enabled`, 3000);
        }
      } catch (cause) {
        setError(errorText(cause));
      } finally {
        setBusyId(null);
      }
    },
    [api, showToast],
  );

  const runToggle = useCallback(
    async (entry: StartupEntry, next: boolean) => {
      const previous = state;
      setBusyId(entry.id);
      setError(null);
      if (previous !== null) setState(moveEntry(previous, entry.id, next));
      try {
        const result: StartupToggleResult = next
          ? await api.enableStartupEntry(entry.id)
          : await api.disableStartupEntry(entry.id);
        if (!result.ok) {
          setState(previous);
          setError(result.message);
          return;
        }
        setState(result.state);
        if (!next) {
          showToast(`${entry.name} disabled`, 5000, {
            label: 'Undo',
            run: () => {
              void undo(entry);
            },
          });
        } else {
          showToast(`${entry.name} enabled`, 3000);
        }
      } catch (cause) {
        setState(previous);
        setError(errorText(cause));
      } finally {
        setBusyId(null);
      }
    },
    [api, showToast, state, undo],
  );

  const toggle = useCallback(
    (entry: StartupEntry, next: boolean) => {
      if (entry.protected) return;
      if (entry.disabledKind === 'windows') {
        if (next) {
          setEnableError(null);
          setEnableEntry(entry);
        }
        return;
      }
      if (entry.requiresAdmin) {
        setAdminError(null);
        setAdminEntry(entry);
        return;
      }
      void runToggle(entry, next);
    },
    [runToggle],
  );

  const cancelEnable = useCallback(() => {
    setEnableEntry(null);
    setEnableError(null);
  }, []);

  const confirmEnable = useCallback(async () => {
    if (enableEntry === null) return;
    setEnableBusy(true);
    setEnableError(null);
    if (enableEntry.requiresAdmin) {
      try {
        await api.relaunchElevated(enableEntry.id, 'enable');
      } catch {
        setEnableBusy(false);
        setEnableError('Could not relaunch with administrator rights.');
      }
      return;
    }
    try {
      const result = await api.enableStartupEntry(enableEntry.id);
      if (!result.ok) {
        setEnableBusy(false);
        setEnableEntry(null);
        showToast("Windows didn't allow this change.", 5000);
        return;
      }
      setState(result.state);
      setEnableBusy(false);
      setEnableEntry(null);
      showToast(`Turned on ${enableEntry.name} — starts at next sign-in.`, 3000);
    } catch {
      setEnableBusy(false);
      setEnableEntry(null);
      showToast("Windows didn't allow this change.", 5000);
    }
  }, [api, enableEntry, showToast]);

  useEffect(() => {
    if (notice === null || noticeShown.current || state === null) return;
    noticeShown.current = true;
    if (notice.to === 'disabled') {
      const entry = state.entries.find((candidate) => candidate.id === notice.entryId) ?? null;
      showToast(
        `${notice.name} disabled`,
        5000,
        entry === null
          ? undefined
          : {
              label: 'Undo',
              run: () => {
                void undo(entry);
              },
            },
      );
    } else if (notice.disabledKind === 'windows') {
      showToast(`Turned on ${notice.name} — starts at next sign-in.`, 3000);
    } else {
      showToast(`${notice.name} enabled`, 3000);
    }
    onNoticeShown();
  }, [notice, state, showToast, undo, onNoticeShown]);

  const relaunch = useCallback(async () => {
    if (adminEntry === null) return;
    setAdminBusy(true);
    setAdminError(null);
    try {
      await api.relaunchElevated(adminEntry.id);
    } catch {
      setAdminBusy(false);
      setAdminError('Could not relaunch with administrator rights. Try again, or turn the entry off in Task Manager.');
    }
  }, [adminEntry, api]);

  const enabled = useMemo(
    () => sortByName((state?.entries ?? []).filter((entry) => entry.state === 'enabled')),
    [state],
  );
  const disabled = useMemo(
    () => sortByName((state?.entries ?? []).filter((entry) => entry.state === 'disabled')),
    [state],
  );

  if (state === null) {
    return (
      <main className="dust-dashboard flex min-h-screen items-center justify-center bg-canvas px-6 text-sm text-ink-muted">
        {error ?? 'Loading startup entries.'}
      </main>
    );
  }

  return (
    <main className="dust-dashboard min-h-screen bg-canvas text-ink">
      <header className="mx-auto w-full max-w-4xl px-6 pt-10 sm:px-8 sm:pt-12">
        <h1 className="text-2xl font-semibold tracking-tight text-ink">Startup Manager</h1>
        <p className="mt-1.5 text-sm text-ink-muted">
          <span className="font-mono text-ink">{state.counts.total}</span> entries
        </p>
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

        {state.counts.total === 0 ? (
          <p className="rounded-xl border border-hairline bg-surface px-4 py-14 text-center text-sm text-ink-muted">
            No startup entries found.
          </p>
        ) : (
          <div className="space-y-8">
            <StartupSection
              title="Enabled"
              count={state.counts.enabled}
              entries={enabled}
              empty="Nothing here."
              busyId={busyId}
              onToggle={toggle}
            />
            <StartupSection
              title="Disabled"
              count={state.counts.disabled}
              entries={disabled}
              empty="No disabled entries."
              busyId={busyId}
              onToggle={toggle}
            />
          </div>
        )}
      </div>

      {toast !== null && (
        <StartupToast
          key={toast.key}
          message={toast.message}
          durationMs={toast.durationMs}
          action={toast.action === undefined ? undefined : { label: toast.action.label, onClick: toast.action.run }}
          onDismiss={() => setToast(null)}
        />
      )}

      {adminEntry !== null && (
        <StartupAdminDialog
          entry={adminEntry}
          busy={adminBusy}
          error={adminError}
          onCancel={() => setAdminEntry(null)}
          onRelaunch={() => {
            void relaunch();
          }}
        />
      )}

      {enableEntry !== null && (
        <StartupEnableDialog
          entry={enableEntry}
          busy={enableBusy}
          error={enableError}
          onCancel={cancelEnable}
          onConfirm={() => {
            void confirmEnable();
          }}
        />
      )}
    </main>
  );
}

interface StartupSectionProps {
  title: string;
  count: number;
  entries: StartupEntry[];
  empty: string;
  busyId: string | null;
  onToggle: (entry: StartupEntry, next: boolean) => void;
}

function StartupSection({ title, count, entries, empty, busyId, onToggle }: StartupSectionProps) {
  return (
    <section
      aria-label={title}
      className="overflow-hidden rounded-2xl border border-hairline bg-surface shadow-[0_1px_2px_rgba(16,24,40,0.04)]"
    >
      <div className="flex items-center gap-3 px-4 py-3.5">
        <h2 className="text-sm font-semibold text-ink">{title}</h2>
        <span className="text-sm text-ink-muted">{count}</span>
      </div>
      <div className="h-px w-full bg-hairline" aria-hidden="true" />
      {entries.length === 0 ? (
        <p className="px-4 py-4 text-sm text-ink-muted">{empty}</p>
      ) : (
        <ul className="divide-y divide-hairline">
          {entries.map((entry) => (
            <StartupRow key={entry.id} entry={entry} busy={busyId === entry.id} onToggle={onToggle} />
          ))}
        </ul>
      )}
    </section>
  );
}
