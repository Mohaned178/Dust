import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { NodeFsEnumerator } from '../src/scanner/enumerator';
import { Fixture } from './fixtures';

describe('NodeFsEnumerator', () => {
  let fixture: Fixture;

  beforeEach(() => {
    fixture = new Fixture();
  });

  afterEach(() => {
    fixture.cleanup();
  });

  it('lists files with size and mtime, directories with zeros', () => {
    fixture.file('a.txt', 'hello', 1_700_000_000_000);
    fixture.dir('sub');
    const result = new NodeFsEnumerator().list(fixture.root);

    const file = result.entries.find((e) => e.name === 'a.txt');
    expect(file).toMatchObject({ kind: 'file', size: 5, mtimeMs: 1_700_000_000_000 });
    const dir = result.entries.find((e) => e.name === 'sub');
    expect(dir).toMatchObject({ kind: 'dir', size: 0, mtimeMs: 0 });
    expect(result.entryErrors).toBe(0);
  });

  it('reports links as kind link with zero size and does not follow them', (ctx) => {
    fixture.file('real/inner.txt', '12345');
    try {
      fixture.link('linked', join(fixture.root, 'real'));
    } catch {
      ctx.skip();
      return;
    }
    const result = new NodeFsEnumerator().list(fixture.root);

    const link = result.entries.find((e) => e.name === 'linked');
    expect(link).toMatchObject({ kind: 'link', size: 0, mtimeMs: 0 });
  });

  it('throws for a missing directory', () => {
    expect(() => new NodeFsEnumerator().list(join(fixture.root, 'nope'))).toThrow();
  });
});
