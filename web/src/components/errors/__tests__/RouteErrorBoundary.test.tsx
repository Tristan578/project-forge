/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent } from '@/test/utils/componentTestUtils';
import { RouteErrorBoundary } from '../RouteErrorBoundary';

const captureExceptionMock = vi.fn();
vi.mock('@/lib/monitoring/sentry-client', () => ({
  captureException: (err: unknown, ctx?: Record<string, unknown>) =>
    captureExceptionMock(err, ctx),
}));

vi.mock('next/link', () => ({
  default: ({
    href,
    children,
    ...rest
  }: {
    href: string;
    children: React.ReactNode;
  }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));

function makeError(message = 'boom', digest?: string) {
  const err = new Error(message) as Error & { digest?: string };
  if (digest !== undefined) err.digest = digest;
  return err;
}

describe('RouteErrorBoundary', () => {
  const reset = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    reset.mockReset();
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllEnvs();
  });

  it('renders title and description', () => {
    render(
      <RouteErrorBoundary
        error={makeError()}
        reset={reset}
        route="editor"
        title="Editor Error"
        description="Your scene was auto-saved."
      />,
    );
    expect(screen.getByText('Editor Error')).toBeInTheDocument();
    expect(screen.getByText(/auto-saved/)).toBeInTheDocument();
    expect(screen.getByText('500')).toBeInTheDocument();
  });

  it('uses default primary label when not provided', () => {
    render(
      <RouteErrorBoundary
        error={makeError()}
        reset={reset}
        route="editor"
        title="Editor Error"
        description="Something went wrong."
      />,
    );
    expect(screen.getByRole('button', { name: 'Try Again' })).toBeInTheDocument();
  });

  it('uses custom primary label when provided', () => {
    render(
      <RouteErrorBoundary
        error={makeError()}
        reset={reset}
        route="editor"
        title="Editor Error"
        description="Something went wrong."
        primaryLabel="Reload Editor"
      />,
    );
    expect(screen.getByRole('button', { name: 'Reload Editor' })).toBeInTheDocument();
  });

  it('renders secondary link when href + label provided', () => {
    render(
      <RouteErrorBoundary
        error={makeError()}
        reset={reset}
        route="settings"
        title="Settings Error"
        description="Your data has not been changed."
        secondaryHref="/dashboard"
        secondaryLabel="Back to Dashboard"
      />,
    );
    const link = screen.getByRole('link', { name: 'Back to Dashboard' });
    expect(link).toHaveAttribute('href', '/dashboard');
  });

  it('omits secondary link when href is missing', () => {
    render(
      <RouteErrorBoundary
        error={makeError()}
        reset={reset}
        route="dashboard"
        title="Dashboard Error"
        description="Try again."
        secondaryLabel="Ignored"
      />,
    );
    expect(screen.queryByRole('link')).not.toBeInTheDocument();
  });

  it('omits secondary link when label is missing', () => {
    render(
      <RouteErrorBoundary
        error={makeError()}
        reset={reset}
        route="dashboard"
        title="Dashboard Error"
        description="Try again."
        secondaryHref="/dashboard"
      />,
    );
    expect(screen.queryByRole('link')).not.toBeInTheDocument();
  });

  it('calls reset when primary button is clicked', () => {
    render(
      <RouteErrorBoundary
        error={makeError()}
        reset={reset}
        route="dashboard"
        title="Dashboard Error"
        description="Retry?"
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Try Again' }));
    expect(reset).toHaveBeenCalledTimes(1);
  });

  it('reports the error to Sentry with route context', () => {
    const error = makeError('editor crashed');
    render(
      <RouteErrorBoundary
        error={error}
        reset={reset}
        route="editor"
        title="Editor Error"
        description="Auto-saved."
      />,
    );
    expect(captureExceptionMock).toHaveBeenCalledTimes(1);
    expect(captureExceptionMock).toHaveBeenCalledWith(error, {
      route: 'editor',
      digest: undefined,
    });
  });

  it('forwards error.digest to Sentry context', () => {
    const error = makeError('dashboard boom', 'abc123');
    render(
      <RouteErrorBoundary
        error={error}
        reset={reset}
        route="dashboard"
        title="Dashboard Error"
        description="Retry?"
      />,
    );
    expect(captureExceptionMock).toHaveBeenCalledWith(error, {
      route: 'dashboard',
      digest: 'abc123',
    });
  });

  it('hides raw error message in production', () => {
    vi.stubEnv('NODE_ENV', 'production');
    render(
      <RouteErrorBoundary
        error={makeError('secret stack trace')}
        reset={reset}
        route="settings"
        title="Settings Error"
        description="Your data has not been changed."
      />,
    );
    expect(screen.queryByText(/secret stack trace/)).not.toBeInTheDocument();
    expect(screen.getByText('Your data has not been changed.')).toBeInTheDocument();
  });

  it('appends raw error message in development', () => {
    vi.stubEnv('NODE_ENV', 'development');
    render(
      <RouteErrorBoundary
        error={makeError('detailed dev error')}
        reset={reset}
        route="settings"
        title="Settings Error"
        description="Your data has not been changed."
      />,
    );
    expect(
      screen.getByText(/Your data has not been changed\. \(detailed dev error\)/),
    ).toBeInTheDocument();
  });

  it('has accessible alert role and live region', () => {
    render(
      <RouteErrorBoundary
        error={makeError()}
        reset={reset}
        route="community"
        title="Community Error"
        description="Try again."
      />,
    );
    const alert = screen.getByRole('alert');
    expect(alert).toHaveAttribute('aria-live', 'assertive');
  });
});
