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
