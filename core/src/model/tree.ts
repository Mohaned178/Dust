import { dirname } from 'node:path';
import type { FolderRecord } from './types';

export interface TreeNode extends FolderRecord {
  parent: string | null;
  complete: boolean;
  children: string[];
}

export class AggregateTree {
  private readonly nodes = new Map<string, TreeNode>();

  addFolder(record: FolderRecord): TreeNode {
    const node = this.ensure(record.path);
    node.bytes = record.bytes;
    node.allocatedBytes = record.allocatedBytes;
    node.fileCount = record.fileCount;
    node.folderCount = record.folderCount;
    node.linkCount = record.linkCount;
    node.newestMtimeMs = record.newestMtimeMs;
    node.errorCount = record.errorCount;
    node.partial = record.partial;
    node.complete = true;
    return node;
  }

  get(path: string): TreeNode | undefined {
    return this.nodes.get(path);
  }

  children(path: string): TreeNode[] {
    const node = this.nodes.get(path);
    if (!node) return [];
    const out: TreeNode[] = [];
    for (const childPath of node.children) {
      const child = this.nodes.get(childPath);
      if (child) out.push(child);
    }
    return out;
  }

  roots(): TreeNode[] {
    const out: TreeNode[] = [];
    for (const node of this.nodes.values()) {
      if (node.parent === null) out.push(node);
    }
    return out;
  }

  size(): number {
    return this.nodes.size;
  }

  private ensure(path: string): TreeNode {
    const existing = this.nodes.get(path);
    if (existing) return existing;

    const parentPath = parentOf(path);
    const node: TreeNode = {
      path,
      bytes: 0,
      allocatedBytes: 0,
      fileCount: 0,
      folderCount: 0,
      linkCount: 0,
      newestMtimeMs: 0,
      errorCount: 0,
      partial: false,
      parent: parentPath,
      complete: false,
      children: [],
    };
    this.nodes.set(path, node);

    if (parentPath !== null) {
      const parentNode = this.ensure(parentPath);
      parentNode.children.push(path);
    }
    return node;
  }
}

function parentOf(path: string): string | null {
  const parent = dirname(path);
  if (parent === path || parent === '.') return null;
  return parent;
}
