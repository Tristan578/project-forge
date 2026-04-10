import { describe, it, expect } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { Popover } from '../Popover';
import { THEME_NAMES } from '../../tokens';

describe('Popover', () => {
  it('renders trigger', () => {
    render(
      <Popover trigger={<span>Open</span>} content={<div>Popover content</div>} />
    );
    expect(screen.getByRole('button', { name: 'Open' })).not.toBeNull();
  });

  it('content hidden initially', () => {
    render(
      <Popover trigger={<span>Open</span>} content={<div>Hidden content</div>} />
    );
    const dialog = screen.getByRole('dialog', { hidden: true });
    expect(dialog.hidden).toBe(true);
  });

  it('shows content when trigger is clicked', () => {
    render(
      <Popover
        trigger={<span>Open popover</span>}
        content={<div>Visible content</div>}
      />
    );
    fireEvent.click(screen.getByRole('button'));
    const dialog = screen.getByRole('dialog');
    expect(dialog.hidden).toBe(false);
    expect(screen.getByText('Visible content')).not.toBeNull();
  });

  it('closes when clicking outside', () => {
    render(
      <Popover
        trigger={<span>Open</span>}
        content={<div>Content</div>}
      />
    );
    fireEvent.click(screen.getByRole('button'));
    const dialog = screen.getByRole('dialog');
    expect(dialog.hidden).toBe(false);
    // Click outside
    fireEvent.mouseDown(document.body);
    expect(dialog.hidden).toBe(true);
  });

  it('closes when Escape is pressed', () => {
    render(
      <Popover trigger={<span>Open</span>} content={<div>Popover</div>} />
    );
    fireEvent.click(screen.getByRole('button'));
    const dialog = screen.getByRole('dialog');
    expect(dialog.hidden).toBe(false);
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(dialog.hidden).toBe(true);
  });

  it('trigger has aria-expanded and aria-controls', () => {
    render(
      <Popover trigger={<span>Open</span>} content={<div>Content</div>} />
    );
    const trigger = screen.getByRole('button');
    expect(trigger.getAttribute('aria-expanded')).toBe('false');
    expect(trigger.getAttribute('aria-haspopup')).toBe('dialog');
    const controlsId = trigger.getAttribute('aria-controls');
    expect(controlsId).toBeTruthy();
    fireEvent.click(trigger);
    expect(trigger.getAttribute('aria-expanded')).toBe('true');
    const dialog = screen.getByRole('dialog');
    expect(dialog.id).toBe(controlsId);
  });

  it('uses overlay background token', () => {
    render(
      <Popover trigger={<span>Open</span>} content={<div>Content</div>} />
    );
    fireEvent.click(screen.getByRole('button'));
    const dialog = screen.getByRole('dialog');
    expect(dialog.className).toContain('var(--sf-bg-surface)');
  });

  it.each(THEME_NAMES)('renders without error in %s theme', (theme) => {
    document.documentElement.setAttribute('data-sf-theme', theme);
    const { container } = render(
      <Popover trigger={<span>Open</span>} content={<div>Content</div>} />
    );
    fireEvent.click(screen.getByRole('button'));
    const allClasses = Array.from(container.querySelectorAll('[class]'))
      .flatMap((el) => el.className.split(' '));
    const leaks = allClasses.filter((c) => /zinc-|stone-|slate-/.test(c));
    expect(leaks, `Hardcoded primitives found: ${leaks.join(', ')}`).toHaveLength(0);
  });
});
