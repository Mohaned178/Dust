import type { DustApi } from '../../../src/shared/ipc';
import { ApiContext } from '../lib/api';
import { DialogHost } from './dialogs';
import { ErrorBoundary } from './ErrorBoundary';
import { PageHost } from './PageHost';
import { PAGES } from './pages';
import type { PageDefinition } from './pages';
import { Sidebar } from './Sidebar';
import { TitleBar } from './TitleBar';
import { ToastLayer } from './ToastLayer';

export interface AppProps {
  api: DustApi;
  /** Tests swap in their own pages. */
  pages?: readonly PageDefinition[];
}

export function App({ api, pages = PAGES }: AppProps) {
  return (
    <ApiContext value={api}>
      <div className="flex h-full flex-col bg-canvas text-ink">
        <TitleBar />
        <div className="flex min-h-0 flex-1">
          <Sidebar pages={pages} />
          <main className="min-w-0 flex-1">
            <ErrorBoundary title="Dust could not draw this screen">
              <PageHost pages={pages} />
            </ErrorBoundary>
          </main>
        </div>
        <DialogHost />
        <ToastLayer />
      </div>
    </ApiContext>
  );
}
