import { StrictMode, Suspense, lazy } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './app/App';
import { ErrorBoundary } from './app/ErrorBoundary';
import { startEvents } from './app/events';
import { applyLaunchHints, prefetchHome } from './app/launch';
import { getWindowApi } from './lib/api';
import './styles/base.css';

performance.mark('dust:main');

// The component gallery exists only in dev builds; the dynamic import is dropped from production bundles.
const Gallery = import.meta.env.DEV
  ? lazy(() => import('./pages/gallery/Gallery').then((m) => ({ default: m.Gallery })))
  : null;
const showGallery = Gallery !== null && window.location.hash === '#gallery';

const container = document.getElementById('root');
if (!container) throw new Error('root element missing');
const api = getWindowApi();
if (!showGallery) {
  // The one subscription to each backend stream, on before the first render so no early event is missed.
  startEvents(api);
  void applyLaunchHints(api);
  void prefetchHome(api);
}
createRoot(container).render(
  <StrictMode>
    {showGallery && Gallery ? (
      <Suspense fallback={null}>
        <Gallery />
      </Suspense>
    ) : (
      <ErrorBoundary
        title="Dust ran into a problem"
        retryLabel="Reload Dust"
        onRetry={() => window.location.reload()}
        className="h-full justify-center"
      >
        <App api={api} />
      </ErrorBoundary>
    )}
  </StrictMode>,
);
