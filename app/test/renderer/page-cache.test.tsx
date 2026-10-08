import { act, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { clearPageCache, useCachedResource } from '../../renderer/src/page-cache';
import type { CachedResource } from '../../renderer/src/page-cache';

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((done, fail) => {
    resolve = done;
    reject = fail;
  });
  return { promise, resolve, reject };
}

function Probe({
  name = 'k',
  load,
  expose,
}: {
  name?: string;
  load: () => Promise<string>;
  expose?: (resource: CachedResource<string>) => void;
}) {
  const resource = useCachedResource<string>(name, load);
  expose?.(resource);
  return (
    <div>
      <span data-testid="data">{resource.data ?? 'none'}</span>
      <span data-testid="error">{resource.error ?? 'no-error'}</span>
      <span data-testid="busy">{resource.revalidating ? 'busy' : 'idle'}</span>
    </div>
  );
}

const text = (id: string) => screen.getByTestId(id).textContent;

describe('useCachedResource', () => {
  let errors: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    errors = vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    expect(errors).not.toHaveBeenCalled();
    errors.mockRestore();
  });

  it('shows nothing on the first mount, then the loaded data', async () => {
    const first = deferred<string>();
    render(<Probe load={() => first.promise} />);

    expect(text('data')).toBe('none');
    expect(text('busy')).toBe('busy');

    await act(async () => first.resolve('one'));
    expect(text('data')).toBe('one');
    expect(text('busy')).toBe('idle');
  });

  it('renders cached data at once on a second mount and replaces it when the revalidation lands', async () => {
    const first = render(<Probe load={async () => 'old'} />);
    await waitFor(() => expect(text('data')).toBe('old'));
    first.unmount();

    const fresh = deferred<string>();
    render(<Probe load={() => fresh.promise} />);

    // No loading state: the cached value is there on the first render.
    expect(text('data')).toBe('old');
    expect(text('busy')).toBe('busy');

    await act(async () => fresh.resolve('new'));
    expect(text('data')).toBe('new');
    expect(text('busy')).toBe('idle');
  });

  it('shares one load between concurrent mounts', async () => {
    const shared = deferred<string>();
    const load = vi.fn(() => shared.promise);
    render(
      <>
        <Probe load={load} />
        <Probe load={load} />
      </>,
    );

    expect(load).toHaveBeenCalledTimes(1);
    await act(async () => shared.resolve('shared'));
    expect(screen.getAllByTestId('data').map((node) => node.textContent)).toEqual(['shared', 'shared']);
  });

  it('keeps separate keys apart', async () => {
    render(
      <>
        <Probe name="a" load={async () => 'A'} />
        <Probe name="b" load={async () => 'B'} />
      </>,
    );
    await waitFor(() => expect(screen.getAllByTestId('data').map((node) => node.textContent)).toEqual(['A', 'B']));
  });

  it('updates the cache when a result arrives after unmount, without warnings', async () => {
    const late = deferred<string>();
    const view = render(<Probe load={() => late.promise} />);
    view.unmount();

    await act(async () => late.resolve('late'));

    const next = deferred<string>();
    render(<Probe load={() => next.promise} />);
    expect(text('data')).toBe('late');
    await act(async () => next.resolve('later'));
  });

  it('keeps the stale data and sets the error when a revalidation fails', async () => {
    const first = render(<Probe load={async () => 'stale'} />);
    await waitFor(() => expect(text('data')).toBe('stale'));
    first.unmount();

    const failing = deferred<string>();
    render(<Probe load={() => failing.promise} />);
    await act(async () => failing.reject(new Error('offline')));

    expect(text('data')).toBe('stale');
    expect(text('error')).toBe('offline');
    expect(text('busy')).toBe('idle');
  });

  it('stringifies a non-Error rejection', async () => {
    const failing = deferred<string>();
    render(<Probe load={() => failing.promise} />);
    await act(async () => failing.reject('plain text'));

    expect(text('data')).toBe('none');
    expect(text('error')).toBe('plain text');
  });

  it('clears the error when a later reload succeeds', async () => {
    let expose!: CachedResource<string>;
    const calls = [() => Promise.reject(new Error('first failed')), () => Promise.resolve('recovered')];
    render(<Probe load={() => calls.shift()!()} expose={(resource) => (expose = resource)} />);
    await waitFor(() => expect(text('error')).toBe('first failed'));

    await act(async () => expose.reload());

    expect(text('error')).toBe('no-error');
    expect(text('data')).toBe('recovered');
  });

  it('mutate updates the component and the cache and supersedes an in-flight load', async () => {
    const slow = deferred<string>();
    let expose!: CachedResource<string>;
    const view = render(<Probe load={() => slow.promise} expose={(resource) => (expose = resource)} />);

    act(() => expose.mutate('mutated'));
    expect(text('data')).toBe('mutated');

    await act(async () => slow.resolve('stale-load'));
    expect(text('data')).toBe('mutated');
    view.unmount();

    const next = deferred<string>();
    render(<Probe load={() => next.promise} />);
    expect(text('data')).toBe('mutated');
    await act(async () => next.resolve('mutated'));
  });

  it('replaces a running shared load with a forced reload(custom)', async () => {
    const slow = deferred<string>();
    const forced = deferred<string>();
    let expose!: CachedResource<string>;
    render(<Probe load={() => slow.promise} expose={(resource) => (expose = resource)} />);

    let pendingForced!: Promise<void>;
    act(() => {
      pendingForced = expose.reload(() => forced.promise);
    });
    await act(async () => forced.resolve('forced'));
    await act(async () => pendingForced);
    expect(text('data')).toBe('forced');

    await act(async () => slow.resolve('slow'));
    expect(text('data')).toBe('forced');
  });

  it('forgets everything on clearPageCache', async () => {
    const first = render(<Probe load={async () => 'kept'} />);
    await waitFor(() => expect(text('data')).toBe('kept'));
    first.unmount();

    clearPageCache();
    const pending = deferred<string>();
    render(<Probe load={() => pending.promise} />);

    expect(text('data')).toBe('none');
    await act(async () => pending.resolve('x'));
  });
});
