---
"@spawnforge/ui": patch
"web": patch
---

Add a status-colour semantic (healthy / degraded / down / unknown) to the design-system tokens as verified foreground/background pairs, and migrate the public `/health` dashboard onto them. The overall-status banner and its Refresh/Retry actions now use `@spawnforge/ui` tokens and the `Button` primitive instead of raw Tailwind palette literals, so the status page participates in the theme system and both action buttons show a visible keyboard focus ring (WCAG 2.4.7). Every status variant clears the WCAG AA 4.5:1 contrast floor for normal text (healthy 5.02:1, degraded 10.95:1, down 6.47:1, unknown 7.73:1), verified per theme in the token tests.
