'use client';
import { jsx as _jsx } from "react/jsx-runtime";
import { lazy, Suspense, useState, useEffect } from 'react';
import { Z_INDEX } from '../tokens';
import './effects.css';
const EmberGlow = lazy(() => import('./EmberGlow'));
const IceFrost = lazy(() => import('./IceFrost'));
const LeafDrift = lazy(() => import('./LeafDrift'));
const RustGears = lazy(() => import('./RustGears'));
const MechScanlines = lazy(() => import('./MechScanlines'));
const LightRays = lazy(() => import('./LightRays'));
const EFFECT_MAP = {
    ember: EmberGlow,
    ice: IceFrost,
    leaf: LeafDrift,
    rust: RustGears,
    mech: MechScanlines,
    light: LightRays,
    // dark: no effect
};
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
export function ThemeAmbient() {
    const [reducedMotion, setReducedMotion] = useState(false);
    const [effectsOff, setEffectsOff] = useState(false);
    const [theme, setTheme] = useState('dark');
    // Subscribe to prefers-reduced-motion changes
    useEffect(() => {
        const mql = window.matchMedia('(prefers-reduced-motion: reduce)');
        setReducedMotion(mql.matches);
        const handler = (e) => setReducedMotion(e.matches);
        mql.addEventListener('change', handler);
        return () => mql.removeEventListener('change', handler);
    }, []);
    // Observe data-sf-effects + data-sf-theme attribute changes.
    // Batch both state updates in a single MutationObserver callback to prevent
    // a race where matchMedia fires between the two separate setX() calls.
    // React 18 batches these automatically inside event handlers, but MutationObserver
    // callbacks are microtasks — reading both attributes at once avoids any
    // intermediate render with mismatched state.
    useEffect(() => {
        const root = document.documentElement;
        function syncFromDOM() {
            const isEffectsOff = root.getAttribute('data-sf-effects') === 'off';
            const currentTheme = (root.getAttribute('data-sf-theme') ?? 'dark');
            setEffectsOff(isEffectsOff);
            setTheme(currentTheme);
        }
        // Read initial state
        syncFromDOM();
        const observer = new MutationObserver(syncFromDOM);
        observer.observe(root, {
            attributes: true,
            attributeFilter: ['data-sf-effects', 'data-sf-theme'],
        });
        return () => observer.disconnect();
    }, []);
    if (reducedMotion || effectsOff)
        return null;
    const EffectComponent = EFFECT_MAP[theme];
    if (!EffectComponent)
        return null;
    return (_jsx("div", { "data-sf-effect": theme, className: "pointer-events-none fixed inset-0", style: { zIndex: Z_INDEX.effects }, "aria-hidden": "true", children: _jsx(Suspense, { fallback: null, children: _jsx(EffectComponent, {}) }) }));
}
