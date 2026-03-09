# Phase 4-B: Next-Gen AI Chat Panel -- Design Document

**Date:** 2026-03-09
**Status:** Draft
**Depends On:** Phase 13 (AI Chat & Orchestration), PR #1224 (Markdown/Conversations/Streaming)

---

## 1. Problem Statement

SpawnForge has a functional AI chat system (Phase 13 + PR #1224) with streaming responses, tool calling, entity @-mentions, approval mode, conversation management, context-aware suggestions, and voice/image input basics. However, the current system is reactive -- the user must always initiate. The next-gen chat panel transforms the AI from a passive tool into a proactive collaborator that understands project context, remembers preferences, and proposes batch edits.

## 2. Feature Inventory

### 2A. Multi-Modal Input Enhancements
**Current state:** Image paste/attach works (base64 to Claude API). Voice input uses Web Speech API with basic transcription.
**Gaps:**
- No drag-and-drop of scene assets (textures, models) into chat
- No screenshot-of-viewport capture ("screenshot this and analyze it")
- Voice does not support continuous/long-form dictation
- No image annotation or markup before sending

### 2B. Proactive AI (Scene Advisor)
**Current state:** None. AI only responds when prompted.
**Design:**
- A background analysis system runs on `sceneGraph` changes (debounced, not every frame)
- Produces `Advisory[]` items: performance warnings, missing colliders, broken script references, lighting issues, orphaned entities
- Advisories surface as non-intrusive chips above the chat input (not as messages -- that would be annoying)
- User clicks a chip to auto-populate a chat prompt: "Fix: 5 dynamic physics entities have no colliders"
- Advisory engine is **pure TypeScript** (no Rust changes), reads from editorStore
- Gated behind user preference toggle (`showAdvisories` in chatStore)

### 2C. Prompt Templates
**Current state:** `SuggestionChips` from PR #1224 provides context-aware follow-ups.
**Design:**
- A `PromptTemplateLibrary` panel accessible via a button in the chat toolbar
- Categories: Scene Setup, Visuals, Physics, Scripting, Audio, Polish, Export
- Each template has: `title`, `description`, `promptTemplate` (with `{{selection}}`, `{{sceneName}}` placeholders)
- Templates are static data (no DB), shipped in `web/src/data/promptTemplates.ts`
- User can create custom templates saved to localStorage
- Templates are searchable with a filter input

### 2D. Chat History Search
**Current state:** Conversations persist in localStorage via `saveConversation`/`loadConversation` and the new `Conversation[]` from PR #1224.
**Design:**
- A search input in the `ConversationList` header
- Searches across all conversation message content (substring match, case-insensitive)
- Results show: conversation name, matching message snippet, timestamp
- Click navigates to the conversation and scrolls to the message
- Pure client-side search on localStorage data (no server)

### 2E. AI Memory (Project Preferences)
**Current state:** None. Each conversation starts fresh (aside from sceneContext).
**Design:**
- A `ProjectMemory` object stored in localStorage per project
- Structure: `{ preferences: Record<string, string>, decisions: string[], lastUpdated: number }`
- AI can write to memory via a new tool: `update_project_memory({ key, value })` and `get_project_memory()`
- Memory is injected into the system prompt as a `[Project Memory]` block
- Examples: "User prefers low-poly art style", "Physics scale is 1 unit = 1 meter", "Main character is the blue cube named Player"
- Memory is editable by user in a "Memory" tab within the chat panel settings
- Hard limit: 2000 chars total to avoid bloating the context window

### 2F. Collaborative Batch Editing (Change Proposals)
**Current state:** Approval mode defers tool execution and shows "preview" status. User approves/rejects all at once.
**Design:**
- Extend approval mode with a **diff view**: before approving, user sees a structured summary of proposed changes
- Group changes by entity: "Player: position (0,1,0) -> (0,3,0), add PhysicsData(dynamic)"
- Individual tool call approve/reject (currently all-or-nothing)
- A "Propose changes" prompt prefix that instructs the AI to use approval mode automatically
- No new Rust changes -- this is purely React UI on top of existing `ToolCallStatus` with `status: 'preview'`

### 2G. Viewport Screenshot Capture
**Current state:** No programmatic viewport capture.
**Design:**
- A "Screenshot" button in the chat toolbar captures the WebGL/WebGPU canvas
- Uses `canvas.toDataURL('image/png')` on the engine canvas element
- Auto-attaches to the current chat input as an image
- User can annotate with a prompt: "Make this area look more like a forest"
- The canvas element is accessed via `document.querySelector('canvas')` (the Bevy canvas)

### 2H. Asset Drag-and-Drop into Chat
**Current state:** Image paste from clipboard works.
**Design:**
- Chat textarea accepts drag-and-drop of:
  1. Image files (same as paste -- convert to base64)
  2. Scene entities (dragged from SceneHierarchy) -- auto-inserts @-mention
  3. Asset files from AssetPanel -- auto-inserts asset reference text
- Uses standard HTML5 drag events (`onDragOver`, `onDrop`)
- Entity drop detection: check `dataTransfer` for `application/x-forge-entity` MIME type (already used by SceneHierarchy DnD)

---

## 3. Architecture

### 3.1 State Changes (chatStore.ts)

```typescript
// New state fields added to ChatState
interface ChatState {
  // ... existing fields ...

  // 2B: Proactive AI
  advisories: Advisory[];
  showAdvisories: boolean;
  setShowAdvisories: (show: boolean) => void;

  // 2D: Chat History Search
  searchQuery: string;
  searchResults: SearchResult[];
  setSearchQuery: (query: string) => void;
  searchConversations: () => void;

  // 2E: AI Memory
  projectMemory: ProjectMemory | null;
  loadProjectMemory: (projectId: string) => void;
  updateProjectMemory: (key: string, value: string) => void;
  deleteProjectMemoryKey: (key: string) => void;
  clearProjectMemory: (projectId: string) => void;

  // 2F: Batch editing
  approveToolCall: (messageId: string, toolCallId: string) => Promise<void>;
  rejectToolCall: (messageId: string, toolCallId: string) => void;

  // 2C: Prompt templates
  customTemplates: PromptTemplate[];
  saveCustomTemplate: (template: PromptTemplate) => void;
  deleteCustomTemplate: (id: string) => void;
  loadCustomTemplates: () => void;
}
```

### 3.2 New Types

```typescript
interface Advisory {
  id: string;
  severity: 'info' | 'warning' | 'error';
  category: 'performance' | 'physics' | 'scripting' | 'lighting' | 'structure';
  title: string;
  description: string;
  suggestedPrompt: string;
  entityIds?: string[];
}

interface SearchResult {
  conversationId: string;
  conversationName: string;
  messageId: string;
  snippet: string;
  timestamp: number;
}

interface ProjectMemory {
  projectId: string;
  preferences: Record<string, string>;
  decisions: string[];
  lastUpdated: number;
}

interface PromptTemplate {
  id: string;
  title: string;
  description: string;
  category: string;
  promptTemplate: string;
  isCustom: boolean;
}
```

### 3.3 New Files

| File | Purpose |
|------|---------|
| `web/src/lib/chat/advisors.ts` | Scene analysis functions that produce `Advisory[]` |
| `web/src/lib/chat/memory.ts` | ProjectMemory CRUD (localStorage) |
| `web/src/lib/chat/search.ts` | Conversation search logic |
| `web/src/data/promptTemplates.ts` | Built-in prompt template library |
| `web/src/components/chat/AdvisoryChips.tsx` | Non-intrusive advisory UI above chat input |
| `web/src/components/chat/PromptTemplatePanel.tsx` | Template library browser |
| `web/src/components/chat/ConversationSearch.tsx` | Search input + results list |
| `web/src/components/chat/ChangeProposalView.tsx` | Diff view for batch approval |
| `web/src/components/chat/MemoryEditor.tsx` | View/edit project memory |
| `web/src/components/chat/ViewportCapture.tsx` | Screenshot button component |
| `web/src/hooks/useAdvisories.ts` | Hook that runs advisory analysis on sceneGraph changes |

### 3.4 New Chat Tools (for AI to use)

Two new tools added to `getChatTools()`:

```typescript
{
  name: 'update_project_memory',
  description: 'Save a project preference or decision to persistent memory. Use this when the user expresses a preference (art style, scale, naming convention) or makes an important design decision.',
  input_schema: {
    type: 'object',
    properties: {
      key: { type: 'string', description: 'Preference key (e.g., "art_style", "physics_scale")' },
      value: { type: 'string', description: 'Preference value' }
    },
    required: ['key', 'value']
  }
}

{
  name: 'get_project_memory',
  description: 'Retrieve all stored project preferences and decisions.',
  input_schema: { type: 'object', properties: {} }
}
```

### 3.5 System Prompt Extension

The system prompt gains a new section injected dynamically:

```
## Project Memory
The user has previously expressed these preferences for this project:
- art_style: low-poly stylized
- physics_scale: 1 unit = 1 meter
- naming: PascalCase entity names

Previous design decisions:
- Using CharacterController component for player movement
- Red color theme for enemies

When the user expresses a new preference or makes a design decision, use update_project_memory to save it.
```

---

## 4. Edge Cases and Constraints

### 4.1 Performance
- **Advisory analysis** must be debounced (500ms after last sceneGraph change). Must NOT run on every frame or every minor transform update
- **Conversation search** on localStorage could be slow with many conversations. Limit to scanning the first 100 messages per conversation, cap at `MAX_CONVERSATIONS` (20)
- **ProjectMemory** in system prompt adds tokens. Hard cap at 2000 chars (~500 tokens). Truncate oldest decisions if exceeded

### 4.2 Security
- **Prompt injection via memory**: The AI writes to memory, and memory is injected into the system prompt. Sanitize memory values with `sanitizeChatInput()` before storage
- **Image size**: Viewport screenshots can be large. Resize to max 1024px width before base64 encoding to stay within API limits
- **Custom templates**: User-created templates are stored in localStorage and never sent to the server as system prompts -- they only populate the user's text input

### 4.3 Mobile
- Voice input already works on mobile (Web Speech API supported on iOS Safari, Chrome Android)
- Advisory chips should be horizontally scrollable on narrow viewports
- PromptTemplatePanel should render as a bottom sheet on mobile (using existing DrawerPanel pattern)
- Viewport screenshot button should be hidden on compact layout (canvas may not be visible)

### 4.4 Tier Gating
- All features gated behind `canUseAI` permission from `userStore`
- Advisory analysis is free (no API calls -- pure client-side)
- Memory tools consume normal tool-call tokens
- No additional tier restrictions beyond existing AI access

### 4.5 WASM / Engine Boundary
- No Rust/engine changes required for any feature in this phase
- Viewport screenshot uses DOM canvas access, not engine bridge
- All features are purely React/TypeScript layer

### 4.6 Data Migration
- Existing conversations (localStorage) remain compatible -- new fields are optional
- ProjectMemory is a new localStorage key (`forge-memory-{projectId}`) -- no migration needed
- Custom templates use a separate key (`forge-prompt-templates`) -- no migration needed

---

## 5. What Is NOT In Scope

- **Real-time AI suggestions as you type** -- too expensive (API call per keystroke)
- **AI watching play-mode and giving feedback** -- would require engine-to-JS performance metrics pipeline (Phase 31 LOD stubs exist but are not real)
- **Multi-user collaborative chat** -- Phase 24 (Editor Collaboration) was removed
- **Server-side conversation storage** -- keeping localStorage for now; DB persistence is a future concern
- **AI-generated images** -- Phase 14 (AI Asset Generation) handles this separately
- **Custom AI personas/roles** -- out of scope for this phase

---

## 6. Component Hierarchy

```
ChatPanel (existing)
  +-- ConversationList (existing, from PR #1224)
  |     +-- ConversationSearch (NEW)
  +-- ChatMessage[] (existing)
  +-- ChangeProposalView (NEW, replaces simple approve/reject for preview tools)
  +-- AdvisoryChips (NEW, above input)
  +-- SuggestionChips (existing)
  +-- ChatInput (existing, enhanced with DnD + viewport capture)
  |     +-- ViewportCapture (NEW, button in toolbar)
  |     +-- PromptTemplatePanel (NEW, popover from toolbar button)
  +-- MemoryEditor (NEW, accessible from chat settings gear)
```

---

## 7. Advisory Rules (Initial Set)

| Rule ID | Category | Condition | Severity | Suggested Prompt |
|---------|----------|-----------|----------|-----------------|
| PERF-001 | performance | Scene has > 50 entities | warning | "I have {count} entities. Can you help optimize my scene?" |
| PERF-002 | performance | > 5 point lights with shadows enabled | warning | "I have many shadow-casting lights. Can you optimize the lighting setup?" |
| PHYS-001 | physics | Entity has PhysicsData but body_type=dynamic and is positioned at Y<0 | warning | "Some physics objects are below the ground plane" |
| PHYS-002 | physics | Dynamic entity with no collider shape | error | "Fix: {count} dynamic physics entities have no collider" |
| SCRIPT-001 | scripting | Script references entity by name that does not exist in scene | error | "Script on '{entity}' references missing entity '{name}'" |
| LIGHT-001 | lighting | No directional light in scene with meshes | info | "Your scene has no directional light. Add one for better visibility?" |
| LIGHT-002 | lighting | Ambient light intensity > 3.0 | info | "Ambient light is very bright. Lower it for more contrast?" |
| STRUCT-001 | structure | Deeply nested hierarchy (> 5 levels) | info | "Entity hierarchy is deeply nested. Consider flattening for clarity." |

---

## 8. Built-In Prompt Templates (Initial Set)

### Scene Setup
- "Create a platformer level" -- "Create a platformer level with a player entity, 5 platforms at different heights, 3 collectible coins, and a ground plane. Add colorful materials and basic lighting."
- "Set up a 3D scene from scratch" -- "Set up a complete 3D scene with a ground plane, directional light with shadows, ambient light, and a camera positioned to see everything. Use a {{sceneName}} theme."
- "Populate with enemies" -- "Add 4 enemy entities to my scene. Position them strategically around {{selection}}. Give them red-tinted materials and add CharacterController game components."

### Visuals
- "Make it realistic" -- "Improve the visual quality of my scene: add PBR materials with appropriate metallic/roughness values, enable bloom post-processing, add fog for depth, and improve the lighting."
- "Apply a color theme" -- "Apply a cohesive color theme to all entities in my scene. Use complementary colors with consistent metallic and roughness values."
- "Add atmosphere" -- "Add atmospheric effects: fog, bloom, adjusted ambient light, and particle effects (dust or rain) to create mood."

### Physics & Gameplay
- "Make it playable" -- "Add physics and game components to make my scene playable: set the ground as static, player as dynamic with a CharacterController, and add collectibles with triggers."
- "Set up a puzzle" -- "Create a physics puzzle: add moveable boxes, pressure plates (triggers), and a door that opens when all plates are activated."

### Audio
- "Add sound design" -- "Add appropriate audio to my scene: background music on a music bus, footstep sounds on the player, and ambient environment sounds."

### Export
- "Pre-export checklist" -- "Review my scene for export readiness. Check for: missing colliders on physics objects, scripts with errors, performance issues, and suggest improvements."
