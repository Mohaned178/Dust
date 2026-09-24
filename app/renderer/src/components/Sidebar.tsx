import { useCallback, useEffect, useState } from 'react';
import type { ComponentType, SVGProps } from 'react';
import {
  DashboardIcon,
  GearIcon,
  HardDriveIcon,
  PackageIcon,
  PanelLeftIcon,
} from './icons';

export type NavKey = 'dashboard' | 'dev-cleanup' | 'drives';

export interface SidebarProps {
  active: NavKey;
  devCleanupDisabled: boolean;
  onNavigate: (key: NavKey) => void;
  onOpenSettings: () => void;
}

const FOCUS = 'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent';
const COLLAPSE_KEY = 'dust.sidebar.collapsed';

const COMING_SOON = ['Deep Uninstall', 'Startup Manager', 'System Info'];

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
        active
          ? 'bg-accent-soft text-accent-strong'
          : 'text-ink-muted hover:bg-canvas hover:text-ink'
      } ${collapsed ? 'justify-center px-0' : ''}`}
    >
      <Icon className="h-[18px] w-[18px] shrink-0" />
      {!collapsed && <span className="truncate">{label}</span>}
      {collapsed && focused && (
        <span className="pointer-events-none absolute left-full top-1/2 z-30 ml-2 -translate-y-1/2 whitespace-nowrap rounded-md border border-hairline bg-surface px-2 py-1 text-xs font-medium text-ink shadow-[0_1px_2px_rgba(16,24,40,0.04)]">
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
      <div className={`flex h-16 items-center border-b border-hairline px-3 ${collapsed ? 'justify-center' : 'justify-between'}`}>
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

      <nav aria-label="Primary" className="flex flex-col gap-0.5 px-2.5 py-3">
        <NavButton
          icon={DashboardIcon}
          label="Dashboard"
          collapsed={collapsed}
          active={active === 'dashboard'}
          onClick={() => onNavigate('dashboard')}
        />
        <NavButton
          icon={PackageIcon}
          label="Dev Cleanup"
          collapsed={collapsed}
          active={active === 'dev-cleanup'}
          disabled={devCleanupDisabled}
          onClick={() => onNavigate('dev-cleanup')}
        />
        <NavButton
          icon={HardDriveIcon}
          label="Drives"
          collapsed={collapsed}
          active={active === 'drives'}
          onClick={() => onNavigate('drives')}
        />
        <NavButton icon={GearIcon} label="Settings" collapsed={collapsed} onClick={onOpenSettings} />
      </nav>

      <div className="mt-auto border-t border-hairline px-3 py-4">
        {collapsed ? (
          <p
            title="Coming soon"
            className="text-center text-xs font-semibold uppercase tracking-[0.16em] text-ink-muted"
          >
            Soon
          </p>
        ) : (
          <>
            <p className="px-1 text-xs font-semibold uppercase tracking-[0.16em] text-ink-muted">
              Coming soon
            </p>
            <ul className="mt-2 space-y-1">
              {COMING_SOON.map((label) => (
                <li key={label} className="flex items-center justify-between gap-2 px-1">
                  <span className="truncate text-sm text-ink-muted">{label}</span>
                  <span className="shrink-0 rounded-full border border-hairline bg-canvas px-1.5 py-px text-xs font-medium tracking-wide text-ink-muted">
                    Soon
                  </span>
                </li>
              ))}
            </ul>
          </>
        )}
      </div>
    </aside>
  );
}
