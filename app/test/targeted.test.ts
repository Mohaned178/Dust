import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { measureDirectories, measurePath } from '../src/main/host/targeted';
import { TempTree } from './fixtures';

describe('measureDirectories', () => {
  it('measures unique directories, keeps order, and skips missing paths', () => {
    const calls: string[] = [];
    const tree = measureDirectories(['C:\\a', 'c:\\a', 'C:\\b'], (path) => {
      calls.push(path);
      if (path.toLowerCase() === 'c:\\b') return null;
      return {
        path,
        bytes: 5,
        allocatedBytes: 4096,
        fileCount: 1,
        folderCount: 0,
        linkCount: 0,
        newestMtimeMs: 7,
        errorCount: 0,
        partial: false,
      };
    });

    expect(calls).toEqual(['C:\\a', 'C:\\b']);
    expect(tree.get('C:\\a')?.bytes).toBe(5);
    expect(tree.get('C:\\a')?.allocatedBytes).toBe(4096);
    expect(tree.get('C:\\b')).toBeUndefined();
  });
});

describe('measurePath', () => {
  let fixture: TempTree;

  beforeEach(() => {
    fixture = new TempTree();
  });

  afterEach(() => {
    fixture.cleanup();
  });

  it('measures a real directory tree including nested files', () => {
    fixture.file('temp/a.bin', 'abcde');
    fixture.file('temp/deep/b.bin', '0123456789');

    const record = measurePath(join(fixture.root, 'temp'));

    expect(record?.bytes).toBe(15);
    expect(record?.fileCount).toBe(2);
    expect(record?.folderCount).toBe(1);
  });

  it('returns null for missing paths and for files', () => {
    const file = fixture.file('one.bin', 'x');
    expect(measurePath(join(fixture.root, 'missing'))).toBeNull();
    expect(measurePath(file)).toBeNull();
  });
});
