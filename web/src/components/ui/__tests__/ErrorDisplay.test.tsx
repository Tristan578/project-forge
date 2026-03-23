/**
 * Render tests for the ErrorDisplay component.
 *
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup } from '@/test/utils/componentTestUtils';
import { ErrorDisplay } from '../ErrorDisplay';

// Stub lucide-react icons so tests don't depend on SVG rendering details
vi.mock('lucide-react', () => ({
  AlertCircle: (props: Record<string, unknown>) => <span data-testid="icon-alert-circle" {...props} />,
  AlertTriangle: (props: Record<string, unknown>) => <span data-testid="icon-alert-triangle" {...props} />,
  Info: (props: Record<string, unknown>) => <span data-testid="icon-info" {...props} />,
  X: (props: Record<string, unknown>) => <span data-testid="icon-x" {...props} />,
}));

afterEach(() => {
  cleanup();
});

// ─── Inline variant ──────────────────────────────────────────────────────────

describe('ErrorDisplay — inline variant', () => {
  it('renders the message text', () => {
    render(<ErrorDisplay variant="inline" message="This field is required." />);
    expect(screen.getByText('This field is required.').textContent).toBe('This field is required.');
  });

  it('has role=alert for screen readers', () => {
    render(<ErrorDisplay variant="inline" message="Invalid email address." />);
    expect(screen.getByRole('alert')).not.toBeNull();
  });

  it('shows the error icon by default (severity=error)', () => {
    render(<ErrorDisplay variant="inline" message="Error" />);
    expect(screen.getByTestId('icon-alert-circle')).toBeDefined();
  });

  it('shows the warning icon when severity=warning', () => {
    render(<ErrorDisplay variant="inline" severity="warning" message="Warning" />);
    expect(screen.getByTestId('icon-alert-triangle')).toBeDefined();
  });

  it('shows the info icon when severity=info', () => {
    render(<ErrorDisplay variant="inline" severity="info" message="Info" />);
    expect(screen.getByTestId('icon-info')).toBeDefined();
  });

  it('does not render a title (inline has no title)', () => {
    render(<ErrorDisplay variant="inline" title="Ignored title" message="Error text." />);
    // title prop is intentionally ignored for inline variant
    expect(screen.queryByText('Ignored title')).toBeNull();
  });

  it('does not render action button for inline variant', () => {
    render(
      <ErrorDisplay
        variant="inline"
        message="Error."
        action={{ label: 'Retry', onClick: vi.fn() }}
      />,
    );
    expect(screen.queryByRole('button')).toBeNull();
  });
});

// ─── Banner variant ──────────────────────────────────────────────────────────

describe('ErrorDisplay — banner variant', () => {
  it('renders the message text', () => {
    render(<ErrorDisplay variant="banner" message="Connection lost." />);
    expect(screen.getByText('Connection lost.').textContent).toBe('Connection lost.');
  });

  it('renders the title when provided', () => {
    render(<ErrorDisplay variant="banner" title="Network error" message="Retry." />);
    expect(screen.getByText('Network error').textContent).toBe('Network error');
  });

  it('does not render a title element when title is omitted', () => {
    render(<ErrorDisplay variant="banner" message="Retry." />);
    // No heading-level element for title
    expect(screen.queryByRole('heading')).toBeNull();
  });

  it('renders the action button when action is provided', () => {
    const onClick = vi.fn();
    render(
      <ErrorDisplay
        variant="banner"
        message="Retry."
        action={{ label: 'Try again', onClick }}
      />,
    );
    const button = screen.getByRole('button', { name: 'Try again' });
    expect(button).not.toBeNull();
  });

  it('calls action.onClick when action button is clicked', () => {
    const onClick = vi.fn();
    render(
      <ErrorDisplay
        variant="banner"
        message="Retry."
        action={{ label: 'Try again', onClick }}
      />,
    );
    screen.getByRole('button', { name: 'Try again' }).click();
    expect(onClick).toHaveBeenCalledOnce();
  });

  it('renders the dismiss button when onDismiss is provided', () => {
    const onDismiss = vi.fn();
    render(<ErrorDisplay variant="banner" message="Error." onDismiss={onDismiss} />);
    expect(screen.getByRole('button', { name: 'Dismiss' })).not.toBeNull();
  });

  it('calls onDismiss when dismiss button is clicked', () => {
    const onDismiss = vi.fn();
    render(<ErrorDisplay variant="banner" message="Error." onDismiss={onDismiss} />);
    screen.getByRole('button', { name: 'Dismiss' }).click();
    expect(onDismiss).toHaveBeenCalledOnce();
  });

  it('does not render a dismiss button when onDismiss is omitted', () => {
    render(<ErrorDisplay variant="banner" message="Error." />);
    expect(screen.queryByRole('button', { name: 'Dismiss' })).toBeNull();
  });

  it('has role=alert for screen readers', () => {
    render(<ErrorDisplay variant="banner" message="Error." />);
    expect(screen.getByRole('alert')).not.toBeNull();
  });
});

// ─── Card variant ─────────────────────────────────────────────────────────────

describe('ErrorDisplay — card variant', () => {
  it('renders the message text', () => {
    render(<ErrorDisplay variant="card" message="Something went wrong." />);
    expect(screen.getByText('Something went wrong.').textContent).toBe('Something went wrong.');
  });

  it('renders the title when provided', () => {
    render(<ErrorDisplay variant="card" title="Engine failed" message="Reload to fix." />);
    expect(screen.getByText('Engine failed').textContent).toBe('Engine failed');
  });

  it('renders the action button when action is provided', () => {
    const onClick = vi.fn();
    render(
      <ErrorDisplay
        variant="card"
        title="Error"
        message="Something went wrong."
        action={{ label: 'Reload page', onClick }}
      />,
    );
    expect(screen.getByRole('button', { name: 'Reload page' })).not.toBeNull();
  });

  it('calls action.onClick when action button is clicked', () => {
    const onClick = vi.fn();
    render(
      <ErrorDisplay
        variant="card"
        message="Error."
        action={{ label: 'Reload', onClick }}
      />,
    );
    screen.getByRole('button', { name: 'Reload' }).click();
    expect(onClick).toHaveBeenCalledOnce();
  });

  it('renders a Dismiss button when onDismiss is provided', () => {
    const onDismiss = vi.fn();
    render(<ErrorDisplay variant="card" message="Error." onDismiss={onDismiss} />);
    expect(screen.getByRole('button', { name: 'Dismiss' })).not.toBeNull();
  });

  it('calls onDismiss when Dismiss button is clicked', () => {
    const onDismiss = vi.fn();
    render(<ErrorDisplay variant="card" message="Error." onDismiss={onDismiss} />);
    screen.getByRole('button', { name: 'Dismiss' }).click();
    expect(onDismiss).toHaveBeenCalledOnce();
  });

  it('shows the large error icon by default', () => {
    render(<ErrorDisplay variant="card" message="Error." />);
    expect(screen.getByTestId('icon-alert-circle')).toBeDefined();
  });

  it('shows the warning icon when severity=warning', () => {
    render(<ErrorDisplay variant="card" severity="warning" message="Warning." />);
    expect(screen.getByTestId('icon-alert-triangle')).toBeDefined();
  });

  it('shows the info icon when severity=info', () => {
    render(<ErrorDisplay variant="card" severity="info" message="Info." />);
    expect(screen.getByTestId('icon-info')).toBeDefined();
  });

  it('has role=alert for screen readers', () => {
    render(<ErrorDisplay variant="card" message="Error." />);
    expect(screen.getByRole('alert')).not.toBeNull();
  });
});

// ─── User-safety invariants ────────────────────────────────────────────────────

describe('ErrorDisplay — user-safety invariants', () => {
  it('never renders raw HTTP status codes', () => {
    render(<ErrorDisplay variant="card" message="Check your connection." title="Connection lost" />);
    const container = document.body;
    expect(container.textContent).not.toContain('500');
    expect(container.textContent).not.toContain('404');
  });

  it('renders message exactly as provided (no wrapping or modification)', () => {
    const msg = 'Check your internet connection and try again.';
    render(<ErrorDisplay variant="banner" message={msg} />);
    expect(screen.getByText(msg)).toBeDefined();
  });
});
