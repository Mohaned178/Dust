import type { SnapshotData, VolumeInfo } from '@dust/core';
import { describe, expect, it } from 'vitest';
import { buildDashboardState } from '../src/main/host/dashboard';

function snapshot(overrides: Partial<SnapshotData> = {}): SnapshotData {
  return {
    schemaVersion: 2,
    rulesVersion: '1',
    root: 'C:\\Data',
    startedAt: 10,
    finishedAt: 20,
    status: 'complete',
    cleanedAt: null,
    disks: [{ volume: 'C:\\', totalBytes: 1000, freeBytes: 400 }],
    categories: [{ ruleId: 'system-temp', category: 'temp', bytes: 100, items: 2 }],
    matches: [],
    projects: [],
    folders: [],
    ...overrides,
  };
}

const volumes: VolumeInfo[] = [
  { root: 'C:\\', label: 'System', driveType: 'fixed' },
  { root: 'E:\\', label: null, driveType: 'removable' },
];

const usage = [
  { volume: 'C:\\', label: 'System', totalBytes: 1000, freeBytes: 400 },
  { volume: 'E:\\', label: null, totalBytes: null, freeBytes: null },
];

describe('buildDashboardState', () => {
  it('attaches snapshot analytics to the analyzed volume only and marks external drives', () => {
    const state = buildDashboardState({ volumes, usage, snapshot: { kind: 'ok', snapshot: snapshot() }, scan: null });
    const system = state.volumes.find((volume) => volume.root === 'C:\\')!;
    const usb = state.volumes.find((volume) => volume.root === 'E:\\')!;

    expect(system).toMatchObject({
      label: 'System',
      external: false,
      totalBytes: 1000,
      freeBytes: 400,
      lastAnalyzedAt: 20,
      reclaimableBytes: 100,
    });
    expect(usb).toMatchObject({ external: true, lastAnalyzedAt: null, reclaimableBytes: null });
    expect(state.snapshot).toMatchObject({ status: 'ok', reclaimableBytes: 100, rulesStale: false });
    expect(state.scan).toBeNull();
  });

  it('flags stale rules and cancelled snapshots', () => {
    const state = buildDashboardState({
      volumes,
      usage,
      snapshot: { kind: 'ok', snapshot: snapshot({ rulesVersion: '999', status: 'cancelled', cleanedAt: 30 }) },
      scan: { kind: 'analyze', root: 'C:\\', startedAt: 5 },
    });
    expect(state.snapshot).toMatchObject({ scanStatus: 'cancelled', rulesStale: true, cleanedAt: 30 });
    expect(state.scan).toEqual({ kind: 'analyze', root: 'C:\\', startedAt: 5 });
  });

  it('reports missing and corrupt snapshots', () => {
    const missing = buildDashboardState({ volumes, usage, snapshot: { kind: 'missing' }, scan: null });
    expect(missing.snapshot).toMatchObject({ status: 'missing', reclaimableBytes: null, rulesStale: false });
    expect(missing.volumes.every((volume) => volume.lastAnalyzedAt === null)).toBe(true);

    const corrupt = buildDashboardState({ volumes, usage, snapshot: { kind: 'corrupt', reason: 'invalid-json' }, scan: null });
    expect(corrupt.snapshot).toEqual({
      status: 'corrupt',
      reason: 'invalid-json',
      root: null,
      finishedAt: null,
      scanStatus: null,
      reclaimableBytes: null,
      cleanedAt: null,
      rulesStale: false,
    });
  });
});
