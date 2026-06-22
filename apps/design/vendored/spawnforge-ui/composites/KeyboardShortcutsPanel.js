import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { useState } from 'react';
import { cn } from '../utils/cn';
function Kbd({ children }) {
    return (_jsx("kbd", { className: "inline-flex items-center justify-center min-w-[24px] h-6 px-1.5 rounded text-xs font-mono", style: {
            backgroundColor: 'var(--sf-bg-elevated)',
            color: 'var(--sf-text)',
            border: '1px solid var(--sf-border-strong)',
            borderRadius: 'var(--sf-radius-sm)',
        }, children: children }));
}
export function KeyboardShortcutsPanel({ groups, onClose, className, }) {
    const [searchQuery, setSearchQuery] = useState('');
    const filteredGroups = groups
        .map((group) => ({
        ...group,
        shortcuts: group.shortcuts.filter((s) => s.label.toLowerCase().includes(searchQuery.toLowerCase()) ||
            s.keys.some((k) => k.toLowerCase().includes(searchQuery.toLowerCase()))),
    }))
        .filter((group) => group.shortcuts.length > 0);
    return (_jsxs("div", { className: cn('flex flex-col', className), style: {
            backgroundColor: 'var(--sf-bg-surface)',
            color: 'var(--sf-text)',
        }, children: [_jsxs("div", { className: "flex items-center justify-between px-4 py-3 border-b", style: { borderColor: 'var(--sf-border)' }, children: [_jsx("h2", { className: "text-sm font-medium", children: "Keyboard Shortcuts" }), onClose && (_jsx("button", { type: "button", onClick: onClose, "aria-label": "Close keyboard shortcuts", className: "p-1 rounded transition-colors", style: { color: 'var(--sf-text-muted)' }, children: _jsx("svg", { width: "14", height: "14", viewBox: "0 0 14 14", children: _jsx("path", { d: "M3 3 L11 11 M11 3 L3 11", stroke: "currentColor", strokeWidth: "1.5" }) }) }))] }), _jsx("div", { className: "px-4 py-2", children: _jsx("input", { type: "text", placeholder: "Search shortcuts...", value: searchQuery, onChange: (e) => setSearchQuery(e.target.value), "aria-label": "Search keyboard shortcuts", className: cn('w-full rounded px-2.5 py-1.5 text-xs outline-none focus:ring-1'), style: {
                        backgroundColor: 'var(--sf-bg-elevated)',
                        color: 'var(--sf-text)',
                        borderRadius: 'var(--sf-radius-md)',
                    } }) }), _jsxs("div", { className: "flex-1 overflow-y-auto px-4 py-2", children: [filteredGroups.map((group) => (_jsxs("div", { className: "mb-4", children: [_jsx("h3", { className: "text-xs font-medium uppercase mb-2", style: { color: 'var(--sf-text-muted)' }, children: group.title }), _jsx("div", { className: "space-y-1.5", children: group.shortcuts.map((shortcut) => (_jsxs("div", { className: "flex items-center justify-between py-1", children: [_jsx("span", { className: "text-xs", style: { color: 'var(--sf-text-secondary)' }, children: shortcut.label }), _jsx("div", { className: "flex items-center gap-1", children: shortcut.keys.map((key, i) => (_jsx(Kbd, { children: key }, i))) })] }, shortcut.id))) })] }, group.title))), filteredGroups.length === 0 && (_jsxs("p", { className: "text-xs text-center py-4", style: { color: 'var(--sf-text-muted)' }, children: ["No shortcuts match \u201C", searchQuery, "\u201D"] }))] })] }));
}
