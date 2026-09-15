---
"web": patch
"@spawnforge/ui": patch
---

Reverb Zone and Audio inspector controls now use the shared `@spawnforge/ui` design-library composites instead of bespoke local copies. The slider, vector-axis and numeric-field controls each carry a properly associated accessible name, so screen-reader users hear a distinct label for every control. A new `NumberField` composite replaces the duplicated `NumberInputRow` that both inspectors carried verbatim, and the Audio inspector's Loop, Spatial and Autoplay checkboxes gain the same label association the Reverb Zone inspector already had.
