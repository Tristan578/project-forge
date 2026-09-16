import { describe, it, expect, vi } from 'vitest';
import { useState } from 'react';
import { render, screen, fireEvent, createEvent } from '@testing-library/react';
import { Tabs } from '../Tabs';
import { THEME_NAMES } from '../../tokens';

const tabs = [
  { id: 'tab1', label: 'Tab 1', content: <div>Content 1</div> },
  { id: 'tab2', label: 'Tab 2', content: <div>Content 2</div> },
  { id: 'tab3', label: 'Tab 3', content: <div>Content 3</div> },
];

describe('Tabs', () => {
  it('renders tab labels', () => {
    render(<Tabs tabs={tabs} activeTab="tab1" onChange={vi.fn()} />);
    expect(screen.getByText('Tab 1')).not.toBeNull();
    expect(screen.getByText('Tab 2')).not.toBeNull();
    expect(screen.getByText('Tab 3')).not.toBeNull();
  });

  it('shows content of active tab', () => {
    render(<Tabs tabs={tabs} activeTab="tab1" onChange={vi.fn()} />);
    expect(screen.getByText('Content 1')).not.toBeNull();
  });

  it('calls onChange when tab is clicked', () => {
    const onChange = vi.fn();
    render(<Tabs tabs={tabs} activeTab="tab1" onChange={onChange} />);
    fireEvent.click(screen.getByText('Tab 2'));
    expect(onChange).toHaveBeenCalledWith('tab2');
  });

  it('marks active tab with aria-selected', () => {
    render(<Tabs tabs={tabs} activeTab="tab2" onChange={vi.fn()} />);
    const tab2 = screen.getByRole('tab', { name: 'Tab 2' });
    expect(tab2.getAttribute('aria-selected')).toBe('true');
  });

  it('navigates tabs with arrow keys', () => {
    const onChange = vi.fn();
    render(<Tabs tabs={tabs} activeTab="tab1" onChange={onChange} />);
    const tabList = screen.getByRole('tablist');
    fireEvent.keyDown(tabList, { key: 'ArrowRight' });
    expect(onChange).toHaveBeenCalledWith('tab2');
  });

  it.each([
    { initial: 'tab1', key: 'ArrowRight', next: 'Tab 2', content: 'Content 2' },
    { initial: 'tab3', key: 'ArrowRight', next: 'Tab 1', content: 'Content 1' },
    { initial: 'tab2', key: 'ArrowLeft', next: 'Tab 1', content: 'Content 1' },
    { initial: 'tab1', key: 'ArrowLeft', next: 'Tab 3', content: 'Content 3' },
    { initial: 'tab2', key: 'Home', next: 'Tab 1', content: 'Content 1' },
    { initial: 'tab2', key: 'End', next: 'Tab 3', content: 'Content 3' },
  ])('moves focus and selection together for $key from $initial', ({ initial, key, next, content }) => {
    function ControlledTabs() {
      const [activeTab, setActiveTab] = useState(initial);
      return <Tabs tabs={tabs} activeTab={activeTab} onChange={setActiveTab} />;
    }
    render(<ControlledTabs />);
    const selected = screen.getByRole('tab', { selected: true });
    selected.focus();
    const event = createEvent.keyDown(selected, { key });

    fireEvent(selected, event);

    const nextTab = screen.getByRole('tab', { name: next });
    expect(document.activeElement).toBe(nextTab);
    expect(nextTab.getAttribute('aria-selected')).toBe('true');
    expect(nextTab.tabIndex).toBe(0);
    expect(screen.getByRole('tabpanel').textContent).toBe(content);
    expect(event.defaultPrevented).toBe(true);
  });

  it('leaves ordinary Tab navigation to the browser', () => {
    const onChange = vi.fn();
    render(<Tabs tabs={tabs} activeTab="tab1" onChange={onChange} />);
    const selected = screen.getByRole('tab', { selected: true });
    const event = createEvent.keyDown(selected, { key: 'Tab' });

    fireEvent(selected, event);

    expect(event.defaultPrevented).toBe(false);
    expect(onChange).not.toHaveBeenCalled();
  });

  it.each(THEME_NAMES)('renders without error in %s theme', (theme) => {
    document.documentElement.setAttribute('data-sf-theme', theme);
    const { container } = render(
      <Tabs tabs={tabs} activeTab="tab1" onChange={vi.fn()} />
    );
    expect(container.querySelector('[role="tablist"]')).not.toBeNull();
    const allClasses = Array.from(container.querySelectorAll('[class]'))
      .flatMap((el) => el.className.split(' '));
    const leaks = allClasses.filter((c) => /zinc-|stone-|slate-/.test(c));
    expect(leaks, `Hardcoded primitives found: ${leaks.join(', ')}`).toHaveLength(0);
  });
});
