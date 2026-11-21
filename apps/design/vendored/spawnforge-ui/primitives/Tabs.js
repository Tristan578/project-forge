import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { cn } from "../utils/cn";
export function Tabs({ tabs, activeTab, onChange, className }) {
    const activeIndex = tabs.findIndex((t) => t.id === activeTab);
    function handleKeyDown(e) {
        if (e.key === "ArrowRight") {
            const next = (activeIndex + 1) % tabs.length;
            onChange(tabs[next].id);
        }
        else if (e.key === "ArrowLeft") {
            const prev = (activeIndex - 1 + tabs.length) % tabs.length;
            onChange(tabs[prev].id);
        }
        else if (e.key === "Home") {
            onChange(tabs[0].id);
        }
        else if (e.key === "End") {
            onChange(tabs[tabs.length - 1].id);
        }
    }
    return (_jsxs("div", { className: cn("w-full", className), children: [_jsx("div", { role: "tablist", onKeyDown: handleKeyDown, className: cn("flex gap-0.5", "bg-[var(--sf-bg-app)] p-1", "rounded-[var(--sf-radius-md)]", "border border-[var(--sf-border)]"), children: tabs.map((tab) => {
                    const isActive = tab.id === activeTab;
                    return (_jsx("button", { role: "tab", id: `tab-${tab.id}`, "aria-selected": isActive, "aria-controls": `tabpanel-${tab.id}`, tabIndex: isActive ? 0 : -1, onClick: () => onChange(tab.id), className: cn("flex-1 px-3 py-1.5 text-sm font-medium", "rounded-[calc(var(--sf-radius-md)_-_2px)]", "transition-all duration-[var(--sf-transition)]", "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--sf-accent)]", "select-none", isActive
                            ? "bg-[var(--sf-bg-elevated)] text-[var(--sf-text)] shadow-[0_1px_3px_rgba(0,0,0,0.3),inset_0_-2px_0_var(--sf-accent),inset_0_1px_0_rgba(255,255,255,0.05)]"
                            : "text-[var(--sf-text-muted)] hover:text-[var(--sf-text-secondary)] hover:bg-[var(--sf-bg-surface)]"), children: tab.label }, tab.id));
                }) }), tabs.map((tab) => (_jsx("div", { id: `tabpanel-${tab.id}`, role: "tabpanel", "aria-labelledby": `tab-${tab.id}`, hidden: tab.id !== activeTab, className: "py-4", children: tab.content }, tab.id)))] }));
}
Tabs.displayName = "Tabs";
