import koffi from 'koffi';

export type RegistryHive = 'HKLM' | 'HKCU';

export type RegistryValueType = 'string' | 'expand-string' | 'multi-string' | 'dword' | 'qword' | 'binary' | 'other';

export interface RegistryValue {
  type: RegistryValueType;
  value: string | number | string[] | Buffer;
  /** The unexpanded text of an `expand-string` value. */
  raw?: string;
}

export class RegistryUnavailableError extends Error {
  constructor(message = 'The native registry API is not available') {
    super(message);
    this.name = 'RegistryUnavailableError';
  }
}

const HIVES: Record<RegistryHive, bigint> = {
  HKCU: 0xffff_ffff_8000_0001n,
  HKLM: 0xffff_ffff_8000_0002n,
};

const KEY_READ = 0x20019;
const KEY_WOW64_64KEY = 0x100;
const ERROR_SUCCESS = 0;
const ERROR_FILE_NOT_FOUND = 2;
const ERROR_PATH_NOT_FOUND = 3;
const ERROR_ACCESS_DENIED = 5;
const ERROR_MORE_DATA = 234;
const ERROR_NO_MORE_ITEMS = 259;

const REG_NONE = 0;
const REG_SZ = 1;
const REG_EXPAND_SZ = 2;
const REG_BINARY = 3;
const REG_DWORD = 4;
const REG_MULTI_SZ = 7;
const REG_QWORD = 11;

const MAX_VALUE_NAME_CHARS = 16_384;

interface RegistryApi {
  open: (hive: bigint, path: string, options: number, sam: number, result: number[]) => number;
  close: (key: number) => number;
  queryInfo: (
    key: number,
    cls: null,
    clsLen: null,
    reserved: null,
    subKeys: number[],
    maxSubKey: number[],
    maxClass: null,
    values: number[],
    maxValueName: number[],
    maxValueData: number[],
    security: null,
    lastWrite: null,
  ) => number;
  enumValue: (
    key: number,
    index: number,
    name: Buffer,
    nameLength: number[],
    reserved: null,
    type: number[],
    data: Buffer,
    dataLength: number[],
  ) => number;
  enumKey: (
    key: number,
    index: number,
    name: Buffer,
    nameLength: number[],
    reserved: null,
    cls: null,
    clsLength: null,
    lastWrite: null,
  ) => number;
  expand: (source: string, target: Buffer | null, size: number) => number;
}

let cachedApi: RegistryApi | null = null;

function loadApi(): RegistryApi {
  if (process.platform !== 'win32') throw new RegistryUnavailableError('The registry is only available on Windows');
  if (cachedApi) return cachedApi;
  try {
    const advapi32 = koffi.load('advapi32.dll');
    const kernel32 = koffi.load('kernel32.dll');
    cachedApi = {
      open: advapi32.func(
        'int32 __stdcall RegOpenKeyExW(uintptr_t hKey, const char16_t *lpSubKey, uint32 ulOptions, uint32 samDesired, _Out_ uintptr_t *phkResult)',
      ) as RegistryApi['open'],
      close: advapi32.func('int32 __stdcall RegCloseKey(uintptr_t hKey)') as RegistryApi['close'],
      queryInfo: advapi32.func(
        'int32 __stdcall RegQueryInfoKeyW(uintptr_t hKey, void *lpClass, void *lpcchClass, void *lpReserved, _Out_ uint32 *lpcSubKeys, _Out_ uint32 *lpcbMaxSubKeyLen, void *lpcbMaxClassLen, _Out_ uint32 *lpcValues, _Out_ uint32 *lpcbMaxValueNameLen, _Out_ uint32 *lpcbMaxValueLen, void *lpcbSecurityDescriptor, void *lpftLastWriteTime)',
      ) as RegistryApi['queryInfo'],
      enumValue: advapi32.func(
        'int32 __stdcall RegEnumValueW(uintptr_t hKey, uint32 dwIndex, _Out_ void *lpValueName, _Inout_ uint32 *lpcchValueName, void *lpReserved, _Out_ uint32 *lpType, _Out_ void *lpData, _Inout_ uint32 *lpcbData)',
      ) as RegistryApi['enumValue'],
      enumKey: advapi32.func(
        'int32 __stdcall RegEnumKeyExW(uintptr_t hKey, uint32 dwIndex, _Out_ void *lpName, _Inout_ uint32 *lpcchName, void *lpReserved, void *lpClass, void *lpcchClass, void *lpftLastWriteTime)',
      ) as RegistryApi['enumKey'],
      expand: kernel32.func(
        'uint32 __stdcall ExpandEnvironmentStringsW(const char16_t *lpSrc, _Out_ void *lpDst, uint32 nSize)',
      ) as RegistryApi['expand'],
    };
  } catch (error) {
    throw new RegistryUnavailableError(error instanceof Error ? error.message : String(error));
  }
  return cachedApi;
}

function cutAtNul(text: string): string {
  const end = text.indexOf('\0');
  return end === -1 ? text : text.slice(0, end);
}

function decodeText(data: Buffer): string {
  return cutAtNul(data.toString('utf16le', 0, data.length - (data.length % 2)));
}

function expandEnvironment(api: RegistryApi, text: string): string {
  if (!text.includes('%')) return text;
  let capacity = Math.max(text.length * 2 + 64, 512);
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const target = Buffer.alloc(capacity * 2);
    const needed = api.expand(text, target, capacity);
    if (needed === 0) return text;
    if (needed <= capacity) return cutAtNul(target.toString('utf16le', 0, needed * 2));
    capacity = needed;
  }
  return text;
}

function decodeValue(api: RegistryApi, type: number, data: Buffer): RegistryValue {
  switch (type) {
    case REG_SZ:
      return { type: 'string', value: decodeText(data) };
    case REG_EXPAND_SZ: {
      const raw = decodeText(data);
      return { type: 'expand-string', value: expandEnvironment(api, raw), raw };
    }
    case REG_MULTI_SZ: {
      const parts = data.toString('utf16le', 0, data.length - (data.length % 2)).split('\0');
      const end = parts.indexOf('');
      return { type: 'multi-string', value: end === -1 ? parts : parts.slice(0, end) };
    }
    case REG_DWORD:
      if (data.length >= 4) return { type: 'dword', value: data.readUInt32LE(0) };
      return { type: 'other', value: data };
    case REG_QWORD:
      if (data.length >= 8) return { type: 'qword', value: Number(data.readBigUInt64LE(0)) };
      return { type: 'other', value: data };
    case REG_NONE:
    case REG_BINARY:
      return { type: 'binary', value: data };
    default:
      return { type: 'other', value: data };
  }
}

interface KeyInfo {
  subKeys: number;
  maxSubKeyChars: number;
  values: number;
  maxValueNameChars: number;
  maxValueBytes: number;
}

function openKey(api: RegistryApi, hive: RegistryHive, path: string): number | null {
  const result = [0];
  const status = api.open(HIVES[hive], path, 0, KEY_READ | KEY_WOW64_64KEY, result);
  if (status === ERROR_SUCCESS) return Number(result[0]);
  if (status === ERROR_FILE_NOT_FOUND || status === ERROR_PATH_NOT_FOUND || status === ERROR_ACCESS_DENIED) {
    return null;
  }
  throw new Error(`RegOpenKeyExW failed for ${hive}\\${path} (${status})`);
}

function queryInfo(api: RegistryApi, key: number): KeyInfo {
  const subKeys = [0];
  const maxSubKey = [0];
  const values = [0];
  const maxValueName = [0];
  const maxValueData = [0];
  const status = api.queryInfo(
    key,
    null,
    null,
    null,
    subKeys,
    maxSubKey,
    null,
    values,
    maxValueName,
    maxValueData,
    null,
    null,
  );
  if (status !== ERROR_SUCCESS) throw new Error(`RegQueryInfoKeyW failed (${status})`);
  return {
    subKeys: Number(subKeys[0]),
    maxSubKeyChars: Number(maxSubKey[0]),
    values: Number(values[0]),
    maxValueNameChars: Number(maxValueName[0]),
    maxValueBytes: Number(maxValueData[0]),
  };
}

function withKey<T>(hive: RegistryHive, path: string, read: (api: RegistryApi, key: number) => T): T | null {
  const api = loadApi();
  const key = openKey(api, hive, path);
  if (key === null) return null;
  try {
    return read(api, key);
  } finally {
    api.close(key);
  }
}

function readAllValues(api: RegistryApi, key: number): Map<string, RegistryValue> {
  const info = queryInfo(api, key);
  const values = new Map<string, RegistryValue>();
  let nameCapacity = info.maxValueNameChars + 1;
  let dataCapacity = Math.max(info.maxValueBytes, 2);
  let index = 0;
  while (true) {
    const name = Buffer.alloc(nameCapacity * 2);
    const data = Buffer.alloc(dataCapacity);
    const nameLength = [nameCapacity];
    const dataLength = [dataCapacity];
    const type = [0];
    const status = api.enumValue(key, index, name, nameLength, null, type, data, dataLength);
    if (status === ERROR_NO_MORE_ITEMS) break;
    if (status === ERROR_MORE_DATA) {
      nameCapacity = Math.min(Math.max(nameCapacity * 2, Number(nameLength[0]) + 1), MAX_VALUE_NAME_CHARS);
      dataCapacity = Math.max(dataCapacity * 2, Number(dataLength[0]), 2);
      continue;
    }
    if (status !== ERROR_SUCCESS) throw new Error(`RegEnumValueW failed (${status})`);
    const valueName = name.toString('utf16le', 0, Number(nameLength[0]) * 2);
    const bytes = Buffer.from(data.subarray(0, Number(dataLength[0])));
    values.set(valueName, decodeValue(api, Number(type[0]), bytes));
    index += 1;
  }
  return values;
}

function readAllSubkeys(api: RegistryApi, key: number): string[] {
  const info = queryInfo(api, key);
  const names: string[] = [];
  let capacity = info.maxSubKeyChars + 1;
  let index = 0;
  while (true) {
    const name = Buffer.alloc(capacity * 2);
    const length = [capacity];
    const status = api.enumKey(key, index, name, length, null, null, null, null);
    if (status === ERROR_NO_MORE_ITEMS) break;
    if (status === ERROR_MORE_DATA) {
      capacity = Math.max(capacity * 2, Number(length[0]) + 1);
      continue;
    }
    if (status !== ERROR_SUCCESS) throw new Error(`RegEnumKeyExW failed (${status})`);
    names.push(name.toString('utf16le', 0, Number(length[0]) * 2));
    index += 1;
  }
  return names;
}

/**
 * Every value of a key, in registry order; null when the key is missing or
 * unreadable. Throws RegistryUnavailableError when the native API cannot load.
 */
export function readRegistryValues(hive: RegistryHive, path: string): Map<string, RegistryValue> | null {
  return withKey(hive, path, readAllValues);
}

/** Subkey names of a key; same semantics as readRegistryValues. */
export function listRegistrySubkeys(hive: RegistryHive, path: string): string[] | null {
  return withKey(hive, path, readAllSubkeys);
}

/** PowerShell's `[string]$value`: arrays are joined with a space. */
export function registryValueToString(value: RegistryValue | undefined): string {
  if (value === undefined) return '';
  switch (value.type) {
    case 'string':
    case 'expand-string':
      return value.value as string;
    case 'dword':
    case 'qword':
      return String(value.value);
    case 'multi-string':
      return (value.value as string[]).join(' ');
    default:
      return Array.from(value.value as Buffer).join(' ');
  }
}

/** PowerShell's `[bool]$value` for a possibly missing property. */
export function registryValueToBool(value: RegistryValue | undefined): boolean {
  if (value === undefined) return false;
  switch (value.type) {
    case 'string':
    case 'expand-string':
      return (value.value as string).length > 0;
    case 'dword':
    case 'qword':
      return value.value !== 0;
    case 'multi-string':
      return (value.value as string[]).length > 0;
    default: {
      const bytes = value.value as Buffer;
      return bytes.length === 1 ? bytes[0] !== 0 : bytes.length > 0;
    }
  }
}
