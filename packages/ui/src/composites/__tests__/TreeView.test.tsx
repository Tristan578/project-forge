import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { TreeView } from '../TreeView';

const NODES = [
  {
    id: 'root',
    label: 'Root',
    children: [
      { id: 'child-1', label: 'Child 1' },
      {
        id: 'child-2',
        label: 'Child 2',
        children: [{ id: 'grandchild', label: 'Grandchild' }],
      },
    ],
  },
  { id: 'sibling', label: 'Sibling' },
];

describe('TreeView', () => {
  it('renders top-level nodes', () => {
    render(<TreeView nodes={NODES} />);
    expect(screen.getByText('Root')).not.toBeNull();
    expect(screen.getByText('Sibling')).not.toBeNull();
  });

  it('expands children on click', () => {
    render(<TreeView nodes={NODES} />);
    expect(screen.queryByText('Child 1')).toBeNull();
    fireEvent.click(screen.getByLabelText('Expand'));
    expect(screen.getByText('Child 1')).not.toBeNull();
    expect(screen.getByText('Child 2')).not.toBeNull();
  });

  it('calls onSelect when a node is clicked', () => {
    const onSelect = vi.fn();
    render(<TreeView nodes={NODES} onSelect={onSelect} />);
    fireEvent.click(screen.getByText('Sibling'));
    expect(onSelect).toHaveBeenCalledWith('sibling');
  });

  it('supports controlled expandedIds', () => {
    render(<TreeView nodes={NODES} expandedIds={['root']} />);
    expect(screen.getByText('Child 1')).not.toBeNull();
  });

  it('supports keyboard navigation', () => {
    const onSelect = vi.fn();
    render(<TreeView nodes={NODES} onSelect={onSelect} />);
    const sibling = screen.getByText('Sibling').closest('[role="button"]')!;
    fireEvent.keyDown(sibling, { key: 'Enter' });
    expect(onSelect).toHaveBeenCalledWith('sibling');
  });

  it('has tree role', () => {
    const { container } = render(<TreeView nodes={NODES} />);
    expect(container.querySelector('[role="tree"]')).not.toBeNull();
  });
});
