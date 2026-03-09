# Phase 4-B: Next-Gen AI Chat Panel -- Implementation Plan

**Date:** 2026-03-09
**Design Doc:** `docs/plans/2026-03-09-ai-chat-panel-design.md`
**Prerequisite:** PR #1224 must be merged first (conversation management, markdown, suggestions, token counter)

---

## Implementation Order

Features are ordered by dependency chain and value. Each step follows TDD: write tests first, then implement, then verify.

---

## Step 1: Prompt Template Library (Data + Store + UI)

**Goal:** Static prompt template data, custom template CRUD, searchable panel.

### 1A: Prompt Template Data
**File:** `web/src/data/promptTemplates.ts`
**Test file:** `web/src/data/__tests__/promptTemplates.test.ts`

Tests:
- All templates have required fields (id, title, description, category, promptTemplate)
- No duplicate IDs
- All categories are from the allowed set
- Template placeholders use valid tokens ({{selection}}, {{sceneName}})

Implementation:
- Export `BUILT_IN_TEMPLATES: PromptTemplate[]` with ~15 templates across 5 categories
- Export `TEMPLATE_CATEGORIES: string[]`
- Export type `PromptTemplate`

### 1B: Template Store Actions
**File:** `web/src/stores/chatStore.ts` (extend)
**Test file:** `web/src/stores/__tests__/chatStore.promptTemplates.test.ts`

Tests:
- `loadCustomTemplates()` loads from localStorage
- `saveCustomTemplate()` persists and appears in state
- `deleteCustomTemplate()` removes by ID
- Custom templates survive round-trip (save -> load)
- Handles corrupt localStorage gracefully

Implementation:
- Add `customTemplates: PromptTemplate[]` to ChatState
- Add `loadCustomTemplates`, `saveCustomTemplate`, `deleteCustomTemplate` actions
- localStorage key: `forge-prompt-templates`

### 1C: PromptTemplatePanel Component
**File:** `web/src/components/chat/PromptTemplatePanel.tsx`
**Test file:** `web/src/components/chat/__tests__/PromptTemplatePanel.test.tsx`

Tests:
- Renders all built-in templates grouped by category
- Filter input narrows visible templates
- Clicking a template calls `onSelect(promptText)` with placeholders resolved
- "Create Custom" form appears and saves
- Custom templates appear alongside built-in ones
- Delete button only appears on custom templates

Implementation:
- Popover panel triggered from a new toolbar button in ChatInput
- Category tabs or collapsible sections
- Search/filter input at top
- Template card: title, description, "Use" button
- Placeholder resolution: `{{selection}}` -> primary entity name, `{{sceneName}}` -> current scene name

---

## Step 2: Chat History Search

**Goal:** Search across all conversations' message content, navigate to results.

### 2A: Search Logic
**File:** `web/src/lib/chat/search.ts`
**Test file:** `web/src/lib/chat/__tests__/search.test.ts`

Tests:
- `searchConversations(query, conversations)` returns matching results
- Case-insensitive matching
- Returns snippet with query highlighted (context window around match)
- Empty query returns empty results
- Handles conversations with no messages
- Limits to first 100 messages per conversation
- Results sorted by timestamp (newest first)

Implementation:
- `searchConversations(query: string, conversations: Conversation[]): SearchResult[]`
- Returns `{ conversationId, conversationName, messageId, snippet, timestamp }`
- Snippet is ~100 chars surrounding the match

### 2B: Search Store Integration
**File:** `web/src/stores/chatStore.ts` (extend)
**Test file:** `web/src/stores/__tests__/chatStore.search.test.ts`

Tests:
- `setSearchQuery` updates state
- `searchConversations` action populates `searchResults`
- Switching to a search result calls `switchConversation` and sets scroll target

Implementation:
- Add `searchQuery`, `searchResults`, `searchScrollTarget` to state
- `searchConversations()` reads `conversations` from state, calls search logic

### 2C: ConversationSearch Component
**File:** `web/src/components/chat/ConversationSearch.tsx`
**Test file:** `web/src/components/chat/__tests__/ConversationSearch.test.tsx`

Tests:
- Renders search input
- Typing triggers debounced search (300ms)
- Results list shows conversation name, snippet, time
- Clicking a result calls switchConversation
- "No results" shown for empty result set
- Clearing search hides results

Implementation:
- Inline in ConversationList header area
- Search icon toggle to show/hide search input
- Debounced input -> searchConversations call
- Result list with click handlers

---

## Step 3: AI Project Memory

**Goal:** Persistent per-project memory that the AI can read and write.

### 3A: Memory CRUD Library
**File:** `web/src/lib/chat/memory.ts`
**Test file:** `web/src/lib/chat/__tests__/memory.test.ts`

Tests:
- `loadMemory(projectId)` returns null for new project
- `saveMemory(projectId, memory)` persists to localStorage
- `updatePreference(projectId, key, value)` adds/updates
- `deletePreference(projectId, key)` removes
- `addDecision(projectId, text)` appends to decisions array
- Memory serialization stays under 2000 char limit (truncates oldest decisions)
- `formatMemoryForPrompt(memory)` produces system prompt text
- Handles missing/corrupt localStorage

Implementation:
- localStorage key: `forge-memory-{projectId}`
- `ProjectMemory` type with preferences, decisions, lastUpdated
- `formatMemoryForPrompt()` returns formatted string for system prompt injection

### 3B: Memory Chat Tools
**File:** `web/src/lib/chat/handlers/memoryHandlers.ts`
**Test file:** `web/src/lib/chat/handlers/__tests__/memoryHandlers.test.ts`

Tests:
- `update_project_memory` tool saves preference and returns success
- `get_project_memory` tool returns current memory state
- Memory values are sanitized (sanitizeChatInput)
- Key names are validated (alphanumeric + underscore, max 50 chars)
- Value length capped at 200 chars

Implementation:
- Register `update_project_memory` and `get_project_memory` in executor handler registry
- Import memory CRUD from `memory.ts`
- Tools need projectId -- derive from current conversation or use a store field

### 3C: Memory Injection in Context
**File:** `web/src/lib/chat/context.ts` (extend)
**Test file:** `web/src/lib/chat/__tests__/context.memory.test.ts`

Tests:
- `buildSceneContext` includes memory section when memory exists
- Memory section omitted when memory is null/empty
- Memory section is properly formatted

Implementation:
- Load memory in `buildSceneContext` and append formatted block
- Add instruction for AI to use `update_project_memory` when user states preferences

### 3D: Memory Tool Registration
**File:** `web/src/lib/chat/tools.ts` (extend)
**Test file:** covered by existing tools tests

Implementation:
- Add `update_project_memory` and `get_project_memory` tool definitions to `getChatTools()`

### 3E: MemoryEditor Component
**File:** `web/src/components/chat/MemoryEditor.tsx`
**Test file:** `web/src/components/chat/__tests__/MemoryEditor.test.tsx`

Tests:
- Renders all preferences as key-value pairs
- Edit button enables inline editing
- Delete button removes a preference
- Decisions list shown below preferences
- "Clear All" button with confirmation
- Shows char count / 2000 limit

Implementation:
- Accessible from a gear/settings menu in ChatPanel header
- Simple table of key-value pairs with edit/delete
- Decisions as a bullet list
- Usage bar showing memory utilization

---

## Step 4: Scene Advisor (Proactive AI)

**Goal:** Background analysis of sceneGraph that produces actionable advisories.

### 4A: Advisory Engine
**File:** `web/src/lib/chat/advisors.ts`
**Test file:** `web/src/lib/chat/__tests__/advisors.test.ts`

Tests:
- `analyzeScene(editorState)` returns Advisory[] for each rule:
  - PERF-001: scene with >50 entities produces warning
  - PERF-002: >5 shadow-casting lights produces warning
  - PHYS-001: dynamic entity at Y<0 produces warning
  - PHYS-002: dynamic entity without collider shape produces error
  - SCRIPT-001: script referencing missing entity name produces error (requires script content analysis)
  - LIGHT-001: no directional light with meshes produces info
  - LIGHT-002: ambient intensity >3.0 produces info
  - STRUCT-001: hierarchy depth >5 produces info
- Returns empty array for healthy scene
- Each advisory has unique ID, category, severity, title, suggestedPrompt
- Performance: analysis of 100-entity scene completes in <50ms

Implementation:
- Each rule is a function: `(state: EditorSnapshot) => Advisory | null`
- `analyzeScene` runs all rules and collects non-null results
- Advisory IDs are deterministic (based on rule + entity IDs) for deduplication

### 4B: useAdvisories Hook
**File:** `web/src/hooks/useAdvisories.ts`
**Test file:** `web/src/hooks/__tests__/useAdvisories.test.ts`

Tests:
- Returns advisories array
- Re-runs analysis when sceneGraph changes (debounced)
- Does not re-run when unrelated store fields change
- Respects `showAdvisories` toggle

Implementation:
- Subscribe to sceneGraph from editorStore
- Debounce with 500ms delay
- Call `analyzeScene` and update chatStore `advisories`
- Memoize to avoid unnecessary re-renders

### 4C: AdvisoryChips Component
**File:** `web/src/components/chat/AdvisoryChips.tsx`
**Test file:** `web/src/components/chat/__tests__/AdvisoryChips.test.tsx`

Tests:
- Renders nothing when no advisories
- Renders chips for each advisory with severity-based color
- Clicking a chip calls `onSelect(suggestedPrompt)`
- Dismiss button removes individual advisory
- Horizontally scrollable on narrow viewports
- Error severity chips are shown first

Implementation:
- Positioned above SuggestionChips in ChatPanel
- Each chip: icon (severity), short title, click to populate chat input
- Dismiss with X button (adds advisory ID to dismissed set in sessionStorage)

---

## Step 5: Collaborative Batch Editing

**Goal:** Per-tool-call approve/reject and diff view for preview mode.

### 5A: ChangeProposalView Component
**File:** `web/src/components/chat/ChangeProposalView.tsx`
**Test file:** `web/src/components/chat/__tests__/ChangeProposalView.test.tsx`

Tests:
- Renders grouped tool calls by target entity
- Each tool call shows: tool name, key params, individual approve/reject buttons
- "Approve All" and "Reject All" buttons still present
- After individual approve, that tool shows success status
- After individual reject, that tool shows rejected status
- Handles mixed approved/rejected state correctly

Implementation:
- Replaces the simple approve/reject buttons in ChatMessage when tools have `status: 'preview'`
- Groups tool calls by entity ID (parsed from `input.entityId` or `input.entity_id`)
- Shows a summary: "3 changes to Player, 2 changes to Ground, 1 new entity"
- Individual checkboxes or approve/reject per item

### 5B: Individual Tool Approve/Reject Actions
**File:** `web/src/stores/chatStore.ts` (extend)
**Test file:** `web/src/stores/__tests__/chatStore.batchEdit.test.ts`

Tests:
- `approveToolCall(messageId, toolCallId)` executes single tool and updates status
- `rejectToolCall(messageId, toolCallId)` marks single tool as rejected
- Partial approval: some approved, some rejected
- After all tools are resolved (no more 'preview'), message is finalized

Implementation:
- `approveToolCall`: find specific tool call, execute it, update status
- `rejectToolCall`: find specific tool call, set status to 'rejected'
- Existing `approveToolCalls`/`rejectToolCalls` still work as bulk operations

---

## Step 6: Viewport Screenshot Capture

**Goal:** Capture the engine canvas and attach to chat.

### 6A: Viewport Capture Utility
**File:** `web/src/lib/chat/viewportCapture.ts`
**Test file:** `web/src/lib/chat/__tests__/viewportCapture.test.ts`

Tests:
- `captureViewport()` returns base64 PNG string
- Returns null if canvas not found
- Resizes to max 1024px width if canvas is larger
- Produces valid data URL format

Implementation:
- Find canvas element: `document.querySelector('canvas')`
- Use `canvas.toDataURL('image/png')`
- If width > 1024, create offscreen canvas, draw scaled, return that
- Return null on failure (e.g., tainted canvas, missing element)

### 6B: ViewportCapture Button
**File:** `web/src/components/chat/ViewportCapture.tsx`
**Test file:** `web/src/components/chat/__tests__/ViewportCapture.test.tsx`

Tests:
- Renders camera icon button
- Click calls captureViewport and adds to images
- Shows loading state during capture
- Hidden on compact layout (mobile)
- Disabled when canvas not available

Implementation:
- Button in ChatInput toolbar row
- On click: capture -> add to images state -> show preview
- Camera icon from lucide-react

---

## Step 7: Asset Drag-and-Drop into Chat

**Goal:** Accept dragged entities and assets into the chat input.

### 7A: ChatInput DnD Enhancement
**File:** `web/src/components/chat/ChatInput.tsx` (extend)
**Test file:** `web/src/components/chat/__tests__/ChatInput.dnd.test.ts`

Tests:
- Dropping an image file adds it to images array
- Dropping entity data (application/x-forge-entity) inserts @-mention
- Dropping asset data inserts asset reference text
- Visual drop zone indicator appears on dragover
- Drop zone deactivates on dragleave
- Invalid drop data is ignored

Implementation:
- Add `onDragOver`, `onDragLeave`, `onDrop` handlers to the textarea container
- Check `dataTransfer.types` for content type routing
- Entity: parse entity data, insert `@EntityName` and call `addEntityRef`
- Asset: insert "Use asset: {assetName} ({assetId})" text
- Image: same as existing paste handler

---

## Step 8: Integration and Polish

### 8A: Wire Advisory Hook into ChatPanel
- Import `useAdvisories` in ChatPanel
- Render `AdvisoryChips` between message list and input
- Add toggle in chat settings

### 8B: Wire Memory into Context Pipeline
- Load memory on conversation load
- Inject into `buildSceneContext`
- Add memory tools to tool registry

### 8C: Wire All New Components into ChatPanel
- PromptTemplatePanel button in toolbar
- ViewportCapture button in toolbar
- ChangeProposalView in message rendering
- ConversationSearch in ConversationList
- MemoryEditor in settings menu

### 8D: Mobile Responsiveness
- Advisory chips horizontal scroll
- PromptTemplatePanel as DrawerPanel on compact
- Hide viewport capture on compact
- Touch-friendly tap targets (min 44px)

### 8E: E2E Tests
**File:** `web/e2e/tests/ai-chat-panel.spec.ts`

Tests:
- Open chat panel, see suggestion chips
- Click prompt template, see it populate input
- Search conversations (if multiple exist)
- Advisory chips appear for problematic scenes
- Viewport screenshot attaches to chat

---

## Verification Checklist

After each step:
```bash
cd web && npx eslint --max-warnings 0 .
cd web && npx tsc --noEmit
cd web && npx vitest run
```

After full phase:
```bash
cd web && npx vitest run --coverage
cd web && npx playwright test
```

---

## Estimated Test Count

| Step | New Tests |
|------|-----------|
| 1: Prompt Templates | ~15 |
| 2: Chat Search | ~12 |
| 3: AI Memory | ~20 |
| 4: Scene Advisor | ~18 |
| 5: Batch Editing | ~10 |
| 6: Viewport Capture | ~8 |
| 7: Asset DnD | ~8 |
| 8: Integration + E2E | ~6 |
| **Total** | **~97** |

---

## Dependency Graph

```
PR #1224 (must merge first)
    |
    v
Step 1: Prompt Templates (independent)
Step 2: Chat Search (depends on Conversation type from PR #1224)
Step 3: AI Memory (independent, but context integration depends on existing context.ts)
Step 4: Scene Advisor (independent)
Step 5: Batch Editing (depends on existing approval mode)
Step 6: Viewport Capture (independent)
Step 7: Asset DnD (independent)
    |
    v
Step 8: Integration (depends on all above)
```

Steps 1-7 can be developed in parallel by different agents. Step 8 is the integration pass.
