import { describe, expect, it } from 'vitest';
import { emptyResource, loadResource } from '../../../renderer-next/src/lib/resource';
import type { Resource } from '../../../renderer-next/src/lib/resource';

function holder() {
  let value: Resource<string> = emptyResource<string>();
  return {
    access: {
      get: () => value,
      set: (next: Resource<string>) => {
        value = next;
      },
    },
    read: () => value,
  };
}

describe('loadResource', () => {
  it('shows the old data while a refresh runs, then the new data', async () => {
    const key = {};
    const { access, read } = holder();
    await loadResource(key, access, async () => 'first');
    let release: (value: string) => void = () => {};
    const second = loadResource(
      key,
      access,
      () =>
        new Promise<string>((resolve) => {
          release = resolve;
        }),
      { force: true },
    );
    expect(read()).toMatchObject({ data: 'first', loading: true });
    release('second');
    await second;
    expect(read()).toMatchObject({ data: 'second', loading: false, error: null });
  });

  it('joins a load already running', async () => {
    const key = {};
    const { access } = holder();
    let calls = 0;
    const load = async () => {
      calls += 1;
      return 'x';
    };
    await Promise.all([loadResource(key, access, load), loadResource(key, access, load)]);
    expect(calls).toBe(1);
  });

  it('drops the result of a load that a forced one replaced', async () => {
    const key = {};
    const { access, read } = holder();
    let releaseOld: (value: string) => void = () => {};
    const old = loadResource(
      key,
      access,
      () =>
        new Promise<string>((resolve) => {
          releaseOld = resolve;
        }),
    );
    await loadResource(key, access, async () => 'new', { force: true });
    releaseOld('old');
    await old;
    expect(read().data).toBe('new');
  });

  it('keeps the last data and reports the error when a load fails', async () => {
    const key = {};
    const { access, read } = holder();
    await loadResource(key, access, async () => 'good');
    await loadResource(key, access, () => Promise.reject(new Error('offline')), { force: true });
    expect(read()).toMatchObject({ data: 'good', error: 'offline', loading: false });
  });
});
