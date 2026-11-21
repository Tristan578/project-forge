/**
 * Render tests for PerformanceProfiler component.
 *
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@/test/utils/componentTestUtils';
import { PerformanceProfiler } from '../PerformanceProfiler';
import { usePerformanceStore } from '@/stores/performanceStore';

vi.mock('@/stores/performanceStore', () => ({
  usePerformanceStore: vi.fn(() => ({})),
}));

vi.mock('lucide-react', () => ({
  ChevronDown: (props: Record<string, unknown>) => <span data-testid="chevron-down" {...props} />,
  ChevronUp: (props: Record<string, unknown>) => <span data-testid="chevron-up" {...props} />,
  AlertTriangle: (props: Record<string, unknown>) => <span data-testid="alert-triangle" {...props} />,
}));

const defaultStats = {
  fps: 60,
  frameTime: 16.7,
  triangleCount: 5000,
  drawCalls: 10,
  entityCount: 20,
  memoryUsage: 128.5,
};

const defaultBudget = {
  targetFps: 60,
  maxTriangles: 500000,
  maxDrawCalls: 100,
  warningThreshold: 0.8,
};

describe('PerformanceProfiler', () => {
  const mockSetProfilerOpen = vi.fn();
  const mockUpdateStats = vi.fn();

  function setupStore({
    isProfilerOpen = false,
    stats = defaultStats,
    budget = defaultBudget,
    history = [] as { fps: number }[],
    warnings = [] as string[],
  } = {}) {
    vi.mocked(usePerformanceStore).mockReturnValue({
      stats,
      isProfilerOpen,
      history,
      budget,
      warnings,
      setProfilerOpen: mockSetProfilerOpen,
      updateStats: mockUpdateStats,
    });
  }

  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
  });

  afterEach(() => {
    cleanup();
    vi.useRealTimers();
  });

  it('renders Performance heading', () => {
    setupStore();
    render(<PerformanceProfiler />);
    expect(screen.getByText('Performance')).toBeInTheDocument();
  });

  it('shows FPS in collapsed view', () => {
    setupStore({ isProfilerOpen: false, stats: { ...defaultStats, fps: 55 } });
    render(<PerformanceProfiler />);
    expect(screen.getByText('55 FPS')).toBeInTheDocument();
  });

  it('shows triangle count in collapsed view', () => {
    setupStore({ isProfilerOpen: false });
    render(<PerformanceProfiler />);
    expect(screen.getByText(/tris/)).toBeInTheDocument();
  });

  it('calls setProfilerOpen when toggle button is clicked', () => {
    setupStore({ isProfilerOpen: false });
    render(<PerformanceProfiler />);
    fireEvent.click(screen.getByRole('button'));
    expect(mockSetProfilerOpen).toHaveBeenCalledWith(true);
  });

  it('shows expanded stats when isProfilerOpen is true', () => {
    setupStore({ isProfilerOpen: true });
    render(<PerformanceProfiler />);
    expect(screen.getByText('Frame Time')).toBeInTheDocument();
    expect(screen.getByText('Triangles')).toBeInTheDocument();
    expect(screen.getByText('Draw Calls')).toBeInTheDocument();
  });

  it('shows entity count when expanded', () => {
    setupStore({ isProfilerOpen: true, stats: { ...defaultStats, entityCount: 42 } });
    render(<PerformanceProfiler />);
    expect(screen.getByText('Entities')).toBeInTheDocument();
    expect(screen.getByText('42')).toBeInTheDocument();
  });

  it('shows memory usage when expanded', () => {
    setupStore({ isProfilerOpen: true, stats: { ...defaultStats, memoryUsage: 64.3 } });
    render(<PerformanceProfiler />);
    expect(screen.getByText('Memory')).toBeInTheDocument();
    expect(screen.getByText(/64\.3 MB/)).toBeInTheDocument();
  });

  it('shows warnings when present', () => {
    setupStore({
      isProfilerOpen: true,
      warnings: ['High triangle count', 'Low FPS'],
    });
    render(<PerformanceProfiler />);
    expect(screen.getByText('High triangle count')).toBeInTheDocument();
    expect(screen.getByText('Low FPS')).toBeInTheDocument();
  });

  it('shows alert icon when warnings exist', () => {
    setupStore({
      isProfilerOpen: false,
      warnings: ['High triangle count'],
    });
    render(<PerformanceProfiler />);
    expect(screen.getByTestId('alert-triangle')).toBeInTheDocument();
  });

  it('aria-expanded is false when collapsed', () => {
    setupStore({ isProfilerOpen: false });
    render(<PerformanceProfiler />);
    const button = screen.getByRole('button');
    expect(button.getAttribute('aria-expanded')).toBe('false');
  });

  it('aria-expanded is true when expanded', () => {
    setupStore({ isProfilerOpen: true });
    render(<PerformanceProfiler />);
    const button = screen.getByRole('button');
    expect(button.getAttribute('aria-expanded')).toBe('true');
  });
});
