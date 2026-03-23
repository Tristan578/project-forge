# Spec: Unified Onboarding Flow

> **Status:** APPROVED
> **Design Decisions (2026-03-22):**
> - Progressive disclosure: **Dimmed tabs** (visible but locked, discoverable surface area)
> - Template auto-play: **User-initiated button click** (no auto-play countdown)
> - AI card for starter tier: **Locked with upgrade badge** (drives conversions)
> **Date:** 2026-03-22
> **Ticket:** PF-599
> **Scope:** Redesign the first-time user experience to maximize activation within 5 minutes

## Problem

SpawnForge's onboarding is fragmented across 6 overlapping components with inconsistent state management and no coherent flow. A new user currently encounters:

1. **QuickStartFlow** (z-index 70) -- 3-step game type picker + template loader
2. **WelcomeModal** (z-index 60) -- Tips + template gallery + tutorial link
3. **WelcomeWizard** -- 3-column choice (tutorial / template / blank) -- only shown when `onboardingStore.isNewUser` is true
4. **OnboardingChecklist** (z-index 30) -- Fixed bottom-left task tracker
5. **TutorialOverlay** (z-index 100) -- Step-by-step spotlight tour
6. **OnboardingPanel** -- Full-screen modal with tutorials, tasks, and achievements

**Activation gates clash**: `QuickStartGate` in `EditorLayout.tsx` conditionally shows either QuickStartFlow or WelcomeModal based on two separate localStorage keys (`forge-quickstart-completed`, `forge-welcomed`). The WelcomeWizard uses `onboardingStore.isNewUser` (persisted Zustand). The result is that users can see up to 3 modals in sequence, or none at all, depending on localStorage state.

**No personalization**: All users see the same flow regardless of whether they want AI-first creation or manual editing, and regardless of their subscription tier.

**No success tracking**: The analytics events file has `trackTutorialStarted` and `trackTutorialCompleted` but no funnel metrics for time-to-first-entity, time-to-first-play, or onboarding path chosen.

**No AI chat integration**: The QuickStartFlow loads a template but never opens the AI chat panel. Users who want "describe a game and AI builds it" have to discover Ctrl+K on their own.

## Solution

### Design Principles

1. **One modal, one decision** -- Replace the 3 competing modals (QuickStartFlow, WelcomeModal, WelcomeWizard) with a single `OnboardingWizard` that branches based on user intent.
2. **Show, don't tell** -- Minimize text; maximize interactive demonstration. Users should be doing something within 30 seconds.
3. **Progressive disclosure** -- Surface basic tools first. Advanced panels (shader editor, visual scripting, behavior trees) stay hidden until the user has completed basic tasks or explicitly explores them.
4. **Tier-aware** -- Starter users do not see AI generation prompts. Hobbyist+ users see AI as the primary path.
5. **Resumable** -- If the user closes the browser mid-onboarding, they resume where they left off (onboardingStore is already persisted).

### User Journey: First 60 Seconds

```
Sign-in / /dev page load
    |
    v
[WASM loading: skeleton UI with progress bar]
    |
    v
[OnboardingWizard: Intent Selection]  <-- single full-screen modal
    |
    +--> "Build with AI" ---------> AI Path (step 2A)
    |     (hobbyist+ only)
    |
    +--> "Choose a Template" -----> Template Path (step 2B)
    |
    +--> "Start Blank" -----------> Blank Path (step 2C)
    |
    +--> "Take the Tour" ---------> Tutorial Path (step 2D)
```

**Step 1: Intent Selection** (replaces WelcomeWizard + QuickStartFlow step 1)
- 4 cards: "Build with AI", "Start from Template", "Blank Canvas", "Guided Tour"
- "Build with AI" card is hidden for starter tier (no AI access)
- Recent projects section shown below cards (same as current WelcomeModal)
- "Don't show again" checkbox preserved

### Guided Tour: Next 4 Minutes

**Path 2A: AI-First** (target: first AI generation within 60 seconds)
1. Dismiss wizard, switch `rightPanelTab` to `'chat'`, focus chat input
2. Pre-populate chat input with ghost text: "Describe your game idea..."
3. Show a contextual tip toast: "Try: Create a platformer with a player, platforms, and coins"
4. After first AI response completes, show a toast: "Click Play to test your game"
5. After first play mode, show OnboardingChecklist (collapsed) in bottom-left

**Path 2B: Template Selection** (target: first play mode within 90 seconds)
1. Open TemplateGallery inline within the wizard (not as a separate modal)
2. After template loads, auto-switch to play mode with a 2-second countdown overlay
3. After user stops play mode, show contextual tip: "Try changing a material color"
4. Show OnboardingChecklist

**Path 2C: Blank Canvas** (target: first entity within 60 seconds)
1. Dismiss wizard immediately
2. Show contextual tip toast after 3 seconds: "Right-click the canvas to add your first entity"
3. After first entity created, show tip: "Click on it to see the Inspector panel"
4. After first material change, show tip: "Hit Play to see your scene in action"
5. Show OnboardingChecklist

**Path 2D: Guided Tour** (target: tutorial completion within 4 minutes)
1. Start the `first-scene` tutorial via `onboardingStore.startTutorial('first-scene')`
2. TutorialOverlay handles the step-by-step spotlight flow (already built)
3. After tutorial completion, show OnboardingChecklist
4. Offer to continue with "Make It Move" or "Build with AI" tutorials

### Template Selection (within OnboardingWizard)

The 5 existing templates (platformer, runner, shooter, puzzle, explorer) plus "Blank Project" are displayed inline in step 2B. The current `TemplateGallery` component is refactored to accept an `inline` prop that removes the fixed overlay positioning so it can render inside the wizard.

Additionally, the existing `QuickStartFlow` game type cards (platformer, shooter, puzzle, explorer) are merged into the template selection step. The separate "describe your game" textarea in QuickStartFlow step 2 is removed -- AI description is handled by the AI chat path instead.

### Progressive Disclosure

New concept: **Feature Visibility Tiers** stored in `onboardingStore`.

| Tier | Panels Visible | Unlocked When |
|------|---------------|---------------|
| `novice` | Inspector, SceneHierarchy, PlayControls, AI Chat | Default for new users |
| `intermediate` | + Script, Modify, Audio Mixer, Prefabs, Export | 3 basic tasks completed |
| `advanced` | + Shader, Visual Scripting, UI Builder, GDD, Behavior Tree | 3 advanced tasks completed OR user manually opens via PanelsMenu |
| `expert` | All panels, no tips | User dismisses checklist OR all tasks done |

Implementation: The `PanelsMenu` component reads `featureVisibilityTier` from `onboardingStore` and filters available panel options. Users can always manually upgrade their tier via a "Show all panels" option in PanelsMenu. The right panel tab bar (`RightPanelTabs` in EditorLayout) hides tabs that are above the user's visibility tier.

**Contextual tooltips on first interaction**: When a user opens a panel for the first time (tracked in `onboardingStore.firstInteractions: Record<string, boolean>`), show a one-time tooltip explaining what the panel does and its primary use case. Tooltips use the existing `ContextualTipToast` component.

### Success Metrics

| Metric | Target | Analytics Event |
|--------|--------|-----------------|
| First entity created | < 60 seconds from wizard dismiss | `onboarding_first_entity` (timestamp delta) |
| First play mode | < 3 minutes from sign-in | `onboarding_first_play` (timestamp delta) |
| First AI generation | < 2 minutes from sign-in | `onboarding_first_ai_gen` (timestamp delta) |
| Onboarding completion rate | > 70% of new users complete 3+ basic tasks in first session | `onboarding_basic_tasks_completed` (count) |
| Path selection distribution | Track which path users choose | `onboarding_path_selected` (path) |
| Tutorial completion rate | > 50% of users who start a tutorial finish it | Existing `tutorial_completed` events |

---

## Technical Implementation

### Files to Create

#### 1. `web/src/components/onboarding/OnboardingWizard.tsx` (NEW)

Replaces: QuickStartFlow, WelcomeModal, WelcomeWizard.

```
Props: { onComplete: () => void }
State: step ('intent' | 'ai' | 'template' | 'blank' | 'tour'), selectedTemplate: string | null
```

- Reads `useUserStore` for tier to gate AI path
- Reads `useOnboardingStore` for `isNewUser`, `featureVisibilityTier`
- Reads recent projects from `getRecentProjects()`
- On complete: sets `onboardingStore.onboardingPath`, marks `forge-onboarding-completed` in localStorage, records visit
- Focus trap and Escape handling (same pattern as current WelcomeModal)
- z-index 65 (between current WelcomeModal at 60 and QuickStartFlow at 70)

#### 2. `web/src/components/onboarding/OnboardingTipManager.tsx` (NEW)

Orchestrates contextual tips based on the chosen onboarding path. Subscribes to `useEditorStore` and `useChatStore` to detect state changes and trigger `ContextualTipToast` at the right moments.

```
Props: none (reads from stores)
Renders: ContextualTipToast when conditions met
State: activeTip, tipQueue
```

Tip triggers (path-specific):

| Path | Trigger | Tip |
|------|---------|-----|
| AI | Chat panel opened | "Try describing your game: 'A platformer with a player and coins'" |
| AI | First AI response done | "Click Play to test your game" |
| Template | Template loaded | "Your game is ready -- Play starts in 3 seconds" |
| Template | First play stop | "Try changing a material color in the Inspector" |
| Blank | 3 seconds idle | "Right-click the canvas to add your first entity" |
| Blank | First entity created | "Click it to see the Inspector panel on the right" |
| Blank | First material change | "Hit Play to see your scene in action" |
| Any | First script opened | "Scripts run in a sandbox. Use forge.* API for engine access" |
| Any | 5 minutes without export | "Export your game from File > Export to share it" |

#### 3. `web/src/data/onboardingTips.ts` (NEW)

Static tip definitions consumed by OnboardingTipManager.

```typescript
export interface OnboardingTip {
  id: string;
  path: 'ai' | 'template' | 'blank' | 'tour' | 'any';
  trigger: {
    type: 'store-change' | 'timer' | 'panel-opened';
    condition: string; // e.g., 'chatMessages.length > 0', 'engineMode === play'
  };
  title: string;
  message: string;
  actionLabel?: string;
  action?: string; // e.g., 'open-chat', 'start-play'
  cooldownMs: number;
}
```

### Files to Modify

#### 4. `web/src/stores/onboardingStore.ts` (MODIFY)

Add fields to `OnboardingState`:

```typescript
// New fields
onboardingPath: 'ai' | 'template' | 'blank' | 'tour' | null;
onboardingStartedAt: number | null;
featureVisibilityTier: 'novice' | 'intermediate' | 'advanced' | 'expert';
firstInteractions: Record<string, boolean>; // panelId -> true
onboardingCompleted: boolean;

// New actions
setOnboardingPath: (path: 'ai' | 'template' | 'blank' | 'tour') => void;
setFeatureVisibilityTier: (tier: 'novice' | 'intermediate' | 'advanced' | 'expert') => void;
recordFirstInteraction: (panelId: string) => void;
completeOnboarding: () => void;
autoPromoteVisibilityTier: () => void; // called when tasks complete
```

The `autoPromoteVisibilityTier` action checks `basicTasks` and `advancedTasks` counts and promotes the tier when thresholds are met. Called from `completeTask`.

#### 5. `web/src/components/editor/EditorLayout.tsx` (MODIFY)

- Replace `QuickStartGate` component with `OnboardingGate` that shows `OnboardingWizard` for new users
- Remove lazy import of `QuickStartFlow` and `WelcomeModal`
- Add `OnboardingTipManager` to both compact and desktop layouts
- Pass `featureVisibilityTier` down to `RightPanelTabs` to filter visible tabs

Changes to `QuickStartGate` (renamed to `OnboardingGate`):

```typescript
function OnboardingGate() {
  const onboardingCompleted = useOnboardingStore((s) => s.onboardingCompleted);
  const isNewUser = useOnboardingStore((s) => s.isNewUser);

  // Also check legacy localStorage keys for backward compatibility
  const legacyCompleted = useSyncExternalStore(
    noopSubscribe,
    () => !!localStorage.getItem('forge-onboarding-completed')
       || !!localStorage.getItem('forge-quickstart-completed')
       || !!localStorage.getItem('forge-welcomed'),
    () => true,
  );

  if (onboardingCompleted || legacyCompleted || !isNewUser) return null;

  return <OnboardingWizard onComplete={() => {
    useOnboardingStore.getState().completeOnboarding();
    localStorage.setItem('forge-onboarding-completed', '1');
  }} />;
}
```

#### 6. `web/src/components/editor/EditorLayout.tsx` -- `RightPanelTabs` (MODIFY)

Filter `TAB_ORDER` based on `featureVisibilityTier`:

```typescript
const TIER_VISIBLE_TABS: Record<string, RightPanelTab[]> = {
  novice: ['inspector', 'chat'],
  intermediate: ['inspector', 'chat', 'modify', 'script'],
  advanced: ['inspector', 'chat', 'modify', 'script', 'ui', 'gdd', 'review', 'behavior'],
  expert: TAB_ORDER,
};
```

#### 7. `web/src/components/editor/TemplateGallery.tsx` (MODIFY)

Add an `inline` prop that removes the fixed overlay and renders as a regular div:

```typescript
interface TemplateGalleryProps {
  isOpen: boolean;
  onClose: () => void;
  inline?: boolean; // When true, renders without fixed overlay
}
```

#### 8. `web/src/lib/analytics/events.ts` (MODIFY)

Add onboarding funnel events:

```typescript
export function trackOnboardingPathSelected(path: string) {
  track('onboarding_path_selected', { path, env });
}

export function trackOnboardingFirstEntity(elapsedMs: number) {
  track('onboarding_first_entity', { elapsedMs, env });
}

export function trackOnboardingFirstPlay(elapsedMs: number) {
  track('onboarding_first_play', { elapsedMs, env });
}

export function trackOnboardingFirstAIGen(elapsedMs: number) {
  track('onboarding_first_ai_gen', { elapsedMs, env });
}

export function trackOnboardingCompleted(path: string, elapsedMs: number, tasksCompleted: number) {
  track('onboarding_completed', { path, elapsedMs, tasksCompleted, env });
}
```

#### 9. `web/src/lib/analytics/posthog.ts` (MODIFY)

Add to `AnalyticsEvent` enum:

```typescript
ONBOARDING_PATH_SELECTED = 'onboarding_path_selected',
ONBOARDING_COMPLETED = 'onboarding_completed',
```

### Files to Delete (after migration)

These files become dead code once `OnboardingWizard` replaces them:

- `web/src/components/onboarding/WelcomeWizard.tsx` -- Functionality merged into OnboardingWizard
- `web/src/components/editor/WelcomeModal.tsx` -- Functionality merged into OnboardingWizard
- `web/src/components/onboarding/QuickStartFlow.tsx` -- Functionality merged into OnboardingWizard

Note: The `WelcomeWizard.test.tsx` and `QuickStartFlow.test.tsx` test files should be migrated to test `OnboardingWizard` instead, not simply deleted.

### MCP Changes

Add 3 MCP commands to `mcp-server/manifest/commands.json` (and sync to `web/src/data/commands.json`):

```json
{
  "name": "start_onboarding",
  "description": "Start or restart the onboarding flow for the current user. Optionally specify a path (ai, template, blank, tour).",
  "category": "onboarding",
  "parameters": [
    { "name": "path", "type": "string", "required": false, "description": "Onboarding path: ai, template, blank, tour. Defaults to showing the intent selection." }
  ]
},
{
  "name": "complete_onboarding_task",
  "description": "Manually mark an onboarding task as completed. Use to programmatically advance onboarding progress.",
  "category": "onboarding",
  "parameters": [
    { "name": "taskId", "type": "string", "required": true, "description": "Task ID from the onboarding checklist (e.g., create-entity, use-ai-chat)" }
  ]
},
{
  "name": "get_onboarding_status",
  "description": "Query the current onboarding state: path chosen, tasks completed, visibility tier, tutorial progress.",
  "category": "onboarding",
  "parameters": []
}
```

Chat handlers in `web/src/lib/chat/handlers/onboardingHandlers.ts` (NEW):

```typescript
export function handleStartOnboarding(args: Record<string, unknown>): ExecutionResult { ... }
export function handleCompleteOnboardingTask(args: Record<string, unknown>): ExecutionResult { ... }
export function handleGetOnboardingStatus(_args: Record<string, unknown>): ExecutionResult { ... }
```

Register in `web/src/lib/chat/executor.ts` handler registry.

### Test Plan

#### Unit Tests (vitest)

1. **OnboardingWizard.test.tsx** -- Renders intent selection, hides AI card for starter tier, navigates between steps, calls onComplete, backward compatibility with legacy localStorage keys
2. **OnboardingTipManager.test.tsx** -- Shows correct tip for each path, respects cooldown, dismisses tips, does not show tips after onboarding completed
3. **onboardingStore additions** -- `setOnboardingPath`, `autoPromoteVisibilityTier` logic, `recordFirstInteraction`, persistence roundtrip
4. **RightPanelTabs filtering** -- Only shows tabs for current visibility tier, "Show all" override works
5. **TemplateGallery inline mode** -- Renders without fixed overlay when `inline={true}`
6. **Analytics events** -- Correct event names and payloads for all new tracking functions
7. **onboardingHandlers.test.ts** -- All 3 MCP handlers return correct results

#### E2E Tests (Playwright)

1. **New user happy path (AI)** -- Sign in, see wizard, click "Build with AI", chat panel opens, type prompt, play mode activates
2. **New user happy path (Template)** -- See wizard, click template, game loads, auto-play countdown, stop play, checklist visible
3. **New user happy path (Blank)** -- See wizard, click blank, contextual tip appears, create entity, tip changes
4. **Returning user** -- No wizard shown (localStorage key present)
5. **Progressive disclosure** -- New user sees only Inspector + Chat tabs. After 3 basic tasks, Script and Modify tabs appear
6. **Legacy migration** -- User with `forge-welcomed` localStorage key does not see new wizard

---

## Acceptance Criteria

- Given a brand-new user (no localStorage state), When they load the editor, Then they see the OnboardingWizard with 4 path options (3 for starter tier) within 2 seconds of WASM load
- Given a user selects "Build with AI", When the wizard dismisses, Then the right panel switches to the AI Chat tab with the input focused and ghost placeholder text visible
- Given a user selects "Start from Template", When they pick a template, Then the template loads and play mode auto-starts within 3 seconds
- Given a user selects "Blank Canvas", When 3 seconds pass without any action, Then a contextual tip toast appears suggesting right-click to add an entity
- Given a user selects "Guided Tour", When the wizard dismisses, Then the TutorialOverlay activates with the `first-scene` tutorial
- Given a starter-tier user, When the OnboardingWizard renders, Then the "Build with AI" card is not visible
- Given a new user who has not completed 3 basic tasks, When they look at the right panel tabs, Then only Inspector and AI Chat tabs are visible
- Given a user completes 3 basic tasks, When `autoPromoteVisibilityTier` runs, Then the visibility tier upgrades to `intermediate` and Script/Modify tabs appear
- Given a user has `forge-quickstart-completed` or `forge-welcomed` in localStorage, When they load the editor, Then the OnboardingWizard does not appear (backward compatibility)
- Given an AI agent sends `start_onboarding` via MCP, When the command executes, Then the OnboardingWizard appears with the specified path pre-selected
- Given an AI agent sends `get_onboarding_status` via MCP, When the command executes, Then it returns the current path, tasks completed, and visibility tier as structured JSON

## Constraints

- **No Rust changes required.** This feature is entirely web-layer. The engine does not need to know about onboarding state.
- **No new npm dependencies.** All UI is built with existing Tailwind + Lucide + Zustand patterns.
- **Backward compatibility required.** Users with existing localStorage keys (`forge-quickstart-completed`, `forge-welcomed`, `forge-onboarding` Zustand persist key) must not see the new wizard. The migration path checks all 3 keys.
- **Performance budget.** OnboardingWizard must not increase initial bundle size. Use `lazy()` import in EditorLayout (same pattern as current QuickStartFlow).
- **Mobile/compact layout.** OnboardingWizard must work in compact mode. The intent selection should stack vertically (single column) below 640px viewport width.
- **Feature visibility tier must not block power users.** The PanelsMenu always shows a "Show all panels" option that immediately promotes to `expert` tier. Progressive disclosure is a suggestion, not a gate.

## Alternatives Considered

### 1. Keep the current multi-modal approach, just fix the z-index conflicts

Rejected. The fundamental problem is not z-index ordering but the lack of a coherent narrative. Three separate entry points (QuickStartFlow, WelcomeModal, WelcomeWizard) each make independent assumptions about what the user needs. Fixing z-index would not address the personalization gap or the missing AI-first path.

### 2. Remove onboarding entirely and rely on the editor being self-explanatory

Rejected. SpawnForge has 25+ panels, 327 MCP commands, and concepts (ECS, WASM, WebGPU) that are unfamiliar to the target audience ("Canva for games" users). Browser-based game engines have a steeper learning curve than document editors. Onboarding is necessary for activation.

### 3. Full video tutorial instead of interactive onboarding

Rejected. Video tutorials have < 30% completion rates. Interactive onboarding (the existing TutorialOverlay spotlight approach) has higher engagement because users learn by doing. The spec preserves the interactive tutorial as one of four paths.

### 4. Server-side onboarding state (database)

Rejected for now. The onboardingStore already uses Zustand persist (localStorage), which survives across sessions on the same device. Server-side state adds complexity (API route, DB migration, auth dependency) for marginal benefit. Can be added later when cross-device sync is prioritized.

## Error Handling

| Error Condition | User Experience | Recovery Path |
|-----------------|-----------------|---------------|
| AI provider rate limit hit during onboarding AI path (HTTP 429) | Toast message: "AI is a bit busy right now — try again in a moment." Chat input remains enabled. | Retry button in toast; user can type manually while waiting. |
| AI provider auth error (HTTP 401/403) during first AI generation | Toast: "AI isn't available for your account. Contact support." "Build with AI" card grays out. | Redirect to upgrade page if on starter tier; show support link otherwise. |
| WASM engine fails to load (fetch error or WASM compile error) | Skeleton loading UI stays visible; after 10s timeout shows error banner: "Engine failed to load. Try refreshing the page." | Reload button in error banner; link to browser compatibility page. |
| Network disconnection during template load in onboarding | Template gallery shows spinner until timeout (8s), then inline error: "Couldn't load templates. Check your connection." | Retry button reloads the template list; "Start Blank" option always available as fallback. |
| Token depletion detected before first AI generation | OnboardingWizard shows "Build with AI" card with token-depleted badge instead of hiding it. | Clicking the card shows the token purchase/upgrade dialog instead of opening chat. |
| Database connection failure when loading recent projects | Recent projects section in OnboardingWizard renders as empty with a subtle "Couldn't load recent projects" note. | No blocking — user can still proceed with any of the 4 onboarding paths. Recent projects are non-critical. |
| `onboardingStore` persist hydration failure (corrupted localStorage) | `onboardingStore` falls back to initial state (fresh user). Wizard appears even for returning users. | User dismisses wizard; `onboardingCompleted: true` is re-written to localStorage on completion. Subsequent loads are correct. |
| Analytics event dispatch failure (PostHog unavailable) | Silently swallowed — analytics is non-blocking. User experience is unaffected. | No recovery needed; funnel metrics will have a gap. Alert via PostHog health dashboard if persistent. |

## Implementation Order

1. **Phase 1: OnboardingWizard** -- Create the unified wizard, wire up in EditorLayout, backward compatibility. Delete old components.
2. **Phase 2: Progressive Disclosure** -- Add `featureVisibilityTier` to onboardingStore, filter RightPanelTabs, add auto-promotion logic.
3. **Phase 3: Contextual Tips** -- Create OnboardingTipManager, define tip data, wire up store subscriptions.
4. **Phase 4: MCP + Analytics** -- Add 3 MCP commands, chat handlers, analytics events.
5. **Phase 5: Tests** -- Unit tests for all new components, E2E tests for happy paths.

Each phase is independently shippable and testable.
