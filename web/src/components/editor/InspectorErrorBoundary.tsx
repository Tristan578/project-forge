'use client';

import { Component, type ErrorInfo, type ReactNode } from 'react';
import { AlertTriangle, RotateCcw } from 'lucide-react';

interface Props {
  children: ReactNode;
  /** Section name shown in the fallback (e.g. "Material", "Physics") */
  section: string;
}

interface State {
  hasError: boolean;
  error: Error | null;
}

/**
 * Lightweight error boundary for individual inspector sections.
 * If one section crashes, the rest of the panel stays functional.
 * Provides a retry button that resets the error state.
 */
export class InspectorErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error): Partial<State> {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error(`[InspectorErrorBoundary] ${this.props.section} crashed:`, error, errorInfo);
  }

  private handleRetry = () => {
    this.setState({ hasError: false, error: null });
  };

  render() {
    if (this.state.hasError) {
      return (
        <div className="border-t border-zinc-800 pt-3 mt-3">
          <div className="rounded border border-red-900/50 bg-red-950/20 p-3">
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
              onClick={this.handleRetry}
              className="flex items-center gap-1 rounded bg-zinc-800 px-2 py-1 text-xs text-zinc-400 hover:bg-zinc-700 hover:text-zinc-300"
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
