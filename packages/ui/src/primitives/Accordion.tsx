import { useState, type ReactNode } from "react";
import { cn } from "../utils/cn";

export interface AccordionItem {
  id: string;
  title: string;
  content: ReactNode;
}

export interface AccordionProps {
  items: AccordionItem[];
  defaultOpen?: string;
  className?: string;
}

export function Accordion({ items, defaultOpen, className }: AccordionProps) {
  const [openId, setOpenId] = useState<string | null>(defaultOpen ?? null);

  function toggle(id: string) {
    setOpenId((current) => (current === id ? null : id));
  }

  return (
    <div
      className={cn(
        "w-full",
        "divide-y divide-[var(--sf-border)]",
        "rounded-[var(--sf-radius-lg)]",
        "border border-[var(--sf-border)]",
        "bg-[var(--sf-bg-surface)]",
        "shadow-[0_1px_4px_rgba(0,0,0,0.2)]",
        "overflow-hidden",
        className
      )}
    >
      {items.map((item) => {
        const isOpen = openId === item.id;
        return (
          <div key={item.id}>
            <button
              type="button"
              aria-expanded={isOpen}
              aria-controls={`accordion-content-${item.id}`}
              id={`accordion-trigger-${item.id}`}
              onClick={() => toggle(item.id)}
              className={cn(
                "flex w-full items-center justify-between",
                "px-4 py-3 text-sm font-medium text-left",
                "text-[var(--sf-text)]",
                "hover:bg-[var(--sf-bg-elevated)]",
                "transition-all duration-[var(--sf-transition)]",
                "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[var(--sf-accent)]",
                isOpen &&
                  "bg-[color-mix(in_srgb,var(--sf-accent)_5%,var(--sf-bg-app))]"
              )}
            >
              <span>{item.title}</span>
              <svg
                xmlns="http://www.w3.org/2000/svg"
                width="16"
                height="16"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
                className={cn(
                  "shrink-0",
                  "transition-all duration-200 ease-out",
                  isOpen
                    ? "rotate-180 text-[var(--sf-accent)]"
                    : "text-[var(--sf-text-muted)]"
                )}
                aria-hidden="true"
              >
                <path d="m6 9 6 6 6-6" />
              </svg>
            </button>
            <div
              id={`accordion-content-${item.id}`}
              role="region"
              aria-labelledby={`accordion-trigger-${item.id}`}
              hidden={!isOpen}
              className="px-4 pb-3 text-sm text-[var(--sf-text-secondary)] leading-relaxed"
            >
              {item.content}
            </div>
          </div>
        );
      })}
    </div>
  );
}

Accordion.displayName = "Accordion";
