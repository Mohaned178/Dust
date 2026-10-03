import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { NodeFsEnumerator } from '../src/scanner/enumerator';
import { WindowsFindEnumerator, createPlatformEnumerator } from '../src/scanner/win-enumerator';
import { Fixture } from './fixtures';

const onWindows = process.platform === 'win32';

interface NormalizedEntry {
  name: string;
  kind: string;
  size: number;
  mtimeMs: number;
}

function normalize(entries: { name: string; kind: string; size: number; mtimeMs: number }[]): NormalizedEntry[] {
  return entries
    .map((entry) => ({
      name: entry.name,
      kind: entry.kind,
      size: entry.size,
      mtimeMs: entry.mtimeMs,
    }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

describe.runIf(onWindows)('WindowsFindEnumerator', () => {
  let fixture: Fixture;

  beforeEach(() => {
    fixture = new Fixture();
  });

  afterEach(() => {
    fixture.cleanup();
  });

  it('matches NodeFsEnumerator for files, directories, and links', () => {
    fixture.file('a.txt', 'hello', 1_700_000_000_123.5);
    fixture.file('sub/b.bin', '0123456789', 1_700_000_100_000);
    fixture.dir('empty');
    fixture.link('linked', join(fixture.root, 'sub'));

    const expected = new NodeFsEnumerator().list(fixture.root);
    const actual = new WindowsFindEnumerator().list(fixture.root);

    expect(normalize(actual.entries)).toEqual(normalize(expected.entries));
    expect(actual.entryErrors).toBe(0);
  });

  it('does not follow links and reports them with zero size', () => {
    fixture.file('real/inner.txt', '12345');
    fixture.link('linked', join(fixture.root, 'real'));

    const result = new WindowsFindEnumerator().list(fixture.root);
    const link = result.entries.find((entry) => entry.name === 'linked');

    expect(link).toMatchObject({ kind: 'link', size: 0, mtimeMs: 0 });
    expect(result.entries.some((entry) => entry.name === 'inner.txt')).toBe(false);
  });

  it('lists long paths beyond the legacy MAX_PATH limit', () => {
    const deep = Array.from({ length: 30 }, (_, index) => `level-${index}-xxxxxxxxxxxxxxxxxxxx`).join('/');
    fixture.file(`${deep}/deep.txt`, 'deep');
    const dir = join(fixture.root, ...deep.split('/'));

    const result = new WindowsFindEnumerator().list(dir);
    expect(result.entries.find((entry) => entry.name === 'deep.txt')).toMatchObject({
      kind: 'file',
      size: 4,
    });
  });

  it('throws for a missing directory', () => {
    expect(() => new WindowsFindEnumerator().list(join(fixture.root, 'nope'))).toThrow();
  });
});

describe.runIf(onWindows)('createPlatformEnumerator', () => {
  it('prefers the Windows enumerator by default', () => {
    const previous = process.env.DUST_ENUMERATOR;
    delete process.env.DUST_ENUMERATOR;
    try {
      expect(createPlatformEnumerator()).toBeInstanceOf(WindowsFindEnumerator);
    } finally {
      if (previous === undefined) delete process.env.DUST_ENUMERATOR;
      else process.env.DUST_ENUMERATOR = previous;
    }
  });

  it('falls back to the Node enumerator when disabled', () => {
    const previous = process.env.DUST_ENUMERATOR;
    process.env.DUST_ENUMERATOR = 'node';
    try {
      expect(createPlatformEnumerator()).toBeInstanceOf(NodeFsEnumerator);
    } finally {
      if (previous === undefined) delete process.env.DUST_ENUMERATOR;
      else process.env.DUST_ENUMERATOR = previous;
    }
  });
});
