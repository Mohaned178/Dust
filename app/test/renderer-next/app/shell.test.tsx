import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useEffect, useState } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { App } from '../../../renderer-next/src/app/App';
import { ErrorBoundary } from '../../../renderer-next/src/app/ErrorBoundary';
import { useDialogs } from '../../../renderer-next/src/app/dialogs';
import type { PageId } from '../../../renderer-next/src/app/nav';
import { PAGES } from '../../../renderer-next/src/app/pages';
import type { PageDefinition } from '../../../renderer-next/src/app/pages';
import { PageHeader } from '../../../renderer-next/src/ui/PageHeader';
import { Dialog } from '../../../renderer-next/src/ui/Dialog';
import { useToast } from '../../../renderer-next/src/ui/toast-store';
import { makeApi } from '../../renderer/fakes';

const NAV_LABELS = ['Home', 'Clean up', 'Apps', 'Startup', 'PC Health', 'Developer', 'Settings'];

describe('app shell', () => {
  it('opens a placeholder page from every nav item', async () => {
    const user = userEvent.setup();
    render(<App api={makeApi()} />);
    const nav = screen.getByRole('navigation', { name: 'Main' });
    expect(
      within(nav)
        .getAllByRole('button')
        .map((button) => button.textContent),
    ).toEqual(NAV_LABELS);

    for (const label of NAV_LABELS) {
      await user.click(within(nav).getByRole('button', { name: label }));
      // Home's heading is a greeting for the time of day.
      const heading = await screen.findByRole('heading', {
        level: 1,
        name: label === 'Home' ? /^Good (morning|afternoon|evening)$/ : label,
      });
      expect(heading).toBeVisible();
      expect(within(nav).getByRole('button', { name: label })).toHaveAttribute('aria-current', 'page');
      expect(
        within(nav)
          .getAllByRole('button')
          .filter((button) => button.hasAttribute('aria-current')),
      ).toHaveLength(1);
    }
  });

  it('moves focus to the page heading after navigating, including to a page that is still loading', async () => {
    const user = userEvent.setup();
    render(<App api={makeApi()} />);
    await user.click(within(screen.getByRole('navigation', { name: 'Main' })).getByRole('button', { name: 'Apps' }));
    const heading = await screen.findByRole('heading', { level: 1, name: 'Apps' });
    await waitFor(() => expect(heading).toHaveFocus());
  });

  it('does not take focus on first load', async () => {
    render(<App api={makeApi()} />);
    const heading = await screen.findByRole('heading', { level: 1, name: /^Good / });
    expect(heading).not.toHaveFocus();
  });
});

// Pages that record what happens to them, in place of the placeholders.
let instances = 0;
const effectLog: string[] = [];

function TestPage({ id }: { id: PageId }) {
  const [instance] = useState(() => (instances += 1));
  const [draft, setDraft] = useState('');
  useEffect(() => {
    effectLog.push(`${id}:on`);
    return () => {
      effectLog.push(`${id}:off`);
    };
  }, [id]);
  return (
    <>
      <PageHeader title={`Page ${id}`} />
      <label>
        Note for {id}
        <input value={draft} onChange={(event) => setDraft(event.target.value)} />
      </label>
      <p data-testid={`instance-${id}`}>{instance}</p>
    </>
  );
}

function testPages(ids: PageId[]): PageDefinition[] {
  return ids.map((id) => {
    const source = PAGES.find((page) => page.id === id);
    if (source === undefined) throw new Error(`no page ${id}`);
    return { ...source, label: id, Component: () => <TestPage id={id} /> };
  });
}

describe('page hosting', () => {
  it('keeps a page’s state while another page is open, and pauses its effects', async () => {
    instances = 0;
    effectLog.length = 0;
    const user = userEvent.setup();
    render(<App api={makeApi()} pages={testPages(['home', 'apps', 'settings'])} />);

    await user.type(await screen.findByLabelText('Note for home'), 'keep me');
    expect(effectLog).toEqual(['home:on']);

    await user.click(screen.getByRole('button', { name: 'apps' }));
    await screen.findByRole('heading', { level: 1, name: 'Page apps' });
    // Home is hidden but mounted; its effects have stopped.
    expect(effectLog).toContain('home:off');
    expect(screen.getByLabelText('Note for home', { selector: 'input' })).not.toBeVisible();

    await user.click(screen.getByRole('button', { name: 'home' }));
    expect(screen.getByLabelText('Note for home')).toHaveValue('keep me');
    expect(screen.getByTestId('instance-home')).toHaveTextContent('1');
    expect(effectLog.filter((entry) => entry === 'home:on')).toHaveLength(2);
  });

  it('drops the least recently used page once more than four are hidden', async () => {
    instances = 0;
    effectLog.length = 0;
    const user = userEvent.setup();
    const ids: PageId[] = ['home', 'cleanup', 'apps', 'startup', 'health', 'developer'];
    render(<App api={makeApi()} pages={testPages(ids)} />);
    await screen.findByTestId('instance-home');

    for (const id of ids.slice(1)) {
      await user.click(screen.getByRole('button', { name: id }));
      await screen.findByTestId(`instance-${id}`);
    }
    // Home was the oldest, so it is gone; the page before the current one is still there.
    expect(screen.queryByTestId('instance-home')).not.toBeInTheDocument();
    expect(screen.getByTestId('instance-cleanup')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'home' }));
    // Home starts fresh with a new instance.
    expect(await screen.findByTestId('instance-home')).toHaveTextContent('7');
  });

  it('shows a retry instead of a blank screen when a page crashes, and keeps the other pages', async () => {
    const user = userEvent.setup();
    const pages = testPages(['home', 'apps']);
    let shouldCrash = true;
    pages[1] = {
      ...pages[1]!,
      Component: () => {
        if (shouldCrash) throw new Error('boom');
        return <PageHeader title="Recovered" />;
      },
    };
    render(<App api={makeApi()} pages={pages} />);
    const quiet = () => {};
    const original = console.error;
    console.error = quiet;
    try {
      await user.click(screen.getByRole('button', { name: 'apps' }));
      expect(await screen.findByRole('alert')).toHaveTextContent('This screen could not be drawn');
      expect(screen.getByRole('navigation', { name: 'Main' })).toBeVisible();

      shouldCrash = false;
      await user.click(screen.getByRole('button', { name: 'Try again' }));
      expect(await screen.findByRole('heading', { level: 1, name: 'Recovered' })).toBeVisible();
    } finally {
      console.error = original;
    }
  });
});

describe('dialog host', () => {
  function Opener() {
    const dialogs = useDialogs();
    return (
      <button
        type="button"
        onClick={() =>
          dialogs.open(({ open, close }) => (
            <Dialog open={open} onOpenChange={(next) => !next && close()} title="A scan is already running">
              body
            </Dialog>
          ))
        }
      >
        Show dialog
      </button>
    );
  }

  it('shows a dialog opened from anywhere and returns focus to the opener', async () => {
    const user = userEvent.setup();
    const pages = testPages(['home']);
    pages[0] = { ...pages[0]!, Component: Opener };
    render(<App api={makeApi()} pages={pages} />);

    const opener = await screen.findByRole('button', { name: 'Show dialog' });
    await user.click(opener);
    const dialog = await screen.findByRole('dialog', { name: 'A scan is already running' });
    expect(dialog).toBeVisible();

    await user.keyboard('{Escape}');
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(opener).toHaveFocus();
  });
});

describe('toast host', () => {
  it('shows a toast pushed from a page, loading the host on demand', async () => {
    const user = userEvent.setup();
    function Pusher() {
      const toast = useToast();
      return (
        <button type="button" onClick={() => toast({ title: 'Startup entry turned off' })}>
          Push toast
        </button>
      );
    }
    const pages = testPages(['home']);
    pages[0] = { ...pages[0]!, Component: Pusher };
    render(<App api={makeApi()} pages={pages} />);

    expect(screen.queryByText('Startup entry turned off')).not.toBeInTheDocument();
    await user.click(await screen.findByRole('button', { name: 'Push toast' }));
    expect(await screen.findByText('Startup entry turned off')).toBeVisible();
  });
});

describe('icon rail', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('names each icon with a tooltip when the window is narrow', async () => {
    vi.stubGlobal('matchMedia', () => ({
      matches: true,
      addEventListener: () => {},
      removeEventListener: () => {},
    }));
    const user = userEvent.setup();
    await import('../../../renderer-next/src/ui/Tooltip');
    render(<App api={makeApi()} />);
    const nav = screen.getByRole('navigation', { name: 'Main' });
    // The label stays in the accessibility tree even though it is not drawn.
    expect(within(nav).getByRole('button', { name: 'Apps' })).toBeInTheDocument();

    // The tooltip code loads lazily; wait until the buttons are wrapped so the focus below is not lost to the swap.
    await waitFor(() => expect(nav.querySelectorAll('[data-state]')).toHaveLength(7));
    await user.tab();
    await user.keyboard('{Tab}');
    expect(within(nav).getByRole('button', { name: 'Clean up' })).toHaveFocus();
    expect(await screen.findByRole('tooltip')).toHaveTextContent('Clean up');
  });
});

describe('root error boundary', () => {
  it('offers a reload action and draws without lazy code', async () => {
    const user = userEvent.setup();
    const reload = vi.fn();
    function Broken(): never {
      throw new Error('boom');
    }
    const quiet = console.error;
    console.error = () => {};
    try {
      render(
        <ErrorBoundary title="Dust ran into a problem" retryLabel="Reload Dust" onRetry={reload}>
          <Broken />
        </ErrorBoundary>,
      );
      expect(screen.getByRole('alert')).toHaveTextContent('Dust ran into a problem');
      await user.click(screen.getByRole('button', { name: 'Reload Dust' }));
      expect(reload).toHaveBeenCalledTimes(1);
    } finally {
      console.error = quiet;
    }
  });
});
