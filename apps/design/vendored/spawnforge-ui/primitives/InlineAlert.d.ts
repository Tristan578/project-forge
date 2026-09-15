import { type HTMLAttributes, type ReactNode } from "react";
export type InlineAlertVariant = "warning" | "error" | "info";
export interface InlineAlertProps extends HTMLAttributes<HTMLDivElement> {
    /**
     * Severity of the notice. Drives both colour tokens and the ARIA role:
     * `error` is assertive (`role="alert"`); `warning` and `info` are polite
     * (`role="status"`).
     */
    variant?: InlineAlertVariant;
    children: ReactNode;
}
/**
 * Inline warning / error / info notice box (#9726). One token-driven primitive
 * for the editor's bespoke amber/yellow warning boxes so they look and behave
 * the same everywhere. Accepts any HTML div attributes (e.g. `id` for
 * `aria-describedby` wiring); the ARIA role is derived from `variant` and is
 * not overridable, so the severity contract always holds.
 */
export declare function InlineAlert({ variant, className, children, ...props }: InlineAlertProps): import("react").JSX.Element;
export declare namespace InlineAlert {
    var displayName: string;
}
