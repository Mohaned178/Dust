import type { Stats } from 'node:fs';
import type { AggregateTree } from '../model/tree';
import type { Marker } from '../model/types';

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
}

export interface FsProbe {
  exists(path: string): boolean;
  stat(path: string): Stats | null;
}

export interface RuleContext {
  root: string;
  tree: AggregateTree;
  markers: Marker[];
  probe: FsProbe;
}

export interface Rule {
  id: string;
  category: CategoryId;
  title: string;
  action: Action;
  match(ctx: RuleContext): RuleMatch[] | Promise<RuleMatch[]>;
}
