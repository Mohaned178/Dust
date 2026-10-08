import koffi from 'koffi';

interface VersionApi {
  size: (path: string, handle: number[] | null) => number;
  read: (path: string, handle: number, length: number, data: Buffer) => boolean;
  query: (block: Buffer, subBlock: string, value: unknown[], length: number[]) => boolean;
}

let cachedApi: VersionApi | null = null;

function loadApi(): VersionApi | null {
  if (process.platform !== 'win32') return null;
  if (cachedApi) return cachedApi;
  try {
    const version = koffi.load('version.dll');
    cachedApi = {
      size: version.func(
        'uint32 __stdcall GetFileVersionInfoSizeW(const char16_t *lptstrFilename, _Out_ uint32 *lpdwHandle)',
      ) as VersionApi['size'],
      read: version.func(
        'bool __stdcall GetFileVersionInfoW(const char16_t *lptstrFilename, uint32 dwHandle, uint32 dwLen, _Out_ void *lpData)',
      ) as VersionApi['read'],
      query: version.func(
        'bool __stdcall VerQueryValueW(const void *pBlock, const char16_t *lpSubBlock, _Out_ void **lplpBuffer, _Out_ uint32 *puLen)',
      ) as VersionApi['query'],
    };
  } catch {
    return null;
  }
  return cachedApi;
}

const FALLBACK_LANGUAGES = ['040904B0', '040904E4', '04090000'];

function hex4(value: number): string {
  return value.toString(16).toUpperCase().padStart(4, '0');
}

function queryString(api: VersionApi, block: Buffer, subBlock: string): string | null {
  const value: unknown[] = [null];
  const length = [0];
  if (!api.query(block, subBlock, value, length) || value[0] === null || length[0] === 0) return null;
  const text = koffi.decode(value[0], 'char16_t', Number(length[0]));
  const end = text.indexOf('\0');
  const trimmed = (end === -1 ? text : text.slice(0, end)).trim();
  return trimmed.length > 0 ? trimmed : null;
}

function translations(api: VersionApi, block: Buffer): string[] {
  const value: unknown[] = [null];
  const length = [0];
  if (!api.query(block, '\\VarFileInfo\\Translation', value, length) || value[0] === null) return [];
  const pairs = Math.floor(Number(length[0]) / 4);
  if (pairs === 0) return [];
  const words = koffi.decode(value[0], 'uint16_t', pairs * 2) as number[];
  const out: string[] = [];
  for (let i = 0; i < pairs; i += 1) out.push(`${hex4(words[i * 2]!)}${hex4(words[i * 2 + 1]!)}`);
  return out;
}

function readCompanyName(api: VersionApi, path: string): string | null {
  const size = api.size(path, [0]);
  if (size === 0) return null;
  const block = Buffer.alloc(size);
  if (!api.read(path, 0, size, block)) return null;
  for (const language of [...translations(api, block), ...FALLBACK_LANGUAGES]) {
    const company = queryString(api, block, `\\StringFileInfo\\${language}\\CompanyName`);
    if (company !== null) return company;
  }
  return null;
}

/** The CompanyName of a file's version resource; null when absent or unreadable. */
export function readFileCompanyName(path: string): string | null {
  const api = loadApi();
  if (api === null) return null;
  try {
    return readCompanyName(api, path);
  } catch {
    return null;
  }
}

/** Company names keyed by the given paths; null when the native API is unavailable. */
export function readFileCompanyNames(paths: string[]): Map<string, string> | null {
  const api = loadApi();
  if (api === null) return null;
  const names = new Map<string, string>();
  for (const path of paths) {
    try {
      const company = readCompanyName(api, path);
      if (company !== null) names.set(path, company);
    } catch {
      continue;
    }
  }
  return names;
}
