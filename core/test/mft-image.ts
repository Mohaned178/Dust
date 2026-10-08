// Builds a minimal synthetic NTFS volume image in memory: a boot sector plus
// an MFT of real FILE records (update-sequence fixups, resident and
// non-resident attributes, runlists). Only the structures the MFT reader
// consumes are populated.
import type { VolumeReader } from '../src/scanner/mft';

export const SECTOR = 512;
export const CLUSTER = 4096;
export const RECORD = 1024;
const USN = 0x0042;
const FILETIME_UNIX_EPOCH_DIFF_MS = 11_644_473_600_000;

export interface NameSpec {
  parent: number;
  name: string;
  namespace?: number;
  parentSeq?: number;
}

export interface RecordSpec {
  index: number;
  dir?: boolean;
  inUse?: boolean;
  seq?: number;
  names?: NameSpec[];
  size?: number;
  allocated?: number;
  resident?: boolean;
  sparseAllocated?: number;
  mtimeMs?: number;
  reparse?: boolean;
  baseRecord?: number;
  torn?: boolean;
}

export interface ImageOptions {
  records: RecordSpec[];
  recordCount?: number;
  /** Splits the MFT into two extents with a gap between them. */
  fragmentAt?: number;
  bootSignature?: string;
}

function fileTime(ms: number): bigint {
  return BigInt(Math.round((ms + FILETIME_UNIX_EPOCH_DIFF_MS) * 10_000));
}

function runEntry(clusters: number, lcnDelta: number): Buffer {
  const length = Buffer.alloc(4);
  length.writeUInt32LE(clusters);
  const offset = Buffer.alloc(4);
  offset.writeInt32LE(lcnDelta);
  return Buffer.concat([Buffer.from([0x44]), length, offset]);
}

function attribute(type: number, body: Buffer, nonResident = false): Buffer {
  if (nonResident) {
    const length = Math.ceil(body.length / 8) * 8;
    const out = Buffer.alloc(length);
    body.copy(out);
    out.writeUInt32LE(type, 0);
    out.writeUInt32LE(length, 4);
    out[8] = 1;
    return out;
  }
  const length = Math.ceil((0x18 + body.length) / 8) * 8;
  const out = Buffer.alloc(length);
  out.writeUInt32LE(type, 0);
  out.writeUInt32LE(length, 4);
  out[8] = 0;
  out.writeUInt32LE(body.length, 0x10);
  out.writeUInt16LE(0x18, 0x14);
  body.copy(out, 0x18);
  return out;
}

function standardInformation(mtimeMs: number, reparse: boolean): Buffer {
  const value = Buffer.alloc(0x48);
  value.writeBigUInt64LE(fileTime(mtimeMs), 0);
  value.writeBigUInt64LE(fileTime(mtimeMs), 8);
  value.writeUInt32LE(reparse ? 0x400 : 0x20, 0x20);
  return attribute(0x10, value);
}

function fileName(spec: NameSpec, seqOf: (record: number) => number): Buffer {
  const name = Buffer.from(spec.name, 'utf16le');
  const value = Buffer.alloc(0x42 + name.length);
  value.writeUInt32LE(spec.parent, 0);
  value.writeUInt16LE(spec.parentSeq ?? seqOf(spec.parent), 6);
  value[0x40] = spec.name.length;
  value[0x41] = spec.namespace ?? 1;
  name.copy(value, 0x42);
  return attribute(0x30, value);
}

function nonResidentData(
  size: number,
  allocated: number,
  runs: Buffer[],
  sparseAllocated?: number,
  startVcn = 0,
): Buffer {
  const packed = sparseAllocated !== undefined;
  const runlistOffset = packed ? 0x48 : 0x40;
  const runlist = Buffer.concat([...runs, Buffer.from([0])]);
  const body = Buffer.alloc(runlistOffset + runlist.length);
  body.writeBigUInt64LE(BigInt(startVcn), 0x10);
  body.writeUInt16LE(runlistOffset, 0x20);
  if (packed) body.writeUInt16LE(0x8000, 0x0c);
  body.writeBigUInt64LE(BigInt(allocated), 0x28);
  body.writeBigUInt64LE(BigInt(size), 0x30);
  body.writeBigUInt64LE(BigInt(size), 0x38);
  if (packed) body.writeBigUInt64LE(BigInt(sparseAllocated), 0x40);
  runlist.copy(body, runlistOffset);
  return attribute(0x80, body, true);
}

function record(spec: RecordSpec, attributes: Buffer[]): Buffer {
  const out = Buffer.alloc(RECORD);
  out.write('FILE', 0, 'latin1');
  const usaCount = RECORD / SECTOR + 1;
  out.writeUInt16LE(0x30, 4);
  out.writeUInt16LE(usaCount, 6);
  out.writeUInt16LE(spec.seq ?? 1, 0x10);
  out.writeUInt16LE(0x38, 0x14);
  out.writeUInt16LE((spec.inUse === false ? 0 : 1) | (spec.dir ? 2 : 0), 0x16);
  out.writeUInt32LE(spec.baseRecord ?? 0, 0x20);
  let cursor = 0x38;
  for (const attr of attributes) {
    attr.copy(out, cursor);
    cursor += attr.length;
  }
  out.writeUInt32LE(0xffff_ffff, cursor);
  cursor += 8;
  out.writeUInt32LE(cursor, 0x18);
  out.writeUInt32LE(RECORD, 0x1c);
  // Update sequence: stash each sector's last word, stamp the USN in its place.
  out.writeUInt16LE(USN, 0x30);
  for (let sector = 1; sector < usaCount; sector += 1) {
    const end = sector * SECTOR - 2;
    out.writeUInt16LE(out.readUInt16LE(end), 0x30 + sector * 2);
    out.writeUInt16LE(spec.torn && sector === 1 ? USN + 1 : USN, end);
  }
  return out;
}

export function buildImage(options: ImageOptions): Buffer {
  const specs = new Map<number, RecordSpec>();
  specs.set(5, { index: 5, dir: true, seq: 5, names: [{ parent: 5, name: '.' }] });
  specs.set(11, { index: 11, dir: true, seq: 11, names: [{ parent: 5, name: '$Extend' }] });
  for (const spec of options.records) specs.set(spec.index, spec);
  const maxIndex = Math.max(...specs.keys());
  const count = Math.max(options.recordCount ?? 0, maxIndex + 1, 32);
  const mftBytes = Math.ceil((count * RECORD) / CLUSTER) * CLUSTER;
  const mftClusters = mftBytes / CLUSTER;
  const mftLcn = 4;
  const fragmentAt = options.fragmentAt;
  // Second extent starts after a 3-cluster gap when fragmented.
  const firstClusters = fragmentAt === undefined ? mftClusters : (fragmentAt * RECORD) / CLUSTER;
  const secondLcn = mftLcn + firstClusters + 3;
  const mftRuns =
    fragmentAt === undefined
      ? [runEntry(mftClusters, mftLcn)]
      : [runEntry(firstClusters, mftLcn), runEntry(mftClusters - firstClusters, secondLcn - mftLcn)];

  let nextDataLcn = (fragmentAt === undefined ? mftLcn + mftClusters : secondLcn + mftClusters - firstClusters) + 16;
  const seqOf = (index: number): number => specs.get(index)?.seq ?? 1;

  const records = new Map<number, Buffer>();
  records.set(
    0,
    record({ index: 0, seq: 1 }, [
      standardInformation(0, false),
      fileName({ parent: 5, name: '$MFT' }, seqOf),
      nonResidentData(count * RECORD, mftBytes, mftRuns),
    ]),
  );
  for (const spec of specs.values()) {
    const attrs: Buffer[] = [];
    if (spec.baseRecord === undefined) attrs.push(standardInformation(spec.mtimeMs ?? 0, spec.reparse ?? false));
    for (const name of spec.names ?? []) attrs.push(fileName(name, seqOf));
    if (!spec.dir && spec.size !== undefined) {
      if (spec.resident) {
        attrs.push(attribute(0x80, Buffer.alloc(spec.size)));
      } else {
        const allocated = spec.allocated ?? Math.ceil(spec.size / CLUSTER) * CLUSTER;
        const clusters = Math.max(1, allocated / CLUSTER);
        attrs.push(nonResidentData(spec.size, allocated, [runEntry(clusters, nextDataLcn)], spec.sparseAllocated));
        nextDataLcn += clusters;
      }
    }
    if (spec.reparse) attrs.push(attribute(0xc0, Buffer.alloc(8)));
    records.set(spec.index, record(spec, attrs));
  }

  const totalClusters = nextDataLcn + 8;
  const image = Buffer.alloc(totalClusters * CLUSTER);
  image.write(options.bootSignature ?? 'NTFS    ', 3, 'latin1');
  image.writeUInt16LE(SECTOR, 0x0b);
  image[0x0d] = CLUSTER / SECTOR;
  image.writeBigUInt64LE(BigInt(mftLcn), 0x30);
  image.writeInt8(-10, 0x40); // 2^10 = 1024-byte records
  for (const [index, bytes] of records) {
    const clusterIndex = (index * RECORD) / CLUSTER;
    const offsetInCluster = (index * RECORD) % CLUSTER;
    const lcn =
      fragmentAt === undefined || index < fragmentAt
        ? mftLcn + Math.floor(clusterIndex)
        : secondLcn + Math.floor(clusterIndex) - firstClusters;
    bytes.copy(image, lcn * CLUSTER + offsetInCluster);
  }
  return image;
}

export function imageReader(image: Buffer): VolumeReader {
  return {
    read(buffer, length, position) {
      const end = Math.min(position + length, image.length);
      if (position >= end) return 0;
      return image.copy(buffer, 0, position, end);
    },
    close() {},
  };
}
