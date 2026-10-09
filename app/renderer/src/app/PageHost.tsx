import { Activity, Suspense, useEffect, useRef } from 'react';
import { Skeleton } from '../ui/Skeleton';
import { ErrorBoundary } from './ErrorBoundary';
import { useNavStore } from './nav';
import type { PageDefinition } from './pages';

function PageFallback() {
  return (
    <div className="flex flex-col gap-4 pt-2" role="status" aria-label="Loading">
      <Skeleton className="h-9 w-56" />
      <Skeleton className="h-4 w-80" />
      <Skeleton className="mt-4 h-40 w-full" />
    </div>
  );
}

/** One page: its own scroll area, error boundary and loading state. */
function PageSlot({ page }: { page: PageDefinition }) {
  const scroller = useRef<HTMLDivElement>(null);
  const scrollTop = useRef(0);

  // Effects stop while the page is hidden and start again when it is shown, so this runs on every show.
  // A hidden page loses its scroll position (display: none), so it is put back here.
  useEffect(() => {
    const element = scroller.current;
    if (element === null) return;
    element.scrollTop = scrollTop.current;
    if (useNavStore.getState().focusTarget !== page.id) return;

    // The heading of a page that is still loading does not exist yet, so wait for it.
    const focusHeading = (): boolean => {
      const heading = element.querySelector('h1');
      if (heading === null) return false;
      heading.focus({ preventScroll: true });
      useNavStore.getState().clearFocusTarget(page.id);
      return true;
    };
    if (focusHeading()) return;
    const observer = new MutationObserver(() => {
      if (focusHeading()) observer.disconnect();
    });
    observer.observe(element, { childList: true, subtree: true });
    return () => observer.disconnect();
  }, [page.id]);

  return (
    <div
      ref={scroller}
      onScroll={(event) => {
        scrollTop.current = event.currentTarget.scrollTop;
      }}
      className="h-full scroll-pb-24 overflow-y-auto"
    >
      <div className="mx-auto max-w-[1040px] px-8 pt-2 pb-8 max-[1099px]:px-6">
        <ErrorBoundary>
          <Suspense fallback={<PageFallback />}>
            <page.Component />
          </Suspense>
        </ErrorBoundary>
      </div>
    </div>
  );
}

/**
 * Keeps every visited page mounted (up to the cap in nav.ts) inside <Activity>. A hidden page keeps its state and
 * stops its effects, so it cannot poll or subscribe while out of sight.
 */
export function PageHost({ pages }: { pages: readonly PageDefinition[] }) {
  const current = useNavStore((state) => state.page);
  const visited = useNavStore((state) => state.visited);
  return (
    <>
      {visited.map((id) => {
        const page = pages.find((candidate) => candidate.id === id);
        if (page === undefined) return null;
        return (
          <Activity key={id} mode={id === current ? 'visible' : 'hidden'}>
            <PageSlot page={page} />
          </Activity>
        );
      })}
    </>
  );
}
