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
import type { RemovalPlan } from '@dust/core';
import { TempTree } from './fixtures';

function makePlan(id = 'f47ac10b-58cc-4372-a567-0e02b2c3d479'): RemovalPlan {
  return {
    id,
    appId: 'app-1',
    createdAt: 100,
    app: {
      id: 'app-1',
      displayName: 'Spotify',
      publisher: 'Spotify AB',
      version: '1.0',
      hive: 'hkcu',
      installLocation: '',
      estimatedSizeKb: null,
    },
    uninstaller: null,
    leftovers: [],
    registry: [],
    startup: [],
    kept: [],
    totals: {
      bytes: 0,
      items: 0,
      reviewBytes: 0,
      reviewItems: 0,
      userDataBytes: 0,
      userDataItems: 0,
      adminItems: 0,
    },
  };
}

function makeJob(overrides: Partial<PendingUninstallJob> = {}): PendingUninstallJob {
  const plan = makePlan();
  return {
    v: 1,
    jobId: plan.id,
    createdAt: 100,
    plan,
    request: {
      jobId: plan.id,
      planId: plan.id,
      selection: ['item-1'],
      includeUserData: false,
      runUninstaller: true,
      quiet: false,
      acknowledge: [],
    },
    ...overrides,
  };
}

describe('parsePendingUninstallArg', () => {
  it('extracts a job id and rejects malformed values', () => {
    const id = 'f47ac10b-58cc-4372-a567-0e02b2c3d479';
    expect(parsePendingUninstallArg(['--other', `${PENDING_UNINSTALL_PREFIX}${id}`])).toBe(id);
    expect(parsePendingUninstallArg(['--other'])).toBeNull();
    expect(parsePendingUninstallArg([`${PENDING_UNINSTALL_PREFIX}../evil`])).toBeNull();
    expect(parsePendingUninstallArg([PENDING_UNINSTALL_PREFIX])).toBeNull();
  });
});

describe('pending uninstall persistence', () => {
  it('round-trips a job file', () => {
    const tree = new TempTree();
    try {
      const path = pendingUninstallPath(tree.root);
      const job = makeJob();
      expect(writePendingUninstall(path, job)).toBe(true);
      expect(JSON.parse(readFileSync(path, 'utf8'))).toEqual(job);
      expect(readPendingUninstall(path, { now: () => 200 })).toEqual(job);
      expect(pendingUninstallPath(tree.root)).toBe(join(tree.root, 'pending-removal.json'));
    } finally {
      tree.cleanup();
    }
  });

  it('returns null for missing, corrupt, expired or mismatched files', () => {
    const tree = new TempTree();
    try {
      const path = pendingUninstallPath(tree.root);
      expect(readPendingUninstall(path, { now: () => 0 })).toBeNull();

      tree.file('pending-removal.json', '{oops');
      expect(readPendingUninstall(path, { now: () => 0 })).toBeNull();

      writePendingUninstall(path, makeJob());
      expect(readPendingUninstall(path, { now: () => 100 + 15 * 60_000 + 1 })).toBeNull();

      tree.file(
        'pending-removal.json',
        JSON.stringify({ ...makeJob(), request: { ...makeJob().request, planId: 'other' } }),
      );
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
