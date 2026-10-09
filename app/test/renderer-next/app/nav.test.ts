import { describe, expect, it } from 'vitest';
import { applyLaunchHints } from '../../../renderer-next/src/app/launch';
import { MAX_HIDDEN_PAGES, touchVisited, useNavStore } from '../../../renderer-next/src/app/nav';
import type { PageId } from '../../../renderer-next/src/app/nav';
import { makeApi } from '../../renderer/fakes';

describe('touchVisited', () => {
  it('puts the page first and does not repeat it', () => {
    expect(touchVisited(['home', 'apps'], 'apps')).toEqual(['apps', 'home']);
  });

  it('drops the least recently used page past the hidden-page cap', () => {
    const all: PageId[] = ['home', 'cleanup', 'apps', 'startup', 'health', 'developer'];
    let visited: PageId[] = [];
    for (const page of all) visited = touchVisited(visited, page);
    expect(visited).toHaveLength(MAX_HIDDEN_PAGES + 1);
    expect(visited).toEqual(['developer', 'health', 'startup', 'apps', 'cleanup']);
  });
});

describe('nav store', () => {
  it('keeps the parameters of a page that was left', () => {
    const { navigate } = useNavStore.getState();
    navigate('cleanup', { view: 'results', root: 'C:\\' });
    navigate('home');
    navigate('cleanup');
    expect(useNavStore.getState().params.cleanup).toEqual({ view: 'results', root: 'C:\\' });
  });

  it('asks the new page for focus, but not when the page does not change', () => {
    const { navigate } = useNavStore.getState();
    navigate('apps');
    expect(useNavStore.getState().focusTarget).toBe('apps');
    useNavStore.getState().clearFocusTarget('apps');
    navigate('apps');
    expect(useNavStore.getState().focusTarget).toBeNull();
  });
});

describe('launch hints', () => {
  it('opens Startup with the notice for a relaunched toggle', async () => {
    const notice = { entryId: 'e1', name: 'Acme', to: 'disabled' as const };
    await applyLaunchHints(makeApi({ getStartupLaunchHint: async () => ({ open: true, notice }) }));
    expect(useNavStore.getState().page).toBe('startup');
    expect(useNavStore.getState().params.startup).toEqual({ notice });
  });

  it('prefers resuming an uninstall when both hints are set', async () => {
    const hint = { open: true, appId: 'a1', notice: null, stalePending: false, runningJobId: 'j1' };
    await applyLaunchHints(
      makeApi({
        getStartupLaunchHint: async () => ({ open: true, notice: null }),
        getUninstallLaunchHint: async () => hint,
      }),
    );
    expect(useNavStore.getState().page).toBe('apps');
    expect(useNavStore.getState().params.apps).toEqual({ hint });
  });

  it('stays on Home when there is nothing to resume', async () => {
    await applyLaunchHints(makeApi());
    expect(useNavStore.getState().page).toBe('home');
  });
});
