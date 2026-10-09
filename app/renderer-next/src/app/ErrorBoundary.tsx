import { Component } from 'react';
import type { ErrorInfo, ReactNode } from 'react';
import { cn } from '../lib/cn';

export interface ErrorBoundaryProps {
  children: ReactNode;
  title?: string;
  /** What the button does. Defaults to drawing the screen again; the root boundary reloads the window. */
  onRetry?: () => void;
  retryLabel?: string;
  className?: string;
}

interface ErrorBoundaryState {
  error: Error | null;
}

/**
 * Catches a crash so one broken screen does not blank the window. The fallback is plain markup with no lazy
 * imports, so it still draws when the crash was a chunk that failed to load.
 */
export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  state: ErrorBoundaryState = { error: null };

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error('Dust renderer error', error, info);
  }

  render(): ReactNode {
    if (this.state.error === null) return this.props.children;
    const { title = 'This screen could not be drawn', onRetry, retryLabel = 'Try again', className } = this.props;
    return (
      <div role="alert" className={cn('flex flex-col items-center gap-2 px-6 py-12 text-center', className)}>
        <p className="text-body font-semibold">{title}</p>
        <p className="max-w-sm text-body text-ink-2">
          Your files were not touched. Try again, and restart Dust if it keeps happening.
        </p>
        <button
          type="button"
          onClick={onRetry ?? (() => this.setState({ error: null }))}
          className="dur-faster mt-2 h-8 rounded-control border border-border bg-surface px-3 text-body hover:border-border-strong hover:bg-surface-hover active:bg-surface-pressed"
        >
          {retryLabel}
        </button>
      </div>
    );
  }
}
