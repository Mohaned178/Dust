import { join } from 'node:path';
import koffi from 'koffi';
import type { Entry } from '../model/types';
import { NodeFsEnumerator, type Enumerator, type ListResult } from './enumerator';

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

export function createPlatformEnumerator(): Enumerator {
  if (process.platform !== 'win32') return new NodeFsEnumerator();
  if (process.env.DUST_ENUMERATOR === 'node') return new NodeFsEnumerator();
  try {
    return new WindowsFindEnumerator();
  } catch {
    return new NodeFsEnumerator();
  }
}
