import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { cn } from '../utils/cn';
export function Label({ className, required, children, ...props }) {
    return (_jsxs("label", { className: cn('text-sm font-medium text-[var(--sf-text)]', 'leading-none', 'peer-disabled:cursor-not-allowed peer-disabled:opacity-70', className), ...props, children: [children, required && (_jsx("span", { className: "ml-0.5 text-[var(--sf-destructive)]", "aria-hidden": "true", children: "*" }))] }));
}
