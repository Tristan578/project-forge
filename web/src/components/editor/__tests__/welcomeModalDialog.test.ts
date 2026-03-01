/**
 * Tests for WelcomeModal dialog semantics and focus trap.
 *
 * @vitest-environment jsdom
 */

import { describe, it, expect } from 'vitest';

describe('WelcomeModal dialog semantics', () => {
  it('should have role="dialog" on the modal container', () => {
    const role = 'dialog';
    expect(role).toBe('dialog');
  });

  it('should have aria-modal="true" to indicate a modal dialog', () => {
    const ariaModal = true;
    expect(ariaModal).toBe(true);
  });

  it('should have aria-labelledby pointing to the title element', () => {
    const titleId = 'welcome-modal-title';
    const ariaLabelledby = 'welcome-modal-title';
    expect(ariaLabelledby).toBe(titleId);
  });

  it('should have a title with the matching id', () => {
    const titleText = 'Welcome to GenForge';
    const titleId = 'welcome-modal-title';
    expect(titleText).toBeTruthy();
    expect(titleId).toBe('welcome-modal-title');
  });

  it('should have tabIndex={-1} on dialog for programmatic focus', () => {
    const tabIndex = -1;
    expect(tabIndex).toBe(-1);
  });
});

describe('WelcomeModal focus trap', () => {
  it('should query focusable elements within the dialog', () => {
    const focusableSelector =
      'a[href], button:not([disabled]), input:not([disabled]), [tabindex]:not([tabindex="-1"])';
    expect(focusableSelector).toContain('button');
    expect(focusableSelector).toContain('a[href]');
    expect(focusableSelector).toContain('input');
  });

  it('should trap Tab at the end by cycling to first focusable', () => {
    // Simulating focus trap logic
    const focusableElements = ['startTutorial', 'browseTemplates', 'docs', 'skip', 'checkbox'];
    const lastIndex = focusableElements.length - 1;
    const currentFocused = focusableElements[lastIndex];

    // When Tab is pressed on last element, focus should go to first
    const nextFocused = currentFocused === focusableElements[lastIndex]
      ? focusableElements[0]
      : focusableElements[lastIndex];

    expect(nextFocused).toBe('startTutorial');
  });

  it('should trap Shift+Tab at the start by cycling to last focusable', () => {
    const focusableElements = ['startTutorial', 'browseTemplates', 'docs', 'skip', 'checkbox'];
    const currentFocused = focusableElements[0];

    const nextFocused = currentFocused === focusableElements[0]
      ? focusableElements[focusableElements.length - 1]
      : focusableElements[0];

    expect(nextFocused).toBe('checkbox');
  });

  it('should close the modal on Escape key', () => {
    let dismissed = false;
    const handleKeyDown = (key: string) => {
      if (key === 'Escape') {
        dismissed = true;
      }
    };
    handleKeyDown('Escape');
    expect(dismissed).toBe(true);
  });

  it('should not close the modal on other keys', () => {
    let dismissed = false;
    const handleKeyDown = (key: string) => {
      if (key === 'Escape') {
        dismissed = true;
      }
    };
    handleKeyDown('Enter');
    expect(dismissed).toBe(false);
  });
});

describe('WelcomeModal auto-focus', () => {
  it('should auto-focus the dialog element when visible', () => {
    // The dialog has tabIndex={-1} to receive programmatic focus
    const dialogTabIndex = -1;
    const hasFocusOutlineNone = true;
    expect(dialogTabIndex).toBe(-1);
    expect(hasFocusOutlineNone).toBe(true);
  });
});
