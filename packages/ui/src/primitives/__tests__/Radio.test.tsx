import { createRef } from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { Radio } from '../Radio';

describe('Radio', () => {
  it('names the radio separately from its description and makes the whole option clickable', () => {
    const change = vi.fn();
    const ref = createRef<HTMLInputElement>();
    render(<Radio ref={ref} name="mode" label="Sandbox" description="No goal required" onChange={change} />);
    const radio = screen.getByRole('radio', { name: 'Sandbox' });
    expect(radio).toHaveAccessibleDescription('No goal required');
    expect(ref.current).toBe(radio);
    fireEvent.click(screen.getByText('No goal required'));
    expect(radio).toBeChecked();
    expect(change).toHaveBeenCalledOnce();
  });

  it('keeps native mutually exclusive selection and disabled behavior', () => {
    render(<><Radio name="mode" label="Win" defaultChecked /><Radio name="mode" label="Sandbox" /><Radio name="mode" label="Endless" disabled /></>);
    fireEvent.click(screen.getByText('Sandbox'));
    expect(screen.getByRole('radio', { name: 'Win' })).not.toBeChecked();
    expect(screen.getByRole('radio', { name: 'Sandbox' })).toBeChecked();
    fireEvent.click(screen.getByText('Endless'));
    expect(screen.getByRole('radio', { name: 'Endless' })).not.toBeChecked();
    expect(screen.getByRole('radio', { name: 'Sandbox' })).toBeChecked();
  });

  it('generates distinct ids and preserves an extra accessible description', () => {
    render(<><span id="extra">Additional context</span><Radio label="One" /><Radio label="Two" description="Detail" aria-describedby="extra" /></>);
    const one = screen.getByRole('radio', { name: 'One' });
    const two = screen.getByRole('radio', { name: 'Two' });
    expect(one.id).not.toBe(two.id);
    expect(two).toHaveAccessibleDescription('Additional context Detail');
  });
});
