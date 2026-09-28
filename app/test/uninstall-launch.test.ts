import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  PENDING_UNINSTALL_PREFIX,
  clearPendingUninstall,
  parsePendingUninstallArg,
  pendingUninstallPath,
  readPendingUninstall,
  writePendingUninstall,
} from '../src/main/uninstall-launch';
import type { PendingUninstallJob } from '../src/main/uninstall-launch';
import { TempTree } from './fixtures';

const JOB_ID = 'f47ac10b-58cc-4372-a567-0e02b2c3d479';
const APP_ID = '1d3be282f0bb9014';

function makeJob(overrides: Partial<PendingUninstallJob> = {}): PendingUninstallJob {
  return { v: 2, jobId: JOB_ID, appId: APP_ID, createdAt: 100, ...overrides };
}

describe('parsePendingUninstallArg', () => {
  it('extracts a job id and rejects malformed values', () => {
    expect(parsePendingUninstallArg(['--other', `${PENDING_UNINSTALL_PREFIX}${JOB_ID}`])).toBe(JOB_ID);
    expect(parsePendingUninstallArg(['--other'])).toBeNull();
    expect(parsePendingUninstallArg([`${PENDING_UNINSTALL_PREFIX}../evil`])).toBeNull();
    expect(parsePendingUninstallArg([PENDING_UNINSTALL_PREFIX])).toBeNull();
  });
});

describe('pending uninstall persistence', () => {
  it('round-trips a job file atomically', () => {
    const tree = new TempTree();
    try {
      const path = pendingUninstallPath(tree.root);
      const job = makeJob();
      expect(writePendingUninstall(path, job)).toBe(true);
      expect(JSON.parse(readFileSync(path, 'utf8'))).toEqual(job);
      expect(() => readFileSync(`${path}.tmp`, 'utf8')).toThrow();
      expect(readPendingUninstall(path, { now: () => 200 })).toEqual(job);
      expect(pendingUninstallPath(tree.root)).toBe(join(tree.root, 'pending-removal.json'));
    } finally {
      tree.cleanup();
    }
  });

  it('returns null for missing, corrupt, expired or future-dated files', () => {
    const tree = new TempTree();
    try {
      const path = pendingUninstallPath(tree.root);
      expect(readPendingUninstall(path, { now: () => 0 })).toBeNull();

      tree.file('pending-removal.json', '{oops');
      expect(readPendingUninstall(path, { now: () => 0 })).toBeNull();

      writePendingUninstall(path, makeJob());
      expect(readPendingUninstall(path, { now: () => 100 + 15 * 60_000 + 1 })).toBeNull();
      expect(readPendingUninstall(path, { now: () => 100 - 5 * 60_000 - 1 })).toBeNull();
      expect(readPendingUninstall(path, { now: () => 200 })).toEqual(makeJob());
    } finally {
      tree.cleanup();
    }
  });

  it('rejects old plan-carrying files and malformed ids', () => {
    const tree = new TempTree();
    try {
      const path = pendingUninstallPath(tree.root);
      tree.file('pending-removal.json', JSON.stringify({ v: 1, jobId: JOB_ID, createdAt: 100, plan: {}, request: {} }));
      expect(readPendingUninstall(path, { now: () => 200 })).toBeNull();

      tree.file('pending-removal.json', JSON.stringify(makeJob({ appId: '..\\evil' })));
      expect(readPendingUninstall(path, { now: () => 200 })).toBeNull();

      tree.file('pending-removal.json', JSON.stringify(makeJob({ jobId: 'short' })));
      expect(readPendingUninstall(path, { now: () => 200 })).toBeNull();
    } finally {
      tree.cleanup();
    }
  });

  it('clears the file', () => {
    const tree = new TempTree();
    try {
      const path = pendingUninstallPath(tree.root);
      writePendingUninstall(path, makeJob());
      clearPendingUninstall(path);
      expect(readPendingUninstall(path, { now: () => 200 })).toBeNull();
    } finally {
      tree.cleanup();
    }
  });
});
