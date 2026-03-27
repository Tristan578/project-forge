import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useDialogA11y } from '../hooks/useDialogA11y';

describe('useDialogA11y', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('returns dialogProps with role=dialog and aria-modal=true', () => {
    const { result } = renderHook(() =>
      useDialogA11y({ title: 'Test Dialog', isOpen: true, onClose: vi.fn() })
    );
    expect(result.current.dialogProps.role).toBe('dialog');
    expect(result.current.dialogProps['aria-modal']).toBe(true);
  });

  it('aria-labelledby on dialog matches id on titleProps', () => {
    const { result } = renderHook(() =>
      useDialogA11y({ title: 'My Dialog', isOpen: true, onClose: vi.fn() })
    );
    const labelledBy = result.current.dialogProps['aria-labelledby'];
    expect(labelledBy).toBeDefined();
    expect(result.current.titleProps.id).toBe(labelledBy);
  });

  it('calls onClose when Escape is pressed and dialog is open', () => {
    const onClose = vi.fn();
    renderHook(() => useDialogA11y({ title: 'Test', isOpen: true, onClose }));
    act(() => {
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    });
    expect(onClose).toHaveBeenCalledOnce();
  });

  it('does NOT call onClose when Escape is pressed and dialog is closed', () => {
    const onClose = vi.fn();
    renderHook(() => useDialogA11y({ title: 'Test', isOpen: false, onClose }));
    act(() => {
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    });
    expect(onClose).not.toHaveBeenCalled();
  });
});
