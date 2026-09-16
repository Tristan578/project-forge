import { describe, it, expect, vi } from 'vitest';
import { useState } from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import { NumberField } from '../NumberField';

/** Controlled wrapper mirroring how the inspectors wire NumberField to store state. */
function StatefulNumberField({
  initial,
  onChangeSpy,
}: {
  initial: number;
  onChangeSpy?: (v: number) => void;
}) {
  const [value, setValue] = useState(initial);
  return (
    <NumberField
      label="Priority"
      value={value}
      step={1}
      onChange={(v) => {
        onChangeSpy?.(v);
        setValue(v);
      }}
    />
  );
}

describe('NumberField', () => {
  it.each(['', '12.5'])('replaces draft %s when an external value changes while focused', (raw) => {
    const onChange = vi.fn();
    const { rerender } = render(<NumberField label="Distance" value={10} onChange={onChange} />);
    const input = screen.getByLabelText('Distance');
    input.focus();
    fireEvent.change(input, { target: { value: raw } });
    expect(input).toHaveValue(raw === '' ? null : 12.5);
    onChange.mockClear();
    rerender(<NumberField label="Distance" value={7} onChange={onChange} />);
    expect(input).toHaveFocus();
    expect(input).toHaveValue(7);
    expect(onChange).not.toHaveBeenCalled();
  });

  it('retains a raw draft when the parent echoes its own bounded commit', () => {
    const onChange = vi.fn();
    const { rerender } = render(<NumberField label="Distance" value={1} max={10} onChange={onChange} />);
    const input = screen.getByLabelText('Distance');
    fireEvent.change(input, { target: { value: '14' } });
    expect(onChange).toHaveBeenCalledWith(10);
    rerender(<NumberField label="Distance" value={10} max={10} onChange={onChange} />);
    expect(input).toHaveValue(14);
    fireEvent.blur(input);
    expect(input).toHaveValue(10);
  });

  it('associates the visible label with the number input', () => {
    // getByLabelText resolves only through the htmlFor/id pairing, so this fails
    // if the composite ever renders the label as an unassociated sibling — the
    // exact drift this shared composite exists to remove from the inspectors.
    render(<NumberField label="Max Distance" value={50} onChange={() => {}} />);
    const input = screen.getByLabelText('Max Distance');
    expect(input).toHaveAttribute('type', 'number');
    expect(input).toHaveValue(50);
  });

  it('parses the raw value and forwards it as a number to onChange', () => {
    const onChange = vi.fn();
    render(<NumberField label="Ref Distance" value={1} onChange={onChange} />);
    fireEvent.change(screen.getByLabelText('Ref Distance'), { target: { value: '2.5' } });
    expect(onChange).toHaveBeenCalledWith(2.5);
  });

  it('forwards min, max and step to the input', () => {
    render(
      <NumberField label="Rolloff" value={1} onChange={() => {}} min={0} max={10} step={0.1} />
    );
    const input = screen.getByLabelText('Rolloff');
    expect(input).toHaveAttribute('min', '0');
    expect(input).toHaveAttribute('max', '10');
    expect(input).toHaveAttribute('step', '0.1');
  });

  it.each([
    { raw: '-4', min: 0, max: 10, expected: 0 },
    { raw: '14', min: 0, max: 10, expected: 10 },
    { raw: '2.5', min: 0, max: 10, expected: 2.5 },
    { raw: '-4', min: 0, max: undefined, expected: 0 },
    { raw: '14', min: undefined, max: 10, expected: 10 },
  ])('commits a bounded value for $raw (min $min, max $max)', ({ raw, min, max, expected }) => {
    const onChange = vi.fn();
    render(<NumberField label="Distance" value={1} onChange={onChange} min={min} max={max} />);
    fireEvent.change(screen.getByLabelText('Distance'), { target: { value: raw } });
    expect(onChange).toHaveBeenCalledExactlyOnceWith(expected);
  });

  it('respects the disabled state', () => {
    render(<NumberField label="Priority" value={0} onChange={() => {}} disabled />);
    expect(screen.getByLabelText('Priority')).toBeDisabled();
  });

  it('does not forward NaN to onChange when the field is cleared', () => {
    // parseFloat('') is NaN. Forwarding it unguarded pushed a non-finite number
    // into the store, which JSON.stringify serializes to null in exported scene
    // data. The guard must swallow the non-finite parse.
    const onChange = vi.fn();
    render(<NumberField label="Priority" value={0} onChange={onChange} step={1} />);
    fireEvent.change(screen.getByLabelText('Priority'), { target: { value: '' } });
    expect(onChange).not.toHaveBeenCalled();
    for (const call of onChange.mock.calls) {
      expect(Number.isFinite(call[0])).toBe(true);
    }
  });

  it('stays clearable — the NaN guard does not snap the field back to the old value', () => {
    // The guard alone would make the field unclearable if the display were
    // re-derived from the committed number every keystroke: the empty state would
    // never reach the input. The draft buffer must render the empty field
    // verbatim so a user can clear and retype.
    const onChangeSpy = vi.fn();
    render(<StatefulNumberField initial={5} onChangeSpy={onChangeSpy} />);
    const input = screen.getByLabelText('Priority') as HTMLInputElement;

    fireEvent.change(input, { target: { value: '' } });
    expect(input.value).toBe('');

    fireEvent.change(input, { target: { value: '2' } });
    fireEvent.change(input, { target: { value: '25' } });
    expect(input.value).toBe('25');
    expect(onChangeSpy.mock.calls.at(-1)?.[0]).toBe(25);
  });

  it('associates a caller-provided input id with the visible label', () => {
    render(<NumberField label="Distance" id="custom-distance" value={1} onChange={() => {}} />);
    expect(screen.getByLabelText('Distance')).toHaveAttribute('id', 'custom-distance');
  });

  it('drops an empty draft and still calls a caller-provided blur handler', () => {
    const onBlur = vi.fn();
    const onChange = vi.fn();
    render(<NumberField label="Distance" value={5} onChange={onChange} onBlur={onBlur} />);
    const input = screen.getByLabelText('Distance') as HTMLInputElement;
    fireEvent.change(input, { target: { value: '' } });
    expect(input.value).toBe('');
    fireEvent.blur(input);
    expect(input.value).toBe('5');
    expect(onBlur).toHaveBeenCalledOnce();
    expect(onChange).not.toHaveBeenCalled();
  });

  it('gives two instances distinct label associations under one render', () => {
    // Two NumberFields with different labels must each resolve to their own
    // input; a shared or missing id would make getByLabelText ambiguous or wrong.
    render(
      <>
        <NumberField label="Max Distance" value={50} onChange={() => {}} />
        <NumberField label="Ref Distance" value={1} onChange={() => {}} />
      </>
    );
    expect(screen.getByLabelText('Max Distance')).toHaveValue(50);
    expect(screen.getByLabelText('Ref Distance')).toHaveValue(1);
  });
});
