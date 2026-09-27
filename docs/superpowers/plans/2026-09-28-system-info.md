# System Info Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship a read-only System Info page — a captured OS/CPU/GPU/firmware snapshot plus live CPU and memory usage, with a copyable plain-text report — without hardcoding any hardware, without elevation, and without writing anything to disk.

**Architecture:** A new pure-TypeScript `core/src/system/system-info.ts` owns the batched PowerShell/WMI query, the parser, Node `os` fallbacks, and the live CPU/memory readers. A cached host service (`app/src/main/host/system-info.ts`) wraps the static load with a 5-minute TTL + in-flight de-duplication and computes live values on every call. Two IPC channels (`systemInfoGet`, `systemInfoLive`) expose it through `EngineHost` → preload → `window.dust`. The renderer gets a formatting module (`app/renderer/src/system-info.ts`) and a `SystemInfoView` page wired into the existing sidebar slot that already advertises "System Info — Soon".

**Tech Stack:** TypeScript, Node `os` + `child_process.execFile`, Windows PowerShell 5.1 + `Get-CimInstance` (one batched spawn), Electron 44 typed IPC, React 19, Tailwind 4, Vitest 3 (core Node, app host Node, app renderer jsdom).

**Spec:** Design settled in review on 2026-09-27. There is no separate spec document; the authoritative requirements are the **Decisions from review** and **Global Constraints** sections below, and the code blocks in each task.

## Global Constraints

- Node `^20.19.0 || >=22.12.0`; npm workspaces `core` and `app`; do not add dependencies.
- Run `npm run typecheck -w core && npm run typecheck -w app` and the relevant workspace tests before every commit.
- TDD: write the failing test, watch it fail for the right reason, then implement minimally and watch it pass.
- **No hardcoded hardware names anywhere.** No CPU/GPU/motherboard/vendor name lists, and no name-based filtering. If the machine reports "Microsoft Basic Display Adapter", render it. Structural filtering is not needed in v1.
- **Read-only. No elevation.** Never call the elevation flow (`relaunchElevated`) from System Info. If a query would need admin, it is out of scope.
- **No hardware data on disk.** In-memory cache only; the snapshot store is for scans only.
- **Live values are never cached.** CPU % and RAM are recomputed on every `systemInfoLive` call. Static snapshot TTL is 5 minutes (matches `INSTALLED_APPS_TTL_MS`).
- **Nullable end-to-end.** Missing data omits the row; it never renders "Unknown". Whole-query failure renders the Node-sourced data plus the exact notice `Hardware details unavailable on this machine.`
- **Excluded in v1:** VRAM (`AdapterRAM` lies above 4 GB), CPU clock speed (`os.cpus()[0].speed` is stale/0 in VMs), temperatures, fan speeds, SMART/disk serials, network adapters/IPs, battery, storage (Dashboard and Drives already own it). Do not render "as reported" qualifiers.
- **Copy output must contain no serial numbers, no MAC addresses, no IP addresses, no product IDs.**
- Machine data renders in `font-mono`; chrome in system sans; one accent (Pine Teal); no green/amber/red outside deletion grades.
- Windows-first: the real PowerShell path only runs on `win32`; non-Windows degrades to Node data with `hardwareAvailable: false`.
- `os.uptime()` returns **seconds**; the model stores `uptimeMs`. `os.freemem()` is "available" memory (includes standby) — label it accordingly in copy as "used".
- Renderer accessible names and exact copy asserted by existing tests are contracts; do not change them unless a task says so.

## Decisions from review (authoritative)

1. **Hybrid page.** Live cluster (auto-refresh 1–2 s while mounted): CPU usage %, RAM used/available. Static snapshot (captured once, **Refresh** button): OS name/version/build/UBR/arch; hostname; uptime; CPU model/physical cores/logical threads; GPU model + driver version (all adapters); motherboard/BIOS if they ride the same spawn. Show a "Captured HH:MM" timestamp. Live values never cached.
2. **Storage excluded entirely.** No disk space, no physical disk identity. Users click **Drives**.
3. **Motherboard/BIOS included** because they are free in the same batched PowerShell spawn; if parsing them proved non-trivial we would defer — it does not.
4. **Copy System Info ships in v1** with this exact format (lines/sections omitted when data is missing):
   ```
   Dust System Info
   Captured: 2026-09-27 14:32

   OS: Windows 11 Pro 23H2 (Build 22631.4169)
   Arch: x64
   Hostname: dev-machine
   Uptime: 2d 4h

   CPU: AMD Ryzen 7 5800X (8 cores / 16 threads)
   RAM: 32 GB total · 18.4 GB used

   GPU: NVIDIA GeForce RTX 4070 (Driver 560.94)
   GPU: AMD Radeon Graphics (Driver 31.0.21914.1001)

   Motherboard: ASUS ROG STRIX B550-F
   BIOS: 2803 (2023-04-12)
   ```
   `navigator.clipboard.writeText`; toast `System info copied.`
5. **VRAM and CPU speed omitted.** A wrong number is worse than a missing one.

Verified against the real machine during planning (2026-09-27):

- The batched script ran in ~1.5 s and returned `{"os":{"productName":"Windows 10 Pro","displayVersion":"25H2","currentBuild":"26200","ubr":9457},"cpu":[...],"gpus":[...],"board":{...},"bios":{...}}`.
- `gpus`/`cpu` came back as arrays even with one element (`ConvertTo-Json -InputObject` + `@()`); `board`/`bios` came back as single objects. The parser must accept both shapes.
- The registry `ProductName` says **"Windows 10 Pro" on Windows 11 build 26200** — the known stale-registry quirk. `os.version()` correctly returned **"Windows 11 Pro"** on the same machine, so the display name comes from `os.version()`, never from the registry `ProductName`. This is why `ProductName` is not even queried.
- CPU `Name` arrives with trailing whitespace (`"AMD Ryzen 5 5500                               "`); every string must be trimmed.

## File structure

| File | Responsibility |
| --- | --- |
| `core/src/system/system-info.ts` (create) | Types, `SYSTEM_INFO_SCRIPT`, parser, arch maps, static assembly with Node fallbacks, live CPU/memory readers |
| `core/src/index.ts` (modify) | Barrel exports for the new surface |
| `core/test/system-info.test.ts` (create) | Parser, assembly, live-sampler unit tests |
| `core/test/system-info-smoke.test.ts` (create) | Real PowerShell smoke test, skipped off Windows |
| `app/src/main/host/system-info.ts` (create) | Cached static service + uncached live sampling |
| `app/test/system-info-host.test.ts` (create) | TTL, force, invalidate, in-flight, no-live-cache tests |
| `app/src/main/host/engine-host.ts` (modify) | `EngineHostDeps.systemInfo`, `getSystemInfo`, `getSystemInfoLive` |
| `app/src/shared/ipc.ts` (modify) | Two channels, type re-exports, `DustApi` methods |
| `app/src/main/ipc.ts` (modify) | Handler registration |
| `app/src/preload/index.ts` (modify) | Bridge wiring |
| `app/test/ipc-contract.test.ts` (modify) | Channel count 18 → 20 |
| `app/test/ipc.test.ts` (modify) | Channel routing test |
| `app/renderer/src/system-info.ts` (create) | Uptime/captured-at/board/BIOS/copy-text formatting |
| `app/test/renderer/system-info-format.test.ts` (create) | Pure formatting tests, exact copy block |
| `app/renderer/src/pages/SystemInfoView.tsx` (create) | The page: live tiles, sections, Refresh, Copy, toast |
| `app/test/renderer/system-info-view.test.tsx` (create) | Page behavior tests |
| `app/test/renderer/fakes.ts` (modify) | `makeSystemInfo`, `makeSystemInfoLive`, `makeApi` additions |
| `app/renderer/src/components/Sidebar.tsx` (modify) | `system-info` nav item; remove from coming-soon |
| `app/renderer/src/App.tsx` (modify) | Route the page |
| `app/test/renderer/sidebar.test.tsx` (modify) | Nav/coming-soon assertions |
| `app/test/renderer/app.test.tsx` (modify) | Routing test |
| `README.md`, `PROJECT_BRIEF.md`, `app/DESIGN.md` (modify) | Feature docs, smoke checklist, stale coming-soon example |

---

### Task 1: Core parser and script

**Files:**
- Create: `core/src/system/system-info.ts`
- Test: `core/test/system-info.test.ts` (create)

**Interfaces:**
- Produces: `SYSTEM_INFO_SCRIPT: string`; `ParsedSystemInfo`; `parseSystemInfoJson(raw: string): ParsedSystemInfo | null`; `mapProcessorArchitecture(value: number | null): string | null`; `normalizeOsArch(raw: string): string | null`; types `SystemInfoGpu`, `SystemInfoOs`, `SystemInfoCpu`, `SystemInfoBoard`, `SystemInfoBios`, `SystemInfoStatic`, `SystemInfoLive`.
- Consumes: nothing.

- [ ] **Step 1: Write the failing parser tests**

Create `core/test/system-info.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import {
  SYSTEM_INFO_SCRIPT,
  mapProcessorArchitecture,
  normalizeOsArch,
  parseSystemInfoJson,
} from '../src/system/system-info';

const FULL_FIXTURE = JSON.stringify({
  os: { displayVersion: '25H2', currentBuild: '26200', ubr: 9457 },
  cpu: [
    {
      Name: 'AMD Ryzen 5 5500                               ',
      NumberOfCores: 6,
      NumberOfLogicalProcessors: 12,
      Architecture: 9,
    },
  ],
  gpus: [{ Name: 'NVIDIA GeForce RTX 4060', DriverVersion: '32.0.16.1714' }],
  board: {
    Manufacturer: 'Micro-Star International Co., Ltd.',
    Product: 'B450M-A PRO MAX II (MS-7C52)',
  },
  bios: { SMBIOSBIOSVersion: 'A.10', ReleaseDate: '2023-10-26' },
});

describe('parseSystemInfoJson', () => {
  it('maps a full batch, trims values and joins the build', () => {
    expect(parseSystemInfoJson(FULL_FIXTURE)).toEqual({
      displayVersion: '25H2',
      build: '26200.9457',
      architecture: 9,
      cpuModel: 'AMD Ryzen 5 5500',
      physicalCores: 6,
      logicalThreads: 12,
      gpus: [{ name: 'NVIDIA GeForce RTX 4060', driverVersion: '32.0.16.1714' }],
      board: {
        manufacturer: 'Micro-Star International Co., Ltd.',
        product: 'B450M-A PRO MAX II (MS-7C52)',
      },
      bios: { version: 'A.10', date: '2023-10-26' },
    });
  });

  it('accepts single objects where arrays are expected', () => {
    const parsed = parseSystemInfoJson(
      JSON.stringify({
        cpu: { Name: 'CPU', NumberOfCores: 2, NumberOfLogicalProcessors: 4, Architecture: 0 },
        gpus: { Name: 'Adapter', DriverVersion: null },
      }),
    );
    expect(parsed?.cpuModel).toBe('CPU');
    expect(parsed?.architecture).toBe(0);
    expect(parsed?.gpus).toEqual([{ name: 'Adapter', driverVersion: null }]);
  });

  it('sums cores across sockets and drops empty GPU entries', () => {
    const parsed = parseSystemInfoJson(
      JSON.stringify({
        cpu: [
          { Name: 'Xeon', NumberOfCores: 8, NumberOfLogicalProcessors: 16 },
          { Name: 'Xeon', NumberOfCores: 8, NumberOfLogicalProcessors: 16 },
        ],
        gpus: [{ Name: '  ' }, { Name: 'Real GPU', DriverVersion: '' }],
      }),
    );
    expect(parsed?.physicalCores).toBe(16);
    expect(parsed?.logicalThreads).toBe(32);
    expect(parsed?.gpus).toEqual([{ name: 'Real GPU', driverVersion: null }]);
  });

  it('returns nulls for missing sections instead of inventing values', () => {
    expect(parseSystemInfoJson('{}')).toEqual({
      displayVersion: null,
      build: null,
      architecture: null,
      cpuModel: null,
      physicalCores: null,
      logicalThreads: null,
      gpus: [],
      board: null,
      bios: null,
    });
  });

  it('returns null for malformed or empty output', () => {
    expect(parseSystemInfoJson('')).toBeNull();
    expect(parseSystemInfoJson('not json')).toBeNull();
    expect(parseSystemInfoJson('[]')).toBeNull();
    expect(parseSystemInfoJson('null')).toBeNull();
  });
});

describe('architecture mapping', () => {
  it('maps CIM processor architecture codes and tolerates unknown codes', () => {
    expect(mapProcessorArchitecture(0)).toBe('x86');
    expect(mapProcessorArchitecture(5)).toBe('ARM');
    expect(mapProcessorArchitecture(9)).toBe('x64');
    expect(mapProcessorArchitecture(12)).toBe('ARM64');
    expect(mapProcessorArchitecture(1)).toBeNull();
    expect(mapProcessorArchitecture(null)).toBeNull();
  });

  it('normalizes Node arch strings for the fallback path', () => {
    expect(normalizeOsArch('ia32')).toBe('x86');
    expect(normalizeOsArch('x64')).toBe('x64');
    expect(normalizeOsArch('arm64')).toBe('ARM64');
    expect(normalizeOsArch('  ')).toBeNull();
  });
});

describe('SYSTEM_INFO_SCRIPT', () => {
  it('reads only the agreed sources and never touches identifiers', () => {
    expect(SYSTEM_INFO_SCRIPT).toContain('Win32_Processor');
    expect(SYSTEM_INFO_SCRIPT).toContain('Win32_VideoController');
    expect(SYSTEM_INFO_SCRIPT).toContain('Win32_BaseBoard');
    expect(SYSTEM_INFO_SCRIPT).toContain('Win32_BIOS');
    expect(SYSTEM_INFO_SCRIPT).not.toContain('Win32_PhysicalMemory');
    expect(SYSTEM_INFO_SCRIPT).not.toContain('AdapterRAM');
    expect(SYSTEM_INFO_SCRIPT).not.toContain('SerialNumber');
    expect(SYSTEM_INFO_SCRIPT).not.toContain('ProductName');
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm run test -w core -- test/system-info.test.ts`
Expected: FAIL — `Cannot find module '../src/system/system-info'`.

- [ ] **Step 3: Implement the module**

Create `core/src/system/system-info.ts`:

```ts
import { execFile } from 'node:child_process';
import { existsSync } from 'node:fs';
import * as os from 'node:os';

export interface SystemInfoGpu {
  name: string;
  driverVersion: string | null;
}

export interface SystemInfoOs {
  name: string | null;
  version: string | null;
  build: string | null;
  arch: string | null;
}

export interface SystemInfoCpu {
  model: string;
  physicalCores: number | null;
  logicalThreads: number | null;
}

export interface SystemInfoBoard {
  manufacturer: string | null;
  product: string | null;
}

export interface SystemInfoBios {
  version: string | null;
  date: string | null;
}

export interface SystemInfoStatic {
  capturedAt: number;
  hardwareAvailable: boolean;
  os: SystemInfoOs;
  hostname: string | null;
  uptimeMs: number | null;
  cpu: SystemInfoCpu | null;
  gpus: SystemInfoGpu[];
  board: SystemInfoBoard | null;
  bios: SystemInfoBios | null;
}

export interface SystemInfoLive {
  cpuPercent: number | null;
  memTotalBytes: number;
  memUsedBytes: number;
  memAvailableBytes: number;
}

export interface ParsedSystemInfo {
  displayVersion: string | null;
  build: string | null;
  architecture: number | null;
  cpuModel: string | null;
  physicalCores: number | null;
  logicalThreads: number | null;
  gpus: SystemInfoGpu[];
  board: SystemInfoBoard | null;
  bios: SystemInfoBios | null;
}

export const SYSTEM_INFO_SCRIPT = [
  "$ErrorActionPreference = 'SilentlyContinue'",
  '$os = $null',
  "try { $cv = Get-ItemProperty -Path 'HKLM:\\SOFTWARE\\Microsoft\\Windows NT\\CurrentVersion' -ErrorAction Stop; $os = [pscustomobject]@{ displayVersion = $cv.DisplayVersion; currentBuild = [string]$cv.CurrentBuild; ubr = $cv.UBR } } catch {}",
  '$cpu = @(Get-CimInstance -ClassName Win32_Processor | Select-Object Name, NumberOfCores, NumberOfLogicalProcessors, Architecture)',
  '$gpus = @(Get-CimInstance -ClassName Win32_VideoController | Select-Object Name, DriverVersion)',
  '$board = Get-CimInstance -ClassName Win32_BaseBoard | Select-Object Manufacturer, Product | Select-Object -First 1',
  "$bios = Get-CimInstance -ClassName Win32_BIOS | Select-Object SMBIOSBIOSVersion, @{n='ReleaseDate';e={ if ($_.ReleaseDate) { $_.ReleaseDate.ToString('yyyy-MM-dd') } }} | Select-Object -First 1",
  "ConvertTo-Json -InputObject ([pscustomobject]@{ os = $os; cpu = $cpu; gpus = $gpus; board = $board; bios = $bios }) -Compress -Depth 4",
].join('\n');

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function asArray(value: unknown): unknown[] {
  if (value === null || value === undefined) return [];
  return Array.isArray(value) ? value : [value];
}

function firstRecord(value: unknown): Record<string, unknown> | null {
  const list = asArray(value);
  return list.length === 0 ? null : asRecord(list[0]);
}

function cleanString(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function toInt(value: unknown): number | null {
  const numeric =
    typeof value === 'number'
      ? value
      : typeof value === 'string'
        ? Number.parseInt(value, 10)
        : Number.NaN;
  return Number.isFinite(numeric) ? Math.trunc(numeric) : null;
}

function toPositiveInt(value: unknown): number | null {
  const numeric = toInt(value);
  return numeric !== null && numeric > 0 ? numeric : null;
}

export function parseSystemInfoJson(raw: string): ParsedSystemInfo | null {
  const trimmed = raw.trim();
  if (trimmed.length === 0) return null;
  let value: unknown;
  try {
    value = JSON.parse(trimmed);
  } catch {
    return null;
  }
  const record = asRecord(value);
  if (record === null) return null;

  const osRecord = asRecord(record.os);
  const currentBuild = cleanString(osRecord?.currentBuild);
  const ubr = toPositiveInt(osRecord?.ubr);
  const build = currentBuild === null ? null : ubr === null ? currentBuild : `${currentBuild}.${ubr}`;

  const cpuEntries = asArray(record.cpu)
    .map(asRecord)
    .filter((entry): entry is Record<string, unknown> => entry !== null);
  const cpuNames = cpuEntries
    .map((entry) => cleanString(entry.Name))
    .filter((name): name is string => name !== null);
  const coreCounts = cpuEntries
    .map((entry) => toPositiveInt(entry.NumberOfCores))
    .filter((count): count is number => count !== null);
  const threadCounts = cpuEntries
    .map((entry) => toPositiveInt(entry.NumberOfLogicalProcessors))
    .filter((count): count is number => count !== null);
  const firstCpu = cpuEntries[0];

  const gpus = asArray(record.gpus)
    .map(asRecord)
    .filter((entry): entry is Record<string, unknown> => entry !== null)
    .map((entry) => {
      const name = cleanString(entry.Name);
      return name === null ? null : { name, driverVersion: cleanString(entry.DriverVersion) };
    })
    .filter((gpu): gpu is SystemInfoGpu => gpu !== null);

  const boardRecord = firstRecord(record.board);
  const manufacturer = cleanString(boardRecord?.Manufacturer);
  const product = cleanString(boardRecord?.Product);

  const biosRecord = firstRecord(record.bios);
  const biosVersion = cleanString(biosRecord?.SMBIOSBIOSVersion);
  const biosDate = cleanString(biosRecord?.ReleaseDate);

  return {
    displayVersion: cleanString(osRecord?.displayVersion),
    build,
    architecture: firstCpu === undefined ? null : toInt(firstCpu.Architecture),
    cpuModel: cpuNames[0] ?? null,
    physicalCores: coreCounts.length === 0 ? null : coreCounts.reduce((sum, count) => sum + count, 0),
    logicalThreads: threadCounts.length === 0 ? null : threadCounts.reduce((sum, count) => sum + count, 0),
    gpus,
    board: manufacturer === null && product === null ? null : { manufacturer, product },
    bios: biosVersion === null && biosDate === null ? null : { version: biosVersion, date: biosDate },
  };
}

const PROCESSOR_ARCHITECTURES: Readonly<Record<number, string>> = {
  0: 'x86',
  5: 'ARM',
  9: 'x64',
  12: 'ARM64',
};

export function mapProcessorArchitecture(value: number | null): string | null {
  if (value === null) return null;
  return PROCESSOR_ARCHITECTURES[value] ?? null;
}

export function normalizeOsArch(raw: string): string | null {
  const value = raw.trim();
  const key = value.toLowerCase();
  if (key.length === 0) return null;
  if (key === 'ia32') return 'x86';
  if (key === 'x64') return 'x64';
  if (key === 'arm64') return 'ARM64';
  if (key === 'arm') return 'ARM';
  return value;
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npm run test -w core -- test/system-info.test.ts`
Expected: PASS (11 tests).

- [ ] **Step 5: Typecheck and commit**

Run: `npm run typecheck -w core`
Expected: clean.

```bash
git add core/src/system/system-info.ts core/test/system-info.test.ts
git commit -m "feat(core): parse batched Windows system info"
```

---

### Task 2: Static snapshot assembly with Node fallbacks

**Files:**
- Modify: `core/src/system/system-info.ts` (append)
- Modify: `core/src/index.ts` (barrel)
- Modify: `core/test/smoke.test.ts` (public API surface)
- Test: `core/test/system-info.test.ts` (append)

**Interfaces:**
- Consumes: everything from Task 1.
- Produces: `SystemInfoOsInfo`; `SystemInfoStaticOptions` (`query?`, `now?`, `osInfo?`, `platform?`); `getSystemInfoStatic(options?): Promise<SystemInfoStatic>`.

- [ ] **Step 1: Write the failing assembly tests**

Append to `core/test/system-info.test.ts`:

```ts
import { getSystemInfoStatic } from '../src/system/system-info';
import type { SystemInfoOsInfo } from '../src/system/system-info';

function fakeOsInfo(overrides: Partial<SystemInfoOsInfo> = {}): SystemInfoOsInfo {
  return {
    hostname: () => 'dev-machine',
    uptimeSeconds: () => (2 * 24 + 4) * 3600,
    version: () => 'Windows 11 Pro',
    release: () => '10.0.26200',
    arch: () => 'x64',
    cpus: () => [{ model: 'AMD Ryzen 5 5500                               ' }, { model: 'AMD Ryzen 5 5500' }],
    ...overrides,
  };
}

describe('getSystemInfoStatic', () => {
  it('merges the queried batch with Node data', async () => {
    const snapshot = await getSystemInfoStatic({
      query: async () => FULL_FIXTURE,
      now: () => 1234,
      osInfo: fakeOsInfo(),
    });
    expect(snapshot).toEqual({
      capturedAt: 1234,
      hardwareAvailable: true,
      os: { name: 'Windows 11 Pro', version: '25H2', build: '26200.9457', arch: 'x64' },
      hostname: 'dev-machine',
      uptimeMs: ((2 * 24 + 4) * 3600) * 1000,
      cpu: { model: 'AMD Ryzen 5 5500', physicalCores: 6, logicalThreads: 12 },
      gpus: [{ name: 'NVIDIA GeForce RTX 4060', driverVersion: '32.0.16.1714' }],
      board: {
        manufacturer: 'Micro-Star International Co., Ltd.',
        product: 'B450M-A PRO MAX II (MS-7C52)',
      },
      bios: { version: 'A.10', date: '2023-10-26' },
    });
  });

  it('falls back to Node values when the query fails', async () => {
    const snapshot = await getSystemInfoStatic({
      query: async () => {
        throw new Error('powershell missing');
      },
      now: () => 1,
      osInfo: fakeOsInfo(),
    });
    expect(snapshot.hardwareAvailable).toBe(false);
    expect(snapshot.os).toEqual({ name: 'Windows 11 Pro', version: null, build: '10.0.26200', arch: 'x64' });
    expect(snapshot.cpu).toEqual({ model: 'AMD Ryzen 5 5500', physicalCores: null, logicalThreads: 2 });
    expect(snapshot.gpus).toEqual([]);
    expect(snapshot.board).toBeNull();
    expect(snapshot.bios).toBeNull();
  });

  it('falls back to the Node arch when the batch has no processor architecture', async () => {
    const snapshot = await getSystemInfoStatic({
      query: async () => JSON.stringify({ cpu: { Name: 'CPU' } }),
      osInfo: fakeOsInfo({ arch: () => 'arm64' }),
    });
    expect(snapshot.os.arch).toBe('ARM64');
  });

  it('returns Node data and no hardware when no query is available off Windows', async () => {
    const snapshot = await getSystemInfoStatic({ osInfo: fakeOsInfo(), platform: 'linux' });
    expect(snapshot.hardwareAvailable).toBe(false);
    expect(snapshot.hostname).toBe('dev-machine');
    expect(snapshot.cpu?.model).toBe('AMD Ryzen 5 5500');
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm run test -w core -- test/system-info.test.ts`
Expected: FAIL — `getSystemInfoStatic` is not exported / not defined.

- [ ] **Step 3: Implement the assembly**

Append to `core/src/system/system-info.ts`:

```ts
export interface SystemInfoOsInfo {
  hostname(): string;
  uptimeSeconds(): number;
  version(): string;
  release(): string;
  arch(): string;
  cpus(): Array<{ model: string }>;
}

const defaultOsInfo: SystemInfoOsInfo = {
  hostname: () => os.hostname(),
  uptimeSeconds: () => os.uptime(),
  version: () => os.version(),
  release: () => os.release(),
  arch: () => os.arch(),
  cpus: () => os.cpus(),
};

export interface SystemInfoStaticOptions {
  query?: () => Promise<string>;
  now?: () => number;
  osInfo?: SystemInfoOsInfo;
  platform?: string;
}

function querySystemInfoJson(): Promise<string> {
  const powershell =
    process.platform === 'win32' && process.env.SystemRoot
      ? `${process.env.SystemRoot}\\System32\\WindowsPowerShell\\v1.0\\powershell.exe`
      : 'powershell.exe';
  const executable = existsSync(powershell) ? powershell : 'powershell.exe';
  return new Promise((resolve, reject) => {
    execFile(
      executable,
      ['-NoProfile', '-NonInteractive', '-Command', SYSTEM_INFO_SCRIPT],
      { encoding: 'utf8', timeout: 20_000, windowsHide: true, maxBuffer: 8 * 1024 * 1024 },
      (error, stdout) => {
        if (error) {
          reject(error);
          return;
        }
        resolve(stdout);
      },
    );
  });
}

export async function getSystemInfoStatic(
  options: SystemInfoStaticOptions = {},
): Promise<SystemInfoStatic> {
  const now = options.now ?? Date.now;
  const info = options.osInfo ?? defaultOsInfo;
  const platform = options.platform ?? process.platform;

  let parsed: ParsedSystemInfo | null = null;
  if (options.query !== undefined || platform === 'win32') {
    try {
      parsed = parseSystemInfoJson(await (options.query ?? querySystemInfoJson)());
    } catch {
      parsed = null;
    }
  }

  const cpus = info.cpus();
  const firstCpu = cpus[0];
  const fallbackModel = firstCpu === undefined ? null : cleanString(firstCpu.model);
  const model = parsed?.cpuModel ?? fallbackModel;
  const cpu: SystemInfoCpu | null =
    model === null
      ? null
      : {
          model,
          physicalCores: parsed?.physicalCores ?? null,
          logicalThreads: parsed?.logicalThreads ?? (cpus.length > 0 ? cpus.length : null),
        };

  const build = parsed?.build ?? cleanString(info.release());
  const arch = mapProcessorArchitecture(parsed?.architecture ?? null) ?? normalizeOsArch(info.arch());
  const uptimeSeconds = info.uptimeSeconds();

  return {
    capturedAt: now(),
    hardwareAvailable: parsed !== null,
    os: { name: cleanString(info.version()), version: parsed?.displayVersion ?? null, build, arch },
    hostname: cleanString(info.hostname()),
    uptimeMs: Number.isFinite(uptimeSeconds) ? Math.max(uptimeSeconds, 0) * 1000 : null,
    cpu,
    gpus: parsed?.gpus ?? [],
    board: parsed?.board ?? null,
    bios: parsed?.bios ?? null,
  };
}
```

- [ ] **Step 4: Export the surface from the core barrel**

In `core/src/index.ts`, append after the `startup/index` exports (end of file):

```ts
export {
  SYSTEM_INFO_SCRIPT,
  getSystemInfoStatic,
  mapProcessorArchitecture,
  normalizeOsArch,
  parseSystemInfoJson,
} from './system/system-info';
export type {
  ParsedSystemInfo,
  SystemInfoBios,
  SystemInfoBoard,
  SystemInfoCpu,
  SystemInfoGpu,
  SystemInfoLive,
  SystemInfoOs,
  SystemInfoOsInfo,
  SystemInfoStatic,
  SystemInfoStaticOptions,
} from './system/system-info';
```

- [ ] **Step 5: Extend the public-API smoke test**

In `core/test/smoke.test.ts`, add a block before the closing `});`:

```ts
  it('exposes the system info surface', () => {
    expect(typeof core.getSystemInfoStatic).toBe('function');
    expect(typeof core.parseSystemInfoJson).toBe('function');
    expect(typeof core.mapProcessorArchitecture).toBe('function');
    expect(typeof core.SYSTEM_INFO_SCRIPT).toBe('string');
  });
```

- [ ] **Step 6: Run the tests to verify they pass**

Run: `npm run test -w core -- test/system-info.test.ts test/smoke.test.ts`
Expected: PASS (15 tests in `system-info.test.ts`, smoke green).

- [ ] **Step 7: Typecheck and commit**

Run: `npm run typecheck -w core`
Expected: clean.

```bash
git add core/src/system/system-info.ts core/src/index.ts core/test/system-info.test.ts core/test/smoke.test.ts
git commit -m "feat(core): assemble system info from WMI with Node fallbacks"
```

---

### Task 3: Live CPU and memory readers

**Files:**
- Modify: `core/src/system/system-info.ts` (append)
- Modify: `core/src/index.ts` (barrel)
- Test: `core/test/system-info.test.ts` (append)

**Interfaces:**
- Consumes: Task 1 types.
- Produces: `CpuTimesSample`; `readCpuTimes(): CpuTimesSample`; `createCpuUsageSampler(readTimes?): () => number | null`; `readMemoryInfo(): { totalBytes: number; usedBytes: number; availableBytes: number }`.

- [ ] **Step 1: Write the failing sampler tests**

Append to `core/test/system-info.test.ts`:

```ts
import { createCpuUsageSampler, readMemoryInfo } from '../src/system/system-info';
import type { CpuTimesSample } from '../src/system/system-info';

describe('createCpuUsageSampler', () => {
  it('returns null on the first sample and a rounded percent on the next', () => {
    const samples: CpuTimesSample[] = [
      { idle: 100, total: 200 },
      { idle: 170, total: 300 },
    ];
    const sample = createCpuUsageSampler(() => samples.shift() as CpuTimesSample);
    expect(sample()).toBeNull();
    expect(sample()).toBe(30);
  });

  it('returns null when no time elapsed or counters go backwards', () => {
    const samples: CpuTimesSample[] = [
      { idle: 100, total: 200 },
      { idle: 100, total: 200 },
      { idle: 90, total: 200 },
      { idle: 100, total: 300 },
    ];
    const sample = createCpuUsageSampler(() => samples.shift() as CpuTimesSample);
    expect(sample()).toBeNull();
    expect(sample()).toBeNull();
    expect(sample()).toBeNull();
    expect(sample()).toBe(90);
  });

  it('clamps a fully busy delta to 100', () => {
    const samples: CpuTimesSample[] = [
      { idle: 0, total: 1000 },
      { idle: 0, total: 2000 },
    ];
    const sample = createCpuUsageSampler(() => samples.shift() as CpuTimesSample);
    expect(sample()).toBeNull();
    expect(sample()).toBe(100);
  });
});

describe('readMemoryInfo', () => {
  it('reports consistent totals from Node', () => {
    const info = readMemoryInfo();
    expect(info.totalBytes).toBeGreaterThan(0);
    expect(info.availableBytes).toBeGreaterThan(0);
    expect(info.usedBytes).toBe(info.totalBytes - info.availableBytes);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm run test -w core -- test/system-info.test.ts`
Expected: FAIL — `createCpuUsageSampler` / `readMemoryInfo` not exported.

- [ ] **Step 3: Implement the readers**

Append to `core/src/system/system-info.ts`:

```ts
export interface CpuTimesSample {
  idle: number;
  total: number;
}

export function readCpuTimes(): CpuTimesSample {
  let idle = 0;
  let total = 0;
  for (const cpu of os.cpus()) {
    idle += cpu.times.idle;
    total += cpu.times.user + cpu.times.nice + cpu.times.sys + cpu.times.idle + cpu.times.irq;
  }
  return { idle, total };
}

export function createCpuUsageSampler(
  readTimes: () => CpuTimesSample = readCpuTimes,
): () => number | null {
  let previous: CpuTimesSample | null = null;
  return () => {
    const current = readTimes();
    const prior = previous;
    previous = current;
    if (prior === null) return null;
    const idleDelta = current.idle - prior.idle;
    const totalDelta = current.total - prior.total;
    if (totalDelta <= 0 || idleDelta < 0) return null;
    const usage = (1 - idleDelta / totalDelta) * 100;
    return Math.min(Math.max(Math.round(usage), 0), 100);
  };
}

export interface MemoryInfo {
  totalBytes: number;
  usedBytes: number;
  availableBytes: number;
}

export function readMemoryInfo(): MemoryInfo {
  const totalBytes = os.totalmem();
  const availableBytes = os.freemem();
  return { totalBytes, availableBytes, usedBytes: Math.max(totalBytes - availableBytes, 0) };
}
```

- [ ] **Step 4: Export from the barrel**

In `core/src/index.ts`, extend the value export block added in Task 2:

```ts
export {
  SYSTEM_INFO_SCRIPT,
  createCpuUsageSampler,
  getSystemInfoStatic,
  mapProcessorArchitecture,
  normalizeOsArch,
  parseSystemInfoJson,
  readCpuTimes,
  readMemoryInfo,
} from './system/system-info';
```

and extend the type export block with `CpuTimesSample` and `MemoryInfo`:

```ts
export type {
  CpuTimesSample,
  MemoryInfo,
  ParsedSystemInfo,
  SystemInfoBios,
  SystemInfoBoard,
  SystemInfoCpu,
  SystemInfoGpu,
  SystemInfoLive,
  SystemInfoOs,
  SystemInfoOsInfo,
  SystemInfoStatic,
  SystemInfoStaticOptions,
} from './system/system-info';
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `npm run test -w core -- test/system-info.test.ts`
Expected: PASS (19 tests).

- [ ] **Step 6: Typecheck and commit**

Run: `npm run typecheck -w core`
Expected: clean.

```bash
git add core/src/system/system-info.ts core/src/index.ts core/test/system-info.test.ts
git commit -m "feat(core): add live CPU and memory readers"
```

---

### Task 4: Real PowerShell smoke test

**Files:**
- Test: `core/test/system-info-smoke.test.ts` (create)

**Interfaces:**
- Consumes: `getSystemInfoStatic` from Task 2.
- Produces: nothing.

- [ ] **Step 1: Write the smoke test**

Create `core/test/system-info-smoke.test.ts`:

```ts
import { hostname } from 'node:os';
import { describe, expect, it } from 'vitest';
import { getSystemInfoStatic } from '../src/system/system-info';

describe('system info against real Windows', () => {
  it(
    'reads and parses the machine',
    async (ctx) => {
      if (process.platform !== 'win32') {
        ctx.skip();
        return;
      }
      const snapshot = await getSystemInfoStatic();
      expect(snapshot.hardwareAvailable).toBe(true);
      expect(snapshot.hostname).toBe(hostname());
      expect(snapshot.os.name).not.toBeNull();
      expect(snapshot.os.build).toMatch(/^\d+(\.\d+)?$/);
      expect(snapshot.cpu).not.toBeNull();
      expect(snapshot.cpu?.model.length).toBeGreaterThan(0);
    },
    30_000,
  );
});
```

- [ ] **Step 2: Run it on Windows**

Run: `npm run test -w core -- test/system-info-smoke.test.ts`
Expected: PASS in roughly 1–3 s. If it fails with `hardwareAvailable: false`, PowerShell or WMI is broken on this machine — inspect the script output manually before proceeding.

- [ ] **Step 3: Commit**

```bash
git add core/test/system-info-smoke.test.ts
git commit -m "test(core): smoke the real system info query"
```

---

### Task 5: Host service with static cache and uncached live sampling

**Files:**
- Create: `app/src/main/host/system-info.ts`
- Test: `app/test/system-info-host.test.ts` (create)

**Interfaces:**
- Consumes: `createCpuUsageSampler`, `getSystemInfoStatic`, `readMemoryInfo`, `MemoryInfo`, `SystemInfoLive`, `SystemInfoStatic` from `@dust/core`.
- Produces: `SYSTEM_INFO_TTL_MS`; `SystemInfoService` (`get(force?): Promise<SystemInfoStatic>`, `live(): SystemInfoLive`, `invalidate(): void`); `SystemInfoServiceOptions` (`load?`, `sampleCpu?`, `readMemory?`, `ttlMs?`, `now?`); `createSystemInfoService(options?): SystemInfoService`.

- [ ] **Step 1: Write the failing service tests**

Create `app/test/system-info-host.test.ts`:

```ts
import type { SystemInfoStatic } from '@dust/core';
import { describe, expect, it, vi } from 'vitest';
import { SYSTEM_INFO_TTL_MS, createSystemInfoService } from '../src/main/host/system-info';

function snapshot(capturedAt: number): SystemInfoStatic {
  return {
    capturedAt,
    hardwareAvailable: true,
    os: { name: 'Windows 11 Pro', version: '25H2', build: '26200.9457', arch: 'x64' },
    hostname: 'dev-machine',
    uptimeMs: 1000,
    cpu: null,
    gpus: [],
    board: null,
    bios: null,
  };
}

describe('createSystemInfoService', () => {
  it('serves the cached snapshot within the TTL', async () => {
    let clock = 0;
    const load = vi.fn(async () => snapshot(clock));
    const service = createSystemInfoService({ load, now: () => clock });

    const first = await service.get();
    clock = SYSTEM_INFO_TTL_MS - 1;
    const second = await service.get();

    expect(second).toBe(first);
    expect(load).toHaveBeenCalledTimes(1);
  });

  it('reloads after the TTL, when forced, and after invalidate', async () => {
    let clock = 0;
    const load = vi.fn(async () => snapshot(clock));
    const service = createSystemInfoService({ load, now: () => clock });

    await service.get();
    clock = SYSTEM_INFO_TTL_MS;
    await service.get();
    expect(load).toHaveBeenCalledTimes(2);

    await service.get(true);
    expect(load).toHaveBeenCalledTimes(3);

    service.invalidate();
    await service.get();
    expect(load).toHaveBeenCalledTimes(4);
  });

  it('shares an in-flight load', async () => {
    let release!: (value: SystemInfoStatic) => void;
    const load = vi.fn(() => new Promise<SystemInfoStatic>((resolve) => (release = resolve)));
    const service = createSystemInfoService({ load });

    const first = service.get();
    const second = service.get();
    release(snapshot(1));

    await expect(first).resolves.toMatchObject({ capturedAt: 1 });
    await expect(second).resolves.toMatchObject({ capturedAt: 1 });
    expect(load).toHaveBeenCalledTimes(1);
  });

  it('never caches live values', () => {
    let cpu = 10;
    let used = 40;
    const sampleCpu = vi.fn(() => cpu);
    const readMemory = vi.fn(() => ({ totalBytes: 100, usedBytes: used, availableBytes: 100 - used }));
    const service = createSystemInfoService({ sampleCpu, readMemory });

    expect(service.live()).toEqual({
      cpuPercent: 10,
      memTotalBytes: 100,
      memUsedBytes: 40,
      memAvailableBytes: 60,
    });
    cpu = 90;
    used = 80;
    expect(service.live()).toEqual({
      cpuPercent: 90,
      memTotalBytes: 100,
      memUsedBytes: 80,
      memAvailableBytes: 20,
    });
    expect(sampleCpu).toHaveBeenCalledTimes(2);
    expect(readMemory).toHaveBeenCalledTimes(2);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm run test -w app -- test/system-info-host.test.ts`
Expected: FAIL — `Cannot find module '../src/main/host/system-info'`.

- [ ] **Step 3: Implement the service**

Create `app/src/main/host/system-info.ts`:

```ts
import { createCpuUsageSampler, getSystemInfoStatic, readMemoryInfo } from '@dust/core';
import type { MemoryInfo, SystemInfoLive, SystemInfoStatic } from '@dust/core';

export const SYSTEM_INFO_TTL_MS = 5 * 60_000;

export interface SystemInfoService {
  get(force?: boolean): Promise<SystemInfoStatic>;
  live(): SystemInfoLive;
  invalidate(): void;
}

export interface SystemInfoServiceOptions {
  load?: () => Promise<SystemInfoStatic>;
  sampleCpu?: () => number | null;
  readMemory?: () => MemoryInfo;
  ttlMs?: number;
  now?: () => number;
}

export function createSystemInfoService(options: SystemInfoServiceOptions = {}): SystemInfoService {
  const load = options.load ?? (() => getSystemInfoStatic());
  const sampleCpu = options.sampleCpu ?? createCpuUsageSampler();
  const readMemory = options.readMemory ?? readMemoryInfo;
  const ttlMs = options.ttlMs ?? SYSTEM_INFO_TTL_MS;
  const now = options.now ?? Date.now;

  let cached: { at: number; snapshot: SystemInfoStatic } | null = null;
  let inflight: Promise<SystemInfoStatic> | null = null;

  return {
    async get(force = false) {
      const stamp = now();
      if (!force && cached !== null && stamp - cached.at < ttlMs) return cached.snapshot;
      if (inflight !== null) return inflight;
      const pending = load().then((snapshot) => {
        cached = { at: now(), snapshot };
        return snapshot;
      });
      inflight = pending;
      try {
        return await pending;
      } finally {
        inflight = null;
      }
    },
    live() {
      const memory = readMemory();
      return {
        cpuPercent: sampleCpu(),
        memTotalBytes: memory.totalBytes,
        memUsedBytes: memory.usedBytes,
        memAvailableBytes: memory.availableBytes,
      };
    },
    invalidate() {
      cached = null;
    },
  };
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npm run test -w app -- test/system-info-host.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Typecheck and commit**

Run: `npm run typecheck -w app`
Expected: clean.

```bash
git add app/src/main/host/system-info.ts app/test/system-info-host.test.ts
git commit -m "feat(app): cache system info snapshots and sample live values"
```

---

### Task 6: Engine host wiring

**Files:**
- Modify: `app/src/main/host/engine-host.ts`
- Test: `app/test/engine-host.test.ts` (append)

**Interfaces:**
- Consumes: `SystemInfoService`, `createSystemInfoService` from Task 5; `SystemInfoLive`, `SystemInfoStatic` from `@dust/core`.
- Produces: `EngineHostDeps.systemInfo?: SystemInfoService`; `EngineHost.getSystemInfo(force?: boolean): Promise<SystemInfoStatic>`; `EngineHost.getSystemInfoLive(): SystemInfoLive`.

- [ ] **Step 1: Write the failing host test**

In `app/test/engine-host.test.ts`, add `SystemInfoStatic` to the existing `@dust/core` type import (line 4), then append this test inside the `describe('createEngineHost', ...)` block:

```ts
  it('serves system info through the injected service', async () => {
    const snapshot: SystemInfoStatic = {
      capturedAt: 5,
      hardwareAvailable: true,
      os: { name: 'Windows 11 Pro', version: null, build: '26200.9457', arch: 'x64' },
      hostname: 'dev-machine',
      uptimeMs: 1000,
      cpu: null,
      gpus: [],
      board: null,
      bios: null,
    };
    const systemInfo = {
      get: vi.fn(async () => snapshot),
      live: vi.fn(() => ({ cpuPercent: 7, memTotalBytes: 100, memUsedBytes: 40, memAvailableBytes: 60 })),
      invalidate: vi.fn(),
    };
    const host = createEngineHost({ store, systemInfo });

    await expect(host.getSystemInfo(true)).resolves.toEqual(snapshot);
    expect(systemInfo.get).toHaveBeenCalledWith(true);
    expect(host.getSystemInfoLive()).toEqual({
      cpuPercent: 7,
      memTotalBytes: 100,
      memUsedBytes: 40,
      memAvailableBytes: 60,
    });
  });
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm run test -w app -- test/engine-host.test.ts`
Expected: FAIL — `host.getSystemInfo is not a function` (TypeScript may flag `systemInfo` as unknown on the deps type; either way the test is red).

- [ ] **Step 3: Wire the service into the host**

In `app/src/main/host/engine-host.ts`:

1. Add to the `@dust/core` type import block (line 27-50) the names `SystemInfoLive` and `SystemInfoStatic`.
2. Add after `import { createVolumeCache } from './volumes';`:

```ts
import { createSystemInfoService } from './system-info';
import type { SystemInfoService } from './system-info';
```

3. Add to `EngineHostDeps` after `startup?: StartupService;`:

```ts
  systemInfo?: SystemInfoService;
```

4. Add to the `EngineHost` interface after `enableStartup(id: string): Promise<StartupToggleResult>;`:

```ts
  getSystemInfo(force?: boolean): Promise<SystemInfoStatic>;
  getSystemInfoLive(): SystemInfoLive;
```

5. Add next to `const startupService: StartupService = ...` (around line 247):

```ts
  const systemInfoService = deps.systemInfo ?? createSystemInfoService();
```

6. Add after the `enableStartup` function (around line 602):

```ts
  function getSystemInfo(force = false): Promise<SystemInfoStatic> {
    return systemInfoService.get(force);
  }

  function getSystemInfoLive(): SystemInfoLive {
    return systemInfoService.live();
  }
```

7. Add `getSystemInfo,` and `getSystemInfoLive,` to the returned object after `enableStartup,`.

- [ ] **Step 4: Run the test to verify it passes**

Run: `npm run test -w app -- test/engine-host.test.ts`
Expected: PASS (all existing tests plus the new one).

- [ ] **Step 5: Typecheck and commit**

Run: `npm run typecheck -w app`
Expected: clean.

```bash
git add app/src/main/host/engine-host.ts app/test/engine-host.test.ts
git commit -m "feat(app): expose system info on the engine host"
```

---

### Task 7: IPC channels, preload bridge, and routing tests

**Files:**
- Modify: `app/src/shared/ipc.ts`
- Modify: `app/src/main/ipc.ts`
- Modify: `app/src/preload/index.ts`
- Test: `app/test/ipc-contract.test.ts`, `app/test/ipc.test.ts`

**Interfaces:**
- Consumes: `EngineHost.getSystemInfo`, `EngineHost.getSystemInfoLive` from Task 6.
- Produces: `IPC.systemInfoGet` (`'dust:system-info:get'`), `IPC.systemInfoLive` (`'dust:system-info:live'`); `DustApi.getSystemInfo(force?: boolean): Promise<SystemInfoStatic>`; `DustApi.getSystemInfoLive(): Promise<SystemInfoLive>`; re-exports of `SystemInfoStatic` / `SystemInfoLive` from `shared/ipc`.

- [ ] **Step 1: Update the contract test first**

In `app/test/ipc-contract.test.ts`, change `expect(channels).toHaveLength(18);` to:

```ts
    expect(channels).toHaveLength(20);
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npm run test -w app -- test/ipc-contract.test.ts`
Expected: FAIL — expected 20, received 18.

- [ ] **Step 3: Add channels, types, and API surface**

In `app/src/shared/ipc.ts`:

1. Add `SystemInfoLive` and `SystemInfoStatic` to the `@dust/core` type import.
2. Add to the `IPC` const before `relaunchElevated`:

```ts
  systemInfoGet: 'dust:system-info:get',
  systemInfoLive: 'dust:system-info:live',
```

3. Change the re-export line to:

```ts
export type { BrowseDeleteResult, StartupSource, SystemInfoLive, SystemInfoStatic };
```

4. Add to `DustApi` before `onScanEvent`:

```ts
  getSystemInfo(force?: boolean): Promise<SystemInfoStatic>;
  getSystemInfoLive(): Promise<SystemInfoLive>;
```

- [ ] **Step 4: Register the handlers**

In `app/src/main/ipc.ts`, add after the `startupHint` handler (before `relaunchElevated`):

```ts
  registrar.handle(IPC.systemInfoGet, (_event, force) =>
    timed('systemInfoGet', () => host.getSystemInfo(force === true)),
  );
  registrar.handle(IPC.systemInfoLive, () => host.getSystemInfoLive());
```

- [ ] **Step 5: Wire the preload bridge**

In `app/src/preload/index.ts`:

1. Add `SystemInfoLive` and `SystemInfoStatic` to the type import from `../shared/ipc`.
2. Add to the `api` object before `onScanEvent`:

```ts
  getSystemInfo: (force?: boolean) =>
    ipcRenderer.invoke(IPC.systemInfoGet, force === true) as Promise<SystemInfoStatic>,
  getSystemInfoLive: () => ipcRenderer.invoke(IPC.systemInfoLive) as Promise<SystemInfoLive>,
```

- [ ] **Step 6: Add the routing test**

In `app/test/ipc.test.ts`, add `SystemInfoStatic` to the existing `../src/shared/ipc` type import, then add this test inside `describe('registerIpcHandlers', ...)`:

```ts
  it('routes system info and live samples through the host', async () => {
    const snapshot: SystemInfoStatic = {
      capturedAt: 5,
      hardwareAvailable: true,
      os: { name: 'Windows 11 Pro', version: null, build: '26200.9457', arch: 'x64' },
      hostname: 'dev-machine',
      uptimeMs: 1000,
      cpu: null,
      gpus: [],
      board: null,
      bios: null,
    };
    const systemInfo = {
      get: vi.fn(async () => snapshot),
      live: vi.fn(() => ({ cpuPercent: 7, memTotalBytes: 100, memUsedBytes: 40, memAvailableBytes: 60 })),
      invalidate: vi.fn(),
    };
    const { host } = makeHost(new FakeSession({ root: 'T:\\' }), { systemInfo });
    const registrar = new FakeRegistrar();
    const unsubscribe = registerIpcHandlers(
      registrar,
      host,
      { send: () => {} },
      { revealPath: async () => {}, relaunchElevated: async () => {} },
    );

    await expect(registrar.invoke(IPC.systemInfoGet, true)).resolves.toEqual(snapshot);
    expect(systemInfo.get).toHaveBeenCalledWith(true);
    await expect(registrar.invoke(IPC.systemInfoGet, 'not-a-boolean')).resolves.toEqual(snapshot);
    expect(systemInfo.get).toHaveBeenLastCalledWith(false);
    await expect(registrar.invoke(IPC.systemInfoLive)).resolves.toEqual({
      cpuPercent: 7,
      memTotalBytes: 100,
      memUsedBytes: 40,
      memAvailableBytes: 60,
    });

    unsubscribe();
    host.dispose();
  });
```

- [ ] **Step 7: Run the tests to verify they pass**

Run: `npm run test -w app -- test/ipc-contract.test.ts test/ipc.test.ts`
Expected: PASS.

- [ ] **Step 8: Typecheck and commit**

Run: `npm run typecheck -w app`
Expected: clean.

```bash
git add app/src/shared/ipc.ts app/src/main/ipc.ts app/src/preload/index.ts app/test/ipc-contract.test.ts app/test/ipc.test.ts
git commit -m "feat(app): add system info IPC channels"
```

---

### Task 8: Renderer formatting and copy block

**Files:**
- Create: `app/renderer/src/system-info.ts`
- Test: `app/test/renderer/system-info-format.test.ts` (create)

**Interfaces:**
- Consumes: `SystemInfoBios`, `SystemInfoCpu`, `SystemInfoGpu`, `SystemInfoLive`, `SystemInfoOs`, `SystemInfoStatic` from `@dust/core`; `formatBytes` from `./format`.
- Produces: `formatUptime(ms): string | null`; `formatCapturedAt(ms): string`; `formatOsName(os): string | null`; `formatOsLine(os): string | null`; `formatCpuSpec(cpu): string | null`; `formatCpuLine(cpu): string`; `formatGpuLine(gpu): string`; `joinBoard(manufacturer, product): string | null`; `formatBios(bios): string | null`; `formatSystemInfoText(snapshot, live): string`.

- [ ] **Step 1: Write the failing format tests**

Create `app/test/renderer/system-info-format.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import {
  formatBios,
  formatCapturedAt,
  formatSystemInfoText,
  formatUptime,
  joinBoard,
} from '../../renderer/src/system-info';
import { makeSystemInfo, makeSystemInfoLive } from './fakes';

describe('formatUptime', () => {
  it('formats days, hours, minutes and the under-a-minute case', () => {
    expect(formatUptime((2 * 24 + 4) * 3_600_000)).toBe('2d 4h');
    expect(formatUptime(2 * 24 * 3_600_000)).toBe('2d');
    expect(formatUptime((4 * 60 + 12) * 60_000)).toBe('4h 12m');
    expect(formatUptime(4 * 3_600_000)).toBe('4h');
    expect(formatUptime(12 * 60_000)).toBe('12m');
    expect(formatUptime(30_000)).toBe('under a minute');
  });

  it('returns null for invalid input', () => {
    expect(formatUptime(Number.NaN)).toBeNull();
    expect(formatUptime(-1)).toBeNull();
  });
});

describe('formatCapturedAt', () => {
  it('renders local time as YYYY-MM-DD HH:MM', () => {
    expect(formatCapturedAt(new Date(2026, 8, 27, 14, 32).getTime())).toBe('2026-09-27 14:32');
    expect(formatCapturedAt(new Date(2026, 0, 5, 9, 7).getTime())).toBe('2026-01-05 09:07');
  });
});

describe('joinBoard and formatBios', () => {
  it('joins manufacturer and product without duplicating shared text', () => {
    expect(joinBoard('ASUS', 'ROG STRIX B550-F')).toBe('ASUS ROG STRIX B550-F');
    expect(joinBoard('ASUSTeK COMPUTER INC.', 'ASUSTeK COMPUTER INC. ROG STRIX B550-F')).toBe(
      'ASUSTeK COMPUTER INC. ROG STRIX B550-F',
    );
    expect(joinBoard(null, 'B450M-A PRO MAX II')).toBe('B450M-A PRO MAX II');
    expect(joinBoard('ASUS', null)).toBe('ASUS');
    expect(joinBoard(null, null)).toBeNull();
  });

  it('formats BIOS version and date independently', () => {
    expect(formatBios({ version: '2803', date: '2023-04-12' })).toBe('2803 (2023-04-12)');
    expect(formatBios({ version: '2803', date: null })).toBe('2803');
    expect(formatBios({ version: null, date: '2023-04-12' })).toBe('2023-04-12');
    expect(formatBios({ version: null, date: null })).toBeNull();
  });
});

describe('formatSystemInfoText', () => {
  it('builds the exact report block', () => {
    expect(formatSystemInfoText(makeSystemInfo(), makeSystemInfoLive())).toBe(
      [
        'Dust System Info',
        'Captured: 2026-09-27 14:32',
        '',
        'OS: Windows 11 Pro 25H2 (Build 26200.9457)',
        'Arch: x64',
        'Hostname: dev-machine',
        'Uptime: 2d 4h',
        '',
        'CPU: AMD Ryzen 7 5800X (8 cores / 16 threads)',
        'RAM: 32 GB total · 18.4 GB used',
        '',
        'GPU: NVIDIA GeForce RTX 4070 (Driver 560.94)',
        '',
        'Motherboard: ASUSTeK COMPUTER INC. ROG STRIX B550-F GAMING',
        'BIOS: 2803 (2023-04-12)',
      ].join('\n'),
    );
  });

  it('omits missing sections instead of printing placeholders', () => {
    const text = formatSystemInfoText(
      makeSystemInfo({
        hardwareAvailable: false,
        os: { name: null, version: null, build: null, arch: null },
        hostname: null,
        uptimeMs: null,
        cpu: null,
        gpus: [],
        board: null,
        bios: null,
      }),
      null,
    );
    expect(text).toBe('Dust System Info\nCaptured: 2026-09-27 14:32');
    expect(text).not.toContain('null');
    expect(text).not.toContain('undefined');
  });

  it('formats GPUs without a driver version as a bare name', () => {
    const text = formatSystemInfoText(
      makeSystemInfo({ gpus: [{ name: 'Microsoft Basic Display Adapter', driverVersion: null }] }),
      null,
    );
    expect(text).toContain('GPU: Microsoft Basic Display Adapter');
    expect(text).not.toContain('(Driver');
  });
});
```

- [ ] **Step 2: Add the renderer fakes first (needed by the tests)**

In `app/test/renderer/fakes.ts`:

1. Add `SystemInfoLive` and `SystemInfoStatic` to the `../../src/shared/ipc` type import.
2. Add these functions after `makeStartupState`:

```ts
export function makeSystemInfo(overrides: Partial<SystemInfoStatic> = {}): SystemInfoStatic {
  return {
    capturedAt: new Date(2026, 8, 27, 14, 32).getTime(),
    hardwareAvailable: true,
    os: { name: 'Windows 11 Pro', version: '25H2', build: '26200.9457', arch: 'x64' },
    hostname: 'dev-machine',
    uptimeMs: (2 * 24 + 4) * 3_600_000,
    cpu: { model: 'AMD Ryzen 7 5800X', physicalCores: 8, logicalThreads: 16 },
    gpus: [{ name: 'NVIDIA GeForce RTX 4070', driverVersion: '560.94' }],
    board: { manufacturer: 'ASUSTeK COMPUTER INC.', product: 'ROG STRIX B550-F GAMING' },
    bios: { version: '2803', date: '2023-04-12' },
    ...overrides,
  };
}

export function makeSystemInfoLive(overrides: Partial<SystemInfoLive> = {}): SystemInfoLive {
  return {
    cpuPercent: 12,
    memTotalBytes: 32 * 1024 ** 3,
    memUsedBytes: 19_757_772_800,
    memAvailableBytes: 32 * 1024 ** 3 - 19_757_772_800,
    ...overrides,
  };
}
```

3. Add to `makeApi` before `onScanEvent`:

```ts
    getSystemInfo: async () => makeSystemInfo(),
    getSystemInfoLive: async () => makeSystemInfoLive(),
```

- [ ] **Step 3: Run the tests to verify they fail**

Run: `npm run test -w app -- test/renderer/system-info-format.test.ts`
Expected: FAIL — `Cannot find module '../../renderer/src/system-info'`.

- [ ] **Step 4: Implement the formatting module**

Create `app/renderer/src/system-info.ts`:

```ts
import type {
  SystemInfoBios,
  SystemInfoCpu,
  SystemInfoGpu,
  SystemInfoLive,
  SystemInfoOs,
  SystemInfoStatic,
} from '@dust/core';
import { formatBytes } from './format';

function present(value: string | null): value is string {
  return value !== null && value.length > 0;
}

function pad(value: number): string {
  return String(value).padStart(2, '0');
}

export function formatUptime(ms: number): string | null {
  if (!Number.isFinite(ms) || ms < 0) return null;
  const totalMinutes = Math.floor(ms / 60_000);
  if (totalMinutes < 1) return 'under a minute';
  const days = Math.floor(totalMinutes / 1440);
  const hours = Math.floor(totalMinutes / 60) % 24;
  const minutes = totalMinutes % 60;
  if (days > 0) return hours > 0 ? `${days}d ${hours}h` : `${days}d`;
  if (hours > 0) return minutes > 0 ? `${hours}h ${minutes}m` : `${hours}h`;
  return `${minutes}m`;
}

export function formatCapturedAt(ms: number): string {
  const date = new Date(ms);
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(
    date.getHours(),
  )}:${pad(date.getMinutes())}`;
}

export function formatOsName(os: SystemInfoOs): string | null {
  const name = [os.name, os.version].filter(present).join(' ');
  return name.length > 0 ? name : null;
}

export function formatOsLine(os: SystemInfoOs): string | null {
  const name = formatOsName(os);
  const build = os.build === null ? null : `(Build ${os.build})`;
  const line = [name, build].filter(present).join(' ');
  return line.length > 0 ? line : null;
}

export function formatCpuSpec(cpu: SystemInfoCpu): string | null {
  if (cpu.physicalCores !== null && cpu.logicalThreads !== null) {
    return `${cpu.physicalCores} cores / ${cpu.logicalThreads} threads`;
  }
  if (cpu.logicalThreads !== null) return `${cpu.logicalThreads} threads`;
  if (cpu.physicalCores !== null) return `${cpu.physicalCores} cores`;
  return null;
}

export function formatCpuLine(cpu: SystemInfoCpu): string {
  const spec = formatCpuSpec(cpu);
  return spec === null ? cpu.model : `${cpu.model} (${spec})`;
}

export function formatGpuLine(gpu: SystemInfoGpu): string {
  return gpu.driverVersion === null ? gpu.name : `${gpu.name} (Driver ${gpu.driverVersion})`;
}

export function joinBoard(manufacturer: string | null, product: string | null): string | null {
  const maker = manufacturer?.trim() ?? '';
  const model = product?.trim() ?? '';
  if (maker.length === 0 && model.length === 0) return null;
  if (maker.length === 0) return model;
  if (model.length === 0) return maker;
  const makerKey = maker.toLowerCase();
  const modelKey = model.toLowerCase();
  if (modelKey.includes(makerKey)) return model;
  if (makerKey.includes(modelKey)) return maker;
  return `${maker} ${model}`;
}

export function formatBios(bios: SystemInfoBios): string | null {
  if (bios.version !== null && bios.date !== null) return `${bios.version} (${bios.date})`;
  return bios.version ?? bios.date;
}

export function formatSystemInfoText(
  snapshot: SystemInfoStatic,
  live: SystemInfoLive | null,
): string {
  const blocks: string[][] = [['Dust System Info', `Captured: ${formatCapturedAt(snapshot.capturedAt)}`]];

  const system: string[] = [];
  const osLine = formatOsLine(snapshot.os);
  if (osLine !== null) system.push(`OS: ${osLine}`);
  if (snapshot.os.arch !== null) system.push(`Arch: ${snapshot.os.arch}`);
  if (snapshot.hostname !== null) system.push(`Hostname: ${snapshot.hostname}`);
  if (snapshot.uptimeMs !== null) {
    const uptime = formatUptime(snapshot.uptimeMs);
    if (uptime !== null) system.push(`Uptime: ${uptime}`);
  }
  if (system.length > 0) blocks.push(system);

  const compute: string[] = [];
  if (snapshot.cpu !== null) compute.push(`CPU: ${formatCpuLine(snapshot.cpu)}`);
  if (live !== null) {
    compute.push(`RAM: ${formatBytes(live.memTotalBytes)} total · ${formatBytes(live.memUsedBytes)} used`);
  }
  if (compute.length > 0) blocks.push(compute);

  if (snapshot.gpus.length > 0) {
    blocks.push(snapshot.gpus.map((gpu) => `GPU: ${formatGpuLine(gpu)}`));
  }

  const firmware: string[] = [];
  const board =
    snapshot.board === null ? null : joinBoard(snapshot.board.manufacturer, snapshot.board.product);
  if (board !== null) firmware.push(`Motherboard: ${board}`);
  const bios = snapshot.bios === null ? null : formatBios(snapshot.bios);
  if (bios !== null) firmware.push(`BIOS: ${bios}`);
  if (firmware.length > 0) blocks.push(firmware);

  return blocks.map((block) => block.join('\n')).join('\n\n');
}
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `npm run test -w app -- test/renderer/system-info-format.test.ts`
Expected: PASS (7 tests).

- [ ] **Step 6: Typecheck and commit**

Run: `npm run typecheck -w app`
Expected: clean.

```bash
git add app/renderer/src/system-info.ts app/test/renderer/system-info-format.test.ts app/test/renderer/fakes.ts
git commit -m "feat(app): format system info and its copy block"
```

---

### Task 9: SystemInfoView page

**Files:**
- Create: `app/renderer/src/pages/SystemInfoView.tsx`
- Test: `app/test/renderer/system-info-view.test.tsx` (create)

**Interfaces:**
- Consumes: `DustApi.getSystemInfo`, `DustApi.getSystemInfoLive` (Task 7); formatting module (Task 8); `makeSystemInfo`, `makeSystemInfoLive`, `makeApi` (Task 8); `StartupToast`, `UsageBar` components.
- Produces: `SystemInfoViewProps { api: DustApi }`; `SystemInfoView({ api })`.

- [ ] **Step 1: Write the failing page tests**

Create `app/test/renderer/system-info-view.test.tsx`:

```tsx
import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { SystemInfoView } from '../../renderer/src/pages/SystemInfoView';
import { makeApi, makeSystemInfo, makeSystemInfoLive } from './fakes';

async function flush(): Promise<void> {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
}

describe('SystemInfoView', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('renders the static snapshot and the live cluster', async () => {
    render(<SystemInfoView api={makeApi()} />);
    await flush();

    expect(screen.getByRole('heading', { name: 'System Info' })).toBeInTheDocument();
    expect(screen.getByText('2026-09-27 14:32')).toBeInTheDocument();
    expect(screen.getByText('Windows 11 Pro 25H2')).toBeInTheDocument();
    expect(screen.getByText('26200.9457')).toBeInTheDocument();
    expect(screen.getByText('x64')).toBeInTheDocument();
    expect(screen.getByText('dev-machine')).toBeInTheDocument();
    expect(screen.getByText('2d 4h')).toBeInTheDocument();

    const processor = screen.getByRole('region', { name: 'Processor' });
    expect(within(processor).getByText('AMD Ryzen 7 5800X')).toBeInTheDocument();
    expect(within(processor).getByText('8')).toBeInTheDocument();
    expect(within(processor).getByText('16')).toBeInTheDocument();

    const graphics = screen.getByRole('region', { name: 'Graphics' });
    expect(within(graphics).getByText('NVIDIA GeForce RTX 4070')).toBeInTheDocument();
    expect(within(graphics).getByText('560.94')).toBeInTheDocument();

    const firmware = screen.getByRole('region', { name: 'Firmware' });
    expect(
      within(firmware).getByText('ASUSTeK COMPUTER INC. ROG STRIX B550-F GAMING'),
    ).toBeInTheDocument();
    expect(within(firmware).getByText('2803 (2023-04-12)')).toBeInTheDocument();

    expect(screen.getByText('12%')).toBeInTheDocument();
    expect(screen.getByText('18.4 GB used of 32 GB')).toBeInTheDocument();
    expect(screen.queryByText('Hardware details unavailable on this machine.')).toBeNull();
  });

  it('omits missing sections and shows the hardware notice when the query failed', async () => {
    render(
      <SystemInfoView
        api={makeApi({
          getSystemInfo: async () =>
            makeSystemInfo({
              hardwareAvailable: false,
              cpu: null,
              gpus: [],
              board: null,
              bios: null,
            }),
        })}
      />,
    );
    await flush();

    expect(screen.getByText('Hardware details unavailable on this machine.')).toBeInTheDocument();
    expect(screen.getByRole('region', { name: 'This PC' })).toBeInTheDocument();
    expect(screen.queryByRole('region', { name: 'Processor' })).toBeNull();
    expect(screen.queryByRole('region', { name: 'Graphics' })).toBeNull();
    expect(screen.queryByRole('region', { name: 'Firmware' })).toBeNull();
  });

  it('omits rows for missing values instead of printing placeholders', async () => {
    render(
      <SystemInfoView
        api={makeApi({
          getSystemInfo: async () =>
            makeSystemInfo({
              os: { name: null, version: null, build: null, arch: null },
              hostname: null,
              uptimeMs: null,
            }),
        })}
      />,
    );
    await flush();

    expect(screen.queryByRole('region', { name: 'This PC' })).toBeNull();
    expect(screen.queryByText('Unknown')).toBeNull();
  });

  it('polls live values while mounted and stops on unmount', async () => {
    vi.useFakeTimers();
    const getSystemInfoLive = vi
      .fn()
      .mockResolvedValueOnce(makeSystemInfoLive({ cpuPercent: 10 }))
      .mockResolvedValueOnce(makeSystemInfoLive({ cpuPercent: 40 }));
    const { unmount } = render(<SystemInfoView api={makeApi({ getSystemInfoLive })} />);
    await flush();

    expect(screen.getByText('10%')).toBeInTheDocument();
    await act(async () => {
      vi.advanceTimersByTime(1500);
    });
    await flush();
    expect(screen.getByText('40%')).toBeInTheDocument();

    const calls = getSystemInfoLive.mock.calls.length;
    unmount();
    await act(async () => {
      vi.advanceTimersByTime(4500);
    });
    expect(getSystemInfoLive.mock.calls.length).toBe(calls);
  });

  it('refreshes the snapshot on demand', async () => {
    const getSystemInfo = vi.fn(async (force?: boolean) =>
      makeSystemInfo({
        capturedAt:
          force === true
            ? new Date(2026, 8, 28, 9, 15).getTime()
            : new Date(2026, 8, 27, 14, 32).getTime(),
      }),
    );
    render(<SystemInfoView api={makeApi({ getSystemInfo })} />);
    await flush();

    expect(screen.getByText('2026-09-27 14:32')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Refresh' }));
    await flush();

    expect(getSystemInfo).toHaveBeenLastCalledWith(true);
    expect(screen.getByText('2026-09-28 09:15')).toBeInTheDocument();
  });

  it('copies the report and shows the toast', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
    render(<SystemInfoView api={makeApi()} />);
    await flush();

    fireEvent.click(screen.getByRole('button', { name: 'Copy system info' }));
    await flush();

    expect(writeText).toHaveBeenCalledTimes(1);
    const text = writeText.mock.calls[0]?.[0] as string;
    expect(text).toContain('OS: Windows 11 Pro 25H2 (Build 26200.9457)');
    expect(text).toContain('CPU: AMD Ryzen 7 5800X (8 cores / 16 threads)');
    expect(text).toContain('RAM: 32 GB total · 18.4 GB used');
    expect(text).toContain('GPU: NVIDIA GeForce RTX 4070 (Driver 560.94)');
    expect(screen.getByRole('status')).toHaveTextContent('System info copied.');
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm run test -w app -- test/renderer/system-info-view.test.tsx`
Expected: FAIL — `Cannot find module '../../renderer/src/pages/SystemInfoView'`.

- [ ] **Step 3: Implement the page**

Create `app/renderer/src/pages/SystemInfoView.tsx`:

```tsx
import { useCallback, useEffect, useState } from 'react';
import type { ReactNode } from 'react';
import type { SystemInfoLive, SystemInfoStatic } from '@dust/core';
import type { DustApi } from '../../../src/shared/ipc';
import { StartupToast } from '../components/StartupToast';
import { UsageBar } from '../components/UsageBar';
import { formatBytes } from '../format';
import {
  formatBios,
  formatCapturedAt,
  formatCpuSpec,
  formatOsName,
  formatSystemInfoText,
  formatUptime,
  joinBoard,
} from '../system-info';

const LIVE_INTERVAL_MS = 1500;
const FOCUS = 'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent';
const CARD = 'rounded-2xl border border-hairline bg-surface shadow-[0_1px_2px_rgba(16,24,40,0.04)]';
const SECONDARY = `rounded-lg border border-hairline bg-surface px-3.5 py-1.5 text-sm font-medium text-ink transition-colors hover:border-hairline-strong hover:bg-surface-hover disabled:cursor-not-allowed disabled:opacity-45 ${FOCUS}`;
const PRIMARY = `rounded-lg bg-accent px-3.5 py-1.5 text-sm font-semibold text-white transition-colors hover:bg-accent-strong ${FOCUS}`;

export interface SystemInfoViewProps {
  api: DustApi;
}

interface InfoRowProps {
  label: string;
  value: string | null;
}

function InfoRow({ label, value }: InfoRowProps) {
  return (
    <div className="flex items-baseline justify-between gap-6 px-4 py-2.5">
      <span className="min-w-0 text-sm text-ink-muted">{label}</span>
      {value !== null && <span className="shrink-0 text-right font-mono text-sm text-ink">{value}</span>}
    </div>
  );
}

function InfoSection({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section aria-label={title} className={`overflow-hidden ${CARD}`}>
      <div className="px-4 py-3.5">
        <h2 className="text-sm font-semibold text-ink">{title}</h2>
      </div>
      <div className="h-px w-full bg-hairline" aria-hidden="true" />
      <div className="divide-y divide-hairline">{children}</div>
    </section>
  );
}

function LiveTile({ label, children }: { label: string; children: ReactNode }) {
  return (
    <section aria-label={label} className={`px-4 py-4 ${CARD}`}>
      <h2 className="text-xs font-semibold uppercase tracking-[0.16em] text-ink-muted">{label}</h2>
      {children}
    </section>
  );
}

function errorText(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause);
}

export function SystemInfoView({ api }: SystemInfoViewProps) {
  const [snapshot, setSnapshot] = useState<SystemInfoStatic | null>(null);
  const [live, setLive] = useState<SystemInfoLive | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [toastKey, setToastKey] = useState(0);

  const load = useCallback(
    (force: boolean) => {
      api
        .getSystemInfo(force)
        .then((next) => {
          setSnapshot(next);
          setError(null);
        })
        .catch((cause: unknown) => setError(errorText(cause)))
        .finally(() => setRefreshing(false));
    },
    [api],
  );

  useEffect(() => {
    load(false);
  }, [load]);

  useEffect(() => {
    let cancelled = false;
    const poll = () => {
      api
        .getSystemInfoLive()
        .then((next) => {
          if (!cancelled) setLive(next);
        })
        .catch(() => {});
    };
    poll();
    const timer = window.setInterval(poll, LIVE_INTERVAL_MS);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [api]);

  const refresh = useCallback(() => {
    setRefreshing(true);
    load(true);
  }, [load]);

  const copy = useCallback(() => {
    if (snapshot === null) return;
    const text = formatSystemInfoText(snapshot, live);
    void navigator.clipboard
      ?.writeText(text)
      .then(() => setToastKey((value) => value + 1))
      .catch(() => {});
  }, [snapshot, live]);

  if (snapshot === null) {
    return (
      <main className="dust-dashboard flex min-h-screen items-center justify-center bg-canvas px-6 text-sm text-ink-muted">
        {error ?? 'Loading system information.'}
      </main>
    );
  }

  const uptime = snapshot.uptimeMs === null ? null : formatUptime(snapshot.uptimeMs);
  const osName = formatOsName(snapshot.os);
  const processorRows: Array<{ label: string; value: string | null }> =
    snapshot.cpu === null
      ? []
      : [
          { label: 'Model', value: snapshot.cpu.model },
          { label: 'Cores', value: snapshot.cpu.physicalCores === null ? null : String(snapshot.cpu.physicalCores) },
          {
            label: 'Threads',
            value: snapshot.cpu.logicalThreads === null ? null : String(snapshot.cpu.logicalThreads),
          },
        ];
  const cpuSpec = snapshot.cpu === null ? null : formatCpuSpec(snapshot.cpu);
  const board =
    snapshot.board === null ? null : joinBoard(snapshot.board.manufacturer, snapshot.board.product);
  const bios = snapshot.bios === null ? null : formatBios(snapshot.bios);
  const firmwareRows: Array<{ label: string; value: string | null }> = [];
  if (board !== null) firmwareRows.push({ label: 'Motherboard', value: board });
  if (bios !== null) firmwareRows.push({ label: 'BIOS', value: bios });

  return (
    <main className="dust-dashboard min-h-screen bg-canvas text-ink">
      <header className="mx-auto w-full max-w-4xl px-6 pt-10 sm:px-8 sm:pt-12">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight text-ink">System Info</h1>
            <p className="mt-1.5 text-sm text-ink-muted">
              Captured <span className="font-mono text-ink">{formatCapturedAt(snapshot.capturedAt)}</span>
            </p>
          </div>
          <div className="flex items-center gap-2">
            <button type="button" onClick={refresh} disabled={refreshing} className={SECONDARY}>
              {refreshing ? 'Refreshing…' : 'Refresh'}
            </button>
            <button type="button" onClick={copy} className={PRIMARY}>
              Copy system info
            </button>
          </div>
        </div>
      </header>

      <div className="mx-auto w-full max-w-4xl px-6 pb-24 pt-8 sm:px-8">
        {error !== null && (
          <p
            role="alert"
            className="mb-6 rounded-lg border border-notice-border bg-notice px-3.5 py-2.5 text-sm text-ink"
          >
            {error}
          </p>
        )}

        <div className="grid gap-3 sm:grid-cols-2">
          <LiveTile label="CPU usage">
            <p className="mt-2 font-mono text-3xl font-semibold tabular-nums text-ink">
              {live === null || live.cpuPercent === null ? '—' : `${live.cpuPercent}%`}
            </p>
          </LiveTile>
          <LiveTile label="Memory usage">
            <p className="mt-2 font-mono text-sm tabular-nums text-ink">
              {live === null
                ? '—'
                : `${formatBytes(live.memUsedBytes)} used of ${formatBytes(live.memTotalBytes)}`}
            </p>
            <div className="mt-2">
              <UsageBar
                usedBytes={live?.memUsedBytes ?? null}
                totalBytes={live?.memTotalBytes ?? null}
                label="Memory usage"
                size="lg"
              />
            </div>
          </LiveTile>
        </div>

        {!snapshot.hardwareAvailable && (
          <p className="mt-6 rounded-lg border border-notice-border bg-notice px-3.5 py-2.5 text-sm text-ink">
            Hardware details unavailable on this machine.
          </p>
        )}

        <div className="mt-8 space-y-6">
          <InfoSection title="This PC">
            <InfoRow label="OS" value={osName} />
            <InfoRow label="Build" value={snapshot.os.build} />
            <InfoRow label="Architecture" value={snapshot.os.arch} />
            <InfoRow label="Hostname" value={snapshot.hostname} />
            <InfoRow label="Uptime" value={uptime} />
          </InfoSection>

          {processorRows.length > 0 && (
            <InfoSection title="Processor">
              {processorRows.map((row) => (
                <InfoRow key={row.label} label={row.label} value={row.value} />
              ))}
              <InfoRow label="Cores / threads" value={cpuSpec} />
            </InfoSection>
          )}

          {snapshot.gpus.length > 0 && (
            <InfoSection title="Graphics">
              {snapshot.gpus.map((gpu, index) => (
                <InfoRow key={`${gpu.name}-${index}`} label={gpu.name} value={gpu.driverVersion} />
              ))}
            </InfoSection>
          )}

          {firmwareRows.length > 0 && (
            <InfoSection title="Firmware">
              {firmwareRows.map((row) => (
                <InfoRow key={row.label} label={row.label} value={row.value} />
              ))}
            </InfoSection>
          )}
        </div>
      </div>

      {toastKey > 0 && (
        <StartupToast
          key={toastKey}
          message="System info copied."
          durationMs={3000}
          onDismiss={() => setToastKey(0)}
        />
      )}
    </main>
  );
}
```

Two details this implementation guarantees, matching the tests:
- The Processor section repeats core/thread counts in a combined "Cores / threads" row (`8 cores / 16 threads`); the separate Cores and Threads rows keep the raw numbers. If you prefer a single row, delete the `Cores`/`Threads` entries and the `cpuSpec` row, but then update the test accordingly — the committed version keeps both.
- `This PC` always renders, but `InfoRow` renders nothing for null values, so an all-null OS section collapses to an empty card; the missing-values test removes the whole `This PC` card instead. To satisfy that test, render the `This PC` section only when at least one of its values is non-null.

Apply that second rule by replacing the `This PC` block with a guarded version:

```tsx
          {(osName !== null ||
            snapshot.os.build !== null ||
            snapshot.os.arch !== null ||
            snapshot.hostname !== null ||
            uptime !== null) && (
            <InfoSection title="This PC">
              <InfoRow label="OS" value={osName} />
              <InfoRow label="Build" value={snapshot.os.build} />
              <InfoRow label="Architecture" value={snapshot.os.arch} />
              <InfoRow label="Hostname" value={snapshot.hostname} />
              <InfoRow label="Uptime" value={uptime} />
            </InfoSection>
          )}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npm run test -w app -- test/renderer/system-info-view.test.tsx`
Expected: PASS (6 tests).

- [ ] **Step 5: Typecheck and commit**

Run: `npm run typecheck -w app`
Expected: clean.

```bash
git add app/renderer/src/pages/SystemInfoView.tsx app/test/renderer/system-info-view.test.tsx
git commit -m "feat(app): add the System Info page"
```

---

### Task 10: Sidebar item and routing

**Files:**
- Modify: `app/renderer/src/components/Sidebar.tsx`
- Modify: `app/renderer/src/App.tsx`
- Test: `app/test/renderer/sidebar.test.tsx`, `app/test/renderer/app.test.tsx`

**Interfaces:**
- Consumes: `SystemInfoView` from Task 9.
- Produces: `NavKey` includes `'system-info'`; `View` includes `{ name: 'system-info' }`.

- [ ] **Step 1: Update the sidebar tests first**

In `app/test/renderer/sidebar.test.tsx`:

1. Replace the `'keeps coming-soon items inert text, not controls'` test with:

```tsx
  it('keeps coming-soon items inert text, not controls', () => {
    renderSidebar();

    expect(screen.getByText('Coming soon')).toBeInTheDocument();
    expect(screen.getByText('Deep Uninstall')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Deep Uninstall' })).toBeNull();
    expect(screen.getAllByText('Soon')).toHaveLength(1);
  });
```

2. In `'meets contrast on the coming-soon group and keeps it out of the tab order'`, change `for (const label of ['Deep Uninstall', 'System Info'])` to `for (const label of ['Deep Uninstall'])`.

3. In `'navigates and opens settings from the nav'`, add after the Startup Manager click:

```tsx
    fireEvent.click(screen.getByRole('button', { name: 'System Info' }));
    expect(onNavigate).toHaveBeenCalledWith('system-info');
```

4. In `'keeps the collapse toggle and nav reachable in visual order'`, change the expected array to:

```tsx
    expect(controls.map((button) => button.getAttribute('aria-label') ?? button.textContent)).toEqual([
      'Collapse sidebar',
      'Dashboard',
      'Dev Cleanup',
      'Startup Manager',
      'Drives',
      'System Info',
      'Settings',
    ]);
```

- [ ] **Step 2: Run the sidebar tests to verify they fail**

Run: `npm run test -w app -- test/renderer/sidebar.test.tsx`
Expected: FAIL — no button named `System Info`, and the coming-soon count is still 2.

- [ ] **Step 3: Update the sidebar**

In `app/renderer/src/components/Sidebar.tsx`:

1. Add `InfoIcon` to the icon import.
2. Change `export type NavKey = 'dashboard' | 'dev-cleanup' | 'startup' | 'drives';` to include `'system-info'`.
3. Change `const COMING_SOON = ['Deep Uninstall', 'System Info'];` to `const COMING_SOON = ['Deep Uninstall'];`.
4. Add after the Drives `NavButton` (before Settings):

```tsx
        <NavButton
          icon={InfoIcon}
          label="System Info"
          collapsed={collapsed}
          active={active === 'system-info'}
          onClick={() => onNavigate('system-info')}
        />
```

- [ ] **Step 4: Run the sidebar tests to verify they pass**

Run: `npm run test -w app -- test/renderer/sidebar.test.tsx`
Expected: PASS.

- [ ] **Step 5: Add the App routing test**

In `app/test/renderer/app.test.tsx`, add before the closing `});`:

```tsx
  it('opens System Info from the sidebar', async () => {
    const api = makeApi();
    render(<App api={api} />);

    fireEvent.click(await screen.findByRole('button', { name: 'System Info' }));
    expect(await screen.findByRole('heading', { name: 'System Info' })).toBeInTheDocument();
    expect(await screen.findByText('Windows 11 Pro 25H2')).toBeInTheDocument();
  });
```

- [ ] **Step 6: Run it to verify it fails**

Run: `npm run test -w app -- test/renderer/app.test.tsx`
Expected: FAIL — clicking the nav item does not change the view.

- [ ] **Step 7: Route the page in App.tsx**

In `app/renderer/src/App.tsx`:

1. Add `import { SystemInfoView } from './pages/SystemInfoView';` (alphabetical, after `StartupView`).
2. Add `| { name: 'system-info' }` to the `View` union.
3. Add to `navFor`:

```ts
    case 'system-info':
      return 'system-info';
```

4. Add to `navigate`:

```ts
      else if (key === 'system-info') setView({ name: 'system-info' });
```

5. Add to the content chain, after the `startup` branch:

```tsx
  } else if (view.name === 'system-info') {
    content = <SystemInfoView api={api} />;
```

- [ ] **Step 8: Run the renderer tests to verify they pass**

Run: `npm run test -w app -- test/renderer/app.test.tsx test/renderer/sidebar.test.tsx`
Expected: PASS.

- [ ] **Step 9: Typecheck and commit**

Run: `npm run typecheck -w app`
Expected: clean.

```bash
git add app/renderer/src/components/Sidebar.tsx app/renderer/src/App.tsx app/test/renderer/sidebar.test.tsx app/test/renderer/app.test.tsx
git commit -m "feat(app): add System Info to the sidebar and routing"
```

---

### Task 11: Documentation and full verification

**Files:**
- Modify: `README.md`
- Modify: `PROJECT_BRIEF.md`
- Modify: `app/DESIGN.md`

**Interfaces:**
- Consumes: the shipped feature.
- Produces: nothing.

- [ ] **Step 1: Add the README feature section**

In `README.md`, after the `### Startup Manager` section (ends at line 72) and before `### Browse-only volumes`, insert:

```md
### System Info

A read-only view of the machine: OS name, version, build, and architecture; hostname and uptime; CPU model with physical cores and logical threads; every reported display adapter with its driver version; and motherboard/BIOS when Windows reports them. CPU and memory usage update live while the page is open; everything else is captured once and refreshed on demand. **Copy system info** produces a plain-text block for bug reports with no serial numbers, MAC addresses, or IP addresses.
```

- [ ] **Step 2: Add the README smoke checklist**

In `README.md`, after the `### Startup Manager smoke checklist` list (ends at line 169) and before `### Development flags`, insert:

```md
### System Info smoke checklist

1. `npm run dev:app`, open **System Info**: the page shows a captured timestamp, OS/build/architecture, hostname, uptime, CPU model with cores and threads, every reported display adapter with its driver version, and motherboard/BIOS when the machine reports them.
2. CPU and memory figures update every ~1.5 seconds while the page is open; leaving the page stops the polling.
3. **Refresh** re-queries the machine and updates the captured timestamp.
4. **Copy system info** copies the formatted block and shows the "System info copied." toast; the block contains no serial numbers, MAC addresses, or IP addresses.
5. On a machine or VM with no discrete GPU, the page renders without a Graphics section (or with the adapters Windows reports) and never shows an error; on any machine, no administrator prompt appears.
```

- [ ] **Step 3: Update the README project structure line**

In `README.md`, change:

```
  src/system/                Volume enumeration, drive types, cluster size
```

to:

```
  src/system/                Volume enumeration, drive types, cluster size, system info
```

- [ ] **Step 4: Update the project brief**

In `PROJECT_BRIEF.md`, add a bullet to "What the app does today (MVP)" after the Startup-related coverage (before `- **Snapshot persistence**`):

```md
- **System Info** — a read-only OS/CPU/GPU/firmware snapshot with live CPU and memory usage, and a copyable plain-text report for bug reports. No elevation, nothing written to disk, no serial numbers or addresses.
```

- [ ] **Step 5: Fix the stale coming-soon example in the design system**

In `app/DESIGN.md` line 269, change the example list from `(Deep Uninstall, Startup Manager, System Info)` to `(Deep Uninstall)` — Startup Manager and System Info have both shipped.

- [ ] **Step 6: Run the full suites and typecheck**

Run: `npm run typecheck`
Expected: clean across both workspaces.

Run: `npm test`
Expected: all core, host, and renderer tests pass, including the new ones and the updated sidebar/app/IPC contract tests.

- [ ] **Step 7: Manual smoke in the real app**

Run: `npm run dev:app`, then walk the README **System Info smoke checklist** items 1–5. Confirm the real page shows this machine's values (validated during planning: OS "Windows 11 Pro" 25H2, build `26200.9457`, GPU "NVIDIA GeForce RTX 4060" driver `32.0.16.1714`, board "Micro-Star International Co., Ltd. B450M-A PRO MAX II (MS-7C52)", BIOS "A.10 (2023-10-26)") and that Copy pastes the exact block format.

- [ ] **Step 8: Commit**

```bash
git add README.md PROJECT_BRIEF.md app/DESIGN.md
git commit -m "docs: document System Info and its smoke checklist"
```

---

## Self-review notes

- **Spec coverage:** every reviewed decision maps to a task — live cluster + static snapshot (Tasks 2, 5, 9), storage excluded (no task touches volumes), motherboard/BIOS batched (Tasks 1–2), copy block (Tasks 8–9), VRAM/speed omitted (absent by construction), no name filtering (parser passes through all adapters, Task 1), nullable end-to-end (Tasks 1, 2, 9), no elevation (no code path), 5-minute TTL + never-cached live (Task 5), no disk persistence (in-memory only), privacy (script never selects identifiers; Task 1 test asserts `SerialNumber` is absent).
- **Type consistency:** `SystemInfoStatic`/`SystemInfoLive` are defined once in `core/src/system/system-info.ts`, re-exported from `@dust/core` and `shared/ipc`; `MemoryInfo` replaces the inline memory shape in the host service; `formatOsName` is used by both the copy block and the view.
- **Placeholder scan:** no TBDs; every code step contains the full file or exact diff instructions; every test step contains real assertions.
- **Known limitation:** the `This PC` card renders only when at least one of its values is present (Task 9 guard) — a machine with a broken registry read but working WMI still shows Build/Arch from the Node fallbacks, so the card is not empty in practice.
