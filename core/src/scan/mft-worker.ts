import type { MessagePort } from 'node:worker_threads';
import type { FolderRecord, Marker } from '../model/types';
import { createExclusionMatcher, type ExclusionConfig } from '../scanner/exclusions';
import { MftUnavailableError, openVolumeReader, scanMft } from '../scanner/mft';

export interface MftWorkerInit {
  mode: 'mft';
  root: string;
  exclusions: ExclusionConfig;
  abortFlag: SharedArrayBuffer;
}

export type MftWorkerEvent =
  | { type: 'mft-unavailable'; reason: string }
  | { type: 'mft-progress'; filesScanned: number; bytesSeen: number; errors: number }
  | { type: 'mft-batch'; folders: FolderRecord[]; markers: Marker[] }
  | {
      type: 'mft-done';
      rootRecord: FolderRecord;
      filesScanned: number;
      bytesSeen: number;
      errors: number;
      aborted: boolean;
    };

const BATCH_SIZE = 4000;

export function runMftWorker(port: MessagePort, init: MftWorkerInit): void {
  const abortFlag = new Int32Array(init.abortFlag);
  let reader;
  try {
    reader = openVolumeReader(init.root);
  } catch (error) {
    port.postMessage({ type: 'mft-unavailable', reason: String((error as Error).message) } satisfies MftWorkerEvent);
    return;
  }

  // Nothing is posted until the scan has fully succeeded, so a failure at any
  // point leaves the session free to fall back to the walker with a clean tree.
  const folders: FolderRecord[] = [];
  const markers: Marker[] = [];

  try {
    const result = scanMft({
      root: init.root,
      reader,
      exclusions: createExclusionMatcher(init.exclusions),
      shouldAbort: () => Atomics.load(abortFlag, 0) === 1,
      onProgress: (update) =>
        port.postMessage({
          type: 'mft-progress',
          filesScanned: update.filesScanned,
          bytesSeen: update.bytesSeen,
          errors: update.errors,
        } satisfies MftWorkerEvent),
      onFolder: (record) => folders.push(record),
      onMarker: (marker) => markers.push(marker),
    });
    for (let start = 0; start < folders.length || start === 0; start += BATCH_SIZE) {
      const batchMarkers = start === 0 ? markers : [];
      port.postMessage({
        type: 'mft-batch',
        folders: folders.slice(start, start + BATCH_SIZE),
        markers: batchMarkers,
      } satisfies MftWorkerEvent);
    }
    port.postMessage({
      type: 'mft-done',
      rootRecord: result.rootRecord,
      filesScanned: result.filesScanned,
      bytesSeen: result.bytesSeen,
      errors: result.errors,
      aborted: result.aborted,
    } satisfies MftWorkerEvent);
  } catch (error) {
    const reason = error instanceof MftUnavailableError ? error.message : `MFT scan failed: ${String(error)}`;
    port.postMessage({ type: 'mft-unavailable', reason } satisfies MftWorkerEvent);
  } finally {
    reader.close();
  }
}
