# Spec: Exhaustive E2E Testing Infrastructure

> **Status:** DRAFT -- Awaiting Approval
> **Date:** 2026-03-26
> **Scope:** 100% interactive coverage of every UI control in the SpawnForge editor via Playwright browser tests

## Problem

Production broke during a live demo because no tests verified the editor actually works. The existing E2E suite has 48 spec files (~7,720 lines) but they are heavily skewed toward smoke tests, navigation, and API routes. Critical editor controls -- sliders, dropdowns, numeric inputs, toggle checkboxes, color pickers, context menus -- have zero or near-zero browser test coverage. When a regression lands in an inspector panel, nobody knows until a user reports it.

### Current Coverage Gaps

| Area | Existing Tests | Gap |
|------|---------------|-----|
| Editor boot, WASM init | smoke.spec.ts (5 tests) | Adequate for smoke |
| Entity CRUD | entity-crud.spec.ts, editor.spec.ts | Basic -- no bulk ops, no drag-reparent |
| Transform inspector | inspector.spec.ts (3 tests) | Covers visibility, not value editing |
| Material inspector | inspector.spec.ts (1 test) | Roughness only, no color/texture/preset |
| Light inspector | None | Zero coverage |
| Physics inspector | None | Zero coverage |
| Audio inspector | None | Zero coverage |
| Particle inspector | None | Zero coverage |
| Animation inspector | None | Zero coverage |
| Terrain inspector | None | Zero coverage |
| Game component inspector | None | Zero coverage |
| Scene settings | scene-settings.spec.ts (basic) | No post-processing sliders |
| Export dialog | export.spec.ts (basic) | No format/resolution/compression controls |
| Modals (Welcome, Token, Feedback) | modals.spec.ts (basic) | No interaction flows |
| Sidebar tools | smoke.spec.ts (button count) | No gizmo mode switching |
| Context menu | None | Zero coverage |
| Keyboard shortcuts | keyboard-shortcuts.spec.ts (basic) | Missing many combos |
| Mobile responsive | mobile-responsive.spec.ts | No drawer interaction |
| Visual scripting | visual-scripting.spec.ts (basic) | No node editing |
| UI builder | None | Zero coverage |
| Shader editor | None | Zero coverage |

## Solution

Build a comprehensive Playwright test suite that exercises every interactive UI element in the editor. Organize around Page Object Models (POMs) per panel, with shared fixtures for state injection. Use the existing `loadPage()` method (no WASM required) for all tests that verify UI behavior without engine rendering.

---

## 1. Interactive Component Inventory

### 1.1 Top Bar

| Component | File | Interactive Elements | State Change | Priority |
|-----------|------|---------------------|-------------|----------|
| SceneToolbar | `SceneToolbar.tsx` | Scene name (click-to-edit input), Undo button, Redo button, Save button, Load button, New Scene button, Browse Scenes button, Export button, Cloud save indicator | `sceneName`, `canUndo/canRedo`, `showExportDialog`, `showSceneBrowser` | P0 |
| PlayControls | `PlayControls.tsx` | Play button, Pause button, Stop button, Resume button | `engineMode` (edit/play/paused) | P0 |
| LayoutMenu | `LayoutMenu.tsx` | Layout preset buttons, reset button | Workspace panel arrangement | P1 |
| PanelsMenu | `PanelsMenu.tsx` | Panel toggle checkboxes | Workspace panel visibility | P1 |
| HelpMenu | `HelpMenu.tsx` | Docs link, Shortcuts button, Feedback button | Opens modals/panels | P1 |
| TokenBalance | `TokenBalance.tsx` | Display only (click navigates) | None | P2 |
| GenerationStatus | `GenerationStatus.tsx` | Cancel button, progress indicator | Generation job state | P2 |

### 1.2 Sidebar

| Component | File | Interactive Elements | State Change | Priority |
|-----------|------|---------------------|-------------|----------|
| Sidebar | `Sidebar.tsx` | Select tool, Move tool, Rotate tool, Scale tool, Grid toggle, Coordinate mode toggle (Local/Global), Add Entity button, Delete button, Duplicate button, Undo/Redo, CSG Union/Subtract/Intersect, Combine Meshes, AI Chat toggle, Settings button, Complexity toggle | `gizmoMode`, `snapSettings.gridVisible`, `coordinateMode`, entity operations | P0 |
| AddEntityMenu | `AddEntityMenu.tsx` | 7 mesh items (Cube, Sphere, Plane, Cylinder, Cone, Torus, Capsule), Terrain, 3 light items (Point, Directional, Spot), Extrude Circle, Lathe Profile | `spawnEntity()` | P0 |
| SettingsPanel | `SettingsPanel.tsx` (via Sidebar) | Settings modal controls | Various settings | P1 |
| ComplexityToggle | `ComplexityToggle.tsx` | Beginner/Intermediate/Advanced toggle | `complexityLevel`, section visibility | P1 |

### 1.3 Scene Hierarchy

| Component | File | Interactive Elements | State Change | Priority |
|-----------|------|---------------------|-------------|----------|
| SceneHierarchy | `SceneHierarchy.tsx` | Entity click (select), Shift+click (multi-select), expand/collapse arrows, drag-and-drop reparent, right-click context menu, keyboard navigation (Up/Down/Left/Right/Enter/Space) | `selectedIds`, `primaryId`, `sceneGraph` parent-child | P0 |
| HierarchySearch | `HierarchySearch.tsx` | Search text input, clear button | `hierarchyFilter` | P0 |
| SceneNode | `SceneNode.tsx` | Visibility toggle eye icon, inline rename (double-click), drag handle | Entity `visible`, `entityName` | P0 |
| ContextMenu | `ContextMenu.tsx` | Rename, Focus, Duplicate, Delete items (keyboard navigable) | Entity operations | P0 |

### 1.4 Inspector Panel -- Transform Section

| Component | File | Interactive Elements | State Change | Priority |
|-----------|------|---------------------|-------------|----------|
| InspectorPanel | `InspectorPanel.tsx` | Entity name input (text, blur/enter to commit), CollapsibleSection expand/collapse toggles (18+ sections) | `renameEntity()`, section visibility | P0 |
| Vec3Input (Position) | `Vec3Input.tsx` | 3 NumberInputs (X/Y/Z), Copy button, Paste button, Reset button | `updateTransform(id, 'position', [...])` | P0 |
| Vec3Input (Rotation) | `Vec3Input.tsx` | 3 NumberInputs (X/Y/Z), Copy button, Paste button, Reset button | `updateTransform(id, 'rotation', [...])` | P0 |
| Vec3Input (Scale) | `Vec3Input.tsx` | 3 NumberInputs (X/Y/Z), Copy button, Paste button, Reset button (min 0.001) | `updateTransform(id, 'scale', [...])` | P0 |
| NumberInput | `NumberInput.tsx` | Click to focus, type value, Enter to commit, Escape to cancel, Up/Down arrow step, mouse wheel step, drag-to-scrub | Individual axis value | P0 |

### 1.5 Inspector Panel -- Material Section (3D only)

| Component | File | Interactive Elements | State Change | Priority |
|-----------|------|---------------------|-------------|----------|
| MaterialInspector | `MaterialInspector.tsx` | Base color picker (color input), Emissive color picker, Metallic slider (0-1), Roughness slider (0-1), Reflectance slider (0-1), Clearcoat slider (0-1), Clearcoat roughness slider (0-1), IOR slider, Alpha cutoff slider, Emissive intensity input, 5 texture slots (file upload + asset dropdown + remove button each), Material preset dropdown (56 presets in categories), Save Custom button, Custom WGSL shader button, AI Generate Texture buttons | `updateMaterial()`, `loadTexture()`, `removeTexture()` | P0 |
| TextureSlot (x5) | `MaterialInspector.tsx` | Browse file button, Asset dropdown, Remove (X) button, Drag-and-drop file | `loadTexture()`, `removeTexture()` | P1 |
| CustomWgslEditor | `CustomWgslEditor.tsx` | Code textarea, Apply button, Reset button | `setCustomShader()` | P2 |

### 1.6 Inspector Panel -- Light Section (3D only)

| Component | File | Interactive Elements | State Change | Priority |
|-----------|------|---------------------|-------------|----------|
| LightInspector | `LightInspector.tsx` | Color picker, Intensity slider (0-1M for point/spot, 0-150K for directional), Range slider (point/spot), Outer angle slider (spot), Inner angle slider (spot), Shadows toggle, Shadow bias slider | `updateLight()` | P0 |

### 1.7 Inspector Panel -- Physics Section

| Component | File | Interactive Elements | State Change | Priority |
|-----------|------|---------------------|-------------|----------|
| PhysicsInspector | `PhysicsInspector.tsx` | Enable toggle, Body type dropdown (Dynamic/Fixed/Kinematic Position/Kinematic Velocity), Collider shape dropdown (Auto/Cuboid/Ball/Cylinder/Capsule), Mass input, Friction slider, Restitution slider, Gravity scale slider, Linear damping slider, Angular damping slider, CCD toggle, Sensor toggle, Locked axes checkboxes | `togglePhysics()`, `updatePhysics()` | P0 |
| Physics2dInspector | `Physics2dInspector.tsx` | Same pattern for 2D physics | `togglePhysics2d()`, `updatePhysics2d()` | P1 |

### 1.8 Inspector Panel -- Audio Section

| Component | File | Interactive Elements | State Change | Priority |
|-----------|------|---------------------|-------------|----------|
| AudioInspector | `AudioInspector.tsx` | Source URL/file input, Volume slider, Pitch slider, Looping toggle, Spatial toggle, Ref distance slider, Max distance slider, Rolloff factor slider, Play button, Stop button, Bus dropdown, AI Generate Sound button, AI Generate Music button | `updateAudio()`, `playAudio()`, `stopAudio()` | P1 |
| AudioMixerPanel | `AudioMixerPanel.tsx` | Per-bus volume sliders, Mute/Solo buttons, Master volume, Add bus button, Delete bus | `updateBus()`, `addBus()`, `removeBus()` | P1 |
| ReverbZoneInspector | `ReverbZoneInspector.tsx` | Min/Max distance sliders, Decay time, Early reflections, Late reverb, HF reference | `updateReverbZone()` | P2 |
| AdaptiveMusicInspector | `AdaptiveMusicInspector.tsx` | Track list, intensity slider, transition controls | Adaptive music state | P2 |

### 1.9 Inspector Panel -- Particle Section

| Component | File | Interactive Elements | State Change | Priority |
|-----------|------|---------------------|-------------|----------|
| ParticleInspector | `ParticleInspector.tsx` | Enable toggle, Preset dropdown (9 presets), Emission rate slider, Lifetime slider, Speed slider (min/max), Size slider (start/end), Gravity Vec3, Emission shape dropdown, Color gradient stops (add/remove/edit), Sprite texture upload, Play button, Stop button | `updateParticle()`, `toggleParticle()` | P1 |

### 1.10 Inspector Panel -- Animation Section

| Component | File | Interactive Elements | State Change | Priority |
|-----------|------|---------------------|-------------|----------|
| AnimationInspector | `AnimationInspector.tsx` | Clip list (click to play), Play/Pause/Stop/Resume buttons, Speed slider, Loop toggle, Blend weight slider, Crossfade duration input, Seek slider | `playAnimation()`, `pauseAnimation()`, `setAnimationSpeed()`, `setAnimationLoop()` | P1 |
| AnimationClipInspector | `AnimationClipInspector.tsx` | Keyframe timeline, Add keyframe button, Delete keyframe, Property dropdown, Value inputs | Keyframe animation state | P2 |

### 1.11 Inspector Panel -- Terrain Section

| Component | File | Interactive Elements | State Change | Priority |
|-----------|------|---------------------|-------------|----------|
| TerrainInspector | `TerrainInspector.tsx` | Seed input + Randomize button, Octaves slider, Frequency slider, Persistence slider, Amplitude slider, Width/Depth inputs, Subdivisions input | `updateTerrain()` | P1 |

### 1.12 Inspector Panel -- Game Components

| Component | File | Interactive Elements | State Change | Priority |
|-----------|------|---------------------|-------------|----------|
| GameComponentInspector | `GameComponentInspector.tsx` | Component type dropdown (from `GAME_COMPONENT_TYPES`), Add component button, Remove component button, Per-component property sliders/inputs/checkboxes, Vec3 inputs for areas/triggers | `addGameComponent()`, `updateGameComponent()`, `removeGameComponent()` | P1 |
| GameCameraInspector | `GameCameraInspector.tsx` | Follow target dropdown, Offset Vec3, Smoothing slider, Look-ahead toggle, Camera shake controls | `updateGameCamera()` | P2 |

### 1.13 Inspector Panel -- 2D-Specific Sections

| Component | File | Interactive Elements | State Change | Priority |
|-----------|------|---------------------|-------------|----------|
| SpriteInspector | `SpriteInspector.tsx` | Sprite source (file/URL), Color tint picker, Flip X/Y toggles, Custom size toggle + width/height, Anchor dropdown | `updateSprite()` | P1 |
| SpriteAnimationInspector | `SpriteAnimationInspector.tsx` | Frame list, FPS slider, Play/Stop, Loop toggle | Sprite animation state | P2 |
| Camera2dInspector | `Camera2dInspector.tsx` | Zoom slider, Background color picker | 2D camera state | P1 |
| TilemapInspector | `TilemapInspector.tsx` | Tile size inputs, Grid dimensions, Layer controls | Tilemap state | P2 |
| SkeletonInspector | `SkeletonInspector.tsx` | Bone hierarchy, IK targets, Weight paint mode | Skeleton 2D state | P2 |

### 1.14 Inspector Panel -- Other Sections

| Component | File | Interactive Elements | State Change | Priority |
|-----------|------|---------------------|-------------|----------|
| JointInspector | `JointInspector.tsx` | Joint type dropdown, Connected body dropdown, Anchor Vec3, Axis Vec3, Limits sliders, Motor controls | `updateJoint()` | P2 |
| EditModeInspector | `EditModeInspector.tsx` | Edit mode controls for mesh editing | Edit mode state | P2 |
| LodInspector | `LodInspector.tsx` | LOD level distances, auto-generate button | LOD state | P2 |
| InputBindingsPanel | `InputBindingsPanel.tsx` | Action name inputs, Key binding buttons, Add/Remove binding | `inputBindings` | P1 |

### 1.15 Scene Settings (No Selection)

| Component | File | Interactive Elements | State Change | Priority |
|-----------|------|---------------------|-------------|----------|
| SceneSettings | `SceneSettings.tsx` | Ambient light color + intensity, Fog toggle + color + density + start/end, Skybox preset dropdown + custom upload + AI generate, Quality preset dropdown (Low/Medium/High/Ultra), Bloom enable + threshold + intensity + radius, Chromatic Aberration slider, Color Grading section tabs (shadows/midtones/highlights) + gamma/gain/lift/saturation sliders, Sharpening slider, SSAO toggle + intensity + radius, Depth of Field controls, Motion Blur controls, Mobile touch config toggles | `updateAmbientLight()`, `updateEnvironment()`, `updateBloom()`, etc. | P0 |
| SceneStatistics | `SceneStatistics.tsx` | Display only (entity count, triangle count) | None | P2 |
| BridgeToolsSection | `BridgeToolsSection.tsx` | Debug toggle buttons | Debug state | P2 |

### 1.16 Right Panel Tabs

| Component | File | Interactive Elements | State Change | Priority |
|-----------|------|---------------------|-------------|----------|
| RightPanelTabs | `EditorLayout.tsx` | 8 tabs: Inspector, AI Chat, Modify, Script, UI, GDD, Review, AI NPC -- arrow key navigation | `rightPanelTab` in chatStore | P0 |

### 1.17 Modals and Dialogs

| Component | File | Interactive Elements | State Change | Priority |
|-----------|------|---------------------|-------------|----------|
| WelcomeModal | `WelcomeModal.tsx` | Quick Start button, Browse Templates button, Idea Generator button, Recent projects list, "Don't show again" checkbox, Dismiss button, Tutorial button | Dismissal state, template selection | P0 |
| ExportDialog | `ExportDialog.tsx` | Title input, Format dropdown (single-html/zip/deploy), Resolution dropdown (responsive/1920x1080/1280x720), Background color picker, Include debug toggle, Loading screen customization (bg color, progress bar color, style dropdown), Orientation lock dropdown, Compression preset dropdown, Compression quality slider, Export button, Close button, Embed snippet copy button | Export configuration, triggers export | P0 |
| PublishDialog | `PublishDialog.tsx` | Publish controls, visibility settings | Cloud publish state | P1 |
| FeedbackDialog | `FeedbackDialog.tsx` | Feedback type dropdown, Text area, Submit button | Sends feedback | P1 |
| KeyboardShortcutsPanel | `KeyboardShortcutsPanel.tsx` | Category filter, Search, Scrollable list | Display only | P1 |
| ShortcutCheatSheet | `ShortcutCheatSheet.tsx` | Overlay with shortcut grid, close on Escape/click | Display only | P2 |
| TokenDepletedModal | `TokenDepletedModal.tsx` | Upgrade button, Dismiss | Navigation | P1 |
| TokenWarningBanner | `TokenWarningBanner.tsx` | Dismiss button | Banner visibility | P2 |
| IdeaGeneratorModal | `IdeaGeneratorModal.tsx` | Genre inputs, Generate button, Idea cards, Use Idea button | AI generation | P2 |
| GenerateTextureDialog | `GenerateTextureDialog.tsx` | Prompt input, Style dropdown, Generate button | Texture generation | P2 |
| GenerateSkyboxDialog | `GenerateSkyboxDialog.tsx` | Prompt input, Generate button | Skybox generation | P2 |
| GenerateSoundDialog | `GenerateSoundDialog.tsx` | Prompt input, Duration slider, Generate button | Sound generation | P2 |
| GenerateMusicDialog | `GenerateMusicDialog.tsx` | Prompt input, Duration slider, Generate button | Music generation | P2 |
| GenerateSpriteDialog | `GenerateSpriteDialog.tsx` | Prompt input, Style options, Generate button | Sprite generation | P2 |
| GenerateModelDialog | `GenerateModelDialog.tsx` | Prompt input, Generate button | 3D model generation | P2 |
| SpriteSheetImportDialog | `SpriteSheetImportDialog.tsx` | File upload, Grid size inputs, Preview, Import button | Sprite sheet import | P2 |
| TemplateGallery | `TemplateGallery.tsx` | Template cards, Use Template button, Preview | Template selection | P1 |

### 1.18 Workspace Panels (Dockview)

| Component | File | Interactive Elements | State Change | Priority |
|-----------|------|---------------------|-------------|----------|
| ScriptEditorPanel | `ScriptEditorPanel.tsx` | Code editor, Run button, Template dropdown, Save button | Script content | P1 |
| ShaderEditorPanel | `ShaderEditorPanel.tsx` | WGSL code editor, Apply button, Reset button | Custom shader | P2 |
| UIBuilderPanel | `UIBuilderPanel.tsx` | Screen list, Widget palette (drag), Widget tree, Widget property panel, Theme editor, Data binding editor | UI builder state | P2 |
| VisualScriptEditor | `VisualScriptEditor.tsx` | Node palette, Canvas (node drag/connect), Node inspector | Visual script graph | P2 |
| DialogueTreeEditor | `DialogueTreeEditor.tsx` | Node editor, Dialogue text inputs, Choice buttons, Condition inputs | Dialogue tree state | P2 |
| BehaviorTreePanel | `BehaviorTreePanel.tsx` | Node tree, Add/Remove nodes, Property editor | Behavior tree state | P2 |
| MaterialLibraryPanel | `MaterialLibraryPanel.tsx` | Category tabs, Preset cards, Apply button, Search | Material preset selection | P1 |
| AssetPanel | `AssetPanel.tsx` | Asset browser, Upload, Delete, Search, Filter tabs | Asset registry | P1 |
| TaskboardPanel | `TaskboardPanel.tsx` | Kanban columns, Ticket cards, Add ticket | In-editor taskboard | P2 |
| DocsPanel | `DocsPanel.tsx` | Search, Navigation tree, Content display | Documentation | P2 |
| GDDPanel | `GDDPanel.tsx` | GDD editor fields, Generate button, Export | GDD state | P2 |
| ReviewPanel | `ReviewPanel.tsx` | Review checklist, Notes | Review state | P2 |
| ModifyPanel | `ModifyPanel.tsx` | CSG operations, procedural tools | Modify operations | P1 |

### 1.19 Overlays

| Component | File | Interactive Elements | State Change | Priority |
|-----------|------|---------------------|-------------|----------|
| ChatOverlay | `EditorLayout.tsx` | Chat input, Message list, Close button, Escape to close | Chat overlay visibility | P1 |
| TutorialOverlay | `TutorialOverlay.tsx` | Step navigation, Skip button, Complete button | Tutorial progress | P2 |
| OnboardingChecklist | `OnboardingChecklist.tsx` | Checklist items, Dismiss button | Onboarding state | P2 |
| SceneTransitionOverlay | `SceneTransitionOverlay.tsx` | Display only (animation) | None | P2 |
| DialogueOverlay | `DialogueOverlay.tsx` | Choice buttons, Advance button | Dialogue playback | P2 |
| InitOverlay | `InitOverlay.tsx` | Display only (loading indicator) | None | P2 |
| EngineCrashOverlay | `EngineCrashOverlay.tsx` | Reload button, Report button | Engine recovery | P1 |

### 1.20 Mobile Layout

| Component | File | Interactive Elements | State Change | Priority |
|-----------|------|---------------------|-------------|----------|
| MobileToolbar | `MobileToolbar.tsx` | Left drawer toggle, Right drawer toggle, Quick action buttons | Drawer open state | P1 |
| MobileBanner | `EditorLayout.tsx` | Dismiss button | Banner visibility | P2 |
| DrawerPanel | `DrawerPanel.tsx` | Slide-in panel, Close button, Swipe to close | Drawer state | P1 |

---

## 2. Test Categories

### 2.1 Boot Tests (Target: 12 tests)
- Editor loads at `/dev` without console errors
- Editor loads at `/dev` without JS exceptions
- Canvas element is present with non-zero dimensions
- React hydration completes (`__REACT_HYDRATED` flag)
- Sidebar renders with tool buttons
- Right panel renders with tab bar
- Scene hierarchy panel renders
- Top bar renders with scene name, play controls, and toolbar
- No invisible text elements (opacity 0, transparent color)
- Error boundary does not render on clean load
- No Next.js error overlay present
- Performance profiler loads without errors

### 2.2 Navigation Tests (Target: 25 tests)
- Right panel tab switching (all 8 tabs: Inspector, Chat, Modify, Script, UI, GDD, Review, AI NPC)
- Right panel keyboard navigation (ArrowLeft/ArrowRight/Home/End)
- Sidebar tool button selection updates gizmo mode (Select, Move, Rotate, Scale)
- Sidebar Grid toggle changes grid visibility state
- Sidebar coordinate mode toggle (Local/Global)
- Layout menu presets apply workspace arrangements
- Panels menu toggles panel visibility
- Help menu opens keyboard shortcuts panel
- Help menu opens feedback dialog
- Ctrl+K opens/closes chat overlay
- ? key opens/closes cheat sheet
- F1 opens docs panel
- Alt+T toggles taskboard panel
- Escape closes chat overlay
- Drawer panel open/close on mobile viewport
- Mobile toolbar drawer toggles

### 2.3 Entity CRUD Tests (Target: 30 tests)
- Spawn each entity type via AddEntityMenu (Cube, Sphere, Plane, Cylinder, Cone, Torus, Capsule, Terrain, Point Light, Directional Light, Spot Light) -- 11 tests
- Spawned entity appears in hierarchy
- Click entity in hierarchy selects it (updates selectedIds)
- Shift+click adds to selection (multi-select)
- Click blank area clears selection
- Hierarchy search filters entities by name
- Hierarchy search clear button resets filter
- Delete selected entity removes it from hierarchy
- Duplicate selected entity creates a copy
- Rename entity via inspector name field (type + blur)
- Rename entity via inspector name field (type + Enter)
- Rename entity cancel via Escape
- Keyboard Delete key deletes selected entity
- Context menu Rename action
- Context menu Duplicate action
- Context menu Delete action
- Context menu Focus action
- Context menu keyboard navigation (Up/Down/Enter)
- Hierarchy expand/collapse arrows work
- Hierarchy keyboard navigation (Up/Down selects, Left collapses, Right expands)

### 2.4 Inspector -- Transform Tests (Target: 35 tests)
- Selecting entity shows Transform section with Position/Rotation/Scale
- Position X input: click, type value, Enter commits
- Position Y input: click, type value, blur commits
- Position Z input: Escape cancels edit
- Rotation inputs display in degrees (store holds radians)
- Scale inputs enforce min 0.001
- NumberInput arrow-up increments by step
- NumberInput arrow-down decrements by step
- NumberInput drag-to-scrub changes value
- Copy Position button writes to clipboard
- Paste Position button reads from clipboard
- Copy/Paste full transform (all 3 vectors)
- Reset Position button resets to [0,0,0]
- Reset Rotation button resets to [0,0,0]
- Reset Scale button resets to [1,1,1]
- Reset button only visible when value differs from default
- CollapsibleSection expand/collapse toggles content visibility
- Multiple Vec3Inputs can be edited in sequence without state corruption
- Rapid value changes debounce correctly
- Tab key moves focus between X, Y, Z inputs

### 2.5 Inspector -- Material Tests (Target: 30 tests)
- Material section visible for mesh entities, hidden for lights
- Base color picker changes material color
- Emissive color picker changes emissive
- Metallic slider (0-1) updates store
- Roughness slider (0-1) updates store
- Reflectance slider updates store
- Clearcoat slider updates store
- Clearcoat roughness slider updates store
- IOR slider updates store
- Alpha cutoff slider updates store
- Emissive intensity input updates store
- Material preset dropdown lists all categories
- Selecting a preset applies its values
- Save Custom material creates a new preset entry
- Texture slot: file upload triggers loadTexture
- Texture slot: remove button clears texture
- Texture slot: asset dropdown selects from registry
- AI Generate Texture button opens generation dialog
- Material library panel preset cards are clickable
- Material library panel search filters presets

### 2.6 Inspector -- Light Tests (Target: 12 tests)
- Light section visible only for light entities
- Color picker changes light color
- Intensity slider works for point light range
- Intensity slider works for directional light range (different max)
- Range slider visible for point/spot lights
- Outer angle slider visible for spot lights
- Inner angle slider visible for spot lights
- Shadows toggle checkbox updates state
- Shadow bias slider works when shadows enabled
- Light type label reflects entity type (Point/Directional/Spot)

### 2.7 Inspector -- Physics Tests (Target: 15 tests)
- Physics enable toggle adds/removes physics from entity
- Body type dropdown has all 4 options
- Body type change updates store
- Collider shape dropdown has all 5 options
- Collider shape change updates store
- Mass input accepts numeric values
- Friction slider (0-1)
- Restitution slider (0-1)
- Gravity scale slider
- Linear damping slider
- Angular damping slider
- CCD toggle
- Sensor toggle
- Locked axes checkboxes (6 axes)
- Documentation help button opens docs

### 2.8 Inspector -- Audio Tests (Target: 12 tests)
- Audio source file/URL input
- Volume slider updates store
- Pitch slider updates store
- Looping toggle
- Spatial toggle shows/hides spatial controls
- Ref distance slider (when spatial)
- Max distance slider (when spatial)
- Play button triggers audio playback
- Stop button stops audio
- Bus dropdown selects audio bus
- AI Generate Sound button opens dialog
- AI Generate Music button opens dialog

### 2.9 Inspector -- Particle Tests (Target: 10 tests)
- Enable toggle
- Preset dropdown applies preset configuration
- Emission rate slider
- Lifetime slider
- Speed min/max sliders
- Size start/end sliders
- Gravity Vec3 input
- Emission shape dropdown
- Play/Stop buttons
- Color gradient stop add/edit/remove

### 2.10 Inspector -- Other Section Tests (Target: 20 tests)
- Animation: clip list rendering, play/pause/stop, speed slider, loop toggle, seek slider
- Terrain: seed input, randomize button, octaves/frequency/persistence/amplitude sliders
- Game components: add component dropdown, property editing, remove component
- Joint: type dropdown, connected body, anchor/axis Vec3
- Input bindings: add binding, key selection, remove binding
- Edit mode: mode controls render

### 2.11 Scene Settings Tests (Target: 25 tests)
- Ambient light color picker
- Ambient light intensity slider
- Fog enable toggle
- Fog color picker
- Fog density/start/end sliders
- Skybox preset dropdown
- Skybox custom upload file input
- Quality preset dropdown (Low/Medium/High/Ultra)
- Bloom enable toggle + threshold/intensity/radius sliders
- Chromatic Aberration slider
- Color grading section tabs (shadows/midtones/highlights)
- Color grading gamma/gain/lift/saturation sliders per section
- Sharpening slider
- SSAO toggle + intensity/radius
- Mobile touch config toggles

### 2.12 Toolbar and Mode Tests (Target: 10 tests)
- Play mode disables editing buttons (Save, Load, New, Export)
- Stop returns to edit mode and re-enables buttons
- Undo button enabled after action, disabled when empty
- Redo button enabled after undo, disabled at tip
- Ctrl+Z triggers undo
- Ctrl+Shift+Z triggers redo
- Ctrl+S triggers save
- Ctrl+Shift+N creates new scene
- Ctrl+P toggles play/stop

### 2.13 Modal and Dialog Tests (Target: 25 tests)
- Welcome modal renders on first visit
- Welcome modal "Don't show again" persists
- Welcome modal Quick Start dismisses modal
- Welcome modal Browse Templates opens gallery
- Welcome modal Idea Generator opens generator
- Export dialog: title input
- Export dialog: format dropdown (single-html/zip/deploy)
- Export dialog: resolution dropdown
- Export dialog: background color picker
- Export dialog: include debug toggle
- Export dialog: loading screen customization
- Export dialog: orientation lock dropdown
- Export dialog: compression preset dropdown
- Export dialog: compression quality slider
- Export dialog: close on Escape
- Export dialog: focus trap (Tab cycles within dialog)
- Export dialog: Export button triggers export
- Feedback dialog: type dropdown, text area, submit
- Token depleted modal: upgrade button, dismiss
- Token warning banner: dismiss button
- Keyboard shortcuts panel: category filter, search
- Scene browser: open, list scenes, select scene
- Onboarding wizard: step navigation, skip, complete

### 2.14 State Persistence Tests (Target: 10 tests)
- Undo reverts last transform change
- Redo re-applies undone change
- Multiple undos in sequence
- Undo after entity spawn removes entity
- Undo after entity delete restores entity
- Undo after material change reverts material
- Scene modified indicator appears after change
- Auto-save recovery dialog appears after simulated crash

### 2.15 Error Boundary Tests (Target: 8 tests)
- Inspector error boundary catches and displays error
- Editor error boundary catches and displays error
- WASM error boundary shows crash overlay
- Crash overlay reload button works
- Error recovery: panel still functional after boundary reset
- No cascade failure when one inspector section errors

### 2.16 Responsive and Mobile Tests (Target: 15 tests)
- Compact layout activates below breakpoint
- Mobile toolbar visible in compact mode
- Left drawer opens/closes hierarchy
- Right drawer opens/closes inspector tabs
- Mobile banner displays and can be dismissed
- Touch-friendly button sizes (minimum 44x44 tap targets)
- Drawer swipe gesture closes panel
- Keyboard shortcuts still work in compact mode
- Panel content scrolls correctly in drawers
- Responsive layout transitions don't lose state

### 2.17 Cross-Browser Tests (Target: 10 tests per browser)
- Chromium, Firefox, WebKit: boot, entity CRUD, inspector interactions
- Mobile Chrome (Pixel 7), Mobile Safari (iPhone 14): boot, drawer navigation

---

## 3. Test Infrastructure Architecture

### 3.1 Page Object Model Hierarchy

```
EditorPage (existing, extended)
  |-- TopBar
  |     |-- SceneToolbarPOM: sceneName, undo, redo, save, load, new, export, browse
  |     |-- PlayControlsPOM: play, pause, stop, resume, getMode
  |     |-- HelpMenuPOM: openShortcuts, openFeedback, openDocs
  |
  |-- SidebarPOM: selectTool, moveTool, rotateTool, scaleTool, gridToggle, ...
  |     |-- AddEntityMenuPOM: open, spawnEntity(type), getMenuItems
  |
  |-- HierarchyPOM: selectEntity, multiSelect, search, clearSearch, expandNode, ...
  |     |-- ContextMenuPOM: rename, duplicate, delete, focus
  |
  |-- InspectorPOM: getName, setName, expandSection, collapseSection
  |     |-- TransformPOM: getPosition, setPosition, getRotation, setRotation, ...
  |     |     |-- Vec3InputPOM: getValues, setValue(axis, val), copy, paste, reset
  |     |     |-- NumberInputPOM: getValue, setValue, increment, decrement
  |     |-- MaterialPOM: getColor, setColor, getMetallic, setMetallic, ...
  |     |-- LightPOM: getColor, setColor, getIntensity, setIntensity, ...
  |     |-- PhysicsPOM: isEnabled, toggle, getBodyType, setBodyType, ...
  |     |-- AudioPOM: getVolume, setVolume, play, stop, ...
  |     |-- ParticlePOM: isEnabled, toggle, getPreset, setPreset, ...
  |     |-- AnimationPOM: playClip, pause, stop, getSpeed, setSpeed, ...
  |     |-- TerrainPOM: getSeed, setSeed, randomize, ...
  |     |-- GameComponentPOM: addComponent, removeComponent, ...
  |
  |-- SceneSettingsPOM: getAmbientColor, setAmbientColor, ...
  |     |-- PostProcessingPOM: bloom, chromaticAberration, colorGrading, ...
  |
  |-- ModalsPOM: welcomeModal, exportDialog, feedbackDialog, ...
  |
  |-- RightPanelPOM: getActiveTab, switchTab, tabKeyboardNav
```

### 3.2 Shared Fixtures

```typescript
// e2e/fixtures/editor.fixture.ts (extend existing)
export const test = base.extend<{
  editor: EditorPage;           // Existing
  inspector: InspectorPOM;      // New
  hierarchy: HierarchyPOM;      // New
  sidebar: SidebarPOM;          // New
  toolbar: SceneToolbarPOM;     // New
  sceneSettings: SceneSettingsPOM; // New
}>({
  // Each POM initialized from editor.page
});
```

### 3.3 State Injection Utilities

```typescript
// e2e/helpers/state-injection.ts (extend existing)

/** Inject a mock entity into the Zustand store for tests that don't need WASM */
async function injectMockEntity(page: Page, entity: MockEntity): Promise<void>;

/** Inject mock material data for material inspector tests */
async function injectMockMaterial(page: Page, entityId: string, material: Partial<MaterialData>): Promise<void>;

/** Read current store state via window.__EDITOR_STORE */
async function getStoreState<T>(page: Page, path: string): Promise<T>;

/** Wait for store state to match predicate */
async function waitForStoreState(page: Page, predicate: string, timeout?: number): Promise<void>;
```

### 3.4 Test Data Factories

```typescript
// e2e/helpers/factories.ts

/** Create a mock entity for store injection */
function createMockEntity(overrides?: Partial<MockEntity>): MockEntity;

/** Create mock transform data */
function createMockTransform(overrides?: Partial<TransformData>): TransformData;

/** Create mock material data */
function createMockMaterial(overrides?: Partial<MaterialData>): MaterialData;

/** Create a scene graph with N entities of given types */
function createMockScene(entities: Array<{ type: string; name: string }>): MockSceneGraph;
```

### 3.5 Engine Mock Strategy

Tests are split into two tiers:

1. **`@ui` tests (no WASM required):** Use `editor.loadPage()` which sets `__SKIP_ENGINE = true`. Inject state directly into the Zustand store via `window.__EDITOR_STORE.setState()`. This covers all inspector interactions, modals, navigation, and UI logic. These run in CI without a WASM build.

2. **`@engine` tests (WASM required):** Use `editor.load()` which waits for `__FORGE_ENGINE_READY`. Test actual command dispatch and event round-trips. Limited to entity CRUD, play mode, and state persistence tests that need real engine responses.

The majority of new tests (estimated 85%) are `@ui` tests. This is critical for CI speed and reliability.

### 3.6 Slider Interaction Helper

Sliders are the most common interactive control in the editor. A dedicated helper avoids duplicating slider interaction logic across 50+ tests.

```typescript
// e2e/helpers/slider.ts

/** Set a range input to a specific value by computing the required mouse position */
async function setSliderValue(page: Page, slider: Locator, value: number): Promise<void>;

/** Read the current value of a range input */
async function getSliderValue(slider: Locator): Promise<number>;

/** Verify a slider's min/max/step attributes */
async function assertSliderRange(slider: Locator, min: number, max: number, step: number): Promise<void>;
```

---

## 4. Automation Hooks for Future Work

### 4.1 New Component Coverage Enforcement

Add a CI step that cross-references editor component files with test coverage:

```bash
# .github/workflows/component-coverage-check.yml
# 1. List all .tsx files in components/editor/ that export interactive components
# 2. For each, check if a corresponding test exists in e2e/tests/
# 3. Fail if any P0/P1 component lacks a test file
```

Implementation: A script at `.claude/tools/check-e2e-coverage.sh` that:
- Parses the component inventory table from this spec (or a generated manifest)
- Checks for corresponding POM and test file
- Reports gaps with priority level

### 4.2 Test Template for New Inspector Panels

When adding a new inspector panel (per the New Component Checklist in CLAUDE.md), the builder agent must also create:

1. A POM class in `e2e/fixtures/poms/<domain>-inspector.pom.ts`
2. A test file in `e2e/tests/<domain>-inspector.spec.ts`
3. Registration of the POM in the editor fixture

Template:
```typescript
// e2e/fixtures/poms/example-inspector.pom.ts
import { type Page, type Locator } from '@playwright/test';

export class ExampleInspectorPOM {
  readonly section: Locator;
  readonly enableToggle: Locator;

  constructor(private page: Page) {
    this.section = page.locator('[data-testid="inspector-example"]');
    this.enableToggle = this.section.locator('input[type="checkbox"]').first();
  }

  async isVisible(): Promise<boolean> {
    return this.section.isVisible();
  }

  async toggle(): Promise<void> {
    await this.enableToggle.click();
  }
}
```

### 4.3 Coverage Tracking Per Component

Add `data-testid` attributes to every interactive element in inspector panels. This enables:
- Automated counting of tested vs untested `data-testid` elements
- Coverage reporting per-panel
- Regression detection when new controls are added without test IDs

Convention: `data-testid="inspector-{section}-{control}"`, e.g.:
- `data-testid="inspector-material-metallic-slider"`
- `data-testid="inspector-physics-body-type-dropdown"`
- `data-testid="inspector-transform-position-x"`

---

## 5. Implementation Phases

### Phase 1: Core Infrastructure + Boot/Navigation (2-3 days)

**Goal:** POM framework, shared fixtures, factories, and all P0 navigation tests.

**Deliverables:**
- POM classes: EditorPage (extended), SidebarPOM, HierarchyPOM, RightPanelPOM, SceneToolbarPOM, PlayControlsPOM
- State injection helpers and test data factories
- Slider interaction helper
- Boot tests (12 tests)
- Navigation tests (25 tests)
- Entity CRUD tests (30 tests)

**Test count:** ~67 tests
**Estimated lines:** ~2,000

### Phase 2: Inspector Panel Tests (3-4 days)

**Goal:** Every slider, input, dropdown, toggle, and color picker in the inspector.

**Deliverables:**
- POM classes: TransformPOM, Vec3InputPOM, NumberInputPOM, MaterialPOM, LightPOM, PhysicsPOM, AudioPOM, ParticlePOM, AnimationPOM, TerrainPOM, GameComponentPOM
- `data-testid` attributes added to all inspector controls
- Transform tests (35 tests)
- Material tests (30 tests)
- Light tests (12 tests)
- Physics tests (15 tests)
- Audio tests (12 tests)
- Particle tests (10 tests)
- Other inspector tests (20 tests)
- Scene settings tests (25 tests)

**Test count:** ~159 tests
**Estimated lines:** ~5,000

### Phase 3: Modals, State, and Advanced Features (2-3 days)

**Goal:** Full modal coverage, undo/redo verification, error boundaries.

**Deliverables:**
- POM classes: ExportDialogPOM, WelcomeModalPOM, FeedbackDialogPOM
- Modal/dialog tests (25 tests)
- Toolbar/mode tests (10 tests)
- State persistence tests (10 tests)
- Error boundary tests (8 tests)

**Test count:** ~53 tests
**Estimated lines:** ~1,800

### Phase 4: Cross-Browser, Mobile, and Workspace Panels (2-3 days)

**Goal:** Responsive layout, mobile drawer interactions, cross-browser verification, workspace panels.

**Deliverables:**
- Responsive/mobile tests (15 tests)
- Cross-browser matrix (Chromium, Firefox, WebKit, mobile) for boot + critical paths
- Workspace panel smoke tests (script editor, UI builder, visual scripting, dialogue editor)
- AI generation dialog smoke tests

**Test count:** ~50 tests
**Estimated lines:** ~1,500

---

## 6. Test Count Summary

| Category | Test Count | Priority |
|----------|-----------|----------|
| Boot tests | 12 | P0 |
| Navigation tests | 25 | P0 |
| Entity CRUD tests | 30 | P0 |
| Transform inspector tests | 35 | P0 |
| Material inspector tests | 30 | P0 |
| Light inspector tests | 12 | P0 |
| Physics inspector tests | 15 | P0 |
| Audio inspector tests | 12 | P1 |
| Particle inspector tests | 10 | P1 |
| Other inspector tests | 20 | P1-P2 |
| Scene settings tests | 25 | P0 |
| Toolbar/mode tests | 10 | P0 |
| Modal/dialog tests | 25 | P0 |
| State persistence tests | 10 | P1 |
| Error boundary tests | 8 | P1 |
| Responsive/mobile tests | 15 | P1 |
| Cross-browser tests | 30 | P1 |
| Workspace panel tests | 20 | P2 |
| **Total** | **~344 tests** | |

Combined with the existing 48 spec files (~200+ tests), the total E2E test count would reach approximately **540+ browser tests**.

---

## Acceptance Criteria

- Given a clean checkout, When `npx playwright test --grep @ui` runs, Then all UI tests pass without WASM build
- Given a WASM build exists, When `npx playwright test --grep @engine` runs, Then all engine tests pass
- Given a new entity is spawned via AddEntityMenu, When each entity type button is clicked, Then the entity appears in the hierarchy
- Given the material inspector is visible, When the roughness slider is dragged to 0.75, Then `materialDataMap[entityId].roughness` equals 0.75 in the store
- Given the export dialog is open, When Tab is pressed repeatedly, Then focus cycles through all dialog controls without escaping
- Given a mobile viewport (375px wide), When the left drawer toggle is tapped, Then the hierarchy panel slides in from the left
- Given any inspector panel errors, When the error boundary catches it, Then the error message is displayed and other panels remain functional

## Constraints

- **CI timeout:** Total E2E suite must complete within 10 minutes on 2 parallel workers
- **No WASM dependency for `@ui` tests:** All inspector/modal/navigation tests use store injection
- **Playwright version:** Use existing Playwright config (Chromium, Firefox, WebKit, mobile projects)
- **No flaky selectors:** All new tests must use `data-testid`, ARIA roles/labels, or semantic selectors -- never CSS class names or xpath
- **Base URL:** Tests must work with `http://localhost:3000/dev` (CI) and `http://spawnforge.localhost:1355/dev` (local via Portless)
- **Existing patterns preserved:** Extend the existing `EditorPage` POM and editor fixture -- do not replace them

## Relationship to Existing Specs

This spec complements `specs/2026-03-20-test-infrastructure-optimization.md` which focuses on unit test speed and coverage ratcheting. That spec handles vitest infrastructure; this spec handles Playwright E2E coverage. They are independent and can be implemented in parallel.
