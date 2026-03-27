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
          'flex',
          'border-b border-[length:var(--sf-border-width)] border-[var(--sf-border)]',
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
                'px-4 py-2 text-sm font-medium',
                'border-b-2 -mb-px',
                'transition-colors duration-[var(--sf-transition)]',
                'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--sf-accent)]',
                isActive
                  ? 'border-[var(--sf-accent)] text-[var(--sf-accent)]'
                  : 'border-transparent text-[var(--sf-text-secondary)] hover:text-[var(--sf-text)] hover:border-[var(--sf-border-strong)]',
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
