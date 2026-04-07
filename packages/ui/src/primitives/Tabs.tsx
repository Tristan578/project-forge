import { type ReactNode, type KeyboardEvent } from 'react';
import { cn } from '../utils/cn';

export interface TabItem {
  id: string;
  label: string;
  content: ReactNode;
}

export interface TabsProps {
  tabs: TabItem[];
  activeTab: string;
  onChange: (tabId: string) => void;
  className?: string;
}

export function Tabs({ tabs, activeTab, onChange, className }: TabsProps) {
  const activeIndex = tabs.findIndex((t) => t.id === activeTab);

  function handleKeyDown(e: KeyboardEvent<HTMLDivElement>) {
    if (e.key === 'ArrowRight') {
      const next = (activeIndex + 1) % tabs.length;
      onChange(tabs[next].id);
    } else if (e.key === 'ArrowLeft') {
      const prev = (activeIndex - 1 + tabs.length) % tabs.length;
      onChange(tabs[prev].id);
    } else if (e.key === 'Home') {
      onChange(tabs[0].id);
    } else if (e.key === 'End') {
      onChange(tabs[tabs.length - 1].id);
    }
  }

  const activeTabContent = tabs.find((t) => t.id === activeTab)?.content;

  return (
    <div className={cn('w-full', className)}>
      {/* Tab list */}
      <div
        role="tablist"
        onKeyDown={handleKeyDown}
        className={cn(
          'flex gap-0.5',
          'bg-[var(--sf-bg-app)] p-1',
          'rounded-[var(--sf-radius-md)]',
          'border border-[var(--sf-border)]',
        )}
      >
        {tabs.map((tab) => {
          const isActive = tab.id === activeTab;
          return (
            <button
              key={tab.id}
              role="tab"
              id={`tab-${tab.id}`}
              aria-selected={isActive}
              aria-controls={`tabpanel-${tab.id}`}
              tabIndex={isActive ? 0 : -1}
              onClick={() => onChange(tab.id)}
              className={cn(
                'flex-1 px-3 py-1.5 text-sm font-medium',
                'rounded-[calc(var(--sf-radius-md)_-_2px)]',
                'transition-all duration-[var(--sf-transition)]',
                'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--sf-accent)]',
                'select-none',
                isActive
                  ? 'bg-[var(--sf-bg-elevated)] text-[var(--sf-text)] shadow-[0_1px_3px_rgba(0,0,0,0.3),inset_0_1px_0_rgba(255,255,255,0.05)]'
                  : 'text-[var(--sf-text-muted)] hover:text-[var(--sf-text-secondary)] hover:bg-[var(--sf-bg-surface)]',
              )}
            >
              {tab.label}
            </button>
          );
        })}
      </div>
      {/* Tab panels */}
      {tabs.map((tab) => (
        <div
          key={tab.id}
          id={`tabpanel-${tab.id}`}
          role="tabpanel"
          aria-labelledby={`tab-${tab.id}`}
          hidden={tab.id !== activeTab}
          className="py-4"
        >
          {tab.id === activeTab && activeTabContent}
        </div>
      ))}
    </div>
  );
}
