import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { SliderInput } from '../SliderInput';

describe('SliderInput', () => {
  it('renders label and value display', () => {
    render(<SliderInput label="Volume" value={50} onChange={() => {}} />);
    expect(screen.getByText('Volume')).not.toBeNull();
    expect(screen.getByText('50')).not.toBeNull();
  });

  it('calls onChange with numeric value', () => {
    const onChange = vi.fn();
    render(<SliderInput label="Volume" value={50} onChange={onChange} min={0} max={100} />);
    const slider = screen.getByRole('slider');
    fireEvent.change(slider, { target: { value: '75' } });
    expect(onChange).toHaveBeenCalledWith(75);
  });

  it('hides value when showValue is false', () => {
    render(<SliderInput label="Volume" value={50} onChange={() => {}} showValue={false} />);
    expect(screen.queryByText('50')).toBeNull();
  });

  it('uses custom formatValue', () => {
    render(
      <SliderInput
        label="Opacity"
        value={0.5}
        onChange={() => {}}
        formatValue={(v) => `${Math.round(v * 100)}%`}
      />
    );
    expect(screen.getByText('50%')).not.toBeNull();
  });

  it('respects disabled state', () => {
    render(<SliderInput label="Vol" value={50} onChange={() => {}} disabled />);
    expect(screen.getByRole('slider')).toBeDisabled();
  });
});
