import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { DustApi } from '../../../src/shared/ipc';
import { CleanDialog } from '../components/CleanDialog';
import { TreeTable } from '../components/TreeTable';
import { InfoIcon } from '../components/icons';
import { browseRefusalMessage } from '../clean';
import {
  applyBrowseDelete,
  browseRootBytes,
  createBrowseStore,
  flattenBrowse,
  upsertBrowseRows,
} from '../browse-tree';
import type { BrowseNode, BrowseStore } from '../browse-tree';
import { pathKey, sameRoot } from '../tree';
import type { SortState } from '../tree';

export interface BrowseViewProps {
  api: DustApi;
  root: string;
  runId: string | null;
  onBack?: () => void;
}

const FOCUS = 'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent';
const SECONDARY = `inline-flex items-center justify-center rounded-lg border border-hairline bg-surface px-3.5 py-1.5 text-sm font-medium text-ink transition-colors hover:border-hairline-strong hover:bg-surface-hover disabled:cursor-not-allowed disabled:opacity-45 ${FOCUS}`;
const PRIMARY = `inline-flex items-center justify-center rounded-lg bg-accent px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-accent-strong disabled:cursor-not-allowed disabled:opacity-45 ${FOCUS}`;

export function BrowseView({ api, root, runId, onBack }: BrowseViewProps) {
  const storeRef = useRef<BrowseStore>(createBrowseStore(root));
  const [version, setVersion] = useState(0);
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(new Set());
  const [sort, setSort] = useState<SortState>({ key: 'size', desc: true });
  const [label, setLabel] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [pendingDelete, setPendingDelete] = useState<string | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const seededRef = useRef(false);

  useEffect(() => {
    storeRef.current = createBrowseStore(root);
    seededRef.current = false;
    setExpanded(new Set());
    setLoaded(false);
    setVersion((value) => value + 1);
  }, [root]);

  useEffect(() => {
    let active = true;
    api
      .getDashboard()
      .then((state) => {
        if (!active) return;
        const volume = state.volumes.find((entry) => sameRoot(entry.root, root));
        setLabel(volume?.label ?? null);
      })
      .catch(() => {});
    return () => {
      active = false;
    };
  }, [api, root]);

  useEffect(() => {
    return api.onScanEvent((next) => {
      if (next.type !== 'browse-folders' || runId === null || next.runId !== runId) return;
      upsertBrowseRows(storeRef.current, next.folders);
      setLoaded(true);
      setVersion((value) => value + 1);
    });
  }, [api, runId]);

  useEffect(() => {
    if (runId !== null) return;
    let cancelled = false;
    api
      .getBrowseResults(root)
      .then((state) => {
        if (cancelled) return;
        storeRef.current = createBrowseStore(root);
        upsertBrowseRows(storeRef.current, state.rows);
        setLoaded(true);
        setVersion((value) => value + 1);
      })
      .catch(() => {
        if (!cancelled) setLoaded(true);
      });
    return () => {
      cancelled = true;
    };
  }, [api, root, runId]);

  useEffect(() => {
    if (seededRef.current) return;
    const store = storeRef.current;
    const rootNode = store.nodes.get(pathKey(store.root));
    if (!rootNode || rootNode.children.length === 0) return;
    const next = new Set<string>();
    const walk = (node: BrowseNode, depth: number): void => {
      if (depth >= 2) return;
      for (const key of node.children) {
        const child = store.nodes.get(key);
        if (!child) continue;
        next.add(key);
        walk(child, depth + 1);
      }
    };
    walk(rootNode, 0);
    seededRef.current = true;
    setExpanded(next);
  }, [version, root]);

  const rows = useMemo(() => flattenBrowse(storeRef.current, expanded, sort), [version, expanded, sort]);
  const totalBytes = useMemo(() => browseRootBytes(storeRef.current), [version]);

  const toggle = useCallback((path: string) => {
    setExpanded((current) => {
      const next = new Set(current);
      const key = pathKey(path);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }, []);

  const reveal = useCallback(
    (path: string) => {
      void api.revealPath(path).catch(() => {});
    },
    [api],
  );

  const closeDialog = useCallback(() => {
    setPendingDelete(null);
    setDeleteError(null);
  }, []);

  const confirmDelete = useCallback(async () => {
    if (pendingDelete === null) return;
    setBusy(true);
    setDeleteError(null);
    try {
      const result = await api.deleteBrowsePath(pendingDelete);
      if (result.status === 'done' || result.status === 'partial' || result.status === 'already-gone') {
        applyBrowseDelete(storeRef.current, pendingDelete, result.deletedBytes, result.status !== 'partial');
        setVersion((value) => value + 1);
        closeDialog();
        return;
      }
      setDeleteError(browseRefusalMessage(result.refusal ?? result.errors[0]?.code));
    } catch (cause) {
      setDeleteError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(false);
    }
  }, [api, closeDialog, pendingDelete]);

  return (
    <main className="dust-dashboard flex min-h-screen flex-col bg-canvas text-ink">
      <div className="sticky top-0 z-30 border-b border-notice-border bg-notice">
        <div className="mx-auto flex max-w-6xl items-start gap-2.5 px-6 py-2.5 text-sm text-ink sm:px-8">
          <InfoIcon className="mt-0.5 h-4 w-4 shrink-0 text-accent" />
          <p className="min-w-0">Browse mode — Dust doesn't grade safety on this drive. You're in control.</p>
        </div>
      </div>

      <div className="mx-auto w-full max-w-6xl flex-1 px-6 py-10 sm:px-8">
        <header className="flex flex-wrap items-end justify-between gap-x-6 gap-y-2">
          <h1 className="text-2xl font-semibold tracking-tight text-ink">
            <span className="font-mono">{root}</span>
            {label !== null && label !== '' && (
              <>
                <span className="mx-2 font-normal text-ink-muted" aria-hidden="true">
                  —
                </span>
                <span className="font-normal">{label}</span>
              </>
            )}
          </h1>
          {onBack !== undefined && (
            <button type="button" onClick={onBack} className={SECONDARY}>
              Back to dashboard
            </button>
          )}
        </header>

        <div className="mt-6">
          {!loaded ? (
            <p className="rounded-2xl border border-hairline bg-surface px-4 py-14 text-center text-sm text-ink-muted">
              Loading…
            </p>
          ) : rows.length === 0 ? (
            <p className="rounded-2xl border border-hairline bg-surface px-4 py-14 text-center text-sm text-ink-muted">
              Nothing to show here.
            </p>
          ) : (
            <TreeTable
              mode="browse"
              rows={rows}
              totalBytes={totalBytes}
              sort={sort}
              onSortChange={setSort}
              expanded={expanded}
              onToggle={toggle}
              onReveal={reveal}
              onDelete={setPendingDelete}
            />
          )}
        </div>
      </div>

      {pendingDelete !== null && (
        <CleanDialog label={`Delete ${pendingDelete}`} onClose={closeDialog}>
          <h2 className="text-lg font-semibold tracking-tight text-ink">Delete permanently?</h2>
          <p className="mt-2 break-all font-mono text-xs text-ink-muted">{pendingDelete}</p>
          <p className="mt-3 text-sm text-ink">This deletes the item permanently. It cannot be undone.</p>
          {deleteError !== null && (
            <p
              role="alert"
              className="mt-4 rounded-lg border border-notice-border bg-notice px-3.5 py-2.5 text-sm text-ink"
            >
              {deleteError}
            </p>
          )}
          <div className="mt-6 flex justify-end gap-2">
            <button type="button" onClick={closeDialog} disabled={busy} className={SECONDARY}>
              Cancel
            </button>
            <button type="button" onClick={() => void confirmDelete()} disabled={busy} className={PRIMARY}>
              {busy ? 'Deleting…' : 'Delete permanently'}
            </button>
          </div>
        </CleanDialog>
      )}
    </main>
  );
}
