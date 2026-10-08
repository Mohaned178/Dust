import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Sidebar } from '../../renderer/src/components/Sidebar';
import type { SidebarProps } from '../../renderer/src/components/Sidebar';

class MemoryStorage implements Storage {
  private store = new Map<string, string>();

  get length(): number {
    return this.store.size;
  }

  clear(): void {
    this.store.clear();
  }

  getItem(key: string): string | null {
    return this.store.has(key) ? (this.store.get(key) as string) : null;
  }

  key(index: number): string | null {
    return Array.from(this.store.keys())[index] ?? null;
  }

  removeItem(key: string): void {
    this.store.delete(key);
  }

  setItem(key: string, value: string): void {
    this.store.set(key, value);
  }
}

function renderSidebar(overrides: Partial<SidebarProps> = {}) {
  const props: SidebarProps = {
    active: 'dashboard',
    devCleanupDisabled: false,
    onNavigate: vi.fn(),
    onOpenSettings: vi.fn(),
    ...overrides,
  };
  return { ...render(<Sidebar {...props} />), props };
}

describe('Sidebar', () => {
  beforeEach(() => {
    Object.defineProperty(window, 'localStorage', {
      value: new MemoryStorage(),
      configurable: true,
      writable: true,
    });
  });

  it('renders the primary navigation with the active item marked', () => {
    renderSidebar({ active: 'startup' });

    expect(screen.getByRole('navigation', { name: 'Primary' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Home' })).not.toHaveAttribute('aria-current');
    expect(screen.getByRole('button', { name: 'Startup apps' })).toHaveAttribute('aria-current', 'page');
    expect(screen.queryByRole('button', { name: 'Drives' })).toBeNull();
  });

  it('navigates and opens settings from the nav', () => {
    const onNavigate = vi.fn();
    const onOpenSettings = vi.fn();
    renderSidebar({ onNavigate, onOpenSettings });

    fireEvent.click(screen.getByRole('button', { name: 'Home' }));
    expect(onNavigate).toHaveBeenCalledWith('dashboard');

    fireEvent.click(screen.getByRole('button', { name: 'Developer cleanup' }));
    expect(onNavigate).toHaveBeenCalledWith('dev-cleanup');

    fireEvent.click(screen.getByRole('button', { name: 'Uninstall apps' }));
    expect(onNavigate).toHaveBeenCalledWith('uninstall');

    fireEvent.click(screen.getByRole('button', { name: 'Startup apps' }));
    expect(onNavigate).toHaveBeenCalledWith('startup');

    fireEvent.click(screen.getByRole('button', { name: 'System info' }));
    expect(onNavigate).toHaveBeenCalledWith('system-info');

    fireEvent.click(screen.getByRole('button', { name: 'Settings' }));
    expect(onOpenSettings).toHaveBeenCalledTimes(1);
  });

  it('disables developer cleanup when there is no system drive', () => {
    renderSidebar({ devCleanupDisabled: true });

    expect(screen.getByRole('button', { name: 'Developer cleanup' })).toBeDisabled();
  });

  it('collapses to an icon rail and persists the choice', () => {
    const { unmount } = renderSidebar();

    expect(screen.getByText('Home')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Collapse sidebar' }));

    expect(screen.queryByText('Home')).toBeNull();
    expect(screen.getByRole('button', { name: 'Home' })).toBeInTheDocument();
    expect(window.localStorage.getItem('dust.sidebar.collapsed')).toBe('1');

    fireEvent.click(screen.getByRole('button', { name: 'Expand sidebar' }));
    expect(screen.getByText('Home')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Collapse sidebar' }));
    unmount();

    renderSidebar();
    expect(screen.queryByText('Home')).toBeNull();
  });

  it('reveals a collapsed rail label when the nav item takes focus', () => {
    renderSidebar();
    fireEvent.click(screen.getByRole('button', { name: 'Collapse sidebar' }));
    expect(screen.queryByText('Home')).toBeNull();

    const home = screen.getByRole('button', { name: 'Home' });
    fireEvent.focus(home);
    expect(screen.getByText('Home')).toBeInTheDocument();

    fireEvent.blur(home);
    expect(screen.queryByText('Home')).toBeNull();
  });

  it('shows the tools as real navigation items with no coming-soon group', () => {
    renderSidebar();

    expect(screen.queryByText('Coming soon')).toBeNull();
    expect(screen.queryByText('Soon')).toBeNull();
    expect(screen.getByText('Tools')).toBeInTheDocument();

    const item = screen.getByRole('button', { name: 'Uninstall apps' });
    expect(item).not.toHaveAttribute('aria-current');
  });

  it('keeps the collapse toggle and nav reachable in visual order', () => {
    renderSidebar();

    const controls = screen.getAllByRole('button');
    expect(controls.map((button) => button.getAttribute('aria-label') ?? button.textContent)).toEqual([
      'Collapse sidebar',
      'Home',
      'Uninstall apps',
      'Startup apps',
      'Developer cleanup',
      'System info',
      'Settings',
    ]);
  });
});
