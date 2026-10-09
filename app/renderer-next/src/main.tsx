import { StrictMode, Suspense, lazy } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './app/App';
import './styles/base.css';

performance.mark('dust:main');

// The component gallery exists only in dev builds; the dynamic import is dropped from production bundles.
const Gallery = import.meta.env.DEV
  ? lazy(() => import('./pages/gallery/Gallery').then((m) => ({ default: m.Gallery })))
  : null;
const showGallery = Gallery !== null && window.location.hash === '#gallery';

const container = document.getElementById('root');
if (!container) throw new Error('root element missing');
createRoot(container).render(
  <StrictMode>
    {showGallery && Gallery ? (
      <Suspense fallback={null}>
        <Gallery />
      </Suspense>
    ) : (
      <App />
    )}
  </StrictMode>,
);
