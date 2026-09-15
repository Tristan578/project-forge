import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { NumberField } from '../NumberField';

describe('NumberField', () => {
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

  it('respects the disabled state', () => {
    render(<NumberField label="Priority" value={0} onChange={() => {}} disabled />);
    expect(screen.getByLabelText('Priority')).toBeDisabled();
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
