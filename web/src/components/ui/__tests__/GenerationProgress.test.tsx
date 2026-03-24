/**
 * Render and interaction tests for GenerationProgress component.
 *
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { render, screen, cleanup, fireEvent } from '@/test/utils/componentTestUtils';
import { GenerationProgress, GenerationProgressOverlay } from '../GenerationProgress';

// ─── Mocks ───────────────────────────────────────────────────────────────────

// Stub out Lucide icons to simple data-testid spans
vi.mock('lucide-react', () => ({
  X: (props: Record<string, unknown>) => <span data-testid="x-icon" {...props} />,
  Sparkles: (props: Record<string, unknown>) => <span data-testid="sparkles-icon" {...props} />,
}));

// Stub estimatedTimes to avoid timer complexity in stage tests
vi.mock('@/lib/generation/estimatedTimes', () => ({
  getCurrentStage: (_type: string, _progress: number) => 'Test stage...',
  formatEstimatedTime: (_type: string, _progress?: number, _elapsed?: number) => '~30-45s',
  ESTIMATED_TIMES: {
    model: { min: 60, max: 120, label: '3D model' },
    texture: { min: 20, max: 45, label: 'texture' },
    sfx: { min: 5, max: 15, label: 'sound effect' },
    voice: { min: 5, max: 15, label: 'voice clip' },
    music: { min: 30, max: 90, label: 'music track' },
    skybox: { min: 30, max: 60, label: 'skybox' },
    sprite: { min: 15, max: 30, label: 'sprite' },
    sprite_sheet: { min: 20, max: 45, label: 'sprite sheet' },
    tileset: { min: 20, max: 45, label: 'tileset' },
    'pixel-art': { min: 10, max: 25, label: 'pixel art' },
  },
}));

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('GenerationProgress', () => {
  afterEach(() => {
    cleanup();
    vi.clearAllTimers();
  });

  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  // ── role / aria ─────────────────────────────────────────────────────────────

  it('renders with role="status" and aria-live="polite"', () => {
    render(<GenerationProgress operation="model" />);
    const el = screen.getByRole('status');
    expect(el).not.toBeNull();
    expect(el.getAttribute('aria-live')).toBe('polite');
  });

  it('sets aria-label to include operation label', () => {
    render(<GenerationProgress operation="model" />);
    const el = screen.getByRole('status');
    expect(el.getAttribute('aria-label')).toContain('3D model');
  });

  // ── header ──────────────────────────────────────────────────────────────────

  it('renders the sparkles icon', () => {
    render(<GenerationProgress operation="texture" />);
    expect(screen.getByTestId('sparkles-icon')).not.toBeNull();
  });

  it('renders the operation label in the header', () => {
    render(<GenerationProgress operation="texture" />);
    expect(screen.getByText(/texture/i)).not.toBeNull();
  });

  it('renders "3D model" label for model operation', () => {
    render(<GenerationProgress operation="model" />);
    expect(screen.getByText(/3D model/)).not.toBeNull();
  });

  // ── cancel button ───────────────────────────────────────────────────────────

  it('does not render cancel button when onCancel is omitted', () => {
    render(<GenerationProgress operation="model" />);
    expect(screen.queryByTestId('x-icon')).toBeNull();
  });

  it('renders cancel button when onCancel is provided', () => {
    const handleCancel = vi.fn();
    render(<GenerationProgress operation="model" onCancel={handleCancel} />);
    expect(screen.getByTestId('x-icon')).not.toBeNull();
  });

  it('calls onCancel when cancel button is clicked', () => {
    const handleCancel = vi.fn();
    render(<GenerationProgress operation="model" onCancel={handleCancel} />);
    // Find the button containing the X icon
    const cancelBtn = screen.getByRole('button');
    fireEvent.click(cancelBtn);
    expect(handleCancel).toHaveBeenCalledOnce();
  });

  it('cancel button has accessible aria-label', () => {
    const handleCancel = vi.fn();
    render(<GenerationProgress operation="model" onCancel={handleCancel} />);
    const btn = screen.getByRole('button');
    expect(btn.getAttribute('aria-label')).toContain('3D model');
    expect(btn.getAttribute('aria-label')).toContain('Cancel');
  });

  // ── indeterminate mode (no progress) ────────────────────────────────────────

  it('does not render a progressbar element in indeterminate mode', () => {
    render(<GenerationProgress operation="model" />);
    expect(screen.queryByRole('progressbar')).toBeNull();
  });

  it('renders stage text in indeterminate mode', () => {
    render(<GenerationProgress operation="model" />);
    // The mocked getCurrentStage returns 'Test stage...' for any inputs
    // But since progress is undefined, derivedStage = 'Starting...'
    expect(screen.getByText('Starting...')).not.toBeNull();
  });

  // ── streaming mode (progress = 0) ──────────────────────────────────────────

  it('does not render a progressbar element in streaming mode', () => {
    render(<GenerationProgress operation="model" progress={0} />);
    expect(screen.queryByRole('progressbar')).toBeNull();
  });

  it('renders stage from getCurrentStage in streaming mode', () => {
    render(<GenerationProgress operation="model" progress={0} />);
    // getCurrentStage mock returns 'Test stage...'
    expect(screen.getByText(/Test stage/i)).not.toBeNull();
  });

  // ── determinate mode (progress > 0) ─────────────────────────────────────────

  it('renders progressbar element in determinate mode', () => {
    render(<GenerationProgress operation="model" progress={50} />);
    const bar = screen.getByRole('progressbar');
    expect(bar).not.toBeUndefined();
  });

  it('sets aria-valuenow to current progress', () => {
    render(<GenerationProgress operation="model" progress={64} />);
    const bar = screen.getByRole('progressbar');
    expect(bar.getAttribute('aria-valuenow')).toBe('64');
  });

  it('renders percentage text in determinate mode', () => {
    render(<GenerationProgress operation="model" progress={64} />);
    expect(screen.getByText('64%')).not.toBeNull();
  });

  it('clamps progress to 0 at minimum', () => {
    render(<GenerationProgress operation="model" progress={-5} />);
    const bar = screen.getByRole('progressbar');
    expect(bar.getAttribute('aria-valuenow')).toBe('0');
  });

  it('clamps progress to 100 at maximum', () => {
    render(<GenerationProgress operation="model" progress={110} />);
    const bar = screen.getByRole('progressbar');
    expect(bar.getAttribute('aria-valuenow')).toBe('100');
  });

  // ── custom stage override ────────────────────────────────────────────────────

  it('uses custom stage prop when provided', () => {
    render(<GenerationProgress operation="model" progress={50} stage="Custom stage label..." />);
    expect(screen.getByText('Custom stage label...')).not.toBeNull();
  });

  it('uses custom stage in downloading state', () => {
    render(
      <GenerationProgress
        operation="model"
        stage="Downloading result..."
      />,
    );
    expect(screen.getByText('Downloading result...')).not.toBeNull();
  });
});

// ─── GenerationProgressOverlay ────────────────────────────────────────────────

describe('GenerationProgressOverlay', () => {
  afterEach(() => {
    cleanup();
    vi.useRealTimers();
  });

  beforeEach(() => {
    vi.useFakeTimers();
  });

  it('renders nothing when isVisible=false', () => {
    render(
      <GenerationProgressOverlay
        isVisible={false}
        operation="model"
      />,
    );
    expect(screen.queryByRole('status')).toBeNull();
  });

  it('renders the progress component when isVisible=true', () => {
    render(
      <GenerationProgressOverlay
        isVisible={true}
        operation="model"
      />,
    );
    expect(screen.getByRole('status')).not.toBeNull();
  });

  it('forwards operation label into the inner component', () => {
    render(
      <GenerationProgressOverlay
        isVisible={true}
        operation="texture"
      />,
    );
    expect(screen.getByText(/texture/i)).not.toBeNull();
  });

  it('passes cancel handler through to the inner component', () => {
    const handleCancel = vi.fn();
    render(
      <GenerationProgressOverlay
        isVisible={true}
        operation="model"
        onCancel={handleCancel}
      />,
    );
    const btn = screen.getByRole('button');
    fireEvent.click(btn);
    expect(handleCancel).toHaveBeenCalledOnce();
  });

  it('has aria-modal attribute', () => {
    render(
      <GenerationProgressOverlay
        isVisible={true}
        operation="model"
      />,
    );
    // The outer backdrop div has aria-modal=true
    const backdrop = document.querySelector('[aria-modal="true"]');
    expect(backdrop).not.toBeNull();
  });
});
