import { fireEvent, render, screen, within } from '@testing-library/react';
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
    renderSidebar({ active: 'drives' });

    expect(screen.getByRole('navigation', { name: 'Primary' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Dashboard' })).not.toHaveAttribute('aria-current');
    expect(screen.getByRole('button', { name: 'Drives' })).toHaveAttribute('aria-current', 'page');
  });

  it('navigates and opens settings from the nav', () => {
    const onNavigate = vi.fn();
    const onOpenSettings = vi.fn();
    renderSidebar({ onNavigate, onOpenSettings });

    fireEvent.click(screen.getByRole('button', { name: 'Dev Cleanup' }));
    expect(onNavigate).toHaveBeenCalledWith('dev-cleanup');

    fireEvent.click(screen.getByRole('button', { name: 'Settings' }));
    expect(onOpenSettings).toHaveBeenCalledTimes(1);
  });

  it('disables dev cleanup when there is no system drive', () => {
    renderSidebar({ devCleanupDisabled: true });

    expect(screen.getByRole('button', { name: 'Dev Cleanup' })).toBeDisabled();
  });

  it('collapses to an icon rail and persists the choice', () => {
    const { unmount } = renderSidebar();

    expect(screen.getByText('Dashboard')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Collapse sidebar' }));

    expect(screen.queryByText('Dashboard')).toBeNull();
    expect(screen.getByRole('button', { name: 'Dashboard' })).toBeInTheDocument();
    expect(window.localStorage.getItem('dust.sidebar.collapsed')).toBe('1');

    fireEvent.click(screen.getByRole('button', { name: 'Expand sidebar' }));
    expect(screen.getByText('Dashboard')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Collapse sidebar' }));
    unmount();

    renderSidebar();
    expect(screen.queryByText('Dashboard')).toBeNull();
  });

  it('reveals a collapsed rail label when the nav item takes focus', () => {
    renderSidebar();
    fireEvent.click(screen.getByRole('button', { name: 'Collapse sidebar' }));
    expect(screen.queryByText('Dashboard')).toBeNull();

    const dashboard = screen.getByRole('button', { name: 'Dashboard' });
    fireEvent.focus(dashboard);
    expect(screen.getByText('Dashboard')).toBeInTheDocument();

    fireEvent.blur(dashboard);
    expect(screen.queryByText('Dashboard')).toBeNull();
  });

  it('keeps coming-soon items inert text, not controls', () => {
    renderSidebar();

    expect(screen.getByText('Coming soon')).toBeInTheDocument();
    expect(screen.getByText('Deep Uninstall')).toBeInTheDocument();
    expect(screen.getByText('Startup Manager')).toBeInTheDocument();
    expect(screen.getByText('System Info')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Deep Uninstall' })).toBeNull();
    expect(screen.getAllByText('Soon')).toHaveLength(3);
  });

  it('meets contrast on the coming-soon group and keeps it out of the tab order', () => {
    renderSidebar();

    expect(screen.getByText('Coming soon')).toHaveClass('text-ink-muted');
    for (const label of ['Deep Uninstall', 'Startup Manager', 'System Info']) {
      expect(screen.getByText(label)).toHaveClass('text-ink-muted');
    }
    for (const tag of screen.getAllByText('Soon')) {
      expect(tag).toHaveClass('text-ink-muted');
    }

    const list = screen.getByRole('list');
    expect(within(list).queryAllByRole('button')).toHaveLength(0);
    expect(list.querySelectorAll('button, a, input, select, textarea, [tabindex]')).toHaveLength(0);
  });

  it('keeps the collapse toggle and nav reachable in visual order', () => {
    renderSidebar();

    const controls = screen.getAllByRole('button');
    expect(controls.map((button) => button.getAttribute('aria-label') ?? button.textContent)).toEqual([
      'Collapse sidebar',
      'Dashboard',
      'Dev Cleanup',
      'Drives',
      'Settings',
    ]);
  });
});
