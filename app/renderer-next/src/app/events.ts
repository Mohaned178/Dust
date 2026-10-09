import type {
  CleanItemResult,
  DustApi,
  ScanEvent,
  ScanProgressPayload,
  StartupDetailsEvent,
  UninstallEvent,
  UpdateStatus,
} from '../../../src/shared/ipc';
import { useAppsStore } from '../stores/apps';
import type { UninstallJob } from '../stores/apps';
import { useCleanStore } from '../stores/clean';
import { useScanStore } from '../stores/scan';
import type { ScanRun } from '../stores/scan';
import { useStartupStore } from '../stores/startup';
import type { StartupDetail } from '../stores/startup';
import { useUpdatesStore } from '../stores/updates';
import { useToastStore } from '../ui/toast-store';

/**
 * The one subscription to each backend event stream. High-rate events are folded into a buffer and written to the
 * stores at most ten times a second, one `set()` per store. Events that end something (a scan finishing, a clean
 * completing) flush the buffer first and are applied at once, so they never wait on a frame.
 *
 * The stores keep what each run has reported, so a screen that mounts after a fast scan has finished still
 * reads the whole story from the store; there is nothing to replay.
 */

/** How often buffered events reach the stores. */
export const FLUSH_INTERVAL_MS = 100;
/** A hidden window gets no animation frames, so a timer backs the frame up. */
const FRAME_FALLBACK_MS = 250;

export interface Scheduler {
  now: () => number;
  /** Runs `run` after `delayMs`, on the next frame when it is zero. Returns a cancel function. */
  schedule: (run: () => void, delayMs: number) => () => void;
}

export const browserScheduler: Scheduler = {
  now: () => performance.now(),
  schedule: (run, delayMs) => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    let frame: number | undefined;
    let finished = false;
    const cancel = () => {
      finished = true;
      if (timer !== undefined) clearTimeout(timer);
      if (frame !== undefined) cancelAnimationFrame(frame);
    };
    const fire = () => {
      if (finished) return;
      cancel();
      run();
    };
    if (delayMs > 0) {
      timer = setTimeout(fire, delayMs);
    } else {
      frame = requestAnimationFrame(fire);
      timer = setTimeout(fire, FRAME_FALLBACK_MS);
    }
    return cancel;
  },
};

interface Buffer {
  runs: Map<string, Partial<ScanRun>>;
  quickProgress: ScanProgressPayload | undefined;
  cleanItems: Map<string, CleanItemResult[]>;
  appSizes: Map<string, number>;
  appIcons: Map<string, string>;
  jobItems: Map<string, { items: number; bytes: number }>;
  startupDetails: Map<string, StartupDetail>;
}

function emptyBuffer(): Buffer {
  return {
    runs: new Map(),
    quickProgress: undefined,
    cleanItems: new Map(),
    appSizes: new Map(),
    appIcons: new Map(),
    jobItems: new Map(),
    startupDetails: new Map(),
  };
}

/** Subscribes to every backend stream. Returns the function that unsubscribes them all. */
export function startEvents(api: DustApi, scheduler: Scheduler = browserScheduler): () => void {
  let buffer = emptyBuffer();
  let dirty = false;
  let cancelScheduled: (() => void) | null = null;
  let lastFlush = Number.NEGATIVE_INFINITY;

  function flush(): void {
    cancelScheduled?.();
    cancelScheduled = null;
    if (!dirty) return;
    const batch = buffer;
    buffer = emptyBuffer();
    dirty = false;
    lastFlush = scheduler.now();

    if (batch.runs.size > 0 || batch.quickProgress !== undefined) {
      useScanStore.getState().applyPatches(batch.runs, batch.quickProgress);
    }
    if (batch.cleanItems.size > 0) {
      useCleanStore.getState().applyBatch(batch.cleanItems, new Map());
    }
    if (batch.appSizes.size > 0 || batch.appIcons.size > 0 || batch.jobItems.size > 0) {
      const jobs = new Map<string, (job: UninstallJob) => UninstallJob>();
      for (const [jobId, added] of batch.jobItems) {
        jobs.set(jobId, (job) => ({
          ...job,
          itemsDone: job.itemsDone + added.items,
          bytesRemoved: job.bytesRemoved + added.bytes,
        }));
      }
      useAppsStore.getState().applyBatch({ sizes: batch.appSizes, icons: batch.appIcons, jobs });
    }
    if (batch.startupDetails.size > 0) {
      useStartupStore.getState().mergeDetails(batch.startupDetails);
    }
  }

  function buffered(): void {
    dirty = true;
    if (cancelScheduled !== null) return;
    const wait = Math.max(0, lastFlush + FLUSH_INTERVAL_MS - scheduler.now());
    cancelScheduled = scheduler.schedule(flush, wait);
  }

  function runPatch(runId: string): Partial<ScanRun> {
    let patch = buffer.runs.get(runId);
    if (patch === undefined) {
      patch = {};
      buffer.runs.set(runId, patch);
    }
    return patch;
  }

  /** Writes one run's patch straight away, after anything buffered before it. */
  function applyNow(runId: string, patch: Partial<ScanRun>): void {
    flush();
    useScanStore.getState().applyPatches(new Map([[runId, patch]]));
  }

  function onScan(event: ScanEvent): void {
    switch (event.type) {
      case 'progress':
        runPatch(event.runId).progress = event.progress;
        buffered();
        break;
      case 'categories':
        runPatch(event.runId).categories = event.categories;
        buffered();
        break;
      case 'finalize-progress':
        runPatch(event.runId).finalizeStep = event.step;
        buffered();
        break;
      case 'quick-clean-progress':
        buffer.quickProgress = event.progress;
        buffered();
        break;
      case 'clean-item': {
        const items = buffer.cleanItems.get(event.cleanId);
        if (items === undefined) buffer.cleanItems.set(event.cleanId, [event.item]);
        else items.push(event.item);
        buffered();
        break;
      }
      case 'started':
        applyNow(event.runId, { root: event.root, startedAt: event.startedAt });
        break;
      case 'finalizing':
        applyNow(event.runId, { finalizing: true });
        break;
      case 'finished':
        applyNow(event.runId, { outcome: { type: 'finished', status: event.status } });
        break;
      case 'failed':
        applyNow(event.runId, { outcome: { type: 'failed', message: event.message } });
        break;
      case 'cleaned':
        flush();
        useCleanStore.getState().applyBatch(new Map(), new Map([[event.cleanId, event.root]]));
        break;
      // The folder, browse and match streams are not used here. The tree is read on demand through
      // getFolderChildren, so these payloads are never kept.
      default:
        break;
    }
  }

  function applyJob(jobId: string, update: (job: UninstallJob) => UninstallJob): void {
    flush();
    useAppsStore.getState().applyBatch({ sizes: new Map(), icons: new Map(), jobs: new Map([[jobId, update]]) });
  }

  function onUninstall(event: UninstallEvent): void {
    switch (event.type) {
      case 'app-size':
        buffer.appSizes.set(event.appId, event.bytes);
        buffered();
        break;
      case 'app-icon':
        buffer.appIcons.set(event.appId, event.iconDataUrl);
        buffered();
        break;
      case 'app-sizes':
        for (const size of event.sizes) buffer.appSizes.set(size.appId, size.bytes);
        buffered();
        break;
      case 'app-icons':
        for (const icon of event.icons) buffer.appIcons.set(icon.appId, icon.iconDataUrl);
        buffered();
        break;
      case 'item': {
        const added = buffer.jobItems.get(event.jobId) ?? { items: 0, bytes: 0 };
        added.items += 1;
        added.bytes += event.bytes;
        buffer.jobItems.set(event.jobId, added);
        buffered();
        break;
      }
      case 'phase':
        applyJob(event.jobId, (job) => ({
          ...job,
          phases: {
            ...job.phases,
            [event.phase]:
              event.note === undefined ? { status: event.status } : { status: event.status, note: event.note },
          },
        }));
        break;
      case 'uninstaller-exited':
        applyJob(event.jobId, (job) => ({ ...job, uninstallerExitCode: event.exitCode }));
        break;
      case 'uninstaller-reboot-required':
        applyJob(event.jobId, (job) => ({ ...job, rebootRequired: true }));
        break;
      case 'verify':
        applyJob(event.jobId, (job) => ({ ...job, verifiedGone: event.gone }));
        break;
      case 'finished':
        applyJob(event.jobId, (job) => ({ ...job, outcome: { type: 'finished', report: event.report } }));
        break;
      case 'failed':
        applyJob(event.jobId, (job) => ({ ...job, outcome: { type: 'failed', message: event.message } }));
        break;
      default:
        break;
    }
  }

  function onStartup(event: StartupDetailsEvent): void {
    for (const detail of event.details) {
      buffer.startupDetails.set(detail.id, { publisher: detail.publisher, iconDataUrl: detail.iconDataUrl });
    }
    buffered();
  }

  /** Keeps the status, and tells the user once, without interrupting, when an update is ready to install. */
  function applyUpdateStatus(status: UpdateStatus): void {
    const wasReady = useUpdatesStore.getState().status.phase === 'downloaded';
    useUpdatesStore.getState().setStatus(status);
    if (status.phase !== 'downloaded' || wasReady) return;
    useToastStore.getState().push({
      title: `Dust ${status.version ?? 'update'} is ready`,
      description: 'Restart Dust to finish updating.',
      action: { label: 'Restart to update', onAction: () => void api.installUpdate() },
    });
  }

  const unsubscribes = [
    api.onScanEvent(onScan),
    api.onUninstallEvent(onUninstall),
    api.onStartupEvent(onStartup),
    api.onUpdateEvent(applyUpdateStatus),
  ];
  let stopped = false;
  api
    .getUpdateStatus()
    .then((status) => {
      if (!stopped) applyUpdateStatus(status);
    })
    .catch(() => {});

  return () => {
    stopped = true;
    cancelScheduled?.();
    cancelScheduled = null;
    for (const unsubscribe of unsubscribes) unsubscribe();
  };
}
