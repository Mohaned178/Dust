import { lazy, memo, Suspense, useEffect } from 'react';
import { cn } from '../lib/cn';
import { useMediaQuery } from '../lib/useMediaQuery';
import { useNavStore } from './nav';
import type { PageId } from './nav';
import type { PageDefinition } from './pages';

// Only the icon rail needs tooltips, so the Radix tooltip code loads when the rail is first shown.
const loadTooltip = () => import('../ui/Tooltip').then((m) => ({ default: m.Tooltip }));
const Tooltip = lazy(loadTooltip);

/** Below this width the sidebar shrinks to an icon rail. Matches the `max-[1099px]` classes below. */
const RAIL_QUERY = '(max-width: 1099px)';

const NavItem = memo(function NavItem({
  page,
  active,
  rail,
  onSelect,
}: {
  page: PageDefinition;
  active: boolean;
  rail: boolean;
  onSelect: (id: PageId) => void;
}) {
  const Icon = page.icon;
  const button = (
    <button
      type="button"
      aria-current={active ? 'page' : undefined}
      onClick={() => onSelect(page.id)}
      className={cn(
        'dur-faster flex h-10 w-full items-center gap-3 rounded-control px-3 text-body max-[1099px]:justify-center max-[1099px]:px-0',
        active
          ? 'bg-accent-soft font-semibold text-accent-hover'
          : 'text-ink hover:bg-surface-hover active:bg-surface-pressed',
      )}
    >
      <Icon className="size-6 shrink-0" aria-hidden="true" />
      {/* In the rail the label stays for screen readers and appears as a tooltip. */}
      <span className="max-[1099px]:sr-only">{page.label}</span>
    </button>
  );
  if (!rail) return button;
  return (
    <Suspense fallback={button}>
      <Tooltip label={page.label} side="right">
        {button}
      </Tooltip>
    </Suspense>
  );
});

export function Sidebar({ pages }: { pages: readonly PageDefinition[] }) {
  const current = useNavStore((state) => state.page);
  const navigate = useNavStore((state) => state.navigate);
  const rail = useMediaQuery(RAIL_QUERY);
  // Fetch the tooltip code once the shell is up, so resizing into the rail never remounts a focused button.
  useEffect(() => {
    void loadTooltip();
  }, []);
  const main = pages.filter((page) => page.id !== 'settings');
  const settings = pages.find((page) => page.id === 'settings');
  return (
    <nav aria-label="Main" className="flex w-60 shrink-0 flex-col gap-1 px-3 pb-3 max-[1099px]:w-14 max-[1099px]:px-2">
      {main.map((page) => (
        <NavItem key={page.id} page={page} active={page.id === current} rail={rail} onSelect={navigate} />
      ))}
      <div className="flex-1" />
      {settings ? <NavItem page={settings} active={settings.id === current} rail={rail} onSelect={navigate} /> : null}
    </nav>
  );
}
