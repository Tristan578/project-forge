/**
 * Render tests for NumberInput component.
 *
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@/test/utils/componentTestUtils';
import { NumberInput } from '../NumberInput';

describe('NumberInput', () => {
  const mockOnChange = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    cleanup();
  });

  it('renders with formatted value', () => {
    render(<NumberInput value={1.5} onChange={mockOnChange} />);
    const input = screen.getByRole('textbox') as HTMLInputElement;
    expect(input.value).toBe('1.500');
  });

  it('renders with label when provided', () => {
    render(<NumberInput value={0} onChange={mockOnChange} label="X" />);
    expect(screen.getByText('X')).not.toBeNull();
  });

  it('uses ariaLabel as aria-label when provided', () => {
    render(<NumberInput value={0} onChange={mockOnChange} ariaLabel="Position X" />);
    expect(screen.getByLabelText('Position X')).not.toBeNull();
  });

  it('uses label as aria-label when ariaLabel not provided', () => {
    render(<NumberInput value={0} onChange={mockOnChange} label="X" />);
    expect(screen.getByLabelText('X')).not.toBeNull();
  });

  it('is disabled when disabled prop is true', () => {
    render(<NumberInput value={0} onChange={mockOnChange} disabled />);
    const input = screen.getByRole('textbox') as HTMLInputElement;
    expect(input.disabled).toBe(true);
  });

  it('formats to custom precision', () => {
    render(<NumberInput value={3.14159} onChange={mockOnChange} precision={2} />);
    const input = screen.getByRole('textbox') as HTMLInputElement;
    expect(input.value).toBe('3.14');
  });

  it('commits value on blur', () => {
    render(<NumberInput value={1.0} onChange={mockOnChange} precision={1} />);
    const input = screen.getByRole('textbox') as HTMLInputElement;
    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: '5' } });
    fireEvent.blur(input);
    expect(mockOnChange).toHaveBeenCalledWith(5);
  });

  it('commits value on Enter key', () => {
    render(<NumberInput value={1.0} onChange={mockOnChange} precision={1} />);
    const input = screen.getByRole('textbox') as HTMLInputElement;
    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: '7' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(mockOnChange).toHaveBeenCalledWith(7);
  });

  it('reverts to original value on Escape', () => {
    render(<NumberInput value={2.5} onChange={mockOnChange} precision={1} />);
    const input = screen.getByRole('textbox') as HTMLInputElement;
    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: '9' } });
    fireEvent.keyDown(input, { key: 'Escape' });
    expect(mockOnChange).not.toHaveBeenCalled();
    expect(input.value).toBe('2.5');
  });

  it('increments value on ArrowUp', () => {
    render(<NumberInput value={1.0} onChange={mockOnChange} step={0.5} />);
    const input = screen.getByRole('textbox');
    fireEvent.keyDown(input, { key: 'ArrowUp' });
    expect(mockOnChange).toHaveBeenCalledWith(1.5);
  });

  it('decrements value on ArrowDown', () => {
    render(<NumberInput value={1.0} onChange={mockOnChange} step={0.5} />);
    const input = screen.getByRole('textbox');
    fireEvent.keyDown(input, { key: 'ArrowDown' });
    expect(mockOnChange).toHaveBeenCalledWith(0.5);
  });

  it('clamps value to max', () => {
    render(<NumberInput value={9} onChange={mockOnChange} max={10} precision={0} />);
    const input = screen.getByRole('textbox') as HTMLInputElement;
    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: '15' } });
    fireEvent.blur(input);
    expect(mockOnChange).toHaveBeenCalledWith(10);
  });

  it('clamps value to min', () => {
    render(<NumberInput value={1} onChange={mockOnChange} min={0} precision={0} />);
    const input = screen.getByRole('textbox') as HTMLInputElement;
    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: '-5' } });
    fireEvent.blur(input);
    expect(mockOnChange).toHaveBeenCalledWith(0);
  });
});
