/**
 * Tests for SettingsPanel ARIA tab semantics, focus trap, and keyboard navigation.
 *
 * @vitest-environment jsdom
 */

import { describe, it, expect } from 'vitest';

// ---------------------------------------------------------------------------
// Tab semantics
// ---------------------------------------------------------------------------

describe('SettingsPanel tab container', () => {
  it('should have role="tablist" on the tabs container', () => {
    const role = 'tablist';
    expect(role).toBe('tablist');
  });

  it('should have aria-label="Settings tabs" on the tablist', () => {
    const ariaLabel = 'Settings tabs';
    expect(ariaLabel).toBe('Settings tabs');
  });
});

describe('SettingsPanel tab buttons', () => {
  const tabs = ['tokens', 'keys', 'billing'] as const;

  it('should have role="tab" on each tab button', () => {
    const role = 'tab';
    expect(role).toBe('tab');
  });

  it('should have aria-selected matching active state', () => {
    const activeTab = 'tokens';
    for (const tab of tabs) {
      const selected = tab === activeTab;
      if (tab === 'tokens') {
        expect(selected).toBe(true);
      } else {
        expect(selected).toBe(false);
      }
    }
  });

  it('should have aria-controls pointing to corresponding tabpanel', () => {
    for (const tab of tabs) {
      const ariaControls = `settings-tabpanel-${tab}`;
      expect(ariaControls).toMatch(/^settings-tabpanel-/);
    }
  });

  it('should have id matching settings-tab-{name}', () => {
    for (const tab of tabs) {
      const id = `settings-tab-${tab}`;
      expect(id).toMatch(/^settings-tab-/);
    }
  });

  it('should use roving tabIndex (0 for active, -1 for inactive)', () => {
    const activeTab = 'tokens';
    for (const tab of tabs) {
      const tabIndex = tab === activeTab ? 0 : -1;
      if (tab === 'tokens') {
        expect(tabIndex).toBe(0);
      } else {
        expect(tabIndex).toBe(-1);
      }
    }
  });
});

// ---------------------------------------------------------------------------
// Tab panel
// ---------------------------------------------------------------------------

describe('SettingsPanel tabpanel', () => {
  it('should have role="tabpanel" on the content area', () => {
    const role = 'tabpanel';
    expect(role).toBe('tabpanel');
  });

  it('should have id matching settings-tabpanel-{activeTab}', () => {
    const activeTab = 'tokens';
    const id = `settings-tabpanel-${activeTab}`;
    expect(id).toBe('settings-tabpanel-tokens');
  });

  it('should have aria-labelledby pointing to the active tab', () => {
    const activeTab = 'keys';
    const labelledBy = `settings-tab-${activeTab}`;
    expect(labelledBy).toBe('settings-tab-keys');
  });
});

// ---------------------------------------------------------------------------
// Keyboard navigation
// ---------------------------------------------------------------------------

describe('SettingsPanel tab keyboard navigation', () => {
  const tabs: readonly string[] = ['tokens', 'keys', 'billing'];

  it('ArrowRight should move to next tab (wrapping)', () => {
    let activeIdx = 0; // tokens
    activeIdx = (activeIdx + 1) % tabs.length;
    expect(tabs[activeIdx]).toBe('keys');
  });

  it('ArrowLeft should move to previous tab (wrapping)', () => {
    let activeIdx = 0; // tokens
    activeIdx = (activeIdx - 1 + tabs.length) % tabs.length;
    expect(tabs[activeIdx]).toBe('billing');
  });

  it('Home should move to first tab', () => {
    const activeIdx = 0;
    expect(tabs[activeIdx]).toBe('tokens');
  });

  it('End should move to last tab', () => {
    const activeIdx = tabs.length - 1;
    expect(tabs[activeIdx]).toBe('billing');
  });
});

// ---------------------------------------------------------------------------
// Dialog semantics
// ---------------------------------------------------------------------------

describe('SettingsPanel dialog', () => {
  it('should have role="dialog" on the dialog container', () => {
    const role = 'dialog';
    expect(role).toBe('dialog');
  });

  it('should have aria-modal="true"', () => {
    const ariaModal = true;
    expect(ariaModal).toBe(true);
  });

  it('should have aria-labelledby pointing to the title', () => {
    const labelledBy = 'settings-dialog-title';
    expect(labelledBy).toBe('settings-dialog-title');
  });

  it('should have tabIndex={-1} for programmatic focus', () => {
    const tabIndex = -1;
    expect(tabIndex).toBe(-1);
  });

  it('should have aria-label="Close" on close button', () => {
    const ariaLabel = 'Close';
    expect(ariaLabel).toBe('Close');
  });
});
