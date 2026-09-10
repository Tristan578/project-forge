import { toast } from 'sonner';

export function showError(message: string): void {
  toast.error(message);
}

/**
 * An error the reader has to ACT on, not merely notice.
 *
 * `showError` inherits sonner's default visible duration (4 s; sonner exports no
 * constant for it, so that number is prose here rather than a mirror). That is
 * long enough to register that something went wrong and far too short to read a
 * two-step remediation, find the named entity in the Hierarchy and tick a
 * checkbox. For a diagnostic the engine emits only on an Edit->Play transition
 * it is worse than terse: once it dismisses, the only way back to the message is
 * to stop and press Play again, so the guidance is not merely hurried but
 * unrecoverable.
 *
 * Stays up until dismissed, and carries the close control that makes dismissing
 * it possible — an indefinite toast with no way to close it is an obstruction,
 * not a warning.
 *
 * `id` DEDUPES. sonner keys toasts by id, so an id turns N concurrent failures
 * that produce the same message into one toast rather than a stack of
 * identical ones. Optional, because most callers raise a one-off.
 */
export function showPersistentError(message: string, options?: { id?: string }): void {
  toast.error(message, { duration: Infinity, closeButton: true, id: options?.id });
}

export function showSuccess(message: string): void {
  toast.success(message);
}

export function showInfo(message: string): void {
  toast(message);
}
