import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { Popover } from '../Popover';
import { THEME_NAMES } from '../../tokens';

describe('Popover', () => {
  it('renders trigger', () => {
    render(
      <Popover trigger={<button>Open</button>} content={<div>Popover content</div>} />
    );
    expect(screen.getByRole('button')).not.toBeNull();
  });

  it('content hidden initially', () => {
    const { container } = render(
      <Popover trigger={<button>Open</button>} content={<div>Hidden content</div>} />
    );
    expect(container.querySelector('[data-popover-content]')).toBeNull();
  });

  it('shows content when trigger is clicked', () => {
    render(
      <Popover
        trigger={<button>Open popover</button>}
        content={<div>Visible content</div>}
      />
    );
    fireEvent.click(screen.getByRole('button'));
    expect(screen.getByText('Visible content')).not.toBeNull();
  });

  it('closes when clicking outside', () => {
    const { container } = render(
      <Popover
        trigger={<button>Open</button>}
        content={<div>Content</div>}
      />
    );
    fireEvent.click(screen.getByRole('button'));
    expect(container.querySelector('[data-popover-content]')).not.toBeNull();
    // Click outside
    fireEvent.mouseDown(document.body);
    expect(container.querySelector('[data-popover-content]')).toBeNull();
  });

  it('closes when Escape is pressed', () => {
    const { container } = render(
      <Popover trigger={<button>Open</button>} content={<div>Popover</div>} />
    );
    fireEvent.click(screen.getByRole('button'));
    expect(container.querySelector('[data-popover-content]')).not.toBeNull();
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(container.querySelector('[data-popover-content]')).toBeNull();
  });

  it('uses overlay background token', () => {
    render(
      <Popover trigger={<button>Open</button>} content={<div>Content</div>} />
    );
    fireEvent.click(screen.getByRole('button'));
    const popoverContent = document.querySelector('[data-popover-content]');
    expect(popoverContent?.className).toContain('var(--sf-bg-overlay)');
  });

  it.each(THEME_NAMES)('renders without error in %s theme', (theme) => {
    document.documentElement.setAttribute('data-sf-theme', theme);
    const { container } = render(
      <Popover trigger={<button>Open</button>} content={<div>Content</div>} />
    );
    fireEvent.click(container.querySelector('button')!);
    const allClasses = Array.from(container.querySelectorAll('[class]'))
      .flatMap((el) => el.className.split(' '));
    const leaks = allClasses.filter((c) => /zinc-|stone-|slate-/.test(c));
    expect(leaks, `Hardcoded primitives found: ${leaks.join(', ')}`).toHaveLength(0);
  });
});
