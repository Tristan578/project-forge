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

  // PR #10294: controls a consumer needs in view at every scroll offset go in
  // `actions`, which must sit OUTSIDE the scrolling body (a footer the body's
  // scroll cannot carry away or slide content under), after it in the panel.
  it('renders actions in a footer outside the scrolling body, after it', () => {
    render(
      <Dialog open onClose={vi.fn()} title="Dialog" actions={<button type="button">Confirm</button>}>
        <p>Body text</p>
      </Dialog>
    );
    const dialog = screen.getByRole('dialog');
    const body = dialog.querySelector('[data-dialog-body]');
    const footer = dialog.querySelector('[data-dialog-actions]');
    const confirm = screen.getByRole('button', { name: 'Confirm' });
    expect(body).not.toBeNull();
    expect(footer).not.toBeNull();
    expect(body?.contains(screen.getByText('Body text'))).toBe(true);
    expect(footer?.contains(confirm)).toBe(true);
    expect(body?.contains(confirm)).toBe(false);
    expect(footer?.parentElement).toBe(dialog);
    expect(body?.nextElementSibling).toBe(footer);
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

    // useDialogA11y picks the initial focus target in a requestAnimationFrame.
    // In Chromium that frame callback runs BEFORE the first ResizeObserver
    // notification (measured 20/20, PR #10294 round 3), so the tests below run
    // the frame first and fire the observer after it: the order production
    // actually sees. The observer-first order is kept as a second case where
    // the outcome must not depend on it.
    function runFrame() {
      act(() => {
        vi.runAllTimers();
      });
    }

    it.each([
      ['frame, then observer (Chromium)', 'frame-first'],
      ['observer, then frame', 'observer-first'],
    ] as const)(
      'keeps initial focus on the first real control, not the scroll region before it: %s',
      (_label, order) => {
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
        if (order === 'frame-first') runFrame();
        setBodyGeometry(getBody(), 900, 300);
        if (order === 'observer-first') runFrame();
        // The region precedes the control in DOM (and Tab) order.
        const region = screen.getByRole('region', { name: 'Long dialog' });
        const first = screen.getByRole('button', { name: 'First control' });
        expect(region.compareDocumentPosition(first) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
        // The region appearing does not pull focus off a real control.
        expect(document.activeElement).toBe(first);
      }
    );

    it('moves initial focus from the container into the scroll region when the region appears after the frame (the Chromium order)', () => {
      vi.useFakeTimers();
      render(
        <Dialog open onClose={vi.fn()} title="Terms">
          <p>Very long text with no controls.</p>
        </Dialog>
      );
      const dialog = screen.getByRole('dialog');
      runFrame();
      // At the frame nothing inside is focusable yet, so the container takes focus.
      expect(document.activeElement).toBe(dialog);
      expect(screen.queryByRole('region')).toBeNull();

      // The observer then reports the overflow: the region appears and takes focus.
      setBodyGeometry(getBody(), 900, 300);
      expect(document.activeElement).toBe(screen.getByRole('region', { name: 'Terms' }));
    });

    it('focuses the scroll region directly when the observer reports before the frame', () => {
      vi.useFakeTimers();
      render(
        <Dialog open onClose={vi.fn()} title="Terms">
          <p>Very long text with no controls.</p>
        </Dialog>
      );
      setBodyGeometry(getBody(), 900, 300);
      runFrame();
      expect(document.activeElement).toBe(screen.getByRole('region', { name: 'Terms' }));
    });

    it('moves focus to the dialog, not <body>, when the focused region stops overflowing, and back into the region when it overflows again', () => {
      vi.useFakeTimers();
      render(
        <Dialog open onClose={vi.fn()} title="Terms">
          <p>Very long text with no controls.</p>
        </Dialog>
      );
      const body = getBody();
      runFrame();
      setBodyGeometry(body, 900, 300);
      // Precondition: the region holds focus (it is the only focusable thing).
      expect(document.activeElement).toBe(body);

      // The viewport grew (or the content shrank) while the region had focus.
      setBodyGeometry(body, 300, 300);
      expect(body.hasAttribute('tabindex')).toBe(false);
      const dialog = screen.getByRole('dialog');
      // Focus stays inside the aria-modal dialog: on its container, which is
      // programmatically focusable (tabIndex -1) but not a Tab stop.
      expect(document.activeElement).toBe(dialog);
      expect(dialog.tabIndex).toBe(-1);

      // The content grew back: the region is the one focusable thing again.
      setBodyGeometry(body, 900, 300);
      expect(document.activeElement).toBe(body);
    });

    it('leaves focus outside the dialog alone when the region appears', () => {
      vi.useFakeTimers();
      const outside = document.createElement('button');
      document.body.appendChild(outside);
      try {
        render(
          <Dialog open onClose={vi.fn()} title="Terms">
            <p>Very long text with no controls.</p>
          </Dialog>
        );
        runFrame();
        // Something outside took focus after the frame (not a real dialog
        // flow, but it isolates the rule: only the CONTAINER hands off).
        outside.focus();
        setBodyGeometry(getBody(), 900, 300);
        expect(screen.getByRole('region', { name: 'Terms' })).toBe(getBody());
        expect(document.activeElement).toBe(outside);
      } finally {
        outside.remove();
      }
    });

    it('disconnects every observer when it closes and when it unmounts', () => {
      const { rerender, unmount } = render(
        <Dialog open onClose={vi.fn()} title="Long dialog">
          <p>Body</p>
        </Dialog>
      );
      // Non-vacuous: something was observed while open.
      expect(observers.length).toBeGreaterThan(0);
      expect(observers.flatMap((o) => o.observed).length).toBeGreaterThan(0);

      rerender(
        <Dialog open={false} onClose={vi.fn()} title="Long dialog">
          <p>Body</p>
        </Dialog>
      );
      expect(observers.map((o) => o.observed.length)).toEqual(observers.map(() => 0));

      rerender(
        <Dialog open onClose={vi.fn()} title="Long dialog">
          <p>Body</p>
        </Dialog>
      );
      const afterReopen = observers.length;
      expect(observers.flatMap((o) => o.observed).length).toBeGreaterThan(0);
      unmount();
      // Includes the observer created on reopen.
      expect(observers.length).toBe(afterReopen);
      expect(observers.map((o) => o.observed.length)).toEqual(observers.map(() => 0));
    });

    it('forgets the overflow on close: a reopened body is a plain box until the observer reports again', () => {
      const { rerender } = render(
        <Dialog open onClose={vi.fn()} title="Long dialog">
          <p>Body</p>
        </Dialog>
      );
      setBodyGeometry(getBody(), 900, 300);
      expect(getBody().getAttribute('role')).toBe('region');

      rerender(
        <Dialog open={false} onClose={vi.fn()} title="Long dialog">
          <p>Body</p>
        </Dialog>
      );
      rerender(
        <Dialog open onClose={vi.fn()} title="Long dialog">
          <p>Body</p>
        </Dialog>
      );
      // No observer has fired since the reopen.
      const body = getBody();
      expect(body.hasAttribute('tabindex')).toBe(false);
      expect(body.hasAttribute('role')).toBe(false);
      expect(screen.queryByRole('region')).toBeNull();
    });

    it('leaves focus alone when the region stops overflowing without holding focus', () => {
      vi.useFakeTimers();
      render(
        <Dialog
          open
          onClose={vi.fn()}
          title="Long dialog"
          actions={<button type="button">Confirm</button>}
        >
          <p>Body</p>
        </Dialog>
      );
      const body = getBody();
      setBodyGeometry(body, 900, 300);
      act(() => {
        vi.runAllTimers();
      });
      const confirm = screen.getByRole('button', { name: 'Confirm' });
      expect(document.activeElement).toBe(confirm);

      setBodyGeometry(body, 300, 300);
      expect(document.activeElement).toBe(confirm);
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
