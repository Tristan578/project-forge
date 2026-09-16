/** Isolates inspector render failures, reports them and offers an announced retry fallback. */
'use client';

import { Component, type ErrorInfo, type ReactNode } from 'react';
import { AlertTriangle, RotateCcw } from 'lucide-react';
import { captureException } from '@/lib/monitoring/sentry-client';

/** Content isolated by this boundary and its user-visible section identity. */
interface Props {
  /** Inspector content to remount when Retry clears the captured failure. */
  children: ReactNode;
  /** Section name shown in the fallback (e.g. "Material", "Physics") */
  section: string;
}

/** Captured render failure retained until an explicit Retry. */
interface State {
  /** Whether render should return the fallback. */
  hasError: boolean;
  /** Captured exception; its message appears only in development. */
  error: Error | null;
}

/**
 * Lightweight error boundary for individual inspector sections.
 * If one section crashes, the rest of the panel stays functional.
 * Provides a retry button that resets the error state.
 */
export class InspectorErrorBoundary extends Component<Props, State> {
  /** @param props Inspector children and section name for the fallback/report. */
  constructor(props: Props) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  /**
   * @param error Exception thrown by descendant rendering.
   * @returns State selecting the fallback and retaining the failure.
   */
  static getDerivedStateFromError(error: Error): Partial<State> {
    return { hasError: true, error };
  }

  /**
   * Reports a descendant failure with its section and component stack.
   * @param error Captured descendant exception.
   * @param errorInfo React component stack context.
   * @returns Nothing; reporting does not rethrow the render failure.
   */
  componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    captureException(error, {
      section: this.props.section,
      componentStack: errorInfo.componentStack,
    });
    console.error(`[InspectorErrorBoundary] ${this.props.section} crashed:`, error, errorInfo);
  }

  /** Clear the captured failure so React renders the children again. */
  private handleRetry = () => {
    this.setState({ hasError: false, error: null });
  };

  /** @returns Inspector children or an alert containing the named Retry control. */
  render() {
    if (this.state.hasError) {
      return (
        <div className="border-t border-zinc-800 pt-3 mt-3">
          <div role="alert" className="rounded border border-red-900/50 bg-red-950/20 p-3">
            <div className="flex items-center gap-2 mb-2">
              <AlertTriangle size={14} className="text-red-400 shrink-0" />
              <span className="text-xs font-medium text-red-400">
                {this.props.section} failed to render
              </span>
            </div>
            {process.env.NODE_ENV === 'development' && this.state.error && (
              <p className="mb-2 text-[10px] text-red-400/70 break-all line-clamp-2">
                {this.state.error.message}
              </p>
            )}
            <button
              type="button"
              onClick={this.handleRetry}
              className="flex items-center gap-1 rounded bg-zinc-800 px-2 py-1 text-xs text-zinc-400 hover:bg-zinc-700 hover:text-zinc-300 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--sf-accent)]"
            >
              <RotateCcw size={10} />
              Retry
            </button>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}
