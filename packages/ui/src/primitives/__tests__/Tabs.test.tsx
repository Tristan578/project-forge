import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
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
