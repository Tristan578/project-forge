import { jsx as _jsx } from "react/jsx-runtime";
import { forwardRef } from 'react';
import { cn } from '../utils/cn';
export const Input = forwardRef(({ className, error, ...props }, ref) => {
    return (_jsx("input", { ref: ref, className: cn('flex h-9 w-full', 'rounded-[var(--sf-radius-md)]', 'border border-[length:var(--sf-border-width)]', error
            ? 'border-[var(--sf-destructive)]'
            : 'border-[var(--sf-border)]', 'bg-[var(--sf-bg-surface)] text-[var(--sf-text)]', 'px-3 py-1 text-sm', 'placeholder:text-[var(--sf-text-muted)]', 'transition-colors duration-[var(--sf-transition)]', 'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--sf-accent)]', 'disabled:opacity-50 disabled:cursor-not-allowed', className), ...props }));
});
Input.displayName = 'Input';
