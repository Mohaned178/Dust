export type NodeKind = 'file' | 'dir' | 'link';

export interface Entry {
  name: string;
  kind: NodeKind;
  size: number;
  mtimeMs: number;
}

export interface FolderRecord {
  path: string;
  bytes: number;
  fileCount: number;
  folderCount: number;
  linkCount: number;
  newestMtimeMs: number;
  errorCount: number;
  partial: boolean;
}

export interface Marker {
  kind: 'package-json' | 'node-modules' | 'git-dir';
  path: string;
}

export interface ProgressUpdate {
  filesScanned: number;
  bytesSeen: number;
  currentPath: string;
  dirsCompleted: number;
  errors: number;
}
