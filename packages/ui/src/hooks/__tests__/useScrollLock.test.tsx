import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { render } from '@testing-library/react';
import { useScrollLock } from '../useScrollLock';

function LockConsumer({ locked }: { locked: boolean }) {
  useScrollLock(locked);
  return null;
}

describe('useScrollLock', () => {
  const originalOverflow = document.documentElement.style.overflow;

  beforeEach(() => {
    document.documentElement.style.overflow = '';
    document.body.style.overflow = '';
  });

  afterEach(() => {
    // Guard against a failing assertion mid-test leaving the shared jsdom
    // document locked for the next test in this file.
    document.documentElement.style.overflow = originalOverflow;
    document.body.style.overflow = '';
  });

  it('sets overflow:hidden on documentElement while locked', () => {
    const { unmount } = render(<LockConsumer locked />);
    expect(document.documentElement.style.overflow).toBe('hidden');
    unmount();
  });

  it('never sets overflow on body', () => {
    const { unmount } = render(<LockConsumer locked />);
    // Regression guard for PF-1017 (#9037): a body-targeted lock leaks into
    // viewport sizing on public pages. The lock must live on
    // documentElement only.
    expect(document.body.style.overflow).toBe('');
    unmount();
  });

  it('restores the prior overflow value when it unmounts', () => {
    const { unmount } = render(<LockConsumer locked />);
    expect(document.documentElement.style.overflow).toBe('hidden');
    unmount();
    expect(document.documentElement.style.overflow).toBe('');
  });

  it('restores a pre-existing non-default overflow value, not empty string', () => {
    document.documentElement.style.overflow = 'scroll';
    const { unmount } = render(<LockConsumer locked />);
    expect(document.documentElement.style.overflow).toBe('hidden');
    unmount();
    expect(document.documentElement.style.overflow).toBe('scroll');
  });

  it('does not lock when `locked` is false', () => {
    const { unmount } = render(<LockConsumer locked={false} />);
    expect(document.documentElement.style.overflow).toBe('');
    unmount();
  });

  it('releases the lock when `locked` flips from true to false without unmounting', () => {
    const { rerender } = render(<LockConsumer locked />);
    expect(document.documentElement.style.overflow).toBe('hidden');
    rerender(<LockConsumer locked={false} />);
    expect(document.documentElement.style.overflow).toBe('');
  });

  it('acquires the lock when `locked` flips from false to true without a fresh mount', () => {
    const { rerender, unmount } = render(<LockConsumer locked={false} />);
    expect(document.documentElement.style.overflow).toBe('');
    rerender(<LockConsumer locked />);
    expect(document.documentElement.style.overflow).toBe('hidden');
    unmount();
    expect(document.documentElement.style.overflow).toBe('');
  });

  it('stacked dialogs: keeps the lock while any consumer is still locked, only releases when the last one unmounts', () => {
    const outer = render(<LockConsumer locked />);
    expect(document.documentElement.style.overflow).toBe('hidden');

    const inner = render(<LockConsumer locked />);
    expect(document.documentElement.style.overflow).toBe('hidden');

    // Inner (later-opened) dialog closes first -- the outer one is still
    // open, so the document must stay locked (refcount, not a boolean).
    inner.unmount();
    expect(document.documentElement.style.overflow).toBe('hidden');

    // Outer dialog closes last -- now the lock releases.
    outer.unmount();
    expect(document.documentElement.style.overflow).toBe('');
  });

  it('stacked dialogs: restores the original value only after the last one releases', () => {
    document.documentElement.style.overflow = 'auto';

    const first = render(<LockConsumer locked />);
    const second = render(<LockConsumer locked />);
    expect(document.documentElement.style.overflow).toBe('hidden');

    first.unmount();
    expect(document.documentElement.style.overflow).toBe('hidden');

    second.unmount();
    expect(document.documentElement.style.overflow).toBe('auto');
  });
});

describe('useScrollLock scrollbar compensation', () => {
  const root = document.documentElement;
  const innerWidthDescriptor = Object.getOwnPropertyDescriptor(window, 'innerWidth');

  // jsdom has no layout, so the viewport and the root's client box are faked
  // to model a page with a classic (space-taking) scrollbar. The fake follows
  // the lock the way a real browser does: once the root's overflow is hidden
  // the scrollbar is gone and `clientWidth` reads the full viewport width, so
  // an implementation that measures AFTER hiding overflow sees a 0 gap here
  // too, exactly as it would in production.
  function setViewport(innerWidth: number, clientWidth: number) {
    Object.defineProperty(window, 'innerWidth', { configurable: true, value: innerWidth });
    Object.defineProperty(root, 'clientWidth', {
      configurable: true,
      get: () =>
        root.style.overflow === 'hidden' && clientWidth > 0 ? innerWidth : clientWidth,
    });
  }

  beforeEach(() => {
    root.style.overflow = '';
    root.style.paddingRight = '';
  });

  afterEach(() => {
    if (innerWidthDescriptor) {
      Object.defineProperty(window, 'innerWidth', innerWidthDescriptor);
    }
    // Remove the instance override so Element.prototype's getter is used again.
    delete (root as unknown as Record<string, unknown>).clientWidth;
    root.style.overflow = '';
    root.style.paddingRight = '';
  });

  it('pads the root by the scrollbar width while locked, then restores it', () => {
    setViewport(1024, 1009);
    const { unmount } = render(<LockConsumer locked />);
    expect(root.style.overflow).toBe('hidden');
    expect(root.style.paddingRight).toBe('15px');
    unmount();
    expect(root.style.paddingRight).toBe('');
  });

  it('adds to an existing padding-right and restores the original value, not empty string', () => {
    root.style.paddingRight = '8px';
    setViewport(1024, 1007);
    const { unmount } = render(<LockConsumer locked />);
    expect(root.style.paddingRight).toBe('25px');
    unmount();
    expect(root.style.paddingRight).toBe('8px');
  });

  it('adds no padding for an overlay scrollbar that takes no width', () => {
    setViewport(1024, 1024);
    const { unmount } = render(<LockConsumer locked />);
    expect(root.style.overflow).toBe('hidden');
    expect(root.style.paddingRight).toBe('');
    unmount();
  });

  it('adds no padding when the root has no layout box (clientWidth 0)', () => {
    setViewport(1024, 0);
    const { unmount } = render(<LockConsumer locked />);
    expect(root.style.paddingRight).toBe('');
    unmount();
  });

  it('stacked dialogs: keeps the padding until the last lock releases and does not re-measure', () => {
    setViewport(1024, 1009);
    const outer = render(<LockConsumer locked />);
    expect(root.style.paddingRight).toBe('15px');

    // A second lock must not stack another scrollbar width on top.
    const inner = render(<LockConsumer locked />);
    expect(root.style.paddingRight).toBe('15px');

    inner.unmount();
    expect(root.style.paddingRight).toBe('15px');

    outer.unmount();
    expect(root.style.paddingRight).toBe('');
  });
});
