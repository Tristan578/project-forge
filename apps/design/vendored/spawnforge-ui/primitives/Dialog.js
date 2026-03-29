import { jsx as _jsx, jsxs as _jsxs, Fragment as _Fragment } from "react/jsx-runtime";
import { cn } from '../utils/cn';
import { useDialogA11y } from '../hooks/useDialogA11y';
import { Z_INDEX } from '../tokens';
export function Dialog({ open, onClose, title, description, children, actions, className }) {
    const { dialogProps, titleProps } = useDialogA11y({ title, isOpen: open, onClose });
    if (!open)
        return null;
    return (_jsxs(_Fragment, { children: [_jsx("div", { "data-dialog-overlay": true, className: "fixed inset-0 bg-[var(--sf-bg-app)]/80 backdrop-blur-sm", style: { zIndex: Z_INDEX.modals - 1 }, onClick: onClose, "aria-hidden": "true" }), _jsxs("div", { ...dialogProps, tabIndex: -1, className: cn('fixed', 'w-full max-w-md', 'rounded-[var(--sf-radius-lg)]', 'border border-[length:var(--sf-border-width)] border-[var(--sf-border)]', 'bg-[var(--sf-bg-surface)] text-[var(--sf-text)]', 'shadow-lg', 'p-6', 'flex flex-col gap-4', className), style: { zIndex: Z_INDEX.modals, left: '50%', top: '50%', transform: 'translate(-50%, -50%)' }, children: [_jsxs("div", { children: [_jsx("h2", { ...titleProps, className: "text-lg font-semibold", children: title }), description && (_jsx("p", { className: "mt-1 text-sm text-[var(--sf-text-secondary)]", children: description }))] }), children && _jsx("div", { className: "text-sm", children: children }), actions && (_jsx("div", { className: "flex justify-end gap-2 pt-2", children: actions }))] })] }));
}
