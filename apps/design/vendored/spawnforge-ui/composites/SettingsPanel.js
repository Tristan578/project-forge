'use client';
import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { useCallback, useState, useEffect, useRef } from 'react';
import { THEME_NAMES, THEME_DEFINITIONS } from '../tokens';
import { Switch } from '../primitives/Switch';
import { cn } from '../utils/cn';
function ThemeCard({ theme, isActive, isProjectTheme, showPerProjectCheckbox, onSelect, onProjectToggle, tabIndex, isFocused, }) {
    const tokens = THEME_DEFINITIONS[theme];
    const bg = tokens['--sf-bg-app'];
    const accent = tokens['--sf-accent'];
    const text = tokens['--sf-text'];
    return (_jsxs("div", { role: "radio", "aria-checked": isActive, tabIndex: tabIndex, "aria-label": theme, "data-sf-theme-card": theme, className: cn('relative flex flex-col gap-2 rounded-[var(--sf-radius-lg)] border p-3', 'cursor-pointer select-none transition-colors duration-[var(--sf-transition)]', isActive
            ? 'border-[var(--sf-accent)] ring-2 ring-[var(--sf-accent)] ring-offset-1 ring-offset-[var(--sf-bg-app)]'
            : 'border-[var(--sf-border)] hover:border-[var(--sf-border-strong)]', isFocused && 'outline-none ring-2 ring-[var(--sf-accent)]'), onClick: onSelect, onKeyDown: (e) => {
            if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                onSelect();
            }
        }, children: [_jsxs("div", { className: "flex gap-1 rounded-[var(--sf-radius-sm)] overflow-hidden h-8", "aria-hidden": "true", children: [_jsx("div", { className: "flex-1", style: { background: bg } }), _jsx("div", { className: "flex-1", style: { background: accent } }), _jsx("div", { className: "flex-1", style: { background: text } })] }), _jsx("span", { className: "text-[var(--sf-text)] text-xs font-medium capitalize", children: theme }), isActive && (_jsx("div", { className: "absolute top-2 right-2 flex h-4 w-4 items-center justify-center rounded-full bg-[var(--sf-accent)]", "aria-hidden": "true", children: _jsx("svg", { width: "8", height: "6", viewBox: "0 0 8 6", fill: "none", children: _jsx("path", { d: "M1 3L3 5L7 1", stroke: "white", strokeWidth: "1.5", strokeLinecap: "round", strokeLinejoin: "round" }) }) })), showPerProjectCheckbox && (_jsxs("label", { className: "flex items-center gap-1.5 text-[var(--sf-text-muted)] text-xs cursor-pointer", onClick: (e) => e.stopPropagation(), children: [_jsx("input", { type: "checkbox", checked: isProjectTheme, onChange: (e) => onProjectToggle(e.target.checked), className: "rounded border-[var(--sf-border)] accent-[var(--sf-accent)]", "aria-label": `Set ${theme} as project theme` }), "Project"] }))] }));
}
export function SettingsPanel({ currentTheme, onThemeChange, effectsEnabled, onEffectsChange, showPerProjectCheckbox = false, projectTheme, onProjectThemeChange, className, }) {
    const [focusedIndex, setFocusedIndex] = useState(-1);
    const [reducedMotion, setReducedMotion] = useState(false);
    const gridRef = useRef(null);
    useEffect(() => {
        const mql = window.matchMedia('(prefers-reduced-motion: reduce)');
        setReducedMotion(mql.matches);
        const handler = (e) => setReducedMotion(e.matches);
        mql.addEventListener('change', handler);
        return () => mql.removeEventListener('change', handler);
    }, []);
    const handleKeyDown = useCallback((e) => {
        const count = THEME_NAMES.length;
        if (e.key === 'ArrowRight' || e.key === 'ArrowDown') {
            e.preventDefault();
            setFocusedIndex((prev) => (prev + 1) % count);
        }
        else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') {
            e.preventDefault();
            setFocusedIndex((prev) => (prev - 1 + count) % count);
        }
        else if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            if (focusedIndex >= 0 && focusedIndex < count) {
                onThemeChange(THEME_NAMES[focusedIndex]);
            }
        }
    }, [focusedIndex, onThemeChange]);
    return (_jsxs("section", { className: cn('space-y-4', className), "aria-labelledby": "theme-switcher-label", children: [_jsx("h3", { id: "theme-switcher-label", className: "text-[var(--sf-text-secondary)] text-xs font-semibold uppercase tracking-wide", children: "Theme" }), _jsx("div", { ref: gridRef, role: "radiogroup", "aria-label": "Select theme", className: "grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4", onKeyDown: handleKeyDown, children: THEME_NAMES.map((theme, i) => (_jsx(ThemeCard, { theme: theme, isActive: currentTheme === theme, isProjectTheme: projectTheme === theme, showPerProjectCheckbox: showPerProjectCheckbox, onSelect: () => {
                        setFocusedIndex(i);
                        onThemeChange(theme);
                    }, onProjectToggle: (checked) => {
                        onProjectThemeChange?.(checked ? theme : null);
                    }, tabIndex: i === 0 ? 0 : -1, isFocused: focusedIndex === i }, theme))) }), _jsxs("div", { className: "flex items-center justify-between", children: [_jsxs("label", { className: "text-[var(--sf-text)] text-sm", children: ["Ambient effects", reducedMotion && (_jsx("span", { className: "ml-2 text-[var(--sf-text-muted)] text-xs", children: "(disabled by system)" }))] }), _jsx(Switch, { checked: effectsEnabled && !reducedMotion, onChange: (e) => onEffectsChange(e.target.checked), disabled: reducedMotion, label: "Toggle ambient effects" })] })] }));
}
