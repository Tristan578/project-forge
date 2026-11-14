---
"@spawnforge/ui": patch
"web": patch
---

Raise the `jsdom` test environment from 30.1.3 to 31.0.0. jsdom 31 resolves an undefined CSS custom property in `getComputedStyle` to the inherited color, so the SliderInput value test now reads the element's inline style to check it uses the `--sf-text-secondary` token. No runtime code changes.
