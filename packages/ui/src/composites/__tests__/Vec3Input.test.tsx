import { describe, it, expect, vi } from 'vitest';
import { useState } from 'react';
import { render, screen, fireEvent, within } from '@testing-library/react';
import { Vec3Input } from '../Vec3Input';

/** A controlled wrapper mirroring how the inspectors wire Vec3Input to store state. */
function StatefulVec3({
  initial,
  precision,
  min,
  max,
  onChangeSpy,
}: {
  initial: [number, number, number];
  precision?: number;
  min?: number;
  max?: number;
  onChangeSpy?: (v: [number, number, number]) => void;
}) {
  const [value, setValue] = useState<[number, number, number]>(initial);
  return (
    <Vec3Input
      label="Size"
      value={value}
      precision={precision}
      min={min}
      max={max}
      onChange={(v) => {
        onChangeSpy?.(v);
        setValue(v);
      }}
    />
  );
}

describe('Vec3Input', () => {
  it.each(['X', 'Y', 'Z'])('replaces a focused %s draft on external value changes', (axis) => {
    const onChange = vi.fn();
    const { rerender } = render(<Vec3Input label="Size" value={[1, 2, 3]} onChange={onChange} />);
    const input = screen.getByLabelText('Size ' + axis);
    input.focus();
    fireEvent.change(input, { target: { value: '12.5' } });
    expect(input).toHaveValue(12.5);
    onChange.mockClear();
    rerender(<Vec3Input label="Size" value={[4, 5, 6]} onChange={onChange} />);
    expect(input).toHaveFocus();
    expect(input).toHaveValue({ X: 4, Y: 5, Z: 6 }[axis]);
    expect(onChange).not.toHaveBeenCalled();
    expect(screen.getByLabelText('Size X')).toHaveValue(4);
    expect(screen.getByLabelText('Size Y')).toHaveValue(5);
    expect(screen.getByLabelText('Size Z')).toHaveValue(6);
  });

  it('retains raw precision for an echoed edit while updating other axes', () => {
    const onChange = vi.fn();
    const { rerender } = render(<Vec3Input label="Size" precision={1} value={[1, 2, 3]} onChange={onChange} />);
    const input = screen.getByLabelText('Size X');
    fireEvent.change(input, { target: { value: '2.56' } });
    rerender(<Vec3Input label="Size" precision={1} value={[2.56, 5, 6]} onChange={onChange} />);
    expect(input).toHaveValue(2.56);
    expect(screen.getByLabelText('Size Y')).toHaveValue(5);
    fireEvent.blur(input);
    expect(input).toHaveValue(2.6);
  });

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

  it('renders an integer axis without gaining trailing decimals', () => {
    // Deriving the display from value.toFixed(precision) with the default
    // precision of 3 turned a Size of 10 into "10.000". The resting display must
    // read "10" — matching the inspectors' prior raw display — while still
    // rounding to precision when the value is fractional.
    render(<Vec3Input label="Size" value={[10, 5, 10]} onChange={() => {}} />);
    expect(screen.getByLabelText('Size X')).toHaveValue(10);
    expect((screen.getByLabelText('Size X') as HTMLInputElement).value).toBe('10');
    render(<Vec3Input label="Size2" value={[10.56, 5, 10]} onChange={() => {}} precision={1} />);
    expect((screen.getByLabelText('Size2 X') as HTMLInputElement).value).toBe('10.6');
  });

  it('lets an axis be cleared to an empty intermediate state without emitting a non-finite value', () => {
    // Regression guard for the draft buffer. When the input value was re-derived
    // from the committed number on every keystroke, clearing the field parsed to
    // NaN, was discarded, and the controlled input snapped straight back to the
    // old digits — so the field could never be cleared and a fresh edit appended
    // to the stale value instead of replacing it. The draft buffer must render
    // the empty state verbatim and must not push a non-finite tuple to onChange.
    const onChangeSpy = vi.fn();
    render(<StatefulVec3 initial={[10, 5, 10]} onChangeSpy={onChangeSpy} />);
    const x = screen.getByLabelText('Size X') as HTMLInputElement;

    fireEvent.change(x, { target: { value: '' } });

    // The field actually clears — under the old derive-every-keystroke behaviour
    // this would still read "10.000".
    expect(x.value).toBe('');
    expect(onChangeSpy).not.toHaveBeenCalled();
    // Nothing non-finite ever reached the consumer.
    for (const call of onChangeSpy.mock.calls) {
      expect(call[0].every((n: number) => Number.isFinite(n))).toBe(true);
    }
  });

  it('replaces the cleared axis with freshly typed digits rather than appending', () => {
    const onChangeSpy = vi.fn();
    render(<StatefulVec3 initial={[10, 5, 10]} onChangeSpy={onChangeSpy} />);
    const x = screen.getByLabelText('Size X') as HTMLInputElement;

    // Clear, then type "25" (each change carries the full field contents a real
    // browser would hold after that keystroke, starting from the now-empty field).
    fireEvent.change(x, { target: { value: '' } });
    fireEvent.change(x, { target: { value: '2' } });
    fireEvent.change(x, { target: { value: '25' } });

    expect(x.value).toBe('25');
    const last = onChangeSpy.mock.calls.at(-1)?.[0];
    expect(last).toEqual([25, 5, 10]);
  });

  it.each(['X', 'Y', 'Z'])('restores an empty %s draft to its last good value on blur', (axis) => {
    const onChangeSpy = vi.fn();
    render(<StatefulVec3 initial={[10, 5, 10]} onChangeSpy={onChangeSpy} />);
    const input = screen.getByLabelText('Size ' + axis) as HTMLInputElement;
    const previous = input.value;
    fireEvent.change(input, { target: { value: '' } });
    expect(input.value).toBe('');
    fireEvent.blur(input);
    expect(input.value).toBe(previous);
    expect(onChangeSpy).not.toHaveBeenCalled();
  });

  it.each(['X', 'Y', 'Z'])('shows the clamped resting %s value after a bounded edit and blur', (axis) => {
    const onChangeSpy = vi.fn();
    render(<StatefulVec3 initial={[10, 5, 10]} min={0} max={100} onChangeSpy={onChangeSpy} />);
    const input = screen.getByLabelText('Size ' + axis) as HTMLInputElement;
    fireEvent.change(input, { target: { value: '150' } });
    expect(input.value).toBe('150');
    const expected = [10, 5, 10];
    expected[['X', 'Y', 'Z'].indexOf(axis)] = 100;
    expect(onChangeSpy).toHaveBeenCalledExactlyOnceWith(expected);
    fireEvent.blur(input);
    expect(input.value).toBe('100');
  });

  it('clamps a committed axis edit to min/max', () => {
    const onChangeSpy = vi.fn();
    render(
      <Vec3Input label="Bounded" value={[0, 0, 0]} min={0} max={100} onChange={onChangeSpy} />
    );
    fireEvent.change(screen.getByLabelText('Bounded X'), { target: { value: '150' } });
    expect(onChangeSpy).toHaveBeenLastCalledWith([100, 0, 0]);
  });
});
