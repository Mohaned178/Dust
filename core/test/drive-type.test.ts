import { afterEach, describe, expect, it, vi } from 'vitest';
import {
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
      { root: 'C:\\', label: 'System', driveType: 'fixed' },
      { root: 'E:\\', label: null, driveType: 'removable' },
    ]);
  });

  it('parses the single-object form', () => {
    expect(parseVolumesJson(JSON.stringify({ root: 'D:\\', FileSystemLabel: null, DriveType: 'Network' }))).toEqual([
      { root: 'D:\\', label: null, driveType: 'network' },
    ]);
  });

  it('returns nothing for garbage or malformed entries', () => {
    expect(parseVolumesJson('{oops')).toEqual([]);
    expect(parseVolumesJson(JSON.stringify([{ root: 'not-a-root' }, null, 'x']))).toEqual([]);
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
    { root: 'C:\\', label: null, driveType: 'fixed' as const },
    { root: 'E:\\', label: null, driveType: 'removable' as const },
    { root: 'N:\\', label: null, driveType: 'network' as const },
    { root: 'X:\\', label: null, driveType: 'unknown' as const },
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
    }
  });
});
