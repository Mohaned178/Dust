import { useCallback, useEffect, useMemo, useState } from 'react';
import type {
  CleanItemResult,
  CleanPreview,
  CleanReport,
  DevCleanupState,
  DevProject,
  DustApi,
} from '../../../src/shared/ipc';
import { CleanPlan } from '../components/CleanPlan';
import { CleanSummary } from '../components/CleanSummary';
import { cleanErrorMessage, newCleanId } from '../clean';
import { formatBytes, formatRelativeTime } from '../format';

export interface DevCleanupViewProps {
  api: DustApi;
  root: string;
  onBack: () => void;
  onViewResults: (root: string) => void;
}

export function DevCleanupView({ api, root, onBack, onViewResults }: DevCleanupViewProps) {
  const [state, setState] = useState<DevCleanupState | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set());
  const [preview, setPreview] = useState<CleanPreview | null>(null);
  const [report, setReport] = useState<CleanReport | null>(null);
  const [acknowledge, setAcknowledge] = useState(false);
  const [busy, setBusy] = useState(false);
  const [cleanId, setCleanId] = useState<string | null>(null);
  const [progress, setProgress] = useState<CleanItemResult[]>([]);

  const load = useCallback(() => {
    api
      .getDevCleanup(root)
      .then(setState)
      .catch((cause: unknown) => setError(cause instanceof Error ? cause.message : String(cause)));
  }, [api, root]);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    if (cleanId === null) return;
    return api.onScanEvent((event) => {
      if (event.type === 'clean-item' && event.cleanId === cleanId) {
        setProgress((current) => [...current, event.item]);
      }
    });
  }, [api, cleanId]);

  const projects = useMemo(
    () => (state === null ? [] : state.groups.flatMap((group) => group.projects)),
    [state],
  );
  const selectedBytes = useMemo(
    () =>
      projects
        .filter((project) => selected.has(project.path))
        .reduce((sum, project) => sum + project.nodeModulesBytes, 0),
    [projects, selected],
  );

  const toggle = useCallback((path: string) => {
    setSelected((current) => {
      const next = new Set(current);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      return next;
    });
  }, []);

  const selectDeadGreen = useCallback(() => {
    if (state === null) return;
    const dead = state.groups.find((group) => group.id === 'dead');
    const paths = (dead?.projects ?? [])
      .filter((project) => project.offered && project.grade === 'green')
      .map((project) => project.path);
    setSelected(new Set(paths));
  }, [state]);

  const setPin = useCallback(
    async (path: string, pinned: boolean) => {
      const result = await api.setPin(path, pinned);
      if (result.ok) load();
      else setError(result.message);
    },
    [api, load],
  );

  const review = useCallback(async () => {
    setError(null);
    const result = await api.previewClean({ scope: 'dev', root, paths: [...selected] });
    if (result.ok) {
      setPreview(result.preview);
      setAcknowledge(false);
    } else {
      setError(cleanErrorMessage(result));
    }
  }, [api, root, selected]);

  const confirm = useCallback(async () => {
    if (preview === null) return;
    const id = newCleanId();
    setBusy(true);
    setError(null);
    setCleanId(id);
    setProgress([]);
    try {
      const result = await api.executeClean({
        cleanId: id,
        planId: preview.planId,
        acknowledge: preview.items.filter((item) => item.grade === 'review').map((item) => item.path),
      });
      if (result.ok) {
        setReport(result.report);
        setPreview(null);
        setSelected(new Set());
        load();
      } else {
        setError(cleanErrorMessage(result));
      }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(false);
      setCleanId(null);
    }
  }, [api, load, preview]);

  if (state === null) {
    return (
      <main className="mx-auto max-w-4xl px-8 py-10 text-sm text-neutral-400">
        {error ?? 'Loading projects.'}
      </main>
    );
  }

  return (
    <main className="mx-auto max-w-4xl px-8 py-10">
      <header className="mb-6">
        <h1 className="text-2xl font-semibold text-neutral-100">Dev Cleanup</h1>
        <p className="mt-1 text-sm text-neutral-400">
          {root}
          {state.finishedAt !== null && ` · analyzed ${formatRelativeTime(state.finishedAt)}`}
        </p>
      </header>

      {state.source === 'empty' ? (
        <p className="text-sm text-neutral-400">
          No scan data for this volume - run an Analyze from the dashboard first.
        </p>
      ) : report !== null ? (
        <CleanSummary
          report={report}
          onDone={() => {
            setReport(null);
            load();
          }}
          doneLabel="Back to projects"
        />
      ) : preview !== null ? (
        <CleanPlan
          preview={preview}
          acknowledge={acknowledge}
          onAcknowledge={setAcknowledge}
          onConfirm={() => void confirm()}
          onCancel={() => setPreview(null)}
          onReveal={(target) => {
            void api.revealPath(target).catch(() => {});
          }}
          busy={busy}
        />
      ) : (
        <>
          {error !== null && <p className="mb-4 text-sm text-red-300">{error}</p>}
          {busy && progress.length > 0 && (
            <ul role="status" className="mb-4 space-y-1 text-sm text-neutral-300">
              {progress.map((item) => (
                <li key={item.path}>
                  {item.path} - {item.status}
                </li>
              ))}
            </ul>
          )}

          <div className="mb-4 flex flex-wrap items-center gap-3">
            <button
              type="button"
              onClick={selectDeadGreen}
              className="rounded-md border border-neutral-700 px-3 py-1.5 text-sm text-neutral-200"
            >
              Select all Dead + green
            </button>
            <span className="text-sm text-neutral-400">
              {selected.size} selected · {formatBytes(selectedBytes)}
            </span>
            <button
              type="button"
              disabled={selected.size === 0}
              onClick={() => void review()}
              className="rounded-md bg-emerald-600 px-3 py-1.5 text-sm font-medium text-white disabled:opacity-40"
            >
              Review cleanup
            </button>
          </div>

          <div className="space-y-6">
            {state.groups.map((group) => (
              <section key={group.id} aria-label={group.label}>
                <h2 className="text-sm font-medium uppercase tracking-wide text-neutral-500">
                  {group.label} ({group.projects.length})
                </h2>
                {group.projects.length === 0 ? (
                  <p className="mt-1 text-sm text-neutral-600">None.</p>
                ) : (
                  <ul className="mt-2 space-y-2">
                    {group.projects.map((project) => (
                      <li key={project.path} className="rounded-lg border border-neutral-800 bg-neutral-900 p-3">
                        <div className="flex items-start gap-3">
                          <input
                            type="checkbox"
                            aria-label={`Select ${project.name}`}
                            checked={selected.has(project.path)}
                            disabled={!project.offered || busy}
                            onChange={() => toggle(project.path)}
                            className="mt-1"
                          />
                          <div className="min-w-0 flex-1">
                            <p className="truncate text-neutral-100" title={project.path}>
                              {project.name}
                            </p>
                            <p className="break-all text-xs text-neutral-500">{project.path}</p>
                            <p className="mt-1 text-xs text-neutral-400">
                              {formatBytes(project.nodeModulesBytes)} · {describeActivity(project)} ·{' '}
                              {project.packageManager}
                              {project.kind === 'monorepo' ? ` · ${project.workspaceCount} packages` : ''}
                            </p>
                            {project.reasons.length > 0 && (
                              <p className="mt-1 text-xs text-amber-300">{project.reasons.join(' · ')}</p>
                            )}
                            {project.restoreCommand !== null && (
                              <p className="mt-1 text-xs text-neutral-500">Rebuild: {project.restoreCommand}</p>
                            )}
                          </div>
                          <span
                            className={`shrink-0 rounded px-2 py-0.5 text-xs font-medium ${
                              project.grade === 'green'
                                ? 'bg-emerald-500/15 text-emerald-300'
                                : 'bg-amber-500/15 text-amber-300'
                            }`}
                          >
                            {project.grade === 'green' ? 'Green' : project.grade === 'yellow' ? 'Yellow' : 'Not offered'}
                          </span>
                          <button
                            type="button"
                            aria-label={`${project.pinned ? 'Unpin' : 'Keep'} ${project.name}`}
                            onClick={() => void setPin(project.path, !project.pinned)}
                            className="shrink-0 rounded-md border border-neutral-700 px-2 py-1 text-xs text-neutral-200"
                          >
                            {project.pinned ? 'Unpin' : 'Keep'}
                          </button>
                        </div>
                      </li>
                    ))}
                  </ul>
                )}
              </section>
            ))}
          </div>

          {state.recentlyCleaned.length > 0 && (
            <details className="mt-6 rounded-xl border border-neutral-800 bg-neutral-900 p-4">
              <summary className="cursor-pointer text-sm text-neutral-300">
                Recently cleaned ({state.recentlyCleaned.length})
              </summary>
              <ul className="mt-3 space-y-2 text-sm">
                {state.recentlyCleaned.map((entry) => (
                  <li key={entry.path} className="rounded-lg border border-neutral-800 p-2">
                    <p className="text-neutral-200">{entry.name}</p>
                    <p className="break-all text-xs text-neutral-500">{entry.path}</p>
                    <p className="mt-1 text-xs text-neutral-400">
                      {formatBytes(entry.bytes)} freed {formatRelativeTime(entry.cleanedAt)}
                      {entry.restoreCommand !== null && ` · rebuild with ${entry.restoreCommand}`}
                    </p>
                  </li>
                ))}
              </ul>
            </details>
          )}
        </>
      )}

      <button
        type="button"
        onClick={onBack}
        className="mt-6 rounded-md bg-neutral-800 px-3 py-1.5 text-sm text-neutral-200"
      >
        Back to dashboard
      </button>
      <button
        type="button"
        onClick={() => onViewResults(root)}
        className="mt-6 ml-2 rounded-md border border-neutral-700 px-3 py-1.5 text-sm text-neutral-200"
      >
        View results
      </button>
    </main>
  );
}

function describeActivity(project: DevProject): string {
  if (project.activityMs === null) return 'activity unknown';
  return `${formatRelativeTime(project.activityMs)} (${project.activitySource})`;
}
