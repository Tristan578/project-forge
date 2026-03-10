/**
 * Render tests for GenerationStatus component.
 *
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@/test/utils/componentTestUtils';
import { GenerationStatus } from '../GenerationStatus';
import { useGenerationStore, type GenerationJob } from '@/stores/generationStore';

vi.mock('@/stores/generationStore', () => ({
  useGenerationStore: vi.fn(),
}));

vi.mock('lucide-react', () => ({
  Loader2: (props: Record<string, unknown>) => <span data-testid="loader" {...props} />,
  CheckCircle: (props: Record<string, unknown>) => <span data-testid="check-circle" {...props} />,
  XCircle: (props: Record<string, unknown>) => <span data-testid="x-circle" {...props} />,
  ChevronDown: (props: Record<string, unknown>) => <span data-testid="chevron-down" {...props} />,
  Trash2: (props: Record<string, unknown>) => <span data-testid="trash" {...props} />,
}));

const pendingJob: GenerationJob = {
  id: 'job-1',
  jobId: 'provider-1',
  type: 'model',
  prompt: 'A red cube',
  status: 'processing',
  progress: 50,
  provider: 'meshy',
  createdAt: 0,
};

const completedJob: GenerationJob = {
  id: 'job-2',
  jobId: 'provider-2',
  type: 'texture',
  prompt: 'Brick wall texture',
  status: 'completed',
  progress: 100,
  provider: 'meshy',
  createdAt: 0,
};

const failedJob: GenerationJob = {
  id: 'job-3',
  jobId: 'provider-3',
  type: 'sfx',
  prompt: 'Explosion sound',
  status: 'failed',
  progress: 0,
  provider: 'elevenlabs',
  createdAt: 0,
  error: 'API rate limit exceeded',
};

describe('GenerationStatus', () => {
  const mockClearCompleted = vi.fn();
  const mockRemoveJob = vi.fn();

  function setupStore({
    jobs = {} as Record<string, GenerationJob>,
  } = {}) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    vi.mocked(useGenerationStore).mockImplementation((selector: any) => {
      const state = {
        jobs,
        clearCompleted: mockClearCompleted,
        removeJob: mockRemoveJob,
      };
      return typeof selector === 'function' ? selector(state) : state;
    });
  }

  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    cleanup();
  });

  it('returns null when no active jobs', () => {
    setupStore({ jobs: {} });
    const { container } = render(<GenerationStatus />);
    expect(container.firstChild).toBeNull();
  });

  it('returns null when only completed jobs', () => {
    setupStore({ jobs: { 'job-2': completedJob } });
    const { container } = render(<GenerationStatus />);
    expect(container.firstChild).toBeNull();
  });

  it('shows Generating button with count when active jobs exist', () => {
    setupStore({ jobs: { 'job-1': pendingJob } });
    render(<GenerationStatus />);
    expect(screen.getByText('Generating (1)')).toBeDefined();
  });

  it('shows count of multiple active jobs', () => {
    setupStore({
      jobs: {
        'job-1': pendingJob,
        'job-4': { ...pendingJob, id: 'job-4', status: 'pending' },
      },
    });
    render(<GenerationStatus />);
    expect(screen.getByText('Generating (2)')).toBeDefined();
  });

  it('does not show dropdown initially', () => {
    setupStore({ jobs: { 'job-1': pendingJob } });
    render(<GenerationStatus />);
    expect(screen.queryByText('Generation Jobs')).toBeNull();
  });

  it('shows dropdown when button clicked', () => {
    setupStore({ jobs: { 'job-1': pendingJob } });
    render(<GenerationStatus />);
    fireEvent.click(screen.getByText('Generating (1)'));
    expect(screen.getByText('Generation Jobs')).toBeDefined();
  });

  it('shows job type in dropdown', () => {
    setupStore({ jobs: { 'job-1': pendingJob } });
    render(<GenerationStatus />);
    fireEvent.click(screen.getByText('Generating (1)'));
    expect(screen.getByText('model')).toBeDefined();
  });

  it('shows processing status with progress', () => {
    setupStore({ jobs: { 'job-1': pendingJob } });
    render(<GenerationStatus />);
    fireEvent.click(screen.getByText('Generating (1)'));
    expect(screen.getByText('Processing... 50%')).toBeDefined();
  });

  it('shows Completed status for completed jobs', () => {
    // Must have an active job for component to render
    setupStore({ jobs: { 'job-1': pendingJob, 'job-2': completedJob } });
    render(<GenerationStatus />);
    fireEvent.click(screen.getByText('Generating (1)'));
    expect(screen.getByText('Completed')).toBeDefined();
  });

  it('shows Failed status for failed jobs', () => {
    setupStore({ jobs: { 'job-1': pendingJob, 'job-3': failedJob } });
    render(<GenerationStatus />);
    fireEvent.click(screen.getByText('Generating (1)'));
    expect(screen.getByText('Failed')).toBeDefined();
  });

  it('shows error message for failed jobs', () => {
    setupStore({ jobs: { 'job-1': pendingJob, 'job-3': failedJob } });
    render(<GenerationStatus />);
    fireEvent.click(screen.getByText('Generating (1)'));
    expect(screen.getByText('API rate limit exceeded')).toBeDefined();
  });

  it('calls clearCompleted when trash button clicked', () => {
    setupStore({ jobs: { 'job-1': pendingJob } });
    render(<GenerationStatus />);
    fireEvent.click(screen.getByText('Generating (1)'));
    fireEvent.click(screen.getByTitle('Clear completed jobs'));
    expect(mockClearCompleted).toHaveBeenCalled();
  });

  it('shows prompt text truncated in dropdown', () => {
    setupStore({ jobs: { 'job-1': pendingJob } });
    render(<GenerationStatus />);
    fireEvent.click(screen.getByText('Generating (1)'));
    expect(screen.getByText('A red cube')).toBeDefined();
  });
});
