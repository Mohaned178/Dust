import { statfsSync } from 'node:fs';

export const DEFAULT_CLUSTER_SIZE = 4096;

export function roundUpToCluster(bytes: number, clusterSize: number): number {
  if (!Number.isFinite(bytes) || bytes <= 0) return 0;
  const cluster = Number.isFinite(clusterSize) && clusterSize > 0 ? clusterSize : DEFAULT_CLUSTER_SIZE;
  return Math.ceil(bytes / cluster) * cluster;
}

export function volumeClusterSize(root: string): number {
  try {
    const stats = statfsSync(root);
    return Number.isFinite(stats.bsize) && stats.bsize > 0 ? stats.bsize : DEFAULT_CLUSTER_SIZE;
  } catch {
    return DEFAULT_CLUSTER_SIZE;
  }
}
