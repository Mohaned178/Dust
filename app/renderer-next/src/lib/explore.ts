import type { ResultRow } from '../../../src/shared/ipc';

/** Rows asked for per request. The backend allows at most 1,000. */
export const PAGE_SIZE = 1000;

/** Folder keys are lower-cased paths; the drive root is the empty string. */
export function folderKey(path: string): string {
  return path.toLowerCase();
}

export interface FolderNode {
  rows: ResultRow[];
  /** Direct children available after filtering, so `rows.length < total` means there are more to load. */
  total: number;
  status: 'loading' | 'ready' | 'error';
}

export const ROOT_KEY = '';

export type FlatItem =
  | { kind: 'folder'; key: string; row: ResultRow; depth: number; expanded: boolean; scaleBytes: number }
  | { kind: 'more'; key: string; parentPath: string; depth: number; remaining: number; loading: boolean }
  | { kind: 'note'; key: string; parentPath: string; depth: number; tone: 'loading' | 'note' | 'error'; text: string };

/** Shown under a folder the scan counted subfolders in, when the saved scan stopped before storing them. */
export const TRUNCATED_NOTE = 'Folders this deep were not saved. Scan again to see them.';

/**
 * The visible rows of the tree, top to bottom: each open folder is followed by its children. A folder whose
 * children are still loading, failed or are only partly loaded is followed by a row that says so.
 */
export function flattenTree(
  nodes: Readonly<Record<string, FolderNode | undefined>>,
  expanded: ReadonlySet<string>,
): FlatItem[] {
  const out: FlatItem[] = [];
  const walk = (path: string, depth: number, owner: ResultRow | null): void => {
    const key = path === '' ? ROOT_KEY : folderKey(path);
    const node = nodes[key];
    if (node === undefined || (node.status === 'loading' && node.rows.length === 0)) {
      out.push({ kind: 'note', key: `${key}\u0000status`, parentPath: path, depth, tone: 'loading', text: 'Loading…' });
      return;
    }
    if (node.status === 'error' && node.rows.length === 0) {
      out.push({
        kind: 'note',
        key: `${key}\u0000status`,
        parentPath: path,
        depth,
        tone: 'error',
        text: 'Dust could not read this folder.',
      });
      return;
    }
    if (node.rows.length === 0) {
      const truncated = owner !== null && owner.childCount > 0;
      out.push({
        kind: 'note',
        key: `${key}\u0000status`,
        parentPath: path,
        depth,
        tone: 'note',
        text: truncated ? TRUNCATED_NOTE : 'No folders in here.',
      });
      return;
    }
    const scaleBytes = Math.max(node.rows[0]?.bytes ?? 0, 1);
    for (const row of node.rows) {
      const open = expanded.has(folderKey(row.path));
      out.push({ kind: 'folder', key: folderKey(row.path), row, depth, expanded: open, scaleBytes });
      if (open) walk(row.path, depth + 1, row);
    }
    if (node.rows.length < node.total) {
      out.push({
        kind: 'more',
        key: `${key}\u0000more`,
        parentPath: path,
        depth,
        remaining: node.total - node.rows.length,
        loading: node.status === 'loading',
      });
    }
  };
  walk('', 0, null);
  return out;
}

export interface Crumb {
  /** The folder's path; the drive root uses ''. */
  path: string;
  name: string;
  /** Known for folders reached by drilling in, not for the drive root. */
  bytes: number | null;
}
