import { Component } from 'react';
import type { ErrorInfo, ReactNode } from 'react';

export interface ErrorBoundaryProps {
  children: ReactNode;
}

interface ErrorBoundaryState {
  error: Error | null;
}

export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  state: ErrorBoundaryState = { error: null };

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error('Dust renderer error', error, info);
  }

  render(): ReactNode {
    if (this.state.error !== null) {
      return (
        <main className="flex min-h-screen items-center justify-center bg-canvas p-8 text-ink">
          <div className="w-full max-w-md rounded-2xl border border-hairline bg-surface p-6 text-center">
            <h1 className="text-lg font-semibold tracking-tight">Something went wrong</h1>
            <p className="mt-2 text-sm text-ink-muted">
              Dust hit an unexpected error while drawing this screen. Reload to continue; your files were not touched.
            </p>
            <p className="mt-3 break-all font-mono text-xs text-ink-muted">{this.state.error.message}</p>
            <button
              type="button"
              onClick={() => window.location.reload()}
              className="mt-5 rounded-lg bg-accent px-4 py-2 text-sm font-medium text-on-accent transition-colors hover:bg-accent-strong focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
            >
              Reload Dust
            </button>
          </div>
        </main>
      );
    }
    return this.props.children;
  }
}
