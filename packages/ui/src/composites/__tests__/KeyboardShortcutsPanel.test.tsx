import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { KeyboardShortcutsPanel } from '../KeyboardShortcutsPanel';

const GROUPS = [
  {
    title: 'General',
    shortcuts: [
      { id: 'save', label: 'Save', keys: ['Ctrl', 'S'] },
      { id: 'undo', label: 'Undo', keys: ['Ctrl', 'Z'] },
    ],
  },
  {
    title: 'Editor',
    shortcuts: [
      { id: 'delete', label: 'Delete selected', keys: ['Del'] },
    ],
  },
];

describe('KeyboardShortcutsPanel', () => {
  it('renders group titles and shortcuts', () => {
    render(<KeyboardShortcutsPanel groups={GROUPS} />);
    expect(screen.getByText('General')).not.toBeNull();
    expect(screen.getByText('Save')).not.toBeNull();
    expect(screen.getAllByText('Ctrl')).toHaveLength(2);
    expect(screen.getByText('S')).not.toBeNull();
    expect(screen.getByText('Editor')).not.toBeNull();
  });

  it('filters shortcuts by search', () => {
    render(<KeyboardShortcutsPanel groups={GROUPS} />);
    const search = screen.getByLabelText('Search keyboard shortcuts');
    fireEvent.change(search, { target: { value: 'Save' } });
    expect(screen.getByText('Save')).not.toBeNull();
    expect(screen.queryByText('Undo')).toBeNull();
    expect(screen.queryByText('Delete selected')).toBeNull();
  });

  it('shows empty state when no results', () => {
    render(<KeyboardShortcutsPanel groups={GROUPS} />);
    fireEvent.change(screen.getByLabelText('Search keyboard shortcuts'), {
      target: { value: 'nonexistent' },
    });
    expect(screen.getByText(/No shortcuts match/)).not.toBeNull();
  });

  it('calls onClose when close button clicked', () => {
    const onClose = vi.fn();
    render(<KeyboardShortcutsPanel groups={GROUPS} onClose={onClose} />);
    fireEvent.click(screen.getByLabelText('Close keyboard shortcuts'));
    expect(onClose).toHaveBeenCalledOnce();
  });
});
