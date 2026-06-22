import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { cn } from '../utils/cn';
export function PropertyGrid({ items, labelWidth = '100px', className, }) {
    return (_jsx("div", { className: cn('flex flex-col', className), role: "group", "aria-label": "Properties", children: items.map((item, index) => (_jsxs("div", { className: "flex items-start gap-2 py-1.5 px-2", style: {
                borderBottom: index < items.length - 1 ? '1px solid var(--sf-border)' : undefined,
            }, children: [_jsx("span", { className: "shrink-0 text-xs font-medium truncate", style: {
                        width: labelWidth,
                        color: 'var(--sf-text-secondary)',
                    }, children: item.label }), _jsx("div", { className: "flex-1 min-w-0 text-xs", style: { color: 'var(--sf-text)' }, children: item.value })] }, item.id ?? index))) }));
}
