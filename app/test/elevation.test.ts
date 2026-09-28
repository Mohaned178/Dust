import { describe, expect, it } from 'vitest';
import { join } from 'node:path';
import {
  ELEVATED_FLAG,
  awaitElevatedStartup,
  buildElevationCommand,
  buildElevationLaunchCommand,
  decideElevation,
  elevationAckPath,
  elevationArgs,
  encodePowerShellCommand,
  hasElevatedFlag,
} from '../src/main/elevation';

describe('buildElevationCommand', () => {
  it('builds a Start-Process command without arguments', () => {
    expect(buildElevationCommand('C:\\Apps\\Dust\\Dust.exe', [])).toBe(
      "Start-Process -FilePath 'C:\\Apps\\Dust\\Dust.exe' -Verb RunAs",
    );
  });

  it('quotes arguments and doubles embedded quotes', () => {
    expect(buildElevationCommand('C:\\Dust.exe', ["C:\\it's here"])).toBe(
      "Start-Process -FilePath 'C:\\Dust.exe' -ArgumentList 'C:\\it''s here' -Verb RunAs",
    );
  });
});

describe('buildElevationLaunchCommand', () => {
  it('launches elevated, waits for the ready signal, and reports real outcomes', () => {
    const script = buildElevationLaunchCommand(
      'C:\\Dust.exe',
      ["C:\\app's path", '--dust-elevated'],
      'C:\\Data\\elevated.ready',
    );
    expect(script).toContain("Start-Process -FilePath 'C:\\Dust.exe'");
    expect(script).toContain("-ArgumentList 'C:\\app''s path','--dust-elevated' -Verb RunAs -PassThru");
    expect(script).toContain("$ack = 'C:\\Data\\elevated.ready'");
    expect(script).toContain('exit 2');
    expect(script).toContain('exit 3');
    expect(script).toContain('exit 4');
    expect(script).toContain('Test-Path -LiteralPath $ack');
    expect(script).toContain('$p.HasExited');
  });

  it('omits the argument list when there is nothing to pass', () => {
    const script = buildElevationLaunchCommand('C:\\Dust.exe', [], 'C:\\a.ready');
    expect(script).toContain('-Verb RunAs -PassThru');
    expect(script).not.toContain('-ArgumentList');
  });
});

describe('elevation flags and args', () => {
  it('encodes scripts for -EncodedCommand without quoting hazards', () => {
    const script = '$a = "x"; [Console]::Error.WriteLine(\'ok\')\n';
    const encoded = encodePowerShellCommand(script);
    expect(Buffer.from(encoded, 'base64').toString('utf16le')).toBe(script);
  });
  it('detects the elevated marker', () => {
    expect(hasElevatedFlag(['electron.exe', ELEVATED_FLAG])).toBe(true);
    expect(hasElevatedFlag(['electron.exe', '--other'])).toBe(false);
    expect(hasElevatedFlag([])).toBe(false);
  });

  it('forwards packaged args and appends the marker once', () => {
    expect(
      elevationArgs({
        packaged: true,
        appPath: 'C:\\Dust\\resources\\app',
        argv: ['Dust.exe', '--dust-uninstall=abc', ELEVATED_FLAG, '--extra'],
      }),
    ).toEqual(['--dust-uninstall=abc', '--extra', ELEVATED_FLAG]);
  });

  it('forwards an unpackaged app path plus args', () => {
    expect(
      elevationArgs({
        packaged: false,
        appPath: 'F:\\Dust\\app',
        argv: ['electron.exe', 'F:\\Dust\\app', '--dust-uninstall=abc'],
      }),
    ).toEqual(['F:\\Dust\\app', '--dust-uninstall=abc', ELEVATED_FLAG]);
  });
});

describe('decideElevation', () => {
  it('runs as-is on other platforms, when already elevated, or when already relaunched', () => {
    expect(decideElevation({ platform: 'linux', argv: [], isElevated: false })).toBe('run');
    expect(decideElevation({ platform: 'win32', argv: [], isElevated: true })).toBe('run');
    expect(decideElevation({ platform: 'win32', argv: [ELEVATED_FLAG], isElevated: false })).toBe('run');
  });

  it('requests elevation on Windows when not elevated', () => {
    expect(decideElevation({ platform: 'win32', argv: ['electron.exe'], isElevated: false })).toBe('relaunch');
  });
});

describe('elevationAckPath', () => {
  it('lives in the user data directory', () => {
    expect(elevationAckPath('C:\\Users\\x\\AppData\\Roaming\\Dust')).toBe(
      join('C:\\Users\\x\\AppData\\Roaming\\Dust', 'elevated.ready'),
    );
  });
});

describe('awaitElevatedStartup', () => {
  function clockControl(): { now: () => number; sleep: (ms: number) => Promise<void> } {
    let clock = 0;
    return {
      now: () => clock,
      sleep: async (ms: number) => {
        clock += ms;
      },
    };
  }

  it('returns ready when the elevated instance signals it loaded', async () => {
    const clock = clockControl();
    const outcome = await awaitElevatedStartup({
      spawn: () => ({ exited: new Promise<number | null>(() => {}) }),
      ackExists: () => true,
      now: clock.now,
      sleep: clock.sleep,
    });
    expect(outcome).toBe('ready');
  });

  it('returns declined when the elevation prompt is refused', async () => {
    const clock = clockControl();
    const outcome = await awaitElevatedStartup({
      spawn: () => ({ exited: Promise.resolve(2) }),
      ackExists: () => false,
      now: clock.now,
      sleep: clock.sleep,
      pollMs: 250,
    });
    expect(outcome).toBe('declined');
  });

  it('returns failed when the elevated launch reports an error', async () => {
    const clock = clockControl();
    const outcome = await awaitElevatedStartup({
      spawn: () => ({ exited: Promise.resolve(3) }),
      ackExists: () => false,
      now: clock.now,
      sleep: clock.sleep,
      pollMs: 250,
    });
    expect(outcome).toBe('failed');
  });

  it('returns failed when the elevated instance exits without loading', async () => {
    const clock = clockControl();
    const outcome = await awaitElevatedStartup({
      spawn: () => ({ exited: Promise.resolve(0) }),
      ackExists: () => false,
      now: clock.now,
      sleep: clock.sleep,
      pollMs: 250,
      ackGraceMs: 500,
    });
    expect(outcome).toBe('failed');
  });

  it('waits for the ack while the elevated instance is starting', async () => {
    const clock = clockControl();
    let checks = 0;
    const outcome = await awaitElevatedStartup({
      spawn: () => ({ exited: new Promise<number | null>(() => {}) }),
      ackExists: () => {
        checks += 1;
        return checks > 2;
      },
      now: clock.now,
      sleep: clock.sleep,
      pollMs: 250,
    });
    expect(outcome).toBe('ready');
  });

  it('gives up after the timeout when nothing happens', async () => {
    const clock = clockControl();
    const outcome = await awaitElevatedStartup({
      spawn: () => ({ exited: new Promise<number | null>(() => {}) }),
      ackExists: () => false,
      now: clock.now,
      sleep: clock.sleep,
      pollMs: 250,
      timeoutMs: 1000,
    });
    expect(outcome).toBe('failed');
  });
});
