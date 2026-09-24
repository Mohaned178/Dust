import { execFileSync } from 'node:child_process';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  LIST_VOLUMES_SCRIPT,
  createExternalPredicate,
  listVolumes,
  listVolumesAsync,
  mapDriveType,
  parseVolumesJson,
  systemDriveRoot,
  volumeRootOf,
} from '../src/system/drive-type';

describe('mapDriveType', () => {
  it('maps the Windows drive-type strings', () => {
    expect(mapDriveType('Fixed')).toBe('fixed');
    expect(mapDriveType('Removable')).toBe('removable');
    expect(mapDriveType('Network')).toBe('network');
    expect(mapDriveType('CD-ROM')).toBe('cdrom');
    expect(mapDriveType('RAM')).toBe('ram');
    expect(mapDriveType('Whatever')).toBe('unknown');
    expect(mapDriveType(undefined)).toBe('unknown');
  });
});

describe('parseVolumesJson', () => {
  it('parses the array form and normalizes roots and labels', () => {
    const volumes = parseVolumesJson(
      JSON.stringify([
        { root: 'c:\\', FileSystemLabel: 'System', DriveType: 'Fixed' },
        { root: 'E:\\', FileSystemLabel: '', DriveType: 'Removable' },
      ]),
    );
    expect(volumes).toEqual([
      { root: 'C:\\', label: 'System', driveType: 'fixed', mediaType: 'unknown' },
      { root: 'E:\\', label: null, driveType: 'removable', mediaType: 'unknown' },
    ]);
  });

  it('parses the single-object form', () => {
    expect(parseVolumesJson(JSON.stringify({ root: 'D:\\', FileSystemLabel: null, DriveType: 'Network' }))).toEqual([
      { root: 'D:\\', label: null, driveType: 'network', mediaType: 'unknown' },
    ]);
  });

  it('returns nothing for garbage or malformed entries', () => {
    expect(parseVolumesJson('{oops')).toEqual([]);
    expect(parseVolumesJson(JSON.stringify([{ root: 'not-a-root' }, null, 'x']))).toEqual([]);
  });

  it('maps media types to ssd, hdd, or unknown', () => {
    const volumes = parseVolumesJson(
      JSON.stringify([
        { root: 'C:\\', FileSystemLabel: 'System', DriveType: 'Fixed', MediaType: 'SSD' },
        { root: 'F:\\', FileSystemLabel: 'Data', DriveType: 'Fixed', MediaType: 'HDD' },
        { root: 'E:\\', FileSystemLabel: '', DriveType: 'Removable', MediaType: 'Unspecified' },
      ]),
    );
    expect(volumes.map((volume) => volume.mediaType)).toEqual(['ssd', 'hdd', 'unknown']);
  });
});

describe('volumeRootOf', () => {
  it('returns the drive root for absolute Windows paths', () => {
    expect(volumeRootOf('C:\\Users\\x\\file.txt')).toBe('C:\\');
    expect(volumeRootOf('F:\\')).toBe('F:\\');
  });

  it('returns null for relative or non-drive paths', () => {
    expect(volumeRootOf('junk\\file.txt')).toBeNull();
    expect(volumeRootOf('\\\\server\\share\\file')).toBeNull();
  });

  it('normalizes forward slashes', () => {
    expect(volumeRootOf('C:/Users/x')).toBe('C:\\');
  });
});

describe('systemDriveRoot', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('derives the boot volume from the Windows directory', () => {
    expect(systemDriveRoot({ windowsDir: 'D:\\Windows' })).toBe('D:\\');
    expect(systemDriveRoot({ windowsDir: 'c:\\Windows' })).toBe('C:\\');
  });

  it('falls back to %SystemDrive%', () => {
    vi.stubEnv('SystemRoot', '');
    vi.stubEnv('windir', '');
    vi.stubEnv('SystemDrive', 'e:');
    expect(systemDriveRoot()).toBe('E:\\');
  });

  it('returns null when no source is available', () => {
    vi.stubEnv('SystemRoot', '');
    vi.stubEnv('windir', '');
    vi.stubEnv('SystemDrive', '');
    expect(systemDriveRoot()).toBeNull();
  });
});

describe('createExternalPredicate', () => {
  const volumes = [
    { root: 'C:\\', label: null, driveType: 'fixed' as const, mediaType: 'unknown' as const },
    { root: 'E:\\', label: null, driveType: 'removable' as const, mediaType: 'unknown' as const },
    { root: 'N:\\', label: null, driveType: 'network' as const, mediaType: 'unknown' as const },
    { root: 'X:\\', label: null, driveType: 'unknown' as const, mediaType: 'unknown' as const },
  ];
  const isExternal = createExternalPredicate(volumes);

  it('flags removable and network volumes', () => {
    expect(isExternal('E:\\proj')).toBe(true);
    expect(isExternal('N:\\dev\\app')).toBe(true);
  });

  it('does not flag fixed or unknown volumes', () => {
    expect(isExternal('C:\\dev\\app')).toBe(false);
    expect(isExternal('X:\\whatever')).toBe(false);
    expect(isExternal('relative\\path')).toBe(false);
  });

  it('is case-insensitive', () => {
    expect(isExternal('e:\\proj')).toBe(true);
  });
});

describe('listVolumes', () => {
  it('lists real volumes with a matching shape on Windows', (ctx) => {
    if (process.platform !== 'win32') {
      ctx.skip();
      return;
    }
    const volumes = listVolumes();
    expect(volumes.length).toBeGreaterThan(0);
    for (const volume of volumes) {
      expect(volume.root).toMatch(/^[A-Za-z]:\\$/);
      expect(['fixed', 'removable', 'network', 'cdrom', 'ram', 'unknown']).toContain(volume.driveType);
      expect(['ssd', 'hdd', 'unknown']).toContain(volume.mediaType);
    }
  });

  it('keeps volume discovery working when the storage cmdlets fail', (ctx) => {
    if (process.platform !== 'win32') {
      ctx.skip();
      return;
    }
    const shadowed = [
      "function Get-Partition { [CmdletBinding()] param() throw 'Get-Partition unavailable' }",
      "function Get-PhysicalDisk { [CmdletBinding()] param() throw 'Get-PhysicalDisk unavailable' }",
      LIST_VOLUMES_SCRIPT,
    ].join('\n');
    const raw = execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', shadowed], {
      encoding: 'utf8',
      timeout: 15_000,
    });
    const volumes = parseVolumesJson(raw);
    expect(volumes.length).toBeGreaterThan(0);
    for (const volume of volumes) {
      expect(volume.mediaType).toBe('unknown');
    }
  });
});

describe('listVolumesAsync', () => {
  it('lists real volumes with a matching shape on Windows', async (ctx) => {
    if (process.platform !== 'win32') {
      ctx.skip();
      return;
    }
    const volumes = await listVolumesAsync();
    expect(volumes.length).toBeGreaterThan(0);
    for (const volume of volumes) {
      expect(volume.root).toMatch(/^[A-Za-z]:\\$/);
      expect(['fixed', 'removable', 'network', 'cdrom', 'ram', 'unknown']).toContain(volume.driveType);
      expect(['ssd', 'hdd', 'unknown']).toContain(volume.mediaType);
    }
  });
});
