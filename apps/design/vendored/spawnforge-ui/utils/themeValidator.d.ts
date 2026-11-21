import type { ThemeTokens } from '../tokens';
declare const _validated: unique symbol;
export interface ValidatedTheme {
    /** @internal Branding field — do NOT read or set. Created only by validateCustomTheme(). */
    readonly [_validated]: true;
    schemaVersion: number;
    name: string;
    author: string;
    description: string;
    tokens: Partial<ThemeTokens>;
}
type ValidationResult = {
    ok: true;
    theme: ValidatedTheme;
} | {
    ok: false;
    error: string;
};
export declare function validateCustomTheme(input: unknown, options?: {
    byteSize?: number;
}): ValidationResult;
export {};
