import type { AggregateTree } from '../model/tree';
import type { Marker } from '../model/types';
import type { FsProbe } from '../rules/types';

export type PackageManager = 'npm' | 'yarn' | 'pnpm' | 'bun' | 'unknown';

export type ProjectKind = 'project' | 'monorepo' | 'orphaned-node-modules';

export type RecencyGroup = 'active' | 'occasional' | 'dead' | 'unknown';

export type RestorabilityGrade = 'green' | 'yellow' | 'not-offered';

export type ActivitySource = 'files' | 'git-reflog' | 'manifest' | 'unknown';

export interface NodeModulesLocation {
  path: string;
  bytes: number;
}

export interface Restorability {
  grade: RestorabilityGrade;
  reasons: string[];
  restoreCommand: string | null;
}

export interface ProjectActivity {
  ms: number | null;
  source: ActivitySource;
}

export interface ProjectRecord {
  path: string;
  name: string;
  kind: ProjectKind;
  packageManager: PackageManager;
  pinned: boolean;
  workspaceCount: number;
  nodeModules: { paths: NodeModulesLocation[]; bytes: number };
  activity: ProjectActivity;
  recency: RecencyGroup;
  restorability: Restorability;
  offered: boolean;
  evidence: string[];
}

export interface ProjectAnalysis {
  projects: ProjectRecord[];
}

export interface RecencyThresholds {
  activeDays: number;
  occasionalDays: number;
}

export interface ProjectOptions {
  now?: () => number;
  thresholds?: Partial<RecencyThresholds>;
  pins?: string[];
  isExternal?: (path: string) => boolean;
  globalInstallRoots?: string[];
}

export interface ClassifyInput extends ProjectOptions {
  root: string;
  tree: AggregateTree;
  markers: Marker[];
  probe: FsProbe;
}
