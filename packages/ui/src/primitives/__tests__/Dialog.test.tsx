import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { Dialog } from '../Dialog';
import { THEME_NAMES } from '../../tokens';

describe('Dialog', () => {
  it('renders nothing when closed', () => {
    const { container } = render(
      <Dialog open={false} onClose={vi.fn()} title="My Dialog">
        Content
      </Dialog>
    );
    expect(container.querySelector('[role="dialog"]')).toBeNull();
  });

  it('renders dialog when open', () => {
    render(
      <Dialog open onClose={vi.fn()} title="My Dialog">
        Dialog content
      </Dialog>
    );
    expect(screen.getByRole('dialog')).not.toBeNull();
  });

  it('renders title', () => {
    render(
      <Dialog open onClose={vi.fn()} title="Test Title">
        Content
      </Dialog>
    );
    expect(screen.getByText('Test Title')).not.toBeNull();
  });

  it('calls onClose when overlay is clicked', () => {
    const onClose = vi.fn();
    const { container } = render(
      <Dialog open onClose={onClose} title="Dialog">
        Content
      </Dialog>
    );
    const overlay = container.querySelector('[data-dialog-overlay]');
    if (overlay) fireEvent.click(overlay);
    expect(onClose).toHaveBeenCalled();
  });

  it('calls onClose when Escape is pressed', () => {
    const onClose = vi.fn();
    render(
      <Dialog open onClose={onClose} title="Dialog">
        Content
      </Dialog>
    );
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(onClose).toHaveBeenCalledOnce();
  });

  it('has aria-modal=true', () => {
    render(
      <Dialog open onClose={vi.fn()} title="Accessible Dialog">
        Content
      </Dialog>
    );
    const dialog = screen.getByRole('dialog');
    expect(dialog.getAttribute('aria-modal')).toBe('true');
  });

  it.each(THEME_NAMES)('renders without error in %s theme', (theme) => {
    document.documentElement.setAttribute('data-sf-theme', theme);
    const { container } = render(
      <Dialog open onClose={vi.fn()} title="Test">
        Content
      </Dialog>
    );
    expect(container.querySelector('[role="dialog"]')).not.toBeNull();
    const allClasses = Array.from(container.querySelectorAll('[class]'))
      .flatMap((el) => el.className.split(' '));
    const leaks = allClasses.filter((c) => /zinc-|stone-|slate-/.test(c));
    expect(leaks, `Hardcoded primitives found: ${leaks.join(', ')}`).toHaveLength(0);
  });
});
