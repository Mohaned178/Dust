import { basename } from 'node:path';
import type { Marker } from '../model/types';
import type { Enumerator } from '../scanner/enumerator';
import { isMtimeTrackedChild, scanDirectory } from '../scanner/dir-scan';
import type { DirOpen } from './protocol';

export interface WorkerScanContext {
  enumerator: Enumerator;
  isExcluded: (absPath: string) => boolean;
  shouldAbort: () => boolean;
  splitAfterEntries: number;
  openDir: (open: DirOpen) => void;
  submitTasks: (paths: string[]) => void;
  marker: (marker: Marker) => void;
  progress: (contribution: { entries: 1; files: 0 | 1; bytes: number; path: string }) => void;
}

export function scanTask(taskPath: string, isRoot: boolean, ctx: WorkerScanContext): void {
  let budget = ctx.splitAfterEntries;

  const walk = (dir: string, root: boolean, trackMtime: boolean): void => {
    if (ctx.shouldAbort()) return;

    const result = scanDirectory(dir, trackMtime, {
      enumerator: ctx.enumerator,
      isExcluded: ctx.isExcluded,
      shouldAbort: ctx.shouldAbort,
      onEntry: (contribution) => ctx.progress(contribution),
    });

    for (const marker of result.markers) ctx.marker(marker);

    ctx.openDir({
      path: dir,
      isRoot: root,
      directBytes: result.directBytes,
      directFileCount: result.directFileCount,
      linkCount: result.linkCount,
      errorCount: result.errorCount,
      newestMtimeMs: result.newestMtimeMs,
      partial: result.partial,
      childDirs: result.childDirs,
    });

    budget -= result.entryCount;
    if (budget <= 0 && result.childDirs.length > 0) {
      ctx.submitTasks(result.childDirs);
      return;
    }

    for (const child of result.childDirs) {
      if (ctx.shouldAbort()) return;
      walk(child, false, trackMtime && isMtimeTrackedChild(basename(child)));
    }
  };

  walk(taskPath, isRoot, true);
}
