import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@/test/utils/componentTestUtils';
import { DashboardLayout } from '../DashboardLayout';

vi.mock('lucide-react', () => ({
  Settings: (props: Record<string, unknown>) => <span data-testid="settings-icon" {...props} />,
  Plus: (props: Record<string, unknown>) => <span data-testid="plus-icon" {...props} />,
  X: (props: Record<string, unknown>) => <span data-testid="x-icon" {...props} />,
  MoreVertical: (props: Record<string, unknown>) => <span data-testid="more-icon" {...props} />,
  FolderOpen: (props: Record<string, unknown>) => <span data-testid="folder-icon" {...props} />,
  Edit: (props: Record<string, unknown>) => <span data-testid="edit-icon" {...props} />,
  Trash2: (props: Record<string, unknown>) => <span data-testid="trash-icon" {...props} />,
}));

vi.mock('../ProjectCard', () => ({
  ProjectCard: ({ project }: { project: { name: string } }) => (
    <div data-testid="project-card">{project.name}</div>
  ),
}));

vi.mock('../NewProjectDialog', () => ({
  NewProjectDialog: ({ isOpen }: { isOpen: boolean }) =>
    isOpen ? <div data-testid="new-project-dialog" /> : null,
}));

const mockPush = vi.fn();
vi.mock('next/navigation', () => ({
  useRouter: vi.fn(() => ({ push: mockPush })),
}));

vi.mock('@clerk/nextjs', () => ({
  UserButton: () => <div data-testid="user-button" />,
}));

// Mock fetch for projects endpoint
const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

describe('DashboardLayout', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockFetch.mockResolvedValue({
      ok: true,
      json: () => Promise.resolve([]),
    });
  });

  afterEach(() => {
    cleanup();
  });

  it('renders without crashing', () => {
    render(<DashboardLayout />);
    expect(screen.getByText('SpawnForge')).not.toBeNull();
    expect(screen.getByText('My Projects')).not.toBeNull();
  });

  it('shows loading state initially', () => {
    mockFetch.mockReturnValue(new Promise(() => {})); // Never resolves
    render(<DashboardLayout />);
    expect(screen.getByText('Loading projects...')).not.toBeNull();
  });

  it('shows empty state when no projects loaded', async () => {
    render(<DashboardLayout />);
    const emptyText = await screen.findByText('No projects yet. Create your first game!');
    expect(emptyText).toBeDefined();
  });

  it('opens new project dialog when clicking the header New Project button', async () => {
    render(<DashboardLayout />);
    // Wait for loading to finish
    await screen.findByText('No projects yet. Create your first game!');

    // There are two buttons with "New Project" text / "Create Project" text.
    // Click the one in the header area
    const newProjectBtn = screen.getByRole('button', { name: /New Project/i });
    fireEvent.click(newProjectBtn);
    expect(screen.getByTestId('new-project-dialog')).not.toBeNull();
  });
});
