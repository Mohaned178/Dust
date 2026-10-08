import { useCallback, useEffect, useState } from 'react';
import type { ComponentType, SVGProps } from 'react';
import { CodeIcon, GearIcon, HomeIcon, InfoIcon, PanelLeftIcon, PowerIcon, UninstallIcon } from './icons';

export type NavKey = 'dashboard' | 'dev-cleanup' | 'uninstall' | 'startup' | 'system-info';

export interface SidebarProps {
  active: NavKey;
  devCleanupDisabled: boolean;
  onNavigate: (key: NavKey) => void;
  onOpenSettings: () => void;
}

const FOCUS = 'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent';
const COLLAPSE_KEY = 'dust.sidebar.collapsed';

function readCollapsed(): boolean {
  try {
    return window.localStorage.getItem(COLLAPSE_KEY) === '1';
  } catch {
    return false;
  }
}

interface NavButtonProps {
  icon: ComponentType<SVGProps<SVGSVGElement>>;
  label: string;
  collapsed: boolean;
  active?: boolean;
  disabled?: boolean;
  onClick: () => void;
}

function NavButton({ icon: Icon, label, collapsed, active = false, disabled = false, onClick }: NavButtonProps) {
  const [focused, setFocused] = useState(false);
  return (
    <button
      type="button"
      aria-current={active ? 'page' : undefined}
      aria-label={collapsed ? label : undefined}
      title={collapsed ? label : undefined}
      disabled={disabled}
      onClick={onClick}
      onFocus={() => setFocused(true)}
      onBlur={() => setFocused(false)}
      className={`relative flex w-full items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-45 ${FOCUS} ${
        active ? 'bg-accent-soft text-accent-strong' : 'text-ink-muted hover:bg-canvas hover:text-ink'
      } ${collapsed ? 'justify-center px-0' : ''}`}
    >
      <Icon className="h-[18px] w-[18px] shrink-0" />
      {!collapsed && <span className="truncate">{label}</span>}
      {collapsed && focused && (
        <span className="pointer-events-none absolute left-full top-1/2 z-30 ml-2 -translate-y-1/2 whitespace-nowrap rounded-md border border-hairline bg-surface px-2 py-1 text-xs font-medium text-ink shadow-card">
          {label}
        </span>
      )}
    </button>
  );
}

export function Sidebar({ active, devCleanupDisabled, onNavigate, onOpenSettings }: SidebarProps) {
  const [collapsed, setCollapsed] = useState(readCollapsed);

  useEffect(() => {
    try {
      window.localStorage.setItem(COLLAPSE_KEY, collapsed ? '1' : '0');
    } catch {
      /* localStorage can be unavailable; the session still works uncollapsed */
    }
  }, [collapsed]);

  const toggle = useCallback(() => setCollapsed((value) => !value), []);

  return (
    <aside
      className={`dust-dashboard flex h-full shrink-0 flex-col border-r border-hairline bg-surface transition-[width] duration-200 ease-[cubic-bezier(0.16,1,0.3,1)] motion-reduce:transition-none ${
        collapsed ? 'w-14' : 'w-60'
      }`}
    >
      <div
        className={`flex h-16 items-center border-b border-hairline px-3 ${collapsed ? 'justify-center' : 'justify-between'}`}
      >
        {!collapsed && <span className="pl-1 text-lg font-semibold tracking-tight text-ink">Dust</span>}
        <button
          type="button"
          aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
          aria-expanded={!collapsed}
          title={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
          onClick={toggle}
          className={`inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-ink-muted transition-colors hover:bg-canvas hover:text-ink ${FOCUS}`}
        >
          <PanelLeftIcon className="h-[18px] w-[18px]" />
        </button>
      </div>

      <nav aria-label="Primary" className="flex flex-1 flex-col gap-0.5 px-2.5 py-3">
        <NavButton
          icon={HomeIcon}
          label="Home"
          collapsed={collapsed}
          active={active === 'dashboard'}
          onClick={() => onNavigate('dashboard')}
        />
        {collapsed ? (
          <div className="mx-2 my-2 border-t border-hairline" />
        ) : (
          <p className="mt-4 mb-1 px-3 text-[11px] font-semibold uppercase tracking-[0.14em] text-ink-muted">Tools</p>
        )}
        <NavButton
          icon={UninstallIcon}
          label="Uninstall apps"
          collapsed={collapsed}
          active={active === 'uninstall'}
          onClick={() => onNavigate('uninstall')}
        />
        <NavButton
          icon={PowerIcon}
          label="Startup apps"
          collapsed={collapsed}
          active={active === 'startup'}
          onClick={() => onNavigate('startup')}
        />
        <NavButton
          icon={CodeIcon}
          label="Developer cleanup"
          collapsed={collapsed}
          active={active === 'dev-cleanup'}
          disabled={devCleanupDisabled}
          onClick={() => onNavigate('dev-cleanup')}
        />
        <NavButton
          icon={InfoIcon}
          label="System info"
          collapsed={collapsed}
          active={active === 'system-info'}
          onClick={() => onNavigate('system-info')}
        />
        <div className="flex-1" />
        <NavButton icon={GearIcon} label="Settings" collapsed={collapsed} onClick={onOpenSettings} />
      </nav>
    </aside>
  );
}
