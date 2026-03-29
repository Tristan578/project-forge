import './effects.css';
/**
 * ThemeAmbient — CSS-only ambient effect router.
 *
 * Reads `data-sf-theme` and `data-sf-effects` from `document.documentElement`,
 * then lazily renders the matching effect component.
 *
 * Rules:
 * - Dark theme → no effect
 * - `data-sf-effects="off"` → no effect
 * - `prefers-reduced-motion: reduce` → no effect
 *
 * NOTE: This component MUST be imported with next/dynamic({ ssr: false })
 * in the main app to avoid hydration mismatch (server renders null,
 * client reads data-sf-theme from DOM).
 *
 * Example in EditorLayout.tsx:
 *   const ThemeAmbient = dynamic(
 *     () => import('@spawnforge/ui').then(m => ({ default: m.ThemeAmbient })),
 *     { ssr: false }
 *   );
 */
export declare function ThemeAmbient(): import("react/jsx-runtime").JSX.Element | null;
