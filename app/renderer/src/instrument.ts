export interface RendererSample {
  name: string;
  totalMs: number;
  count: number;
  maxMs: number;
}

interface Sample {
  totalMs: number;
  count: number;
  maxMs: number;
}

const samples = new Map<string, Sample>();

function round(value: number): number {
  return Math.round(value * 100) / 100;
}

export function recordRendererSample(name: string, ms: number): void {
  const current = samples.get(name);
  if (current) {
    current.totalMs += ms;
    current.count += 1;
    if (ms > current.maxMs) current.maxMs = ms;
    return;
  }
  samples.set(name, { totalMs: ms, count: 1, maxMs: ms });
}

export function bumpRendererCount(name: string, amount = 1): void {
  const current = samples.get(name);
  if (current) {
    current.count += amount;
    return;
  }
  samples.set(name, { totalMs: 0, count: amount, maxMs: 0 });
}

export function rendererReport(): RendererSample[] {
  return [...samples.entries()]
    .map(([name, sample]) => ({
      name,
      totalMs: round(sample.totalMs),
      count: sample.count,
      maxMs: round(sample.maxMs),
    }))
    .sort((a, b) => b.totalMs - a.totalMs);
}

export function rendererMemory(): { usedJsHeapMb: number; totalJsHeapMb: number } | null {
  const memory = (
    performance as unknown as { memory?: { usedJSHeapSize: number; totalJSHeapSize: number } }
  ).memory;
  if (!memory) return null;
  return {
    usedJsHeapMb: Math.round(memory.usedJSHeapSize / 1024 / 1024),
    totalJsHeapMb: Math.round(memory.totalJSHeapSize / 1024 / 1024),
  };
}

if (typeof PerformanceObserver !== 'undefined') {
  try {
    new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) {
        recordRendererSample('longtask', entry.duration);
      }
    }).observe({ entryTypes: ['longtask'] });
  } catch {
    /* longtask observation is best-effort */
  }
}

Object.assign(window, { __dustRendererReport: rendererReport, __dustRendererMemory: rendererMemory });
