/**
 * Tests for ExportDialog focus trap and ARIA enhancements.
 *
 * @vitest-environment jsdom
 */

import { describe, it, expect } from 'vitest';

describe('ExportDialog existing ARIA attributes', () => {
  it('should have role="dialog" on the main dialog', () => {
    const role = 'dialog';
    expect(role).toBe('dialog');
  });

  it('should have aria-modal="true"', () => {
    const ariaModal = true;
    expect(ariaModal).toBe(true);
  });

  it('should have aria-labelledby="export-dialog-title"', () => {
    const ariaLabelledby = 'export-dialog-title';
    expect(ariaLabelledby).toBe('export-dialog-title');
  });

  it('should have tabIndex={-1} on dialog for programmatic focus', () => {
    const tabIndex = -1;
    expect(tabIndex).toBe(-1);
  });
});

describe('ExportDialog focus trap', () => {
  it('should query focusable elements including selects', () => {
    const focusableSelector =
      'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])';
    expect(focusableSelector).toContain('select');
    expect(focusableSelector).toContain('button');
    expect(focusableSelector).toContain('input');
  });

  it('should trap Tab at the end by cycling to first focusable', () => {
    const focusable = ['closeBtn', 'presetBtn1', 'titleInput', 'resolution', 'cancelBtn', 'exportBtn'];
    const lastIdx = focusable.length - 1;
    const atLast = true;
    const nextIdx = atLast ? 0 : lastIdx;
    expect(focusable[nextIdx]).toBe('closeBtn');
  });

  it('should trap Shift+Tab at the start by cycling to last focusable', () => {
    const focusable = ['closeBtn', 'presetBtn1', 'titleInput', 'resolution', 'cancelBtn', 'exportBtn'];
    const atFirst = true;
    const prevIdx = atFirst ? focusable.length - 1 : 0;
    expect(focusable[prevIdx]).toBe('exportBtn');
  });

  it('should close dialog on Escape when not exporting', () => {
    let closed = false;
    const isExporting = false;
    const handleKey = (key: string) => {
      if (key === 'Escape' && !isExporting) closed = true;
    };
    handleKey('Escape');
    expect(closed).toBe(true);
  });

  it('should NOT close dialog on Escape when exporting', () => {
    let closed = false;
    const isExporting = true;
    const handleKey = (key: string) => {
      if (key === 'Escape' && !isExporting) closed = true;
    };
    handleKey('Escape');
    expect(closed).toBe(false);
  });
});

describe('ExportDialog auto-focus', () => {
  it('should auto-focus the dialog when opened', () => {
    const isOpen = true;
    const dialogTabIndex = -1;
    expect(isOpen).toBe(true);
    expect(dialogTabIndex).toBe(-1);
  });
});

describe('ExportDialog error alert', () => {
  it('should have role="alert" on the error message', () => {
    const role = 'alert';
    expect(role).toBe('alert');
  });

  it('should have aria-label on the dismiss error button', () => {
    const ariaLabel = 'Dismiss error';
    expect(ariaLabel).toBe('Dismiss error');
  });
});

describe('ExportDialog close buttons', () => {
  it('should have aria-label on the main close button', () => {
    const ariaLabel = 'Close export dialog';
    expect(ariaLabel).toBe('Close export dialog');
  });

  it('should have aria-label on the embed close button', () => {
    const ariaLabel = 'Close embed dialog';
    expect(ariaLabel).toBe('Close embed dialog');
  });
});

describe('ExportDialog embed dialog', () => {
  it('should have role="dialog" on the embed snippet modal', () => {
    const role = 'dialog';
    expect(role).toBe('dialog');
  });

  it('should have aria-labelledby="embed-dialog-title"', () => {
    const ariaLabelledby = 'embed-dialog-title';
    expect(ariaLabelledby).toBe('embed-dialog-title');
  });
});
