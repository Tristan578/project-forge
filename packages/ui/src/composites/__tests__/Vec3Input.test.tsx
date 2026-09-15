import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, within } from '@testing-library/react';
import { Vec3Input } from '../Vec3Input';

describe('Vec3Input', () => {
  it('renders three axis inputs with labels', () => {
    render(<Vec3Input label="Position" value={[1, 2, 3]} onChange={() => {}} />);
    expect(screen.getByLabelText('Position X')).not.toBeNull();
    expect(screen.getByLabelText('Position Y')).not.toBeNull();
    expect(screen.getByLabelText('Position Z')).not.toBeNull();
  });

  it('displays label text', () => {
    render(<Vec3Input label="Scale" value={[1, 1, 1]} onChange={() => {}} />);
    expect(screen.getByText('Scale')).not.toBeNull();
  });

  it('exposes the axis inputs as a group named by the label', () => {
    // The outer div carries aria-labelledby, but without role="group" a plain
    // <div> is ARIA role "generic", which the spec forbids from taking an
    // author-supplied name — the label would be inert to assistive tech. Pin the
    // group role so the three axis inputs announce their shared "Scale" label.
    render(<Vec3Input label="Scale" value={[1, 2, 3]} onChange={() => {}} />);
    const group = screen.getByRole('group', { name: 'Scale' });
    expect(within(group).getByLabelText('Scale X')).not.toBeNull();
    expect(within(group).getByLabelText('Scale Y')).not.toBeNull();
    expect(within(group).getByLabelText('Scale Z')).not.toBeNull();
  });

  it('calls onChange when an axis value changes', () => {
    const onChange = vi.fn();
    render(<Vec3Input label="Position" value={[0, 0, 0]} onChange={onChange} />);
    fireEvent.change(screen.getByLabelText('Position X'), { target: { value: '5' } });
    expect(onChange).toHaveBeenCalledWith([5, 0, 0]);
  });

  it('shows reset button when value differs from default', () => {
    const onReset = vi.fn();
    render(
      <Vec3Input
        label="Position"
        value={[1, 0, 0]}
        onChange={() => {}}
        onReset={onReset}
        defaultValue={[0, 0, 0]}
      />
    );
    const resetBtn = screen.getByLabelText('Reset position to default');
    expect(resetBtn).not.toBeNull();
    fireEvent.click(resetBtn);
    expect(onReset).toHaveBeenCalledOnce();
  });

  it('disables all inputs when disabled', () => {
    render(<Vec3Input label="Pos" value={[0, 0, 0]} onChange={() => {}} disabled />);
    expect(screen.getByLabelText('Pos X')).toBeDisabled();
    expect(screen.getByLabelText('Pos Y')).toBeDisabled();
    expect(screen.getByLabelText('Pos Z')).toBeDisabled();
  });
});
