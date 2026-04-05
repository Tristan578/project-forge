# P0: 3D Viewport Keyboard Navigation

> Closes #8181 — 3D viewport has no keyboard navigation — core workflow inaccessible

## Problem

The 3D viewport (`CanvasArea.tsx`) has no keyboard event handling. The `<canvas>` element:
- Has no `tabIndex` attribute (cannot receive focus)
- Has no `onKeyDown`/`onKeyUp` handlers
- Has no `aria-label` or `role` attribute

This means:
1. **Keyboard-only users cannot interact with the viewport** — no way to move camera, select entities, or trigger shortcuts while the canvas is focused
2. **Accessibility violation** — WCAG 2.1 SC 2.1.1 (Keyboard) requires all functionality to be operable via keyboard
3. **Editor shortcuts don't work when canvas is focused** — users click the canvas (to select entities via mouse), then keyboard shortcuts stop working because focus is on an element with no key handlers

### Current Keyboard Support

SceneHierarchy has good keyboard nav (arrow keys, Enter to select, F2 to rename, Delete to delete, Shift+F10 for context menu) — `SceneHierarchy.tsx:123`.

The **engine** has a full input system (`engine/src/core/input.rs`) that maps `KeyCode` to game actions, but this only works in **Play mode** via Bevy's built-in `ButtonInput<KeyCode>`. In **Edit mode**, keyboard events from the canvas are never captured.

### Existing Shortcuts

`KeyboardShortcutsPanel.tsx` shows registered shortcuts, and `ShortcutCheatSheet.tsx` shows a quick reference. These shortcuts work when focus is on other editor elements but not when focus is on the canvas.

The bridge system (`bridge/core_systems.rs`) handles keyboard-driven operations like gizmo mode switching (W/E/R for translate/rotate/scale) via commands dispatched from JS.

## Implementation Plan

### Phase 1: Make canvas focusable and forward key events

**Goal**: Canvas receives focus and forwards keyboard events to the editor.

1. **Add `tabIndex={0}` and `aria-label` to the canvas element** in `CanvasArea.tsx`:

```tsx
<canvas
  id={CANVAS_ID}
  tabIndex={0}
  role="application"
  aria-label="3D viewport — use keyboard shortcuts to navigate"
  className={`block h-full w-full${isReady ? '' : ' invisible'}`}
  onKeyDown={handleKeyDown}
  onKeyUp={handleKeyUp}
/>
```

2. **Create keyboard event handler** that dispatches to the engine and editor:

```typescript
const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
  // Don't intercept when typing in an input/textarea
  if ((e.target as HTMLElement).tagName === 'INPUT' || 
      (e.target as HTMLElement).tagName === 'TEXTAREA') return;

  // In Play mode, Bevy handles keyboard via ButtonInput<KeyCode> natively.
  // Don't dispatch editor commands (e.g., W=translate) that conflict with
  // game input (e.g., W=forward). Let browser deliver events to WASM directly.
  if (engineMode === 'play') return;

  switch (e.key) {
    // Gizmo mode switching
    case 'w': case 'W': sendCommand('set_gizmo_mode', { mode: 'translate' }); break;
    case 'e': case 'E': sendCommand('set_gizmo_mode', { mode: 'rotate' }); break;
    case 'r': case 'R': sendCommand('set_gizmo_mode', { mode: 'scale' }); break;

    // Delete selected
    case 'Delete': case 'Backspace': deleteSelectedEntities(); break;

    // Duplicate
    case 'd': if (e.metaKey || e.ctrlKey) { e.preventDefault(); duplicateSelectedEntity(); } break;

    // Undo/Redo
    case 'z': if (e.metaKey || e.ctrlKey) { e.preventDefault(); e.shiftKey ? redo() : undo(); } break;

    // Focus selected entity (F key = frame selection)
    case 'f': case 'F': if (!e.metaKey && !e.ctrlKey) focusSelectedEntity(); break;

    // Deselect all
    case 'Escape': deselectAll(); break;

    default: break;
  }
}, [sendCommand, deleteSelectedEntities, duplicateSelectedEntity, undo, redo, deselectAll]);
```

3. **Forward arrow keys to camera orbit in Edit mode** via engine commands:

```typescript
// Camera nudge (arrow keys when no modifier)
case 'ArrowLeft':  sendCommand('orbit_camera', { deltaYaw: -5 }); break;
case 'ArrowRight': sendCommand('orbit_camera', { deltaYaw: 5 }); break;
case 'ArrowUp':    sendCommand('orbit_camera', { deltaPitch: -5 }); break;
case 'ArrowDown':  sendCommand('orbit_camera', { deltaPitch: 5 }); break;
```

**Files**: `web/src/components/editor/CanvasArea.tsx`

### Phase 2: Engine-side `orbit_camera` command

**Goal**: Allow keyboard-driven camera orbit, zoom, and pan.

1. **Add `orbit_camera` command** to `engine/src/core/commands/transform.rs`:

```rust
"orbit_camera" => {
    let delta_yaw = payload.get("deltaYaw").and_then(|v| v.as_f64()).unwrap_or(0.0) as f32;
    let delta_pitch = payload.get("deltaPitch").and_then(|v| v.as_f64()).unwrap_or(0.0) as f32;
    let delta_radius = payload.get("deltaRadius").and_then(|v| v.as_f64()).unwrap_or(0.0) as f32;
    pending.camera_orbit = Some(CameraOrbitRequest { delta_yaw, delta_pitch, delta_radius });
}
```

2. **Add `CameraOrbitRequest` to pending queue** (`core/pending/transform.rs`)
3. **Process in camera system** (`bridge/core_systems.rs`) — apply deltas to `PanOrbitCamera` yaw/pitch/radius
4. **Zoom with +/- keys** (mapped to `deltaRadius`)

**Files**: 
- `engine/src/core/commands/transform.rs`
- `engine/src/core/pending/transform.rs`
- `engine/src/bridge/core_systems.rs`
- `engine/src/core/camera.rs`

### Phase 3: Focus management between panels

**Goal**: Tab/Shift+Tab moves focus between panels logically.

1. **Add focus outline style for canvas** — subtle purple outline matching the editor theme:

```css
#game-canvas:focus-visible {
  outline: 2px solid rgb(168 85 247 / 0.5);
  outline-offset: -2px;
}
```

2. **Play mode passthrough** — when `engineMode === 'play'`, the React `handleKeyDown` returns early (no-op). Bevy receives keyboard events natively via `ButtonInput<KeyCode>`. The only exception is Escape, which exits Play mode. `usePointerLock` already manages mouse capture during Play mode.

3. **Tab order**: Sidebar → Scene Hierarchy → Canvas → Inspector → Chat panel. Use `tabIndex` values or explicit `focus()` calls on panel transitions.

**Files**: `web/src/components/editor/CanvasArea.tsx`, `web/src/components/editor/EditorLayout.tsx`, `web/src/app/globals.css`

### Phase 4: Shortcut registry integration

**Goal**: Canvas shortcuts appear in the KeyboardShortcutsPanel and are rebindable.

1. **Register canvas shortcuts** in the existing shortcut system (wherever `KeyboardShortcutsPanel.tsx` reads its data from)
2. **Show canvas-specific shortcuts** when canvas is focused (contextual help)
3. **Allow rebinding** — store custom bindings in localStorage, read in the `handleKeyDown` handler

**Files**: `web/src/components/editor/KeyboardShortcutsPanel.tsx`, `web/src/lib/workspace/keybindings.ts` (existing shortcut registry with `DEFAULT_BINDINGS`, `getMergedBindings()`, `eventToKeyCombo()`, and localStorage persistence)

## Test Plan

- [ ] Unit test: `CanvasArea` canvas element has `tabIndex={0}` and `role="application"`
- [ ] Unit test: `handleKeyDown` dispatches correct commands for W/E/R/Delete/Escape
- [ ] Unit test: Ctrl+Z triggers undo, Ctrl+Shift+Z triggers redo
- [ ] Unit test: Arrow keys send `orbit_camera` command
- [ ] Unit test: Key events are ignored when target is INPUT/TEXTAREA
- [ ] Unit test: Key events are no-op when `engineMode === 'play'` (except Escape)
- [ ] Engine test: `orbit_camera` command modifies camera yaw/pitch/radius
- [ ] E2E test: Tab from hierarchy to canvas, press Delete to remove selected entity
- [ ] A11y test: Canvas has correct ARIA attributes

## Estimated Scope

- **Phase 1**: 1 file (CanvasArea.tsx), ~80 lines — **1-2 hours**
- **Phase 2**: 4 engine files, ~60 lines Rust — **2-3 hours** (requires WASM rebuild)
- **Phase 3**: 3 files, ~30 lines — **1 hour**
- **Phase 4**: 2-3 files, ~100 lines — **2 hours**

## Notes

- Phase 2 requires a WASM build (`build_wasm.ps1`). If the sprint is web-only, Phase 1 can ship independently with gizmo mode switching and edit operations that don't need new engine commands.
- The `orbit_camera` command is new. Alternatively, Phase 1 could dispatch existing `set_camera` commands with absolute values computed in JS, but delta-based orbit is cleaner.
- Play mode keyboard handling is already working via Bevy's `ButtonInput` — this spec only addresses Edit mode gaps.
