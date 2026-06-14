---
"web": patch
---

Mount `useScriptRunner` in the editor canvas so user entity scripts actually run when the game enters Play mode. The hook that registers the per-frame play-tick callback was never mounted by any component, so pressing Play rendered the scene but executed none of the user's scripts. The hook self-gates on `engineMode === 'play'`, so it stays inert in Edit mode.
