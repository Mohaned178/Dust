import { closeSync, openSync, readSync } from 'node:fs';
import { sep } from 'node:path';
import type { FolderRecord, Marker, ProgressUpdate } from '../model/types';
import type { ExclusionMatcher } from './exclusions';
import { clusterAllocation, fileTimePartsToUnixMs } from './filetime';

// Reads an NTFS volume's Master File Table directly and rebuilds the same
// FolderRecords and markers the directory walker produces. One sequential pass
// over the MFT replaces a CreateFile + directory query per folder, which is
// what makes a cold HDD scan seek-bound. Raw volume access needs
// administrator rights; callers fall back to the walker on MftUnavailableError.
//
// The output deliberately mirrors the walker's semantics: reparse points
// (files and folders) count as links and are not descended, excluded names
// are skipped entirely, every hard link is counted under each parent (as a
// directory listing would), and NTFS metafiles ($MFT, $Extend, ...) are not
// listed because FindFirstFile never returns them.

export class MftUnavailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'MftUnavailableError';
  }
}

export interface VolumeReader {
  /** Reads `length` bytes at absolute volume offset `position` into `buffer`; returns bytes read. */
  read(buffer: Buffer, length: number, position: number): number;
  close(): void;
}

export interface NtfsGeometry {
  bytesPerSector: number;
  bytesPerCluster: number;
  mftOffset: number;
  recordSize: number;
}

export interface Extent {
  /** Logical cluster number, or -1 for a sparse run. */
  lcn: number;
  clusters: number;
}

export interface MftScanOptions {
  root: string;
  reader: VolumeReader;
  exclusions: ExclusionMatcher;
  shouldAbort?: () => boolean;
  chunkBytes?: number;
  progressIntervalMs?: number;
  now?: () => number;
  onFolder?: (record: FolderRecord) => void;
  onMarker?: (marker: Marker) => void;
  onProgress?: (update: ProgressUpdate) => void;
}

export interface MftScanResult {
  rootRecord: FolderRecord;
  filesScanned: number;
  bytesSeen: number;
  errors: number;
  markers: Marker[];
  aborted: boolean;
}

const ROOT_RECORD = 5;
const FIRST_USER_RECORD = 16;
const FIXUP_STRIDE = 512;
const NO_PARENT = 0xffff_ffff;
const TWO_32 = 4_294_967_296;
const DEFAULT_CHUNK_BYTES = 4 * 1024 * 1024;

const ATTR_STANDARD_INFORMATION = 0x10;
const ATTR_ATTRIBUTE_LIST = 0x20;
const ATTR_FILE_NAME = 0x30;
const ATTR_DATA = 0x80;
const ATTR_REPARSE_POINT = 0xc0;
const ATTR_END = 0xffff_ffff;
const ATTR_FLAG_COMPRESSED = 0x0001;
const ATTR_FLAG_SPARSE = 0x8000;
const FILE_ATTRIBUTE_REPARSE_POINT = 0x400;
const NAMESPACE_DOS = 2;
const RECORD_IN_USE = 0x01;
const RECORD_IS_DIRECTORY = 0x02;
const FILE_SIGNATURE = 0x454c_4946; // "FILE"

const IN_USE = 1;
const IS_DIR = 2;
const REPARSE = 4;
const EXCLUDED = 8;
const PACKAGE_JSON = 16;

const DIR_UNKNOWN = 0;
const DIR_VALID = 1;
const DIR_INVALID = 2;
const DIR_VISITING = 3;

export function openVolumeReader(root: string): VolumeReader {
  const match = /^([a-zA-Z]):\\?$/.exec(root);
  if (!match) throw new MftUnavailableError(`not a volume root: ${root}`);
  let fd: number;
  try {
    fd = openSync(`\\\\.\\${match[1]!.toUpperCase()}:`, 'r');
  } catch (error) {
    throw new MftUnavailableError(`cannot open volume ${root}: ${(error as Error).message}`);
  }
  return {
    read: (buffer, length, position) => readSync(fd, buffer, 0, length, position),
    close: () => closeSync(fd),
  };
}

function readU64(buffer: Buffer, offset: number): number {
  return buffer.readUInt32LE(offset) + buffer.readUInt32LE(offset + 4) * TWO_32;
}

/** Low 48 bits of an NTFS file reference: the MFT record number. */
function readRecordNumber(buffer: Buffer, offset: number): number {
  return buffer.readUInt32LE(offset) + buffer.readUInt16LE(offset + 4) * TWO_32;
}

function readUnsigned(buffer: Buffer, offset: number, size: number): number {
  let value = 0;
  let scale = 1;
  for (let index = 0; index < size; index += 1) {
    value += buffer[offset + index]! * scale;
    scale *= 256;
  }
  return value;
}

function readSigned(buffer: Buffer, offset: number, size: number): number {
  const value = readUnsigned(buffer, offset, size);
  return buffer[offset + size - 1]! & 0x80 ? value - 2 ** (8 * size) : value;
}

export function parseBootSector(buffer: Buffer): NtfsGeometry {
  if (buffer.length < 512 || buffer.toString('latin1', 3, 11) !== 'NTFS    ') {
    throw new MftUnavailableError('not an NTFS volume');
  }
  const bytesPerSector = buffer.readUInt16LE(0x0b);
  const rawSectorsPerCluster = buffer[0x0d]!;
  const sectorsPerCluster = rawSectorsPerCluster <= 0x80 ? rawSectorsPerCluster : 2 ** (256 - rawSectorsPerCluster);
  const bytesPerCluster = bytesPerSector * sectorsPerCluster;
  const rawRecordSize = buffer.readInt8(0x40);
  const recordSize = rawRecordSize > 0 ? rawRecordSize * bytesPerCluster : 2 ** -rawRecordSize;
  const powerOfTwo = (value: number) => value > 0 && (value & (value - 1)) === 0;
  if (
    !powerOfTwo(bytesPerSector) ||
    bytesPerSector < 512 ||
    bytesPerSector > 4096 ||
    !powerOfTwo(bytesPerCluster) ||
    !powerOfTwo(recordSize) ||
    recordSize < 256 ||
    recordSize > 65_536
  ) {
    throw new MftUnavailableError('unsupported NTFS geometry');
  }
  return { bytesPerSector, bytesPerCluster, mftOffset: readU64(buffer, 0x30) * bytesPerCluster, recordSize };
}

/** Applies the update-sequence fixups in place; false means a torn or corrupt record. */
export function applyFixups(buffer: Buffer, offset: number, recordSize: number): boolean {
  const usaOffset = buffer.readUInt16LE(offset + 4);
  const usaCount = buffer.readUInt16LE(offset + 6);
  if (usaCount < 2 || usaOffset + usaCount * 2 > recordSize) return false;
  const usn = buffer.readUInt16LE(offset + usaOffset);
  for (let index = 1; index < usaCount; index += 1) {
    const position = offset + index * FIXUP_STRIDE - 2;
    if (position + 2 > offset + recordSize) return false;
    if (buffer.readUInt16LE(position) !== usn) return false;
    buffer.writeUInt16LE(buffer.readUInt16LE(offset + usaOffset + index * 2), position);
  }
  return true;
}

export function decodeRunlist(buffer: Buffer, offset: number, end: number): Extent[] {
  const extents: Extent[] = [];
  let lcn = 0;
  let cursor = offset;
  while (cursor < end) {
    const header = buffer[cursor]!;
    if (header === 0) break;
    const lengthSize = header & 0x0f;
    const offsetSize = header >> 4;
    if (lengthSize === 0 || lengthSize > 8 || offsetSize > 8 || cursor + 1 + lengthSize + offsetSize > end) {
      throw new MftUnavailableError('corrupt runlist');
    }
    const clusters = readUnsigned(buffer, cursor + 1, lengthSize);
    if (offsetSize === 0) {
      extents.push({ lcn: -1, clusters });
    } else {
      lcn += readSigned(buffer, cursor + 1 + lengthSize, offsetSize);
      extents.push({ lcn, clusters });
    }
    cursor += 1 + lengthSize + offsetSize;
  }
  return extents;
}

interface Attribute {
  type: number;
  offset: number;
  length: number;
  nonResident: boolean;
  nameLength: number;
}

function* attributes(buffer: Buffer, offset: number, recordSize: number): Generator<Attribute> {
  const used = Math.min(buffer.readUInt32LE(offset + 0x18), recordSize);
  const end = offset + used;
  let cursor = offset + buffer.readUInt16LE(offset + 0x14);
  while (cursor + 16 <= end) {
    const type = buffer.readUInt32LE(cursor);
    if (type === ATTR_END) return;
    const length = buffer.readUInt32LE(cursor + 4);
    if (length < 16 || cursor + length > end) return;
    yield { type, offset: cursor, length, nonResident: buffer[cursor + 8] !== 0, nameLength: buffer[cursor + 9]! };
    cursor += length;
  }
}

function residentValue(buffer: Buffer, attribute: Attribute): { start: number; length: number } {
  return {
    start: attribute.offset + buffer.readUInt16LE(attribute.offset + 0x14),
    length: buffer.readUInt32LE(attribute.offset + 0x10),
  };
}

interface DataRun {
  startVcn: number;
  extents: Extent[];
}

function dataRunOf(buffer: Buffer, attribute: Attribute): DataRun {
  const start = attribute.offset;
  return {
    startVcn: readU64(buffer, start + 0x10),
    extents: decodeRunlist(buffer, start + buffer.readUInt16LE(start + 0x20), start + attribute.length),
  };
}

/** Locates the MFT's own extents and size from record 0 ($MFT), following an attribute list if present. */
export function locateMft(reader: VolumeReader, geometry: NtfsGeometry): { extents: Extent[]; bytes: number } {
  const { recordSize, bytesPerCluster, bytesPerSector, mftOffset } = geometry;
  const readLength = Math.max(recordSize, bytesPerSector);
  const readRecordAt = (position: number): Buffer => {
    const buffer = Buffer.alloc(readLength);
    if (reader.read(buffer, readLength, position) < recordSize) throw new MftUnavailableError('short MFT read');
    if (buffer.readUInt32LE(0) !== FILE_SIGNATURE || !applyFixups(buffer, 0, recordSize)) {
      throw new MftUnavailableError('corrupt $MFT record');
    }
    return buffer;
  };

  const record0 = readRecordAt(mftOffset);
  const runs: DataRun[] = [];
  let bytes = -1;
  const extensionRecords: number[] = [];
  for (const attribute of attributes(record0, 0, recordSize)) {
    if (attribute.type === ATTR_DATA && attribute.nameLength === 0 && attribute.nonResident) {
      const run = dataRunOf(record0, attribute);
      if (run.startVcn === 0) bytes = readU64(record0, attribute.offset + 0x30);
      runs.push(run);
    } else if (attribute.type === ATTR_ATTRIBUTE_LIST) {
      if (attribute.nonResident) throw new MftUnavailableError('non-resident $MFT attribute list');
      const value = residentValue(record0, attribute);
      let cursor = value.start;
      const end = value.start + value.length;
      while (cursor + 0x1a <= end) {
        const entryLength = record0.readUInt16LE(cursor + 4);
        if (entryLength === 0) break;
        const type = record0.readUInt32LE(cursor);
        const record = readRecordNumber(record0, cursor + 0x10);
        if (type === ATTR_DATA && record0[cursor + 6] === 0 && record !== 0) extensionRecords.push(record);
        cursor += entryLength;
      }
    }
  }

  // Extension records hold the rest of a heavily fragmented $MFT's runlist.
  // They live inside the MFT itself, almost always within the first extent.
  const resolve = (record: number): number => {
    const sorted = [...runs].sort((a, b) => a.startVcn - b.startVcn);
    const target = (record * recordSize) / bytesPerCluster;
    for (const run of sorted) {
      let vcn = run.startVcn;
      for (const extent of run.extents) {
        if (target < vcn + extent.clusters && extent.lcn >= 0) {
          return (extent.lcn + (target - vcn)) * bytesPerCluster;
        }
        vcn += extent.clusters;
      }
    }
    throw new MftUnavailableError('cannot resolve $MFT extension record');
  };
  for (const record of new Set(extensionRecords)) {
    const buffer = readRecordAt(resolve(record));
    for (const attribute of attributes(buffer, 0, recordSize)) {
      if (attribute.type === ATTR_DATA && attribute.nameLength === 0 && attribute.nonResident) {
        const run = dataRunOf(buffer, attribute);
        if (run.startVcn === 0) bytes = readU64(buffer, attribute.offset + 0x30);
        if (!runs.some((existing) => existing.startVcn === run.startVcn)) runs.push(run);
      }
    }
  }

  if (bytes <= 0 || runs.length === 0) throw new MftUnavailableError('$MFT has no data attribute');
  runs.sort((a, b) => a.startVcn - b.startVcn);
  return { extents: runs.flatMap((run) => run.extents), bytes };
}

interface ExtraLink {
  record: number;
  parent: number;
  parentSeq: number;
  name: string;
  flags: number;
}

class MftTable {
  readonly flags: Uint8Array;
  readonly seq: Uint16Array;
  readonly parent: Uint32Array;
  readonly parentSeq: Uint16Array;
  readonly size: Float64Array;
  readonly alloc: Float64Array;
  readonly mtime: Float64Array;
  readonly names: (string | undefined)[];
  readonly extraLinks: ExtraLink[] = [];
  torn = 0;

  constructor(
    readonly count: number,
    private readonly exclusions: ExclusionMatcher,
  ) {
    this.flags = new Uint8Array(count);
    this.seq = new Uint16Array(count);
    this.parent = new Uint32Array(count).fill(NO_PARENT);
    this.parentSeq = new Uint16Array(count);
    this.size = new Float64Array(count);
    this.alloc = new Float64Array(count);
    this.mtime = new Float64Array(count);
    this.names = new Array<string | undefined>(count);
  }

  parse(buffer: Buffer, offset: number, index: number, recordSize: number): void {
    if (buffer.readUInt32LE(offset) !== FILE_SIGNATURE) return;
    if (!applyFixups(buffer, offset, recordSize)) {
      this.torn += 1;
      return;
    }
    const header = buffer.readUInt16LE(offset + 0x16);
    if ((header & RECORD_IN_USE) === 0) return;
    const baseRef = readRecordNumber(buffer, offset + 0x20);
    const base = baseRef === 0 ? index : baseRef;
    if (base >= this.count) return;
    if (base === index) {
      this.flags[base] |= IN_USE | ((header & RECORD_IS_DIRECTORY) !== 0 ? IS_DIR : 0);
      this.seq[base] = buffer.readUInt16LE(offset + 0x10);
    }

    // Hot loop over millions of records: walk attributes inline rather than
    // through the attributes() generator, which allocates per yield.
    const end = offset + Math.min(buffer.readUInt32LE(offset + 0x18), recordSize);
    let cursor = offset + buffer.readUInt16LE(offset + 0x14);
    while (cursor + 16 <= end) {
      const type = buffer.readUInt32LE(cursor);
      if (type === ATTR_END) break;
      const length = buffer.readUInt32LE(cursor + 4);
      if (length < 16 || cursor + length > end) break;
      const nonResident = buffer[cursor + 8] !== 0;
      if (type === ATTR_STANDARD_INFORMATION && !nonResident) {
        const value = cursor + buffer.readUInt16LE(cursor + 0x14);
        if (buffer.readUInt32LE(cursor + 0x10) >= 0x24) {
          this.mtime[base] = fileTimePartsToUnixMs(buffer.readUInt32LE(value + 8), buffer.readUInt32LE(value + 12));
          if ((buffer.readUInt32LE(value + 0x20) & FILE_ATTRIBUTE_REPARSE_POINT) !== 0) this.flags[base] |= REPARSE;
        }
      } else if (type === ATTR_FILE_NAME && !nonResident) {
        const value = cursor + buffer.readUInt16LE(cursor + 0x14);
        if (buffer[value + 0x41] !== NAMESPACE_DOS) {
          const nameStart = value + 0x42;
          const name = buffer.toString('utf16le', nameStart, nameStart + buffer[value + 0x40]! * 2);
          this.addName(base, readRecordNumber(buffer, value), buffer.readUInt16LE(value + 6), name);
        }
      } else if (type === ATTR_DATA && buffer[cursor + 9] === 0) {
        if (!nonResident) {
          this.size[base] = buffer.readUInt32LE(cursor + 0x10);
          this.alloc[base] = 0;
        } else if (readU64(buffer, cursor + 0x10) === 0) {
          const packed = (buffer.readUInt16LE(cursor + 0x0c) & (ATTR_FLAG_COMPRESSED | ATTR_FLAG_SPARSE)) !== 0;
          this.size[base] = readU64(buffer, cursor + 0x30);
          this.alloc[base] = packed && length >= 0x48 ? readU64(buffer, cursor + 0x40) : readU64(buffer, cursor + 0x28);
        }
      } else if (type === ATTR_REPARSE_POINT) {
        this.flags[base] |= REPARSE;
      }
      cursor += length;
    }
  }

  private addName(record: number, parent: number, parentSeq: number, name: string): void {
    if (parent >= NO_PARENT) return;
    const isDir = (this.flags[record]! & IS_DIR) !== 0;
    let flags = 0;
    if (this.exclusions.name(name)) flags |= EXCLUDED;
    if (!isDir && name.length === 12 && name.toLowerCase() === 'package.json') flags |= PACKAGE_JSON;
    if (this.names[record] === undefined && this.parent[record] === NO_PARENT) {
      this.parent[record] = parent;
      this.parentSeq[record] = parentSeq;
      // File names are only needed later when path exclusions apply;
      // directory names build every path, so they are always kept. A name
      // met in an extension record before its base is kept too, since the
      // base's directory flag is not known yet.
      const baseSeen = (this.flags[record]! & IN_USE) !== 0;
      this.names[record] = isDir || !baseSeen || this.exclusions.path !== null ? name : '';
      this.flags[record] |= flags;
      return;
    }
    this.extraLinks.push({ record, parent, parentSeq, name, flags });
  }
}

export function scanMft(options: MftScanOptions): MftScanResult {
  const { reader, exclusions } = options;
  const now = options.now ?? Date.now;
  const progressInterval = options.progressIntervalMs ?? 100;
  const shouldAbort = options.shouldAbort ?? (() => false);

  const boot = Buffer.alloc(4096);
  if (reader.read(boot, 4096, 0) < 512) throw new MftUnavailableError('cannot read boot sector');
  const geometry = parseBootSector(boot);
  const { recordSize, bytesPerCluster } = geometry;
  const mft = locateMft(reader, geometry);
  const count = Math.floor(mft.bytes / recordSize);
  const table = new MftTable(count, exclusions);

  let filesScanned = 0;
  let bytesSeen = 0;
  let lastProgress = 0;
  let aborted = false;
  const report = (currentPath: string, force = false): void => {
    if (!options.onProgress) return;
    const stamp = now();
    if (!force && stamp - lastProgress < progressInterval) return;
    lastProgress = stamp;
    options.onProgress({ filesScanned, bytesSeen, currentPath, dirsCompleted: 0, errors: table.torn });
  };

  // Pass 1: stream the MFT sequentially, extent by extent.
  const chunkBytes = Math.max(
    recordSize,
    Math.floor((options.chunkBytes ?? DEFAULT_CHUNK_BYTES) / recordSize) * recordSize,
  );
  const chunk = Buffer.alloc(chunkBytes);
  let recordIndex = 0;
  read: for (const extent of mft.extents) {
    const extentBytes = extent.clusters * bytesPerCluster;
    if (extentBytes % recordSize !== 0) throw new MftUnavailableError('MFT extent splits a record');
    let remaining = Math.min(extentBytes, (count - recordIndex) * recordSize);
    if (extent.lcn < 0) {
      recordIndex += Math.floor(remaining / recordSize);
      continue;
    }
    let position = extent.lcn * bytesPerCluster;
    while (remaining > 0) {
      if (shouldAbort()) {
        aborted = true;
        break read;
      }
      const length = Math.min(chunkBytes, remaining);
      const read = reader.read(chunk, length, position);
      if (read <= 0) throw new MftUnavailableError('short MFT read');
      const records = Math.floor(read / recordSize);
      for (let index = 0; index < records; index += 1) {
        table.parse(chunk, index * recordSize, recordIndex + index, recordSize);
        if ((table.flags[recordIndex + index]! & (IN_USE | IS_DIR)) === IN_USE) {
          filesScanned += 1;
          bytesSeen += table.size[recordIndex + index]!;
        }
      }
      recordIndex += records;
      position += records * recordSize;
      remaining -= records * recordSize;
      report(options.root);
      if (records === 0) break;
    }
  }

  const rootPath = options.root;
  if (aborted) {
    const rootRecord: FolderRecord = {
      path: rootPath,
      bytes: 0,
      allocatedBytes: 0,
      fileCount: 0,
      folderCount: 0,
      linkCount: 0,
      newestMtimeMs: 0,
      errorCount: 0,
      partial: true,
    };
    return { rootRecord, filesScanned, bytesSeen, errors: table.torn, markers: [], aborted: true };
  }

  return buildTree(table, rootPath, bytesPerCluster, exclusions, options, report);
}

function buildTree(
  table: MftTable,
  rootPath: string,
  clusterSize: number,
  exclusions: ExclusionMatcher,
  options: MftScanOptions,
  report: (path: string, force?: boolean) => void,
): MftScanResult {
  const { count, flags, parent, parentSeq, seq, names } = table;
  const markers: Marker[] = [];
  const emitMarker = (marker: Marker): void => {
    markers.push(marker);
    options.onMarker?.(marker);
  };
  if (count <= ROOT_RECORD || (flags[ROOT_RECORD]! & IS_DIR) === 0) {
    throw new MftUnavailableError('root directory record missing');
  }

  // Pass 2: resolve every directory's path, validity, depth, and inherited
  // flags. Iterative so pathological depths cannot overflow the stack.
  const state = new Uint8Array(count);
  const depth = new Uint32Array(count);
  const tracked = new Uint8Array(count);
  const inNodeModules = new Uint8Array(count);
  const paths = new Array<string | undefined>(count);
  state[ROOT_RECORD] = DIR_VALID;
  paths[ROOT_RECORD] = rootPath;
  tracked[ROOT_RECORD] = 1;

  const parentLinkValid = (p: number, pSeq: number): boolean => p < count && state[p] === DIR_VALID && seq[p] === pSeq;
  const isDirCandidate = (record: number): boolean =>
    record >= FIRST_USER_RECORD && (flags[record]! & (IN_USE | IS_DIR | REPARSE | EXCLUDED)) === (IN_USE | IS_DIR);

  const chain: number[] = [];
  for (let record = FIRST_USER_RECORD; record < count; record += 1) {
    if (state[record] !== DIR_UNKNOWN || !isDirCandidate(record)) continue;
    chain.length = 0;
    let current = record;
    let valid: boolean;
    for (;;) {
      const currentState = state[current];
      if (currentState === DIR_VALID) {
        valid = true;
        break;
      }
      if (currentState !== DIR_UNKNOWN || !isDirCandidate(current)) {
        valid = false;
        break;
      }
      state[current] = DIR_VISITING;
      chain.push(current);
      const next = parent[current]!;
      // A parent whose sequence number moved on was deleted and its record
      // reused; the entry is a stale orphan, as is anything beneath it.
      if (next >= count || seq[next] !== parentSeq[current]) {
        valid = false;
        break;
      }
      current = next;
    }
    for (let index = chain.length - 1; index >= 0; index -= 1) {
      const dir = chain[index]!;
      if (!valid) {
        state[dir] = DIR_INVALID;
        continue;
      }
      const up = parent[dir]!;
      const name = names[dir]!;
      const base = paths[up]!;
      const path = base.endsWith(sep) ? base + name : base + sep + name;
      if (exclusions.path?.(path)) {
        state[dir] = DIR_INVALID;
        valid = false;
        continue;
      }
      const lower = name.toLowerCase();
      paths[dir] = path;
      depth[dir] = depth[up]! + 1;
      tracked[dir] = tracked[up]! && lower !== 'node_modules' && lower !== '.git' ? 1 : 0;
      inNodeModules[dir] = inNodeModules[up]! || lower === 'node_modules' ? 1 : 0;
      state[dir] = DIR_VALID;
    }
  }

  // Pass 3: direct contributions of every entry to its parent directory.
  const bytes = new Float64Array(count);
  const allocated = new Float64Array(count);
  const fileCount = new Float64Array(count);
  const folderCount = new Float64Array(count);
  const linkCount = new Float64Array(count);
  const newest = new Float64Array(count);
  let filesScanned = 0;
  let bytesSeen = 0;

  const addEntry = (record: number, up: number, upSeq: number, name: string | undefined, linkFlags: number): void => {
    if (!parentLinkValid(up, upSeq) || (linkFlags & EXCLUDED) !== 0) return;
    const recordFlags = flags[record]!;
    if ((recordFlags & IS_DIR) !== 0) {
      if (state[record] === DIR_VALID) {
        folderCount[up] += 1;
        const lower = names[record]!.toLowerCase();
        if (lower === 'node_modules' && !inNodeModules[up]) emitMarker({ kind: 'node-modules', path: paths[record]! });
        if (lower === '.git') emitMarker({ kind: 'git-dir', path: paths[record]! });
      } else if ((recordFlags & REPARSE) !== 0 && record >= FIRST_USER_RECORD) {
        const path = paths[up]!.endsWith(sep) ? paths[up]! + names[record]! : paths[up]! + sep + names[record]!;
        if (!exclusions.path?.(path)) linkCount[up] += 1;
      }
      return;
    }
    if (exclusions.path !== null && name !== undefined) {
      const path = paths[up]!.endsWith(sep) ? paths[up]! + name : paths[up]! + sep + name;
      if (exclusions.path(path)) return;
    }
    if ((recordFlags & REPARSE) !== 0) {
      linkCount[up] += 1;
      return;
    }
    const size = table.size[record]!;
    fileCount[up] += 1;
    bytes[up] += size;
    allocated[up] += clusterAllocation(table.alloc[record]!, clusterSize);
    if (tracked[up] && table.mtime[record]! > newest[up]!) newest[up] = table.mtime[record]!;
    if ((linkFlags & PACKAGE_JSON) !== 0 && !inNodeModules[up]) {
      const base = paths[up]!;
      emitMarker({
        kind: 'package-json',
        path: base.endsWith(sep) ? `${base}package.json` : `${base}${sep}package.json`,
      });
    }
    filesScanned += 1;
    bytesSeen += size;
  };

  for (let record = FIRST_USER_RECORD; record < count; record += 1) {
    if ((flags[record]! & IN_USE) === 0) continue;
    addEntry(record, parent[record]!, parentSeq[record]!, names[record], flags[record]!);
  }
  for (const link of table.extraLinks) {
    if (link.record < FIRST_USER_RECORD || (flags[link.record]! & IN_USE) === 0) continue;
    if ((flags[link.record]! & IS_DIR) !== 0) continue;
    addEntry(link.record, link.parent, link.parentSeq, link.name, link.flags);
  }

  // Pass 4: roll up bottom-up (deepest first) and emit records children-first,
  // the same order the walker finalizes them in.
  let maxDepth = 0;
  const validDirs: number[] = [];
  for (let record = FIRST_USER_RECORD; record < count; record += 1) {
    if (state[record] !== DIR_VALID) continue;
    validDirs.push(record);
    if (depth[record]! > maxDepth) maxDepth = depth[record]!;
  }
  const buckets: number[][] = Array.from({ length: maxDepth + 1 }, () => []);
  for (const record of validDirs) buckets[depth[record]!]!.push(record);

  for (let level = maxDepth; level >= 1; level -= 1) {
    for (const dir of buckets[level]!) {
      const record: FolderRecord = {
        path: paths[dir]!,
        bytes: bytes[dir]!,
        allocatedBytes: allocated[dir]!,
        fileCount: fileCount[dir]!,
        folderCount: folderCount[dir]!,
        linkCount: linkCount[dir]!,
        newestMtimeMs: newest[dir]!,
        errorCount: 0,
        partial: false,
      };
      options.onFolder?.(record);
      const up = parent[dir]!;
      bytes[up] += record.bytes;
      allocated[up] += record.allocatedBytes;
      fileCount[up] += record.fileCount;
      folderCount[up] += record.folderCount;
      linkCount[up] += record.linkCount;
      if (record.newestMtimeMs > newest[up]!) newest[up] = record.newestMtimeMs;
    }
    report(rootPath);
  }

  const rootRecord: FolderRecord = {
    path: rootPath,
    bytes: bytes[ROOT_RECORD]!,
    allocatedBytes: allocated[ROOT_RECORD]!,
    fileCount: fileCount[ROOT_RECORD]!,
    folderCount: folderCount[ROOT_RECORD]!,
    linkCount: linkCount[ROOT_RECORD]!,
    newestMtimeMs: newest[ROOT_RECORD]!,
    errorCount: 0,
    partial: false,
  };
  return { rootRecord, filesScanned, bytesSeen, errors: table.torn, markers, aborted: false };
}
