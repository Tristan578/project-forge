import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
import { Dialog } from '../Dialog';
import { ScrollArea } from '../ScrollArea';
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

  it('locks document scroll on documentElement (never body) while open', () => {
    document.documentElement.style.overflow = '';
    document.body.style.overflow = '';
    const { unmount } = render(
      <Dialog open onClose={vi.fn()} title="Dialog">
        Content
      </Dialog>
    );
    expect(document.documentElement.style.overflow).toBe('hidden');
    expect(document.body.style.overflow).toBe('');
    unmount();
    expect(document.documentElement.style.overflow).toBe('');
  });

  it('keeps the scroll lock held while a second, stacked dialog is still open', () => {
    document.documentElement.style.overflow = '';
    const outer = render(
      <Dialog open onClose={vi.fn()} title="Outer">
        Outer content
      </Dialog>
    );
    const inner = render(
      <Dialog open onClose={vi.fn()} title="Inner">
        Inner content
      </Dialog>
    );
    expect(document.documentElement.style.overflow).toBe('hidden');

    inner.unmount();
    expect(document.documentElement.style.overflow).toBe('hidden');

    outer.unmount();
    expect(document.documentElement.style.overflow).toBe('');
  });

  it('does not lock document scroll while closed', () => {
    document.documentElement.style.overflow = '';
    const { unmount } = render(
      <Dialog open={false} onClose={vi.fn()} title="Dialog">
        Content
      </Dialog>
    );
    expect(document.documentElement.style.overflow).toBe('');
    unmount();
  });

  it('follows `open` on one mounted Dialog: releases on close, re-locks on reopen', () => {
    document.documentElement.style.overflow = '';
    const view = (open: boolean) => (
      <Dialog open={open} onClose={vi.fn()} title="Dialog">
        Content
      </Dialog>
    );
    const { rerender, unmount } = render(view(true));
    expect(document.documentElement.style.overflow).toBe('hidden');

    rerender(view(false));
    expect(document.documentElement.style.overflow).toBe('');

    rerender(view(true));
    expect(document.documentElement.style.overflow).toBe('hidden');

    unmount();
    expect(document.documentElement.style.overflow).toBe('');
  });

  it("renders the body as its own ScrollArea scroll container inside the dynamic-viewport-capped panel (PF-1032 / #9052 AC5)", () => {
    // Derive ScrollArea's own classes from a real ScrollArea, so this pins
    // "the body IS a ScrollArea" rather than restating today's class list.
    const { container: reference } = render(<ScrollArea />);
    const scrollAreaClasses = Array.from(
      (reference.firstChild as HTMLElement).classList
    );
    expect(scrollAreaClasses).toContain('[overscroll-behavior:contain]');
    expect(scrollAreaClasses).toContain('overflow-auto');

    render(
      <Dialog open onClose={vi.fn()} title="Dialog">
        Long body content
      </Dialog>
    );
    const dialog = screen.getByRole('dialog');
    const body = dialog.querySelector<HTMLElement>('[data-dialog-body]');
    expect(body).not.toBeNull();
    expect(body).not.toBe(dialog);
    expect(body?.contains(screen.getByText('Long body content'))).toBe(true);
    for (const cls of scrollAreaClasses) {
      expect(body?.classList.contains(cls), `body is missing ${cls}`).toBe(true);
    }
    // dvh, not vh: the panel must fit the visible viewport on mobile.
    expect(dialog.classList.contains('max-h-[85dvh]')).toBe(true);
    expect(dialog.className).not.toMatch(/max-h-\[85vh\]/);
  });

  describe('keyboard-scrollable body (WCAG 2.1.1)', () => {
    // jsdom has neither layout nor ResizeObserver. The fake records each
    // observer so a test can fire it after setting the body's fake geometry.
    const observers: FakeResizeObserver[] = [];
    class FakeResizeObserver {
      observed: Element[] = [];
      constructor(private readonly callback: () => void) {
        observers.push(this);
      }
      observe(el: Element) {
        this.observed.push(el);
      }
      disconnect() {
        this.observed = [];
      }
      fire() {
        if (this.observed.length > 0) this.callback();
      }
    }

    function setBodyGeometry(body: HTMLElement, scrollHeight: number, clientHeight: number) {
      Object.defineProperty(body, 'scrollHeight', { configurable: true, value: scrollHeight });
      Object.defineProperty(body, 'clientHeight', { configurable: true, value: clientHeight });
      act(() => {
        for (const o of observers) o.fire();
      });
    }

    beforeEach(() => {
      observers.length = 0;
      vi.stubGlobal('ResizeObserver', FakeResizeObserver);
    });

    afterEach(() => {
      vi.unstubAllGlobals();
      vi.useRealTimers();
    });

    function getBody() {
      const body = screen.getByRole('dialog').querySelector<HTMLElement>('[data-dialog-body]');
      if (!body) throw new Error('no dialog body');
      return body;
    }

    it('observes both the scroll box and its content', () => {
      render(
        <Dialog open onClose={vi.fn()} title="Long dialog">
          <p>Body</p>
        </Dialog>
      );
      const body = getBody();
      const observed = observers.flatMap((o) => o.observed);
      expect(observed).toContain(body);
      expect(observed).toContain(body.firstElementChild);
    });

    it('is a focusable region named by the title while its content overflows, and a plain box when it does not', () => {
      render(
        <Dialog open onClose={vi.fn()} title="Long dialog">
          <p>Body</p>
        </Dialog>
      );
      const body = getBody();
      expect(screen.queryByRole('region')).toBeNull();
      expect(body.hasAttribute('tabindex')).toBe(false);

      setBodyGeometry(body, 900, 300);
      expect(screen.getByRole('region', { name: 'Long dialog' })).toBe(body);
      expect(body.tabIndex).toBe(0);

      // Content shrank (or the viewport grew): no extra Tab stop.
      setBodyGeometry(body, 300, 300);
      expect(screen.queryByRole('region')).toBeNull();
      expect(body.hasAttribute('tabindex')).toBe(false);
    });

    it('keeps initial focus on the first real control, not the scroll region before it', () => {
      vi.useFakeTimers();
      render(
        <Dialog
          open
          onClose={vi.fn()}
          title="Long dialog"
          actions={<button type="button">Confirm</button>}
        >
          <button type="button">First control</button>
        </Dialog>
      );
      setBodyGeometry(getBody(), 900, 300);
      // The region precedes the control in DOM (and Tab) order.
      const region = screen.getByRole('region', { name: 'Long dialog' });
      const first = screen.getByRole('button', { name: 'First control' });
      expect(region.compareDocumentPosition(first) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();

      act(() => {
        vi.runAllTimers();
      });
      expect(document.activeElement).toBe(first);
    });

    it('falls back to the scroll region for initial focus when it is the only focusable thing', () => {
      vi.useFakeTimers();
      render(
        <Dialog open onClose={vi.fn()} title="Terms">
          <p>Very long text with no controls.</p>
        </Dialog>
      );
      setBodyGeometry(getBody(), 900, 300);
      act(() => {
        vi.runAllTimers();
      });
      expect(document.activeElement).toBe(screen.getByRole('region', { name: 'Terms' }));
    });

    it('measures once when ResizeObserver is unavailable', () => {
      vi.stubGlobal('ResizeObserver', undefined);
      const scrollHeight = vi
        .spyOn(HTMLElement.prototype, 'scrollHeight', 'get')
        .mockImplementation(function (this: HTMLElement) {
          return this.hasAttribute('data-dialog-body') ? 900 : 0;
        });
      try {
        render(
          <Dialog open onClose={vi.fn()} title="No observer">
            <p>Body</p>
          </Dialog>
        );
        expect(screen.getByRole('region', { name: 'No observer' })).toBe(getBody());
      } finally {
        scrollHeight.mockRestore();
      }
    });
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
