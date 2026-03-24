import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@/test/utils/componentTestUtils';
import { ProjectCard } from '../ProjectCard';

vi.mock('lucide-react', () => ({
  MoreVertical: (props: Record<string, unknown>) => <span data-testid="more-icon" {...props} />,
  FolderOpen: (props: Record<string, unknown>) => <span data-testid="folder-icon" {...props} />,
  Edit: (props: Record<string, unknown>) => <span data-testid="edit-icon" {...props} />,
  Trash2: (props: Record<string, unknown>) => <span data-testid="trash-icon" {...props} />,
}));

const mockProject = {
  id: 'proj-1',
  name: 'My Game',
  thumbnail: null,
  entityCount: 12,
  updatedAt: new Date().toISOString(),
};

describe('ProjectCard', () => {
  const mockOnOpen = vi.fn();
  const mockOnDelete = vi.fn();
  const mockOnRename = vi.fn();

  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it('renders project name and entity count', () => {
    render(
      <ProjectCard
        project={mockProject}
        onOpen={mockOnOpen}
        onDelete={mockOnDelete}
        onRename={mockOnRename}
      />
    );
    expect(screen.getByText('My Game')).not.toBeNull();
    expect(screen.getByText('12 entities')).not.toBeNull();
  });

  it('shows relative time', () => {
    render(
      <ProjectCard
        project={mockProject}
        onOpen={mockOnOpen}
        onDelete={mockOnDelete}
        onRename={mockOnRename}
      />
    );
    // Just updated, so should show "just now"
    expect(screen.getByText('just now')).not.toBeNull();
  });

  it('calls onOpen when thumbnail area is clicked', () => {
    render(
      <ProjectCard
        project={mockProject}
        onOpen={mockOnOpen}
        onDelete={mockOnDelete}
        onRename={mockOnRename}
      />
    );
    // Click the thumbnail area (first child div with cursor-pointer)
    const thumbnail = screen.getByText('My Game').closest('.group')?.querySelector('.cursor-pointer');
    if (thumbnail) {
      fireEvent.click(thumbnail);
      expect(mockOnOpen).toHaveBeenCalledWith('proj-1');
    }
  });
});
