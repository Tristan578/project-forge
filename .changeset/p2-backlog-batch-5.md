---
'web': patch
---

fix: wire AccessibilityPanel toggles to engine and add tests for 9 untested lib files

- AccessibilityPanel: colorblind simulation now applies CSS filter to game canvas,
  screen reader/input remapping settings persist to Zustand store, input remappings
  dispatch set_input_binding to engine (#8207)
- Tests: cloudSave, userMessages, chat/search, constants, perf/baselines,
  wasm/preloadHint, pacingAnalyzer, executor shared helpers, sandboxGlobals (#8218)
