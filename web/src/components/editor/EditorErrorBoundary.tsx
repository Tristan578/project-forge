'use client';

import { Component, type ErrorInfo, type ReactNode } from 'react';
import { AlertTriangle, RefreshCw, ArrowLeft } from 'lucide-react';
import { captureException } from '@/lib/monitoring/sentry-client';

interface Props { children: ReactNode; }
interface State { hasError: boolean; error: Error | null; errorInfo: ErrorInfo | null; }

export class EditorErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { hasError: false, error: null, errorInfo: null };
  }

  static getDerivedStateFromError(error: Error): Partial<State> {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    captureException(error, { boundary: 'EditorErrorBoundary', componentStack: errorInfo.componentStack });
    console.error('[EditorErrorBoundary] Uncaught render error:', error, errorInfo);
    this.setState({ errorInfo });
  }

  private handleReload = () => { window.location.reload(); };
  private handleBackToDashboard = () => { window.location.href = '/dashboard'; };

  render() {
    if (this.state.hasError) {
      return (
        <div className="flex h-screen w-full items-center justify-center bg-zinc-950 p-4">
          <div className="max-w-md rounded-lg border border-zinc-700 bg-zinc-900 p-6 shadow-2xl">
            <div className="mb-4 flex items-center gap-3">
              <AlertTriangle className="h-8 w-8 shrink-0 text-red-500" />
              <h1 className="text-xl font-bold text-white">Something went wrong</h1>
            </div>
            <p className="mb-4 text-sm text-zinc-300">The editor encountered an unexpected error. You can try reloading the page or return to the dashboard.</p>
            {process.env.NODE_ENV === 'development' && this.state.error && (
              <details className="mb-4 rounded border border-zinc-700 bg-zinc-950 p-3">
                <summary className="cursor-pointer text-xs font-semibold text-zinc-400">Technical Details</summary>
                <pre className="mt-2 max-h-40 overflow-auto text-xs text-red-400">{this.state.error.toString()}{this.state.errorInfo?.componentStack}</pre>
              </details>
            )}
            <div className="flex flex-col gap-2">
              <button onClick={this.handleReload} className="flex items-center justify-center gap-2 rounded bg-blue-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500">
                <RefreshCw className="h-4 w-4" />Reload Editor
              </button>
              <button onClick={this.handleBackToDashboard} className="flex items-center justify-center gap-2 rounded bg-zinc-700 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-zinc-600 focus:outline-none focus:ring-2 focus:ring-blue-500">
                <ArrowLeft className="h-4 w-4" />Back to Dashboard
              </button>
            </div>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}
