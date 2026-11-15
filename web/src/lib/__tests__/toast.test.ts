import { describe, it, expect, vi, beforeEach } from 'vitest';

const mocks = vi.hoisted(() => {
  const error = vi.fn();
  const success = vi.fn();
  const base = Object.assign(vi.fn(), { error, success });
  return { error, success, base };
});

vi.mock('sonner', () => ({ toast: mocks.base }));

import { showError, showPersistentError, showSuccess, showInfo } from '../toast';

/**
 * The only difference between {@link showError} and {@link showPersistentError}
 * is the options object, so that object is what has to be asserted. Without
 * this, `showPersistentError` could be a second name for `toast.error(message)`
 * and every caller's test would still pass — a caller only observes which
 * function it invoked, never what that function did with the message
 * (PF-1228, review finding 2).
 */
describe('toast', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('showError takes sonner default duration', () => {
    showError('boom');
    // Exactly one argument: passing an options object at all would mean this
    // function has an opinion about duration, and it deliberately does not.
    expect(mocks.error).toHaveBeenCalledWith('boom');
  });

  it('showPersistentError stays up until dismissed, and can be dismissed', () => {
    showPersistentError('Turn on Physics for Player, then press Play again.');

    expect(mocks.error).toHaveBeenCalledWith(
      'Turn on Physics for Player, then press Play again.',
      { duration: Infinity, closeButton: true, id: undefined },
    );
  });

  it('forwards the dedupe id, which is what stops N failures stacking N toasts', () => {
    // sonner keys toasts by id, so dropping `id` would silently restore the
    // stacked-toast bug this function was changed to fix — and nothing would
    // fail, because `toHaveBeenCalledWith` ignores a property whose value is
    // `undefined`. Asserting a real id is what makes that regression reachable.
    showPersistentError('That generation could not be finished.', { id: 'generation-failed-1' });

    expect(mocks.error).toHaveBeenCalledWith(
      'That generation could not be finished.',
      { duration: Infinity, closeButton: true, id: 'generation-failed-1' },
    );
  });

  it('showSuccess and showInfo are unchanged', () => {
    showSuccess('saved');
    showInfo('heads up');

    expect(mocks.success).toHaveBeenCalledWith('saved');
    expect(mocks.base).toHaveBeenCalledWith('heads up');
  });
});
