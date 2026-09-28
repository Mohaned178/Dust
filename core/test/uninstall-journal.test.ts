import { afterEach, describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Journal, journalPathFor, parseJournal } from '../src/uninstall/journal';
import { UNINSTALL_JOURNAL_VERSION } from '../src/uninstall/types';
import { Fixture } from './fixtures';

const fixtures: Fixture[] = [];

afterEach(() => {
  for (const fixture of fixtures.splice(0)) fixture.cleanup();
});

describe('journalPathFor', () => {
  it('lives next to the snapshot in the user data directory', () => {
    expect(journalPathFor('C:\\Users\\x\\AppData\\Roaming\\Dust')).toBe(
      join('C:\\Users\\x\\AppData\\Roaming\\Dust', 'uninstall-history.log'),
    );
  });
});

describe('Journal', () => {
  it('appends versioned json lines in order with plan and app identity', () => {
    const fixture = new Fixture();
    fixtures.push(fixture);
    const path = join(fixture.root, 'uninstall-history.log');
    let clock = 1000;
    const journal = new Journal({ path, planId: 'plan-1', appId: 'app-1', now: () => clock++ });

    journal.append('started', { appName: 'FooApp' });
    journal.append('phase', { phase: 'backup', status: 'done' });
    journal.append('finished', { outcome: 'complete' });

    const lines = readFileSync(path, 'utf8').trim().split('\n').map((line) => JSON.parse(line));
    expect(lines).toEqual([
      { v: UNINSTALL_JOURNAL_VERSION, ts: 1000, kind: 'started', planId: 'plan-1', appId: 'app-1', appName: 'FooApp' },
      { v: UNINSTALL_JOURNAL_VERSION, ts: 1001, kind: 'phase', planId: 'plan-1', appId: 'app-1', phase: 'backup', status: 'done' },
      { v: UNINSTALL_JOURNAL_VERSION, ts: 1002, kind: 'finished', planId: 'plan-1', appId: 'app-1', outcome: 'complete' },
    ]);
  });

  it('creates missing directories and never throws when the writer fails', () => {
    const fixture = new Fixture();
    fixtures.push(fixture);
    const nested = join(fixture.root, 'deep', 'dir', 'history.log');
    const journal = new Journal({ path: nested, planId: 'p', appId: 'a', now: () => 1 });
    journal.append('started');
    expect(readFileSync(nested, 'utf8')).toContain('"kind":"started"');

    let calls = 0;
    const failing = new Journal({
      path: nested,
      planId: 'p',
      appId: 'a',
      write: () => {
        calls += 1;
        throw new Error('disk full');
      },
    });
    expect(() => failing.append('started')).not.toThrow();
    expect(() => failing.append('finished')).not.toThrow();
    expect(calls).toBe(1);
  });
});

describe('parseJournal', () => {
  it('round-trips journal lines and skips malformed ones', () => {
    const raw = [
      JSON.stringify({ v: 1, ts: 1, kind: 'started', planId: 'p', appId: 'a' }),
      'not json',
      JSON.stringify({ v: 1, ts: 2, kind: 'finished', planId: 'p', appId: 'a' }),
      '',
    ].join('\n');
    const lines = parseJournal(raw);
    expect(lines?.map((line) => line.kind)).toEqual(['started', 'finished']);
    expect(parseJournal('')).toEqual([]);
  });

  it('drops objects that are not journal lines', () => {
    const raw = [JSON.stringify({ hello: 'world' }), JSON.stringify([1, 2, 3])].join('\n');
    expect(parseJournal(raw)).toEqual([]);
  });
});
