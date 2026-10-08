import { join } from 'node:path';
import koffi from 'koffi';
import type { Entry } from '../model/types';
import { NodeFsEnumerator, type Enumerator, type ListResult } from './enumerator';
import { DEFAULT_CLUSTER_SIZE } from '../system/cluster';
import { clusterAllocation, fileTimePartsToUnixMs } from './filetime';

const FILE_ATTRIBUTE_DIRECTORY = 0x10;
const FILE_ATTRIBUTE_REPARSE_POINT = 0x400;
const ERROR_NO_MORE_FILES = 18;
const INVALID_HANDLE_VALUE = 0xffff_ffff_ffff_ffffn;
const FILETIME_TICKS_PER_SECOND = 10_000_000n;
const FILETIME_TICKS_PER_100NS = 100n;
const FILETIME_UNIX_EPOCH_DIFF_TICKS = 116_444_736_000_000_000n;
const WINDOWS_EPOCH_OFFSET = 4_294_967_296;

interface FileTime {
  dwLowDateTime: number;
  dwHighDateTime: number;
}

interface FindData {
  dwFileAttributes: number;
  ftCreationTime: FileTime;
  ftLastAccessTime: FileTime;
  ftLastWriteTime: FileTime;
  nFileSizeHigh: number;
  nFileSizeLow: number;
  dwReserved0: number;
  dwReserved1: number;
  cFileName: string;
  cAlternateFileName: string;
}

interface FindApi {
  findFirst: (pattern: string, data: FindData) => unknown;
  findNext: (handle: unknown, data: FindData) => boolean;
  findClose: (handle: unknown) => boolean;
  getLastError: () => number;
}

let cachedApi: FindApi | null = null;

function loadApi(): FindApi {
  if (cachedApi) return cachedApi;
  const kernel32 = koffi.load('kernel32.dll');
  const FILETIME = koffi.struct('FILETIME', {
    dwLowDateTime: 'uint32',
    dwHighDateTime: 'uint32',
  });
  koffi.struct('WIN32_FIND_DATAW', {
    dwFileAttributes: 'uint32',
    ftCreationTime: FILETIME,
    ftLastAccessTime: FILETIME,
    ftLastWriteTime: FILETIME,
    nFileSizeHigh: 'uint32',
    nFileSizeLow: 'uint32',
    dwReserved0: 'uint32',
    dwReserved1: 'uint32',
    cFileName: koffi.array('char16_t', 260),
    cAlternateFileName: koffi.array('char16_t', 14),
  });
  cachedApi = {
    findFirst: kernel32.func(
      'void * __stdcall FindFirstFileW(const char16_t *lpFileName, _Out_ WIN32_FIND_DATAW *lpFindFileData)',
    ) as FindApi['findFirst'],
    findNext: kernel32.func(
      'bool __stdcall FindNextFileW(void *hFindFile, _Out_ WIN32_FIND_DATAW *lpFindFileData)',
    ) as FindApi['findNext'],
    findClose: kernel32.func('bool __stdcall FindClose(void *hFindFile)') as FindApi['findClose'],
    getLastError: kernel32.func('uint32 __stdcall GetLastError()') as FindApi['getLastError'],
  };
  return cachedApi;
}

function nativePattern(dir: string): string {
  const pattern = join(dir, '*');
  if (pattern.startsWith('\\\\?\\')) return pattern;
  if (pattern.startsWith('\\\\')) return `\\\\?\\UNC\\${pattern.slice(2)}`;
  return `\\\\?\\${pattern}`;
}

function fileTimeToUnixMs(time: FileTime): number {
  const ticks =
    BigInt(time.dwHighDateTime) * BigInt(WINDOWS_EPOCH_OFFSET) +
    BigInt(time.dwLowDateTime) -
    FILETIME_UNIX_EPOCH_DIFF_TICKS;
  const seconds = ticks / FILETIME_TICKS_PER_SECOND;
  const nanos = (ticks % FILETIME_TICKS_PER_SECOND) * FILETIME_TICKS_PER_100NS;
  return Number(seconds) * 1000 + Number(nanos) / 1e6;
}

function toEntry(data: FindData): Entry {
  const attributes = data.dwFileAttributes;
  if ((attributes & FILE_ATTRIBUTE_REPARSE_POINT) !== 0) {
    return { name: data.cFileName, kind: 'link', size: 0, mtimeMs: 0 };
  }
  if ((attributes & FILE_ATTRIBUTE_DIRECTORY) !== 0) {
    return { name: data.cFileName, kind: 'dir', size: 0, mtimeMs: 0 };
  }
  return {
    name: data.cFileName,
    kind: 'file',
    size: data.nFileSizeHigh * WINDOWS_EPOCH_OFFSET + data.nFileSizeLow,
    mtimeMs: fileTimeToUnixMs(data.ftLastWriteTime),
  };
}

export class WindowsFindEnumerator implements Enumerator {
  private readonly api = loadApi();

  list(dir: string): ListResult {
    const entries: Entry[] = [];
    let entryErrors = 0;
    const data: FindData = {
      dwFileAttributes: 0,
      ftCreationTime: { dwLowDateTime: 0, dwHighDateTime: 0 },
      ftLastAccessTime: { dwLowDateTime: 0, dwHighDateTime: 0 },
      ftLastWriteTime: { dwLowDateTime: 0, dwHighDateTime: 0 },
      nFileSizeHigh: 0,
      nFileSizeLow: 0,
      dwReserved0: 0,
      dwReserved1: 0,
      cFileName: '',
      cAlternateFileName: '',
    };

    const handle = this.api.findFirst(nativePattern(dir), data);
    if (koffi.address(handle) === INVALID_HANDLE_VALUE) {
      const code = this.api.getLastError();
      throw new Error(`FindFirstFileW failed for "${dir}" (Win32 error ${code})`);
    }

    try {
      for (;;) {
        if (data.cFileName !== '.' && data.cFileName !== '..') {
          entries.push(toEntry(data));
        }
        if (!this.api.findNext(handle, data)) {
          if (this.api.getLastError() !== ERROR_NO_MORE_FILES) entryErrors += 1;
          break;
        }
      }
    } finally {
      this.api.findClose(handle);
    }

    return { entries, entryErrors };
  }
}

// FILE_FULL_DIR_INFO, as returned by GetFileInformationByHandleEx. Offsets are
// fixed by the Win32 ABI; FileName is UTF-16 and not NUL-terminated.
const FULL_DIR_INFO = {
  nextEntryOffset: 0,
  lastWriteTime: 24,
  endOfFile: 40,
  allocationSize: 48,
  fileAttributes: 56,
  fileNameLength: 60,
  fileName: 68,
} as const;
const FILE_FULL_DIRECTORY_INFO_CLASS = 14;
const FILE_LIST_DIRECTORY = 0x1;
const FILE_SHARE_ALL = 0x7;
const OPEN_EXISTING = 3;
const FILE_FLAG_BACKUP_SEMANTICS = 0x0200_0000;
const DIR_BUFFER_BYTES = 64 * 1024;
interface DirInfoApi {
  createFile: (
    name: string,
    access: number,
    share: number,
    security: null,
    disposition: number,
    flags: number,
    template: null,
  ) => unknown;
  getInfo: (handle: unknown, infoClass: number, buffer: Buffer, size: number) => boolean;
  closeHandle: (handle: unknown) => boolean;
  getLastError: () => number;
}

let cachedDirInfoApi: DirInfoApi | null = null;

function loadDirInfoApi(): DirInfoApi {
  if (cachedDirInfoApi) return cachedDirInfoApi;
  const kernel32 = koffi.load('kernel32.dll');
  cachedDirInfoApi = {
    createFile: kernel32.func(
      'void * __stdcall CreateFileW(const char16_t *lpFileName, uint32 dwDesiredAccess, uint32 dwShareMode, void *lpSecurityAttributes, uint32 dwCreationDisposition, uint32 dwFlagsAndAttributes, void *hTemplateFile)',
    ) as DirInfoApi['createFile'],
    getInfo: kernel32.func(
      'bool __stdcall GetFileInformationByHandleEx(void *hFile, int FileInformationClass, void *lpFileInformation, uint32 dwBufferSize)',
    ) as DirInfoApi['getInfo'],
    closeHandle: kernel32.func('bool __stdcall CloseHandle(void *hObject)') as DirInfoApi['closeHandle'],
    getLastError: kernel32.func('uint32 __stdcall GetLastError()') as DirInfoApi['getLastError'],
  };
  return cachedDirInfoApi;
}

function nativeDirPath(dir: string): string {
  if (dir.startsWith('\\\\?\\')) return dir;
  if (dir.startsWith('\\\\')) return `\\\\?\\UNC\\${dir.slice(2)}`;
  return `\\\\?\\${dir}`;
}

// Batched directory listing: one FFI call returns a 64 KB page of entries
// (typically several hundred) instead of one FindNextFileW call per entry,
// and the page is decoded straight from the buffer without per-entry struct
// marshalling. It also reports the true on-disk allocation, which accounts
// for NTFS compression, sparse files, and files resident in the MFT.
export class WindowsDirInfoEnumerator implements Enumerator {
  private readonly api = loadDirInfoApi();
  private readonly buffer = Buffer.alloc(DIR_BUFFER_BYTES);

  constructor(private readonly clusterSize = DEFAULT_CLUSTER_SIZE) {}

  list(dir: string): ListResult {
    const handle = this.api.createFile(
      nativeDirPath(dir),
      FILE_LIST_DIRECTORY,
      FILE_SHARE_ALL,
      null,
      OPEN_EXISTING,
      FILE_FLAG_BACKUP_SEMANTICS,
      null,
    );
    if (koffi.address(handle) === INVALID_HANDLE_VALUE) {
      const code = this.api.getLastError();
      throw new Error(`CreateFileW failed for "${dir}" (Win32 error ${code})`);
    }

    const entries: Entry[] = [];
    let entryErrors = 0;
    const buffer = this.buffer;
    try {
      while (this.api.getInfo(handle, FILE_FULL_DIRECTORY_INFO_CLASS, buffer, DIR_BUFFER_BYTES)) {
        let offset = 0;
        for (;;) {
          const nameBytes = buffer.readUInt32LE(offset + FULL_DIR_INFO.fileNameLength);
          const nameStart = offset + FULL_DIR_INFO.fileName;
          const name = buffer.toString('utf16le', nameStart, nameStart + nameBytes);
          if (name !== '.' && name !== '..') {
            const attributes = buffer.readUInt32LE(offset + FULL_DIR_INFO.fileAttributes);
            if ((attributes & FILE_ATTRIBUTE_REPARSE_POINT) !== 0) {
              entries.push({ name, kind: 'link', size: 0, mtimeMs: 0 });
            } else if ((attributes & FILE_ATTRIBUTE_DIRECTORY) !== 0) {
              entries.push({ name, kind: 'dir', size: 0, mtimeMs: 0 });
            } else {
              const writeLow = buffer.readUInt32LE(offset + FULL_DIR_INFO.lastWriteTime);
              const writeHigh = buffer.readUInt32LE(offset + FULL_DIR_INFO.lastWriteTime + 4);
              entries.push({
                name,
                kind: 'file',
                size:
                  buffer.readUInt32LE(offset + FULL_DIR_INFO.endOfFile + 4) * WINDOWS_EPOCH_OFFSET +
                  buffer.readUInt32LE(offset + FULL_DIR_INFO.endOfFile),
                mtimeMs: fileTimePartsToUnixMs(writeLow, writeHigh),
                allocated: clusterAllocation(
                  buffer.readUInt32LE(offset + FULL_DIR_INFO.allocationSize + 4) * WINDOWS_EPOCH_OFFSET +
                    buffer.readUInt32LE(offset + FULL_DIR_INFO.allocationSize),
                  this.clusterSize,
                ),
              });
            }
          }
          const next = buffer.readUInt32LE(offset + FULL_DIR_INFO.nextEntryOffset);
          if (next === 0) break;
          offset += next;
        }
      }
      if (this.api.getLastError() !== ERROR_NO_MORE_FILES) entryErrors += 1;
    } finally {
      this.api.closeHandle(handle);
    }

    return { entries, entryErrors };
  }
}

export function createPlatformEnumerator(clusterSize?: number): Enumerator {
  if (process.platform !== 'win32') return new NodeFsEnumerator();
  if (process.env.DUST_ENUMERATOR === 'node') return new NodeFsEnumerator();
  if (process.env.DUST_ENUMERATOR === 'find') {
    try {
      return new WindowsFindEnumerator();
    } catch {
      return new NodeFsEnumerator();
    }
  }
  try {
    return new WindowsDirInfoEnumerator(clusterSize);
  } catch {
    try {
      return new WindowsFindEnumerator();
    } catch {
      return new NodeFsEnumerator();
    }
  }
}
