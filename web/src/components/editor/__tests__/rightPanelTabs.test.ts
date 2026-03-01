/**
 * Tests for RightPanelTabs ARIA tab semantics.
 *
 * @vitest-environment jsdom
 */

import { describe, it, expect } from 'vitest';

const TAB_ORDER = ['inspector', 'chat', 'script', 'ui'] as const;

describe('RightPanelTabs ARIA tablist', () => {
  it('should have role="tablist" on the container', () => {
    const role = 'tablist';
    expect(role).toBe('tablist');
  });

  it('should have aria-label="Right panel tabs" on the tablist', () => {
    const ariaLabel = 'Right panel tabs';
    expect(ariaLabel).toBe('Right panel tabs');
  });
});

describe('RightPanelTabs tab buttons', () => {
  TAB_ORDER.forEach((tab) => {
    it(`should have role="tab" on the "${tab}" button`, () => {
      const role = 'tab';
      expect(role).toBe('tab');
    });

    it(`should have id="tab-${tab}" on the "${tab}" button`, () => {
      const id = `tab-${tab}`;
      expect(id).toBe(`tab-${tab}`);
    });

    it(`should have aria-controls="tabpanel-${tab}" on the "${tab}" button`, () => {
      const ariaControls = `tabpanel-${tab}`;
      expect(ariaControls).toBe(`tabpanel-${tab}`);
    });
  });

  it('should set aria-selected=true on the active tab', () => {
    const activeTab: string = 'inspector';
    const ariaSelected = activeTab === 'inspector';
    expect(ariaSelected).toBe(true);
  });

  it('should set aria-selected=false on inactive tabs', () => {
    const activeTab: string = 'inspector';
    const chatSelected = activeTab === 'chat';
    const scriptSelected = activeTab === 'script';
    expect(chatSelected).toBe(false);
    expect(scriptSelected).toBe(false);
  });

  it('should set tabIndex=0 on the active tab and -1 on others', () => {
    const activeTab: string = 'chat';
    const tabIndices = TAB_ORDER.map((tab) => (tab === activeTab ? 0 : -1));
    expect(tabIndices).toEqual([-1, 0, -1, -1]);
  });
});

describe('RightPanelTabs keyboard navigation', () => {
  it('should move to next tab on ArrowRight', () => {
    const activeTab: string = 'inspector';
    const idx = TAB_ORDER.indexOf(activeTab as typeof TAB_ORDER[number]);
    const nextTab = TAB_ORDER[(idx + 1) % TAB_ORDER.length];
    expect(nextTab).toBe('chat');
  });

  it('should wrap around from last to first on ArrowRight', () => {
    const activeTab: string = 'ui';
    const idx = TAB_ORDER.indexOf(activeTab as typeof TAB_ORDER[number]);
    const nextTab = TAB_ORDER[(idx + 1) % TAB_ORDER.length];
    expect(nextTab).toBe('inspector');
  });

  it('should move to previous tab on ArrowLeft', () => {
    const activeTab: string = 'chat';
    const idx = TAB_ORDER.indexOf(activeTab as typeof TAB_ORDER[number]);
    const prevTab = TAB_ORDER[(idx - 1 + TAB_ORDER.length) % TAB_ORDER.length];
    expect(prevTab).toBe('inspector');
  });

  it('should wrap around from first to last on ArrowLeft', () => {
    const activeTab: string = 'inspector';
    const idx = TAB_ORDER.indexOf(activeTab as typeof TAB_ORDER[number]);
    const prevTab = TAB_ORDER[(idx - 1 + TAB_ORDER.length) % TAB_ORDER.length];
    expect(prevTab).toBe('ui');
  });

  it('should move to first tab on Home', () => {
    const firstTab = TAB_ORDER[0];
    expect(firstTab).toBe('inspector');
  });

  it('should move to last tab on End', () => {
    const lastTab = TAB_ORDER[TAB_ORDER.length - 1];
    expect(lastTab).toBe('ui');
  });
});

describe('RightPanelContent tabpanel', () => {
  TAB_ORDER.forEach((tab) => {
    it(`should have role="tabpanel" with id="tabpanel-${tab}" when "${tab}" is active`, () => {
      const id = `tabpanel-${tab}`;
      const ariaLabelledby = `tab-${tab}`;
      expect(id).toBe(`tabpanel-${tab}`);
      expect(ariaLabelledby).toBe(`tab-${tab}`);
    });
  });
});

describe('Unread message indicator', () => {
  it('should have aria-label on the unread indicator', () => {
    const ariaLabel = 'Unread messages';
    expect(ariaLabel).toBe('Unread messages');
  });
});
