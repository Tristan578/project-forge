/** Shared inline notices with themed severity borders and backgrounds. */
import { type HTMLAttributes, type ReactNode } from "react";
/** Supported notice severities. */
export type InlineAlertVariant = "warning" | "error" | "info";
/** Notice content and div attributes, excluding the variant-controlled role. */
export interface InlineAlertProps extends Omit<HTMLAttributes<HTMLDivElement>, "role"> {
    /**
     * Severity of the notice. Drives both colour tokens and the ARIA role:
     * `error` is assertive (`role="alert"`); `warning` and `info` are polite
     * (`role="status"`). `role` itself is not a prop — it is always derived
     * from `variant` and cannot be overridden.
     */
    variant?: InlineAlertVariant;
    /** Required message content, which may include recovery controls. */
    children: ReactNode;
}
/**
 * Inline warning / error / info notice box (#9726). One token-driven primitive
 * for the editor's bespoke amber/yellow warning boxes so they look and behave
 * the same everywhere. Accepts HTML div attributes excluding `role` (e.g. `id` for
 * `aria-describedby` wiring); the ARIA role is derived from `variant` and is
 * not overridable. Explicit `aria-live` attributes retain normal HTML behavior.
 * Defaults to `warning`; severity colours the border/background, while body
 * text uses the theme foreground for readable contrast.
 * @param props - Message content, optional severity and supported div attributes.
 * @returns A themed div with the severity-derived alert or status role.
 */
export declare function InlineAlert({ variant, className, children, ...props }: InlineAlertProps): import("react").JSX.Element;
export declare namespace InlineAlert {
    var displayName: string;
}
