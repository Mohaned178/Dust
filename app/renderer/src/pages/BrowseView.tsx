import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { DustApi } from '../../../src/shared/ipc';
import { TreeTable } from '../components/TreeTable';
import { applyBrowseDelete, browseRootBytes, createBrowseStore, flattenBrowse, upsertBrowseRows } from '../browse-tree';
import type { BrowseStore } from '../browse-tree';
import { pathKey } from '../tree';
import type { SortState } from '../tree';

export interface BrowseViewProps {
  api: DustApi;
  root: string;
  runId: string;
}

export function BrowseView({ api, root, runId }: BrowseViewProps) {
  const storeRef = useRef<BrowseStore>(createBrowseStore(root));
  const [version, setVersion] = useState(0);
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(new Set());
  const [sort, setSort] = useState<SortState>({ key: 'size', desc: true });
  const [pendingDelete, setPendingDelete] = useState<string | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    storeRef.current = createBrowseStore(root);
    setVersion((value) => value + 1);
  }, [root]);

  useEffect(() => {
    return api.onScanEvent((next) => {
      if (next.type !== 'browse-folders' || next.runId !== runId) return;
      upsertBrowseRows(storeRef.current, next.folders);
      setVersion((value) => value + 1);
    });
  }, [api, runId]);

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
      setDeleteError(`Delete refused (${result.refusal ?? result.errors[0]?.code ?? 'denied'})`);
    } catch (cause) {
      setDeleteError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(false);
    }
  }, [api, closeDialog, pendingDelete]);

  return (
    <section aria-label="Browse results" className="space-y-4">
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

      {pendingDelete !== null && (
        <div
          role="dialog"
          aria-label={`Delete ${pendingDelete}`}
          className="fixed inset-0 z-20 flex items-center justify-center bg-black/60 p-6"
        >
          <div className="w-[520px] rounded-xl border border-neutral-700 bg-neutral-950 p-4">
            <h2 className="text-base font-medium text-neutral-100">Delete permanently?</h2>
            <p className="mt-2 break-all text-xs text-neutral-400">{pendingDelete}</p>
            <p className="mt-2 text-sm text-neutral-300">
              This deletes the item permanently. It cannot be undone.
            </p>
            {deleteError !== null && <p className="mt-2 text-sm text-red-300">{deleteError}</p>}
            <div className="mt-4 flex justify-end gap-2">
              <button
                type="button"
                onClick={closeDialog}
                disabled={busy}
                className="rounded-md border border-neutral-700 px-3 py-1.5 text-sm text-neutral-200 disabled:opacity-40"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => void confirmDelete()}
                disabled={busy}
                className="rounded-md bg-red-600 px-3 py-1.5 text-sm font-medium text-white disabled:opacity-40"
              >
                {busy ? 'Deleting…' : 'Delete permanently'}
              </button>
            </div>
          </div>
        </div>
      )}
    </section>
  );
}
