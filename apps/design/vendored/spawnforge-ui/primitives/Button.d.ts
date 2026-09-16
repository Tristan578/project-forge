/** Shared button variants, sizing, keyboard focus and disabled interaction states. */
import { type ButtonHTMLAttributes } from 'react';
/** Native button attributes with library variants and sizes. */
export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
    /** Visual treatment; defaults to the primary filled button. */
    variant?: 'default' | 'destructive' | 'outline' | 'ghost';
    /** Spacing and type scale; defaults to md. Small buttons retain a 44px mobile target. */
    size?: 'sm' | 'md' | 'lg';
}
/**
 * Renders a native button with shared focus, disabled and variant styling.
 * Outline text retains the primary foreground at rest and hover so normal-sized
 * labels remain readable on both surface and elevated backgrounds.
 * @param props Native button attributes, children and optional variant/size.
 * @returns A button whose forwarded ref points to its native element.
 */
export declare const Button: import("react").ForwardRefExoticComponent<ButtonProps & import("react").RefAttributes<HTMLButtonElement>>;
