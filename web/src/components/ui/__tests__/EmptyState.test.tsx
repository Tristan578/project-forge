/**
 * Render tests for EmptyState component.
 *
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup } from '@/test/utils/componentTestUtils';
import { EmptyState } from '../EmptyState';

const MockIcon = (props: Record<string, unknown>) => (
  <svg data-testid="empty-state-icon" {...props} />
);

describe('EmptyState', () => {
  afterEach(() => {
    cleanup();
  });

  it('renders the title text', () => {
    render(
      <EmptyState
        icon={MockIcon as never}
        title="No entities yet"
        description="Add something to get started"
      />
    );
    expect(screen.getByText('No entities yet')).not.toBeNull();
  });

  it('renders the description text', () => {
    render(
      <EmptyState
        icon={MockIcon as never}
        title="No entities yet"
        description="Add something to get started"
      />
    );
    expect(screen.getByText('Add something to get started')).not.toBeNull();
  });

  it('renders the icon', () => {
    render(
      <EmptyState
        icon={MockIcon as never}
        title="No entities yet"
        description="Add something to get started"
      />
    );
    expect(screen.getByTestId('empty-state-icon')).not.toBeNull();
  });

  it('renders an action button when action prop provided', () => {
    const handleClick = vi.fn();
    render(
      <EmptyState
        icon={MockIcon as never}
        title="No entities yet"
        description="Add something to get started"
        action={{ label: 'Add Entity', onClick: handleClick }}
      />
    );
    const button = screen.getByRole('button', { name: 'Add Entity' });
    expect(button).toBeDefined();
  });

  it('calls action onClick when button is clicked', () => {
    const handleClick = vi.fn();
    render(
      <EmptyState
        icon={MockIcon as never}
        title="No entities yet"
        description="Add something to get started"
        action={{ label: 'Add Entity', onClick: handleClick }}
      />
    );
    const button = screen.getByRole('button', { name: 'Add Entity' });
    button.click();
    expect(handleClick).toHaveBeenCalledOnce();
  });

  it('does not render an action button when action prop is not provided', () => {
    render(
      <EmptyState
        icon={MockIcon as never}
        title="No entities yet"
        description="Add something to get started"
      />
    );
    expect(screen.queryByRole('button')).toBeNull();
  });

  it('applies additional className to the wrapper', () => {
    const { container } = render(
      <EmptyState
        icon={MockIcon as never}
        title="Title"
        description="Desc"
        className="my-custom-class"
      />
    );
    expect(container.firstChild).toBeDefined();
    const wrapper = container.firstChild as HTMLElement;
    expect(wrapper.className).toContain('my-custom-class');
  });

  it('uses default className when no className is provided', () => {
    const { container } = render(
      <EmptyState
        icon={MockIcon as never}
        title="Title"
        description="Desc"
      />
    );
    const wrapper = container.firstChild as HTMLElement;
    expect(wrapper.className).toContain('flex');
    expect(wrapper.className).toContain('border-dashed');
  });

  it('icon has aria-hidden attribute', () => {
    render(
      <EmptyState
        icon={MockIcon as never}
        title="No entities"
        description="Nothing here"
      />
    );
    const icon = screen.getByTestId('empty-state-icon');
    expect(icon.getAttribute('aria-hidden')).toBe('true');
  });
});
