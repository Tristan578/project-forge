import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@/test/utils/componentTestUtils';
import { NewProjectDialog } from '../NewProjectDialog';

vi.mock('lucide-react', () => ({
  X: (props: Record<string, unknown>) => <span data-testid="x-icon" {...props} />,
}));

describe('NewProjectDialog', () => {
  afterEach(() => {
    cleanup();
  });

  it('renders nothing when not open', () => {
    const { container } = render(
      <NewProjectDialog isOpen={false} onClose={vi.fn()} onCreate={vi.fn()} />
    );
    expect(container.innerHTML).toBe('');
  });

  it('renders dialog when open', () => {
    render(
      <NewProjectDialog isOpen={true} onClose={vi.fn()} onCreate={vi.fn()} />
    );
    expect(screen.getByText('New Project')).toBeDefined();
    expect(screen.getByText('Project Name')).toBeDefined();
    expect(screen.getByDisplayValue('My Game')).toBeDefined();
  });

  it('calls onCreate with trimmed name when Create is clicked', () => {
    const onCreate = vi.fn();
    const onClose = vi.fn();
    render(
      <NewProjectDialog isOpen={true} onClose={onClose} onCreate={onCreate} />
    );
    const input = screen.getByDisplayValue('My Game');
    fireEvent.change(input, { target: { value: 'Cool Project' } });
    fireEvent.click(screen.getByText('Create'));
    expect(onCreate).toHaveBeenCalledWith('Cool Project');
  });

  it('disables Create button when name is empty', () => {
    render(
      <NewProjectDialog isOpen={true} onClose={vi.fn()} onCreate={vi.fn()} />
    );
    const input = screen.getByDisplayValue('My Game');
    fireEvent.change(input, { target: { value: '   ' } });
    const createBtn = screen.getByText('Create');
    expect(createBtn.hasAttribute('disabled')).toBe(true);
  });
});
