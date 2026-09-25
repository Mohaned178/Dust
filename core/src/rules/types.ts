import type { Dirent, Stats } from 'node:fs';
import type { AggregateTree } from '../model/tree';
import type { Marker } from '../model/types';
import type { ProjectRecord } from '../projects/types';
import type { InstalledAppsSnapshot } from '../system/installed-apps';

export type CategoryId = 'temp' | 'recycle-bin' | 'npm-cache' | 'app-caches' | 'npm-projects';

export type ActionGrade = 'safe' | 'review';

export type Recovery =
  | { kind: 'regenerate'; command: string }
  | { kind: 'junk'; reason: string };

export type Action =
  | { kind: 'delete-path' }
  | { kind: 'empty-recycle-bin' };

export interface RuleMatch {
  path: string;
  bytes: number;
  grade: ActionGrade;
  recovery: Recovery;
  evidence: string;
  origin?: 'detected';
}

export interface FsProbe {
  exists(path: string): boolean;
  stat(path: string): Stats | null;
  listDirectory(path: string): Dirent[];
  readFile(path: string): string | null;
}

export interface RuleContext {
  root: string;
  tree: AggregateTree;
  markers: Marker[];
  probe: FsProbe;
  projects?: ProjectRecord[];
  installs?: InstalledAppsSnapshot;
}

export interface Rule {
  id: string;
  category: CategoryId;
  title: string;
  action: Action;
  match(ctx: RuleContext): RuleMatch[] | Promise<RuleMatch[]>;
}
