/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent } from '@/test/utils/componentTestUtils';
import { EditorErrorBoundary } from '../EditorErrorBoundary';

vi.mock('@/lib/monitoring/sentry-client', () => ({ captureException: vi.fn() }));
vi.mock('lucide-react', () => ({
  AlertTriangle: (props: Record<string, unknown>) => <span data-testid="alert-icon" {...props} />,
  RefreshCw: (props: Record<string, unknown>) => <span data-testid="refresh-icon" {...props} />,
  ArrowLeft: (props: Record<string, unknown>) => <span data-testid="arrow-icon" {...props} />,
}));

function ThrowingChild({ shouldThrow }: { shouldThrow: boolean }) {
  if (shouldThrow) throw new Error('Editor render crash');
  return <div data-testid="child-content">Editor Running</div>;
}

describe('EditorErrorBoundary', () => {
  const origErr = console.error;
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    console.error = vi.fn();
    Object.defineProperty(window, 'location', { value: { ...window.location, reload: vi.fn(), href: '' }, writable: true, configurable: true });
  });
  afterEach(() => { console.error = origErr; cleanup(); });

  it('renders children normally', () => {
    render(<EditorErrorBoundary><ThrowingChild shouldThrow={false} /></EditorErrorBoundary>);
    expect(screen.getByTestId('child-content')).toBeInTheDocument();
  });

  it('shows fallback UI when child throws', () => {
    render(<EditorErrorBoundary><ThrowingChild shouldThrow={true} /></EditorErrorBoundary>);
    expect(screen.getByText('Something went wrong')).toBeInTheDocument();
  });

  it('hides child content on error', () => {
    render(<EditorErrorBoundary><ThrowingChild shouldThrow={true} /></EditorErrorBoundary>);
    expect(screen.queryByTestId('child-content')).toBeNull();
  });

  it('shows Reload Editor button', () => {
    render(<EditorErrorBoundary><ThrowingChild shouldThrow={true} /></EditorErrorBoundary>);
    expect(screen.getByText('Reload Editor')).toBeInTheDocument();
  });

  it('shows Back to Dashboard button', () => {
    render(<EditorErrorBoundary><ThrowingChild shouldThrow={true} /></EditorErrorBoundary>);
    expect(screen.getByText('Back to Dashboard')).toBeInTheDocument();
  });

  it('reports error to Sentry', async () => {
    render(<EditorErrorBoundary><ThrowingChild shouldThrow={true} /></EditorErrorBoundary>);
    const { captureException } = await import('@/lib/monitoring/sentry-client');
    expect(captureException).toHaveBeenCalledWith(expect.any(Error), expect.objectContaining({ boundary: 'EditorErrorBoundary' }));
  });

  it('reloads on Reload Editor click', () => {
    render(<EditorErrorBoundary><ThrowingChild shouldThrow={true} /></EditorErrorBoundary>);
    fireEvent.click(screen.getByText('Reload Editor'));
    expect(window.location.reload).toHaveBeenCalled();
  });

  it('navigates to dashboard on Back click', () => {
    render(<EditorErrorBoundary><ThrowingChild shouldThrow={true} /></EditorErrorBoundary>);
    fireEvent.click(screen.getByText('Back to Dashboard'));
    expect(window.location.href).toBe('/dashboard');
  });
});
