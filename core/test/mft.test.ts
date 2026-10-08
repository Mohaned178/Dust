import { describe, expect, it } from 'vitest';
import type { FolderRecord, Marker } from '../src/model/types';
import { createExclusionMatcher } from '../src/scanner/exclusions';
import { MftUnavailableError, decodeRunlist, parseBootSector, scanMft } from '../src/scanner/mft';
import { CLUSTER, buildImage, imageReader, type ImageOptions } from './mft-image';

const ROOT = 'X:\\';
const T1 = 1_700_000_000_000;
const T2 = 1_750_000_000_000;

function scan(options: ImageOptions, extra: { paths?: string[]; abort?: boolean } = {}) {
  const folders = new Map<string, FolderRecord>();
  const markers: Marker[] = [];
  const result = scanMft({
    root: ROOT,
    reader: imageReader(buildImage(options)),
    exclusions: createExclusionMatcher({ paths: extra.paths }),
    shouldAbort: () => extra.abort === true,
    onFolder: (record) => folders.set(record.path, record),
    onMarker: (marker) => markers.push(marker),
  });
  return { result, folders, markers };
}

describe('scanMft', () => {
  it('rebuilds folder totals from MFT records', () => {
    const { result, folders } = scan({
      records: [
        { index: 16, dir: true, names: [{ parent: 5, name: 'data' }] },
        { index: 17, size: 10_000, mtimeMs: T1, names: [{ parent: 16, name: 'big.bin' }] },
        { index: 18, size: 3, resident: true, mtimeMs: T2, names: [{ parent: 16, name: 'tiny.txt' }] },
        { index: 19, dir: true, names: [{ parent: 16, name: 'sub' }] },
        { index: 20, size: 5000, mtimeMs: T1, names: [{ parent: 19, name: 'deep.bin' }] },
        { index: 21, size: 7, resident: true, names: [{ parent: 5, name: 'root.txt' }] },
      ],
    });

    expect(folders.get('X:\\data\\sub')).toEqual({
      path: 'X:\\data\\sub',
      bytes: 5000,
      allocatedBytes: 2 * CLUSTER,
      fileCount: 1,
      folderCount: 0,
      linkCount: 0,
      newestMtimeMs: T1,
      errorCount: 0,
      partial: false,
    });
    expect(folders.get('X:\\data')).toMatchObject({
      bytes: 15_003,
      allocatedBytes: 5 * CLUSTER,
      fileCount: 3,
      folderCount: 1,
      newestMtimeMs: T2,
    });
    expect(result.rootRecord).toMatchObject({ path: ROOT, bytes: 15_010, fileCount: 4, folderCount: 2 });
    expect(result.filesScanned).toBe(4);
    expect(result.bytesSeen).toBe(15_010);
    expect(result.aborted).toBe(false);
  });

  it('emits children before their parents', () => {
    const order: string[] = [];
    scanMft({
      root: ROOT,
      reader: imageReader(
        buildImage({
          records: [
            { index: 16, dir: true, names: [{ parent: 5, name: 'a' }] },
            { index: 17, dir: true, names: [{ parent: 16, name: 'b' }] },
            { index: 18, dir: true, names: [{ parent: 17, name: 'c' }] },
          ],
        }),
      ),
      exclusions: createExclusionMatcher(),
      onFolder: (record) => order.push(record.path),
    });
    expect(order).toEqual(['X:\\a\\b\\c', 'X:\\a\\b', 'X:\\a']);
  });

  it('never lists NTFS metafiles or $Extend contents', () => {
    const { result, folders } = scan({
      records: [{ index: 24, size: 4096, names: [{ parent: 11, name: '$UsnJrnl' }] }],
    });
    expect(result.rootRecord.fileCount).toBe(0);
    expect(result.rootRecord.folderCount).toBe(0);
    expect(folders.size).toBe(0);
  });

  it('counts reparse points as links and does not descend into them', () => {
    const { result, folders } = scan({
      records: [
        { index: 16, dir: true, reparse: true, names: [{ parent: 5, name: 'junction' }] },
        { index: 17, size: 9999, names: [{ parent: 16, name: 'behind.bin' }] },
        { index: 18, size: 100, reparse: true, names: [{ parent: 5, name: 'placeholder.docx' }] },
      ],
    });
    expect(folders.has('X:\\junction')).toBe(false);
    expect(result.rootRecord).toMatchObject({ linkCount: 2, fileCount: 0, bytes: 0, folderCount: 0 });
  });

  it('skips excluded names and paths with everything beneath them', () => {
    const { result, folders } = scan(
      {
        records: [
          { index: 16, size: 8 * CLUSTER, names: [{ parent: 5, name: 'pagefile.sys' }] },
          { index: 17, dir: true, names: [{ parent: 5, name: 'System Volume Information' }] },
          { index: 18, size: 50, names: [{ parent: 17, name: 'tracking.log' }] },
          { index: 19, dir: true, names: [{ parent: 5, name: 'skipme' }] },
          { index: 20, size: 70, names: [{ parent: 19, name: 'inner.txt' }] },
          { index: 21, size: 30, names: [{ parent: 5, name: 'kept.txt' }] },
        ],
      },
      { paths: ['X:\\skipme'] },
    );
    expect(folders.size).toBe(0);
    expect(result.rootRecord).toMatchObject({ fileCount: 1, bytes: 30, folderCount: 0 });
  });

  it('ignores deleted records and orphans whose parent record was reused', () => {
    const { result } = scan({
      records: [
        { index: 16, inUse: false, size: 500, names: [{ parent: 5, name: 'deleted.txt' }] },
        { index: 17, dir: true, seq: 4, names: [{ parent: 5, name: 'live' }] },
        { index: 18, size: 600, names: [{ parent: 17, name: 'orphan.txt', parentSeq: 3 }] },
        { index: 19, size: 700, names: [{ parent: 17, name: 'child.txt' }] },
      ],
    });
    expect(result.rootRecord).toMatchObject({ fileCount: 1, bytes: 700, folderCount: 1 });
  });

  it('counts a hard-linked file under every parent but skips DOS short names', () => {
    const { folders } = scan({
      records: [
        { index: 16, dir: true, names: [{ parent: 5, name: 'a' }] },
        { index: 17, dir: true, names: [{ parent: 5, name: 'b' }] },
        {
          index: 18,
          size: 1000,
          names: [
            { parent: 16, name: 'LONGFI~1.TXT', namespace: 2 },
            { parent: 16, name: 'long file name.txt', namespace: 1 },
            { parent: 17, name: 'link.txt', namespace: 0 },
          ],
        },
      ],
    });
    expect(folders.get('X:\\a')).toMatchObject({ fileCount: 1, bytes: 1000 });
    expect(folders.get('X:\\b')).toMatchObject({ fileCount: 1, bytes: 1000 });
  });

  it('merges attributes from extension records into their base record', () => {
    const { folders } = scan({
      records: [
        { index: 16, dir: true, names: [{ parent: 5, name: 'dir' }] },
        { index: 17, mtimeMs: T1, names: [{ parent: 16, name: 'frag.bin' }] },
        { index: 18, baseRecord: 17, size: 20_000 },
      ],
    });
    expect(folders.get('X:\\dir')).toMatchObject({ fileCount: 1, bytes: 20_000, newestMtimeMs: T1 });
  });

  it('uses the compressed or sparse allocation when present', () => {
    const { folders } = scan({
      records: [
        { index: 16, dir: true, names: [{ parent: 5, name: 'd' }] },
        { index: 17, size: 100_000, sparseAllocated: CLUSTER, names: [{ parent: 16, name: 'sparse.vhd' }] },
      ],
    });
    expect(folders.get('X:\\d')).toMatchObject({ bytes: 100_000, allocatedBytes: CLUSTER });
  });

  it('emits project markers with the walker semantics', () => {
    const { markers } = scan({
      records: [
        { index: 16, dir: true, names: [{ parent: 5, name: 'app' }] },
        { index: 17, size: 2, resident: true, names: [{ parent: 16, name: 'package.json' }] },
        { index: 18, dir: true, names: [{ parent: 16, name: 'node_modules' }] },
        { index: 19, dir: true, names: [{ parent: 18, name: 'dep' }] },
        { index: 20, size: 2, resident: true, names: [{ parent: 19, name: 'package.json' }] },
        { index: 21, dir: true, names: [{ parent: 19, name: 'node_modules' }] },
        { index: 22, dir: true, names: [{ parent: 16, name: '.git' }] },
      ],
    });
    expect(markers.map((marker) => `${marker.kind}:${marker.path}`).sort()).toEqual([
      'git-dir:X:\\app\\.git',
      'node-modules:X:\\app\\node_modules',
      'package-json:X:\\app\\package.json',
    ]);
  });

  it('does not track modification times inside node_modules or .git', () => {
    const { folders } = scan({
      records: [
        { index: 16, dir: true, names: [{ parent: 5, name: 'app' }] },
        { index: 17, size: 10, mtimeMs: T1, names: [{ parent: 16, name: 'index.js' }] },
        { index: 18, dir: true, names: [{ parent: 16, name: 'node_modules' }] },
        { index: 19, size: 10, mtimeMs: T2, names: [{ parent: 18, name: 'fresh.js' }] },
      ],
    });
    expect(folders.get('X:\\app\\node_modules')?.newestMtimeMs).toBe(0);
    expect(folders.get('X:\\app')?.newestMtimeMs).toBe(T1);
  });

  it('skips torn records and reports them as errors', () => {
    const { result } = scan({
      records: [
        { index: 16, size: 100, torn: true, names: [{ parent: 5, name: 'torn.bin' }] },
        { index: 17, size: 200, names: [{ parent: 5, name: 'ok.bin' }] },
      ],
    });
    expect(result.errors).toBe(1);
    expect(result.rootRecord).toMatchObject({ fileCount: 1, bytes: 200 });
  });

  it('follows an MFT split across non-contiguous extents', () => {
    const records = Array.from({ length: 40 }, (_, offset) => ({
      index: 16 + offset,
      size: 1000 + offset,
      names: [{ parent: 5, name: `file-${offset}.bin` }],
    }));
    const { result } = scan({ records, fragmentAt: 32 });
    expect(result.rootRecord.fileCount).toBe(40);
    expect(result.rootRecord.bytes).toBe(40 * 1000 + (39 * 40) / 2);
  });

  it('reads in small chunks without losing records', () => {
    const records = Array.from({ length: 30 }, (_, offset) => ({
      index: 16 + offset,
      size: 10,
      names: [{ parent: 5, name: `f${offset}` }],
    }));
    const result = scanMft({
      root: ROOT,
      reader: imageReader(buildImage({ records })),
      exclusions: createExclusionMatcher(),
      chunkBytes: 1024,
    });
    expect(result.rootRecord.fileCount).toBe(30);
  });

  it('returns a partial, aborted result when cancelled', () => {
    const { result, folders } = scan(
      { records: [{ index: 16, size: 10, names: [{ parent: 5, name: 'a' }] }] },
      { abort: true },
    );
    expect(result.aborted).toBe(true);
    expect(result.rootRecord.partial).toBe(true);
    expect(folders.size).toBe(0);
  });

  it('refuses volumes that are not NTFS', () => {
    expect(() => scan({ records: [], bootSignature: 'EXFAT   ' })).toThrow(MftUnavailableError);
  });
});

describe('MFT primitives', () => {
  it('parses boot sector geometry', () => {
    const image = buildImage({ records: [] });
    expect(parseBootSector(image)).toEqual({
      bytesPerSector: 512,
      bytesPerCluster: 4096,
      mftOffset: 4 * 4096,
      recordSize: 1024,
    });
  });

  it('decodes runlists with relative, negative, and sparse runs', () => {
    // 0x21: 1-byte length, 2-byte offset. 0x01: sparse run.
    const runs = Buffer.from([0x21, 0x10, 0x00, 0x01, 0x11, 0x08, 0xf0, 0x01, 0x04, 0x00]);
    expect(decodeRunlist(runs, 0, runs.length)).toEqual([
      { lcn: 256, clusters: 16 },
      { lcn: 240, clusters: 8 },
      { lcn: -1, clusters: 4 },
    ]);
  });
});
