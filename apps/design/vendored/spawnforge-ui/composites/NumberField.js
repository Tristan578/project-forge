import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { useId, useState } from 'react';
import { cn } from '../utils/cn';
/**
 * A labelled numeric input row. The visible `label` is associated with the
 * `<input>` through a matching `htmlFor`/`id` pair (caller ID or `useId`), so it has
 * a programmatic accessible name (`getByLabelText(label)` resolves to it) rather
 * than a visual label sitting next to an unassociated input.
 *
 * This replaces the bespoke `NumberInputRow` that both the Reverb Zone and Audio
 * inspectors previously carried verbatim, closing the duplication-with-drift the
 * copies had already fallen into (one gained label association, the other did
 * not). Consumers that need a help tooltip compose it alongside this composite.
 * Empty drafts remain editable without dispatching; blur restores the committed
 * value and also invokes a caller-provided blur handler.
 * @param props Controlled value/callback, label, bounds and native input attributes.
 * @returns A labelled numeric editor that retains raw drafts while editing.
 */
export function NumberField({ label, value, onChange, min, max, step = 0.1, className, disabled, id: providedId, onBlur, ...props }) {
    const generatedId = useId();
    const id = providedId ?? generatedId;
    // Buffer the in-flight edit as a raw string so the field can be cleared and
    // retyped. Two failures are fixed together: (1) forwarding parseFloat('') as
    // NaN to onChange — an unguarded number that flows into the store and
    // serializes to null in exported scene data — and (2) re-deriving the input's
    // value from the committed number every keystroke, which (with the NaN guard
    // added) would otherwise make the field impossible to clear because the empty
    // intermediate state never reaches state and the input snaps back. The draft
    // renders verbatim while editing; only a finite parse commits to onChange.
    const [draft, setDraft] = useState(null);
    const handleChange = (e) => {
        const raw = e.target.value;
        setDraft(raw);
        const parsed = parseFloat(raw);
        if (Number.isFinite(parsed)) {
            const clamped = Math.min(max ?? Infinity, Math.max(min ?? -Infinity, parsed));
            onChange(clamped);
        }
    };
    const displayValue = draft !== null ? draft : String(value);
    return (_jsxs("div", { className: cn('flex items-center gap-2', className), children: [_jsx("label", { htmlFor: id, className: "w-20 shrink-0 text-xs font-medium", style: { color: 'var(--sf-text-secondary)' }, children: label }), _jsx("input", { id: id, type: "number", value: displayValue, min: min, max: max, step: step, disabled: disabled, onChange: handleChange, onBlur: (event) => {
                    setDraft(null);
                    onBlur?.(event);
                }, className: cn('flex-1 min-w-0 rounded px-2 py-1 text-xs outline-none focus:ring-1', 'disabled:opacity-50 disabled:cursor-not-allowed'), style: {
                    backgroundColor: 'var(--sf-bg-elevated)',
                    color: 'var(--sf-text)',
                    borderRadius: 'var(--sf-radius-sm)',
                }, ...props })] }));
}
