import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { PropertyGrid } from '../PropertyGrid';

describe('PropertyGrid', () => {
  it('renders label-value pairs', () => {
    render(
      <PropertyGrid
        items={[
          { label: 'Name', value: 'Player' },
          { label: 'Type', value: 'Mesh' },
        ]}
      />
    );
    expect(screen.getByText('Name')).not.toBeNull();
    expect(screen.getByText('Player')).not.toBeNull();
    expect(screen.getByText('Type')).not.toBeNull();
    expect(screen.getByText('Mesh')).not.toBeNull();
  });

  it('renders ReactNode values', () => {
    render(
      <PropertyGrid
        items={[
          { label: 'Color', value: <span data-testid="swatch">Red</span> },
        ]}
      />
    );
    expect(screen.getByTestId('swatch')).not.toBeNull();
  });

  it('has group role with accessible label', () => {
    const { container } = render(<PropertyGrid items={[{ label: 'X', value: '1' }]} />);
    const group = container.querySelector('[role="group"]');
    expect(group).not.toBeNull();
    expect(group?.getAttribute('aria-label')).toBe('Properties');
  });
});
