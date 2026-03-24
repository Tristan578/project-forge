/**
 * Render tests for WasmErrorBoundary component.
 *
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup } from '@/test/utils/componentTestUtils';
import { WasmErrorBoundary } from '../WasmErrorBoundary';

vi.mock('@/lib/monitoring/sentry-client', () => ({
  captureException: vi.fn(),
}));

vi.mock('lucide-react', () => ({
  AlertTriangle: (props: Record<string, unknown>) => <span data-testid="alert-triangle" {...props} />,
  RefreshCw: (props: Record<string, unknown>) => <span data-testid="refresh-cw" {...props} />,
}));

// A component that throws an error for testing
function ThrowingChild({ shouldThrow }: { shouldThrow: boolean }) {
  if (shouldThrow) {
    throw new Error('WASM crash simulation');
  }
  return <div data-testid="child-content">Engine Running</div>;
}

describe('WasmErrorBoundary', () => {
  // Suppress console.error for error boundary tests
  const originalConsoleError = console.error;

  beforeEach(() => {
    vi.clearAllMocks();
    console.error = vi.fn();
    // Clear crash backup
    localStorage.removeItem('forge-editor-crash-backup');
  });

  afterEach(() => {
    console.error = originalConsoleError;
    cleanup();
    localStorage.removeItem('forge-editor-crash-backup');
  });

  it('renders children normally when no error', () => {
    render(
      <WasmErrorBoundary>
        <ThrowingChild shouldThrow={false} />
      </WasmErrorBoundary>
    );
    expect(screen.getByTestId('child-content')).not.toBeNull();
  });

  it('renders Engine Error fallback UI when child throws', () => {
    render(
      <WasmErrorBoundary>
        <ThrowingChild shouldThrow={true} />
      </WasmErrorBoundary>
    );
    expect(screen.getByText('Engine Error')).not.toBeNull();
  });

  it('shows error description in fallback UI', () => {
    render(
      <WasmErrorBoundary>
        <ThrowingChild shouldThrow={true} />
      </WasmErrorBoundary>
    );
    expect(screen.getByText(/unexpected error/)).not.toBeNull();
  });

  it('shows Reload Engine button in fallback UI', () => {
    render(
      <WasmErrorBoundary>
        <ThrowingChild shouldThrow={true} />
      </WasmErrorBoundary>
    );
    expect(screen.getByText('Reload Engine')).not.toBeNull();
  });

  it('shows Restore & Reload Engine button when backup exists', () => {
    localStorage.setItem(
      'forge-editor-crash-backup',
      JSON.stringify({ timestamp: '2024-01-01T00:00:00Z', state: '{}' })
    );
    render(
      <WasmErrorBoundary>
        <ThrowingChild shouldThrow={true} />
      </WasmErrorBoundary>
    );
    expect(screen.getByText('Restore & Reload Engine')).not.toBeNull();
  });

  it('does not show Restore button when no backup', () => {
    render(
      <WasmErrorBoundary>
        <ThrowingChild shouldThrow={true} />
      </WasmErrorBoundary>
    );
    expect(screen.queryByText('Restore & Reload Engine')).toBeNull();
  });

  it('shows Auto-save detected message when backup exists', () => {
    localStorage.setItem(
      'forge-editor-crash-backup',
      JSON.stringify({ timestamp: '2024-01-01T00:00:00Z', state: '{}' })
    );
    render(
      <WasmErrorBoundary>
        <ThrowingChild shouldThrow={true} />
      </WasmErrorBoundary>
    );
    expect(screen.getByText('Auto-save detected')).not.toBeNull();
  });

  it('hides child content when error occurs', () => {
    render(
      <WasmErrorBoundary>
        <ThrowingChild shouldThrow={true} />
      </WasmErrorBoundary>
    );
    expect(screen.queryByTestId('child-content')).toBeNull();
  });
});
