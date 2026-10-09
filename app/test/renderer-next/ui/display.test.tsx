import { act, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { GradePill } from '../../../renderer-next/src/ui/Badge';
import { FileSize, RelativeTime } from '../../../renderer-next/src/ui/Display';
import { EmptyState, ErrorState } from '../../../renderer-next/src/ui/EmptyState';
import { Notice } from '../../../renderer-next/src/ui/Notice';
import { ProgressBar } from '../../../renderer-next/src/ui/ProgressBar';
import { Ring } from '../../../renderer-next/src/ui/Ring';
import { SearchBox } from '../../../renderer-next/src/ui/SearchBox';
import { Skeleton } from '../../../renderer-next/src/ui/Skeleton';
import { UsageBar } from '../../../renderer-next/src/ui/UsageBar';
import { VirtualList } from '../../../renderer-next/src/ui/VirtualList';
import { formatBytes, formatRelativeTime } from '../../../renderer-next/src/lib/format';

afterEach(() => {
  vi.useRealTimers();
});

describe('SearchBox', () => {
  it('waits 300 ms after the last keystroke, then reports the settled text once', () => {
    vi.useFakeTimers();
    const onSearch = vi.fn();
    render(<SearchBox label="Search apps" onSearch={onSearch} />);
    const box = screen.getByRole('searchbox', { name: 'Search apps' });
    for (const text of ['c', 'ch', 'chr']) {
      act(() => {
        (box as HTMLInputElement).focus();
        // Typing is simulated through the value setter React listens to.
        const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!;
        setter.call(box, text);
        box.dispatchEvent(new Event('input', { bubbles: true }));
        vi.advanceTimersByTime(100);
      });
    }
    expect(onSearch).not.toHaveBeenCalled();
    act(() => {
      vi.advanceTimersByTime(300);
    });
    expect(onSearch).toHaveBeenCalledTimes(1);
    expect(onSearch).toHaveBeenCalledWith('chr');
  });

  it('clears at once from the clear button and from Escape, keeping focus', async () => {
    const user = userEvent.setup();
    const onSearch = vi.fn();
    render(<SearchBox label="Search" onSearch={onSearch} delay={10_000} />);
    const box = screen.getByRole('searchbox');
    await user.type(box, 'abc');
    await user.click(screen.getByRole('button', { name: 'Clear search' }));
    expect(box).toHaveValue('');
    expect(box).toHaveFocus();
    expect(screen.queryByRole('button', { name: 'Clear search' })).not.toBeInTheDocument();
    await user.type(box, 'x{Escape}');
    expect(box).toHaveValue('');
  });

  it('focuses on Ctrl+F, and not when the shortcut is off', async () => {
    const user = userEvent.setup();
    const { unmount } = render(<SearchBox label="Search" onSearch={() => {}} />);
    await user.keyboard('{Control>}f{/Control}');
    expect(screen.getByRole('searchbox')).toHaveFocus();
    unmount();
    render(<SearchBox label="Search" onSearch={() => {}} shortcut={false} />);
    await user.keyboard('{Control>}f{/Control}');
    expect(screen.getByRole('searchbox')).not.toHaveFocus();
  });
});

describe('ProgressBar', () => {
  it('exposes a determinate value with spoken text', () => {
    render(<ProgressBar label="Scanning" value={0.45} />);
    const bar = screen.getByRole('progressbar', { name: 'Scanning' });
    expect(bar).toHaveAttribute('aria-valuenow', '45');
    expect(bar).toHaveAttribute('aria-valuetext', 'Scanning 45%');
  });

  it('is indeterminate without a value', () => {
    render(<ProgressBar label="Scanning" />);
    expect(screen.getByRole('progressbar')).not.toHaveAttribute('aria-valuenow');
  });
});

describe('UsageBar', () => {
  const segments = [
    { id: 'temp', label: 'Temp', bytes: 1024 ** 3 },
    { id: 'bin', label: 'Recycle Bin', bytes: 0 },
  ];

  it('lists only non-empty segments with exact sizes in the legend', () => {
    render(<UsageBar label="Space used on C:\" totalBytes={10 * 1024 ** 3} segments={segments} />);
    expect(screen.getByRole('group', { name: 'Space used on C:\\' })).toBeInTheDocument();
    expect(screen.getByText('Temp')).toBeInTheDocument();
    expect(screen.getByText('1.0 GB')).toBeInTheDocument();
    expect(screen.queryByText('Recycle Bin')).not.toBeInTheDocument();
  });

  it('turns segments into buttons when they can be selected', async () => {
    const user = userEvent.setup();
    const onSelect = vi.fn();
    render(
      <UsageBar label="Usage" legend={false} totalBytes={4 * 1024 ** 3} segments={[{ ...segments[0]!, onSelect }]} />,
    );
    await user.click(screen.getByRole('button', { name: 'Temp, 1.0 GB' }));
    expect(onSelect).toHaveBeenCalledOnce();
  });

  it('does not duplicate tab stops when the legend offers the same buttons', async () => {
    const user = userEvent.setup();
    render(<UsageBar label="Usage" totalBytes={4 * 1024 ** 3} segments={[{ ...segments[0]!, onSelect: () => {} }]} />);
    await user.tab();
    expect(screen.getByRole('button', { name: /Temps*1.0 GB/ })).toHaveFocus();
    await user.tab();
    expect(document.body).toHaveFocus();
  });
});

describe('Ring', () => {
  it('is an image named by its label', () => {
    render(
      <Ring value={0.61} label="Memory in use, 61%">
        61%
      </Ring>,
    );
    expect(screen.getByRole('img', { name: 'Memory in use, 61%' })).toHaveTextContent('61%');
  });
});

describe('GradePill', () => {
  it('always says the grade in words', () => {
    render(
      <>
        <GradePill grade="safe" />
        <GradePill grade="review" />
        <GradePill grade="protected" />
      </>,
    );
    for (const word of ['Safe', 'Review', 'Protected']) expect(screen.getByText(word)).toBeInTheDocument();
  });
});

describe('Notice, EmptyState, ErrorState', () => {
  it('announces a notice as a status with its action', () => {
    render(<Notice action={<button type="button">Scan again</button>}>This list is from 2 days ago.</Notice>);
    expect(screen.getByRole('status')).toHaveTextContent('This list is from 2 days ago.');
    expect(screen.getByRole('button', { name: 'Scan again' })).toBeInTheDocument();
  });

  it('shows an empty state with its action', () => {
    render(<EmptyState title="Nothing to clean right now" action={<button type="button">Scan again</button>} />);
    expect(screen.getByText('Nothing to clean right now')).toBeInTheDocument();
  });

  it('error state is an alert and Try again retries', async () => {
    const user = userEvent.setup();
    const onRetry = vi.fn();
    render(<ErrorState description="Dust couldn't read the list." onRetry={onRetry} />);
    expect(screen.getByRole('alert')).toHaveTextContent("Dust couldn't read the list.");
    await user.click(screen.getByRole('button', { name: 'Try again' }));
    expect(onRetry).toHaveBeenCalledOnce();
  });
});

describe('Skeleton', () => {
  it('stays invisible for 150 ms so instant loads never flash', () => {
    vi.useFakeTimers();
    const { container } = render(<Skeleton className="h-4 w-20" />);
    const block = container.firstElementChild as HTMLElement;
    expect(block).toHaveAttribute('aria-hidden', 'true');
    expect(block).toHaveAttribute('data-shown', 'false');
    expect(block).toHaveClass('invisible');
    act(() => {
      vi.advanceTimersByTime(149);
    });
    expect(block).toHaveAttribute('data-shown', 'false');
    act(() => {
      vi.advanceTimersByTime(1);
    });
    expect(block).toHaveAttribute('data-shown', 'true');
    expect(block).not.toHaveClass('invisible');
  });
});

describe('VirtualList', () => {
  const items = Array.from({ length: 20 }, (_, index) => ({ id: `r${index}`, name: `Row ${index}` }));

  it('is a named list whose rows know their position', () => {
    render(
      <VirtualList
        label="Files"
        items={items}
        rowHeight={40}
        getKey={(item) => item.id}
        renderRow={(item) => item.name}
      />,
    );
    expect(screen.getByRole('list', { name: 'Files' })).toBeInTheDocument();
    const rows = screen.getAllByRole('listitem');
    expect(rows[0]).toHaveAttribute('aria-posinset', '1');
    expect(rows[0]).toHaveAttribute('aria-setsize', '20');
  });

  it('re-renders only the rows whose item changed', () => {
    const renders: string[] = [];
    const renderRow = (item: { id: string; name: string }) => {
      renders.push(item.id);
      return item.name;
    };
    const { rerender } = render(
      <VirtualList label="Files" items={items} rowHeight={40} getKey={(item) => item.id} renderRow={renderRow} />,
    );
    const first = renders.length;
    expect(first).toBe(20);
    const next = items.map((item, index) => (index === 3 ? { ...item, name: 'Changed' } : item));
    rerender(
      <VirtualList label="Files" items={next} rowHeight={40} getKey={(item) => item.id} renderRow={renderRow} />,
    );
    expect(renders.slice(first)).toEqual(['r3']);
    expect(screen.getByText('Changed')).toBeInTheDocument();
  });
});

describe('formatting', () => {
  it('formats exact sizes', () => {
    expect(formatBytes(null)).toBe('—');
    expect(formatBytes(512)).toBe('512 B');
    expect(formatBytes(1536)).toBe('1.5 KB');
    expect(formatBytes(4.2 * 1024 ** 3)).toBe('4.2 GB');
    render(<FileSize bytes={1024 ** 2 * 20} />);
    expect(screen.getByText('20 MB')).toBeInTheDocument();
  });

  it('uses plain words for relative time', () => {
    const now = 1_000_000_000_000;
    expect(formatRelativeTime(null, now)).toBe('never');
    expect(formatRelativeTime(now - 10_000, now)).toBe('just now');
    expect(formatRelativeTime(now - 60_000, now)).toBe('1 minute ago');
    expect(formatRelativeTime(now - 5 * 60_000, now)).toBe('5 minutes ago');
    expect(formatRelativeTime(now - 3 * 3_600_000, now)).toBe('3 hours ago');
    expect(formatRelativeTime(now - 2 * 86_400_000, now)).toBe('2 days ago');
  });

  it('RelativeTime keeps the exact time on hover', () => {
    render(<RelativeTime ms={Date.now() - 5 * 60_000} />);
    const time = screen.getByText('5 minutes ago');
    expect(time.tagName).toBe('TIME');
    expect(time).toHaveAttribute('title');
  });
});
