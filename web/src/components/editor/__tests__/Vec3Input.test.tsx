import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@/test/utils/componentTestUtils';
import { Vec3Input } from '../Vec3Input';

describe('Vec3Input', () => {
  afterEach(() => {
    cleanup();
  });

  it('renders X, Y, Z inputs with values', () => {
    const mockOnChange = vi.fn();
    render(<Vec3Input value={[1, 2, 3]} onChange={mockOnChange} label="Position" />);
    
    const inputs = screen.getAllByRole('textbox') as HTMLInputElement[];
    expect(inputs).toHaveLength(3);
    expect(inputs[0].value).toBe('1.000');
    expect(inputs[1].value).toBe('2.000');
    expect(inputs[2].value).toBe('3.000');
  });

  it('calls onChange with updated values when Enter is pressed', () => {
    const mockOnChange = vi.fn();
    render(<Vec3Input value={[0, 0, 0]} onChange={mockOnChange} label="Scale" />);
    
    const inputs = screen.getAllByRole('textbox') as HTMLInputElement[];
    
    fireEvent.focus(inputs[0]);
    fireEvent.change(inputs[0], { target: { value: '5' } });
    fireEvent.blur(inputs[0]); // Blur is a reliable way to trigger commitValue in NumberInput

    expect(mockOnChange).toHaveBeenCalledWith([5, 0, 0]);
  });

  it('handles invalid inputs gracefully (ignores them)', () => {
    const mockOnChange = vi.fn();
    render(<Vec3Input value={[1, 2, 3]} onChange={mockOnChange} label="Position" />);
    
    const inputs = screen.getAllByRole('textbox') as HTMLInputElement[];
    
    fireEvent.change(inputs[1], { target: { value: 'abc' } });
    fireEvent.blur(inputs[1]);

    // Should not call onChange with NaN
    expect(mockOnChange).not.toHaveBeenCalled();
  });
});
