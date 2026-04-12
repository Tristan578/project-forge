/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup } from '@/test/utils/componentTestUtils';

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

function makeError(message = 'boom') {
  return new Error(message) as Error & { digest?: string };
}

const reset = vi.fn();

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('route error.tsx wrappers', () => {
  it('editor wrapper renders correct title and reports to Sentry with route=editor', async () => {
    const { default: EditorError } = await import(
      '@/app/editor/[id]/error'
    );
    const error = makeError('editor crash');
    render(<EditorError error={error} reset={reset} />);
    expect(screen.getByText('Editor Error')).toBeInTheDocument();
    expect(screen.getByText(/auto-saved/)).toBeInTheDocument();
    expect(captureExceptionMock).toHaveBeenCalledWith(error, {
      route: 'editor',
      digest: undefined,
    });
  });

  it('dashboard wrapper renders correct title and reports to Sentry with route=dashboard', async () => {
    const { default: DashboardError } = await import(
      '@/app/dashboard/error'
    );
    const error = makeError('dashboard crash');
    render(<DashboardError error={error} reset={reset} />);
    expect(screen.getByText('Dashboard Error')).toBeInTheDocument();
    expect(captureExceptionMock).toHaveBeenCalledWith(error, {
      route: 'dashboard',
      digest: undefined,
    });
  });

  it('settings wrapper renders correct title and reports to Sentry with route=settings', async () => {
    const { default: SettingsError } = await import(
      '@/app/settings/error'
    );
    const error = makeError('settings crash');
    render(<SettingsError error={error} reset={reset} />);
    expect(screen.getByText('Settings Error')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Back to Dashboard' })).toHaveAttribute(
      'href',
      '/dashboard',
    );
    expect(captureExceptionMock).toHaveBeenCalledWith(error, {
      route: 'settings',
      digest: undefined,
    });
  });

  it('admin wrapper renders correct title and reports to Sentry with route=admin', async () => {
    const { default: AdminError } = await import('@/app/admin/error');
    const error = makeError('admin crash');
    render(<AdminError error={error} reset={reset} />);
    expect(screen.getByText('Admin Error')).toBeInTheDocument();
    expect(captureExceptionMock).toHaveBeenCalledWith(error, {
      route: 'admin',
      digest: undefined,
    });
  });

  it('community wrapper renders correct title and reports to Sentry with route=community', async () => {
    const { default: CommunityError } = await import(
      '@/app/community/error'
    );
    const error = makeError('community crash');
    render(<CommunityError error={error} reset={reset} />);
    expect(screen.getByText('Community Error')).toBeInTheDocument();
    expect(captureExceptionMock).toHaveBeenCalledWith(error, {
      route: 'community',
      digest: undefined,
    });
  });

  it('play wrapper renders correct title and reports to Sentry with route=play', async () => {
    const { default: PlayError } = await import('@/app/play/error');
    const error = makeError('play crash');
    render(<PlayError error={error} reset={reset} />);
    expect(screen.getByText('Play Error')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Back to Community' })).toHaveAttribute(
      'href',
      '/community',
    );
    expect(captureExceptionMock).toHaveBeenCalledWith(error, {
      route: 'play',
      digest: undefined,
    });
  });
});
