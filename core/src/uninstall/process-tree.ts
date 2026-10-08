import koffi from 'koffi';

// Tracks an uninstaller's whole process tree. NSIS and Inno Setup uninstallers
// copy themselves to %TEMP%, relaunch from there (Au_.exe, _iu14D2N.tmp), and
// exit at once; waiting on the spawned process alone reports "finished" while
// the real wizard is still on screen.

export interface ProcessEntry {
  pid: number;
  ppid: number;
  name: string;
}

interface ProcessEntryStruct {
  dwSize: number;
  th32ProcessID: number;
  th32ParentProcessID: number;
  szExeFile: string;
}

interface ToolhelpApi {
  snapshot: (flags: number, pid: number) => unknown;
  first: (handle: unknown, entry: ProcessEntryStruct) => boolean;
  next: (handle: unknown, entry: ProcessEntryStruct) => boolean;
  close: (handle: unknown) => boolean;
  entrySize: number;
}

const TH32CS_SNAPPROCESS = 0x2;
const INVALID_HANDLE_VALUE = 0xffff_ffff_ffff_ffffn;

// Processes an uninstaller commonly opens on its way out (a feedback page in
// the browser, an Explorer window) that are not part of the uninstall itself.
const UNTRACKED_NAMES = new Set([
  'chrome.exe',
  'msedge.exe',
  'firefox.exe',
  'opera.exe',
  'brave.exe',
  'iexplore.exe',
  'explorer.exe',
  'conhost.exe',
]);

let cachedApi: ToolhelpApi | null = null;

function loadApi(): ToolhelpApi {
  if (cachedApi) return cachedApi;
  const kernel32 = koffi.load('kernel32.dll');
  const struct = koffi.struct('PROCESSENTRY32W', {
    dwSize: 'uint32',
    cntUsage: 'uint32',
    th32ProcessID: 'uint32',
    th32DefaultHeapID: 'uintptr_t',
    th32ModuleID: 'uint32',
    cntThreads: 'uint32',
    th32ParentProcessID: 'uint32',
    pcPriClassBase: 'int32',
    dwFlags: 'uint32',
    szExeFile: koffi.array('char16_t', 260),
  });
  cachedApi = {
    snapshot: kernel32.func(
      'void * __stdcall CreateToolhelp32Snapshot(uint32 dwFlags, uint32 th32ProcessID)',
    ) as ToolhelpApi['snapshot'],
    first: kernel32.func(
      'bool __stdcall Process32FirstW(void *hSnapshot, _Inout_ PROCESSENTRY32W *lppe)',
    ) as ToolhelpApi['first'],
    next: kernel32.func(
      'bool __stdcall Process32NextW(void *hSnapshot, _Inout_ PROCESSENTRY32W *lppe)',
    ) as ToolhelpApi['next'],
    close: kernel32.func('bool __stdcall CloseHandle(void *hObject)') as ToolhelpApi['close'],
    entrySize: koffi.sizeof(struct),
  };
  return cachedApi;
}

/** Every running process with its parent; null when the snapshot is unavailable. */
export function listProcesses(): ProcessEntry[] | null {
  if (process.platform !== 'win32') return null;
  let api: ToolhelpApi;
  try {
    api = loadApi();
  } catch {
    return null;
  }
  const handle = api.snapshot(TH32CS_SNAPPROCESS, 0);
  if (koffi.address(handle) === INVALID_HANDLE_VALUE) return null;
  const out: ProcessEntry[] = [];
  try {
    const entry: ProcessEntryStruct = {
      dwSize: api.entrySize,
      th32ProcessID: 0,
      th32ParentProcessID: 0,
      szExeFile: '',
    };
    let more = api.first(handle, entry);
    while (more) {
      out.push({ pid: entry.th32ProcessID, ppid: entry.th32ParentProcessID, name: entry.szExeFile });
      entry.dwSize = api.entrySize;
      more = api.next(handle, entry);
    }
  } finally {
    api.close(handle);
  }
  return out;
}

/**
 * Follows the descendants of a root process across snapshots. A child is
 * adopted as soon as it is seen with a tracked parent, even after that parent
 * has exited, so a relaunch-and-exit hand-off is never lost.
 */
export class ProcessTreeTracker {
  private readonly tracked = new Set<number>();
  // Tracked processes seen gone. Kept so a late-seen child still finds its
  // parent, but never alive again: a reused PID is a different process.
  private readonly exited = new Set<number>();

  constructor(rootPid: number) {
    this.tracked.add(rootPid);
  }

  /** Updates from a snapshot; true while any tracked process is still running. */
  update(processes: readonly ProcessEntry[]): boolean {
    const present = new Set(processes.map((entry) => entry.pid));
    for (const pid of this.tracked) {
      if (!present.has(pid)) this.exited.add(pid);
    }
    let grew = true;
    while (grew) {
      grew = false;
      for (const entry of processes) {
        if (this.tracked.has(entry.pid) || !this.tracked.has(entry.ppid)) continue;
        if (UNTRACKED_NAMES.has(entry.name.toLowerCase())) continue;
        this.tracked.add(entry.pid);
        grew = true;
      }
    }
    return processes.some((entry) => this.tracked.has(entry.pid) && !this.exited.has(entry.pid));
  }
}
