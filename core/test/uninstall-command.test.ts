import { describe, expect, it } from 'vitest';
import { buildSilentOption, parseUninstallCommand, tokenizeCommandLine } from '../src/uninstall/command';

const exists = () => true;
const missing = () => false;

describe('parseUninstallCommand', () => {
  it('rejects empty and malformed strings', () => {
    expect(parseUninstallCommand('', { exists })).toMatchObject({
      kind: 'unknown',
      executable: '',
      args: [],
      launchable: false,
      blockReason: 'malformed',
    });
    expect(parseUninstallCommand('   ', { exists }).kind).toBe('unknown');
    expect(parseUninstallCommand('unins000', { exists })).toMatchObject({
      kind: 'unknown',
      launchable: false,
      blockReason: 'malformed',
    });
    expect(parseUninstallCommand('"C:\\Broken\\uninst.exe', { exists })).toMatchObject({
      kind: 'unknown',
      launchable: false,
      blockReason: 'malformed',
    });
  });

  it('parses a quoted executable with arguments', () => {
    const command = parseUninstallCommand('"C:\\Program Files\\Foo\\uninstall.exe" /S /remove', { exists });
    expect(command).toMatchObject({
      kind: 'exe',
      executable: 'C:\\Program Files\\Foo\\uninstall.exe',
      args: ['/S', '/remove'],
      exeExists: true,
      launchable: true,
      blockReason: null,
    });
    expect(command.raw).toBe('"C:\\Program Files\\Foo\\uninstall.exe" /S /remove');
  });

  it('parses an unquoted executable path with spaces', () => {
    const command = parseUninstallCommand('C:\\Program Files\\Foo\\uninstall.exe /S', { exists });
    expect(command.executable).toBe('C:\\Program Files\\Foo\\uninstall.exe');
    expect(command.args).toEqual(['/S']);
    expect(command.kind).toBe('exe');
  });

  it('detects case-insensitive .EXE extensions and missing executables', () => {
    expect(parseUninstallCommand('C:\\Foo\\UNINST.EXE', { exists }).kind).toBe('exe');
    expect(parseUninstallCommand('C:\\Foo\\uninst.exe', { exists: missing })).toMatchObject({
      kind: 'exe',
      exeExists: false,
      launchable: false,
      blockReason: 'missing-exe',
    });
  });

  it('keeps quoted argument values as single tokens', () => {
    const command = parseUninstallCommand('"C:\\Foo\\uninst.exe" /path "C:\\has space" /q', { exists });
    expect(command.args).toEqual(['/path', 'C:\\has space', '/q']);
  });

  it('expands environment variables in the executable', () => {
    const command = parseUninstallCommand('%ProgramFiles%\\Foo\\uninstall.exe /S', {
      exists,
      env: { ProgramFiles: 'C:\\Program Files' },
    });
    expect(command.executable).toBe('C:\\Program Files\\Foo\\uninstall.exe');
    expect(command.launchable).toBe(true);
  });

  it('recognizes msiexec /X and extracts the product code', () => {
    const command = parseUninstallCommand('MsiExec.exe /X{90160000-008C-0000-1000-0000000FF1CE}', { exists });
    expect(command).toMatchObject({
      kind: 'msi',
      executable: 'MsiExec.exe',
      msiProductCode: '{90160000-008C-0000-1000-0000000FF1CE}',
      launchable: true,
      blockReason: null,
    });
    expect(command.args).toEqual(['/X{90160000-008C-0000-1000-0000000FF1CE}']);
  });

  it('recognizes msiexec /I, /package and /uninstall forms', () => {
    const i = parseUninstallCommand('MsiExec.exe /I{11111111-2222-3333-4444-555555555555}', { exists });
    expect(i.msiProductCode).toBe('{11111111-2222-3333-4444-555555555555}');

    const split = parseUninstallCommand('MsiExec.exe /X {11111111-2222-3333-4444-555555555555} /qn', { exists });
    expect(split.msiProductCode).toBe('{11111111-2222-3333-4444-555555555555}');

    const pkg = parseUninstallCommand('msiexec.exe /package {11111111-2222-3333-4444-555555555555}', { exists });
    expect(pkg.kind).toBe('msi');
    expect(pkg.msiProductCode).toBe('{11111111-2222-3333-4444-555555555555}');

    const uninstall = parseUninstallCommand('MsiExec.exe /uninstall {11111111-2222-3333-4444-555555555555}', {
      exists,
    });
    expect(uninstall.msiProductCode).toBe('{11111111-2222-3333-4444-555555555555}');
  });

  it('checks an absolute msiexec path for existence', () => {
    const command = parseUninstallCommand(
      'C:\\Windows\\System32\\msiexec.exe /X{11111111-2222-3333-4444-555555555555}',
      {
        exists: missing,
      },
    );
    expect(command.kind).toBe('msi');
    expect(command.exeExists).toBe(false);
    expect(command.blockReason).toBe('missing-exe');
  });

  it('refuses bare executable names that cannot be verified', () => {
    const command = parseUninstallCommand('uninstall.exe /S', { exists: () => true });
    expect(command).toMatchObject({
      kind: 'exe',
      executable: 'uninstall.exe',
      exeExists: false,
      launchable: false,
      blockReason: 'not-absolute',
    });
  });

  it('classifies rundll32 uninstallers', () => {
    const command = parseUninstallCommand('rundll32.exe "C:\\Foo\\setup.dll",Uninstall', { exists });
    expect(command).toMatchObject({ kind: 'rundll32', executable: 'rundll32.exe', launchable: true });
    expect(command.args).toEqual(['C:\\Foo\\setup.dll,Uninstall']);
  });

  it('classifies URL-protocol uninstallers as not launchable', () => {
    expect(parseUninstallCommand('steam://uninstall/570', { exists })).toMatchObject({
      kind: 'url',
      launchable: false,
      blockReason: 'url-protocol',
    });
    expect(parseUninstallCommand('"ms-windows-store://uninstall"', { exists }).kind).toBe('url');
  });

  it('does not mistake drive letters for URL schemes', () => {
    expect(parseUninstallCommand('C:\\Program Files\\Foo\\uninstall.exe', { exists }).kind).toBe('exe');
  });
});

describe('tokenizeCommandLine', () => {
  it('splits on whitespace and drops quotes', () => {
    expect(tokenizeCommandLine('  /S   /D="C:\\Dir"  ')).toEqual(['/S', '/D=C:\\Dir']);
  });

  it('returns an empty list for blank input', () => {
    expect(tokenizeCommandLine('   ')).toEqual([]);
  });
});

describe('buildSilentOption', () => {
  const msi = parseUninstallCommand('MsiExec.exe /X{11111111-2222-3333-4444-555555555555}', { exists });

  it('builds a deterministic silent msiexec command for MSI apps with a quiet string', () => {
    const silent = buildSilentOption({
      command: msi,
      quietUninstallString: 'MsiExec.exe /X{11111111-2222-3333-4444-555555555555} /qn',
      windowsInstaller: true,
    });
    expect(silent).toEqual({
      args: ['/x', '{11111111-2222-3333-4444-555555555555}', '/qn', '/norestart'],
      source: 'msi-default',
      wellFormed: true,
    });
  });

  it('uninstalls any MSI product quietly without needing a quiet string', () => {
    for (const quietUninstallString of ['', '   ', 'not a command']) {
      expect(buildSilentOption({ command: msi, quietUninstallString, windowsInstaller: false })?.args).toEqual([
        '/x',
        msi.msiProductCode,
        '/qn',
        '/norestart',
      ]);
    }
  });

  it('requires the MSI product code', () => {
    const noCode = parseUninstallCommand('MsiExec.exe /qb', { exists });
    expect(
      buildSilentOption({
        command: noCode,
        quietUninstallString: 'MsiExec.exe /qb',
        windowsInstaller: true,
      }),
    ).toBeNull();
  });

  it("uses a non-MSI app's own quiet command only when it runs the same uninstaller", () => {
    const exe = parseUninstallCommand('"C:\\Foo\\uninst.exe"', { exists });
    expect(
      buildSilentOption({ command: exe, quietUninstallString: '"C:\\Foo\\uninst.exe" /S', windowsInstaller: false }),
    ).toEqual({ args: ['/S'], source: 'quiet-string', wellFormed: true });
    expect(
      buildSilentOption({ command: exe, quietUninstallString: '"C:\\Other\\tool.exe" /S', windowsInstaller: false }),
    ).toBeNull();
    expect(buildSilentOption({ command: exe, quietUninstallString: '', windowsInstaller: false })).toBeNull();
  });
});
