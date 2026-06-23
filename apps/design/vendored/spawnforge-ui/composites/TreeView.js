import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { useState, useCallback, useMemo } from 'react';
import { cn } from '../utils/cn';
function TreeItem({ node, depth, selectedId, expandedIds, onSelect, onToggleExpand, }) {
    const hasChildren = node.children && node.children.length > 0;
    const isExpanded = expandedIds.has(node.id);
    const isSelected = selectedId === node.id;
    const handleKeyDown = (e) => {
        if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            onSelect?.(node.id);
        }
        else if (e.key === 'ArrowRight' && hasChildren && !isExpanded) {
            e.preventDefault();
            onToggleExpand(node.id);
        }
        else if (e.key === 'ArrowLeft' && hasChildren && isExpanded) {
            e.preventDefault();
            onToggleExpand(node.id);
        }
    };
    return (_jsxs("div", { role: "treeitem", "aria-expanded": hasChildren ? isExpanded : undefined, "aria-selected": isSelected, children: [_jsxs("div", { role: "button", tabIndex: 0, onClick: () => onSelect?.(node.id), onKeyDown: handleKeyDown, className: cn('flex items-center gap-1 px-2 py-1 cursor-pointer text-xs rounded', 'transition-colors duration-100'), style: {
                    paddingLeft: `${depth * 16 + 8}px`,
                    backgroundColor: isSelected ? 'var(--sf-bg-elevated)' : 'transparent',
                    color: isSelected ? 'var(--sf-text)' : 'var(--sf-text-secondary)',
                }, children: [hasChildren && (_jsx("button", { type: "button", onClick: (e) => {
                            e.stopPropagation();
                            onToggleExpand(node.id);
                        }, "aria-label": isExpanded ? `Collapse ${node.label}` : `Expand ${node.label}`, className: "w-4 h-4 flex items-center justify-center shrink-0", style: { color: 'var(--sf-text-muted)' }, children: _jsx("svg", { width: "10", height: "10", viewBox: "0 0 10 10", className: cn('transition-transform duration-100', isExpanded && 'rotate-90'), children: _jsx("path", { d: "M3 1 L7 5 L3 9", fill: "none", stroke: "currentColor", strokeWidth: "1.5" }) }) })), !hasChildren && _jsx("span", { className: "w-4 shrink-0" }), node.icon && _jsx("span", { className: "shrink-0", children: node.icon }), _jsx("span", { className: "truncate", children: node.label })] }), hasChildren && isExpanded && (_jsx("div", { role: "group", children: node.children.map((child) => (_jsx(TreeItem, { node: child, depth: depth + 1, selectedId: selectedId, expandedIds: expandedIds, onSelect: onSelect, onToggleExpand: onToggleExpand }, child.id))) }))] }));
}
export function TreeView({ nodes, selectedId, onSelect, expandedIds: controlledExpandedIds, onToggleExpand: controlledOnToggle, className, }) {
    const isControlled = controlledExpandedIds !== undefined && controlledOnToggle !== undefined;
    const [internalExpanded, setInternalExpanded] = useState(() => controlledExpandedIds ? new Set(controlledExpandedIds) : new Set());
    const expandedSet = useMemo(() => isControlled ? new Set(controlledExpandedIds) : internalExpanded, [isControlled, controlledExpandedIds, internalExpanded]);
    const handleToggle = useCallback((id) => {
        if (isControlled) {
            controlledOnToggle(id);
        }
        else {
            setInternalExpanded((prev) => {
                const next = new Set(prev);
                if (next.has(id)) {
                    next.delete(id);
                }
                else {
                    next.add(id);
                }
                return next;
            });
        }
    }, [isControlled, controlledOnToggle]);
    return (_jsx("div", { role: "tree", className: cn('text-xs', className), style: { color: 'var(--sf-text)' }, children: nodes.map((node) => (_jsx(TreeItem, { node: node, depth: 0, selectedId: selectedId, expandedIds: expandedSet, onSelect: onSelect, onToggleExpand: handleToggle }, node.id))) }));
}
