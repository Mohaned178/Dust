import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ScanSession } from '../src/scanner/session';
import { Fixture } from './fixtures';

describe('scan pipeline', () => {
  let fixture: Fixture;

  beforeEach(() => {
    fixture = new Fixture();
  });

  afterEach(() => {
    fixture.cleanup();
  });

  it('produces a navigable tree with correct parent sizes after streaming child records', async () => {
    fixture.file('project/package.json', '{}');
    fixture.file('project/src/index.ts', 'xxxx');
    fixture.file('project/node_modules/dep/a.js', 'yyyyyy');
    fixture.file('other/data.txt', 'zz');

    let streamedFolders = 0;
    const result = await new ScanSession({
      root: fixture.root,
      pool: false,
      onFolder: () => {
        streamedFolders += 1;
      },
    }).start();

    expect(result.status).toBe('complete');
    expect(streamedFolders).toBe(5);

    const project = result.tree.get(join(fixture.root, 'project'));
    expect(project?.bytes).toBe(2 + 4 + 6);
    expect(result.tree.children(join(fixture.root, 'project')).map((c) => c.path)).toContain(
      join(fixture.root, 'project', 'node_modules'),
    );
    expect(result.tree.get(fixture.root)?.bytes).toBe(14);
  });

  it('keeps junction rows inert: zero bytes, not followed, still linked in the tree', async (ctx) => {
    fixture.file('real/data.bin', '1234567890');
    try {
      fixture.link('alias', join(fixture.root, 'real'));
    } catch {
      ctx.skip();
      return;
    }

    const result = await new ScanSession({ root: fixture.root, pool: false }).start();
    const alias = result.tree.get(join(fixture.root, 'alias'));

    expect(alias?.bytes).toBe(0);
    expect(result.tree.get(fixture.root)?.bytes).toBe(10);
  });
});
