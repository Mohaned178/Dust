import { AggregateTree } from '@dust/core';

export const instrumentEnabled =
  process.env.DUST_INSTRUMENT === '1' || process.env.DUST_BENCH_ROOT !== undefined;

interface Sample {
  totalMs: number;
  count: number;
  maxMs: number;
}

const samples = new Map<string, Sample>();

function round(value: number): number {
  return Math.round(value * 100) / 100;
}

export function recordSample(name: string, ms: number): void {
  const current = samples.get(name);
  if (current) {
    current.totalMs += ms;
    current.count += 1;
    if (ms > current.maxMs) current.maxMs = ms;
    return;
  }
  samples.set(name, { totalMs: ms, count: 1, maxMs: ms });
}

export function instrument<T>(name: string, fn: () => T): T {
  if (!instrumentEnabled) return fn();
  const startedAt = performance.now();
  try {
    return fn();
  } finally {
    recordSample(name, performance.now() - startedAt);
  }
}

export async function instrumentAsync<T>(name: string, fn: () => Promise<T>): Promise<T> {
  if (!instrumentEnabled) return fn();
  const startedAt = performance.now();
  try {
    return await fn();
  } finally {
    recordSample(name, performance.now() - startedAt);
  }
}

export interface InstrumentSample {
  name: string;
  totalMs: number;
  count: number;
  maxMs: number;
}

export function reportSamples(): InstrumentSample[] {
  return [...samples.entries()]
    .map(([name, sample]) => ({
      name,
      totalMs: round(sample.totalMs),
      count: sample.count,
      maxMs: round(sample.maxMs),
    }))
    .sort((a, b) => b.totalMs - a.totalMs);
}

export function resetSamples(): void {
  samples.clear();
}

let treeMergePatched = false;

export function patchTreeMergeTotal(): void {
  if (!instrumentEnabled || treeMergePatched) return;
  treeMergePatched = true;
  const proto = AggregateTree.prototype as unknown as {
    addFolder: (this: unknown, ...args: unknown[]) => unknown;
  };
  const original = proto.addFolder;
  proto.addFolder = function patchedAddFolder(this: unknown, ...args: unknown[]): unknown {
    const startedAt = performance.now();
    try {
      return original.apply(this, args);
    } finally {
      recordSample('tree.addFolder.total', performance.now() - startedAt);
    }
  };
}

patchTreeMergeTotal();
