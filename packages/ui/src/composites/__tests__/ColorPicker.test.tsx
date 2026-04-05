import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { ColorPicker } from '../ColorPicker';

describe('ColorPicker', () => {
  it('renders label and hex input', () => {
    render(<ColorPicker label="Accent" value="#3b82f6" onChange={() => {}} />);
    expect(screen.getByText('Accent')).not.toBeNull();
    expect(screen.getByLabelText('Accent hex value')).not.toBeNull();
  });

  it('renders color swatch input', () => {
    render(<ColorPicker label="Color" value="#ff0000" onChange={() => {}} />);
    expect(screen.getByLabelText('Color color picker')).not.toBeNull();
  });

  it('calls onChange when valid hex is typed', () => {
    const onChange = vi.fn();
    render(<ColorPicker label="Color" value="#000000" onChange={onChange} />);
    const hexInput = screen.getByLabelText('Color hex value');
    fireEvent.change(hexInput, { target: { value: '#ff0000' } });
    expect(onChange).toHaveBeenCalledWith('#ff0000');
  });

  it('does not call onChange for invalid hex', () => {
    const onChange = vi.fn();
    render(<ColorPicker label="Color" value="#000000" onChange={onChange} />);
    const hexInput = screen.getByLabelText('Color hex value');
    fireEvent.change(hexInput, { target: { value: 'notahex' } });
    expect(onChange).not.toHaveBeenCalled();
  });

  it('reverts to prop value on blur with invalid input', () => {
    render(<ColorPicker label="Color" value="#123456" onChange={() => {}} />);
    const hexInput = screen.getByLabelText('Color hex value') as HTMLInputElement;
    fireEvent.change(hexInput, { target: { value: 'xxx' } });
    fireEvent.blur(hexInput);
    expect(hexInput.value).toBe('#123456');
  });

  it('respects disabled state', () => {
    render(<ColorPicker label="Color" value="#000000" onChange={() => {}} disabled />);
    expect(screen.getByLabelText('Color hex value')).toBeDisabled();
    expect(screen.getByLabelText('Color color picker')).toBeDisabled();
  });
});
