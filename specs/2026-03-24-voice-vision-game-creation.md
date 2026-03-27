# Spec: Voice-and-Vision Game Creation

> **Status:** DRAFT -- Awaiting Approval
> **Date:** 2026-03-24
> **Ticket:** PF-556
> **Scope:** Let users describe a game verbally or sketch it visually, and have AI build it

## Problem

SpawnForge's AI chat requires users to type structured text prompts. This creates two barriers:
1. **Speed** -- describing a game scene verbally is 3-5x faster than typing it.
2. **Visual intent** -- sketching a layout on paper or whiteboard captures spatial relationships that are tedious to describe in words ("put a wall here, enemies over there").

Competitors (Unity Muse, Roblox Assistant) are adding multimodal input. SpawnForge must support voice and image input to maintain its "Canva for games" positioning.

## Existing Infrastructure

- **AI chat route** (`web/src/app/api/chat/route.ts`) already uses Vercel AI SDK with streaming.
- **Generation handlers** (`web/src/lib/chat/handlers/generationHandlers.ts`) handle async AI jobs.
- **Asset generation routes** exist for sprites, textures, music, SFX, voice, models, skyboxes.
- **328 MCP commands** cover entity creation, materials, physics, scripting -- the AI can already build scenes from text instructions.
- **Scene context** (`web/src/lib/chat/context.ts`) provides current scene state to AI.

The gap is **input modality** -- the system only accepts text today.

## Solution

### Phase 1: Voice Input (Low Risk)

Add a microphone button to the chat panel that records audio, transcribes it via Whisper API, and feeds the transcript into the existing chat pipeline.

**Why this is simple:** The existing chat handler chain already works with natural language. Voice is just a new input method for the same pipeline.

#### Web Changes

1. **`web/src/components/chat/VoiceInputButton.tsx`** -- React component with mic icon, press-to-talk UX.
   - Uses `MediaRecorder` API (browser-native, no library needed).
   - Records WebM/Opus audio chunks.
   - Shows recording indicator (duration, waveform visualization via `AnalyserNode`).
   - On release: sends audio blob to transcription endpoint.

2. **`web/src/app/api/chat/transcribe/route.ts`** -- Server-side transcription endpoint.
   - Accepts `multipart/form-data` with audio file.
   - Forwards to OpenAI Whisper API (`/v1/audio/transcriptions`).
   - Returns plain text transcript.
   - Rate limited: 10 req/min per user (reuse `distributedRateLimit`).
   - Token cost: deduct from user balance (Whisper is ~$0.006/min).

3. **`web/src/components/chat/ChatInput.tsx`** -- Integrate VoiceInputButton next to send button.
   - Transcript populates input field for user review before sending.
   - Optional "auto-send" toggle for power users.

#### Cost Control
- Max recording duration: 60 seconds (prevents accidental cost).
- Audio compressed client-side (WebM/Opus, ~32kbps = ~240KB/min).
- Whisper API cost: ~$0.006/minute -- negligible vs. LLM inference.

### Phase 2: Vision Input (Medium Risk)

Accept images (photos of sketches, screenshots, diagrams) and use multimodal LLM to interpret them as scene descriptions, then feed those descriptions into the existing command pipeline.

#### Web Changes

1. **`web/src/components/chat/ImageUploadButton.tsx`** -- Drop zone + paste + file picker.
   - Accepts PNG, JPEG, WebP. Max 4MB (resized client-side if larger).
   - Shows thumbnail preview in chat input area.
   - Multiple images per message supported (max 4).

2. **`web/src/app/api/chat/route.ts`** -- Extend to accept multimodal messages.
   - Vercel AI SDK already supports `image` content parts in messages.
   - When image is present, system prompt gets a "vision interpreter" preamble: "The user has provided a sketch/image. Analyze it to determine scene layout, entity types, and spatial relationships. Then use SpawnForge commands to build it."
   - Image sent as base64 data URL in message content (within 4MB limit).

3. **`web/src/lib/chat/context.ts`** -- Add vision-specific context.
   - When image is attached, inject prompt guidance: coordinate mapping (image pixels to world units), common sketch patterns (boxes = walls, circles = entities, arrows = movement).

#### Vision Interpretation Strategy

The multimodal LLM (Claude or GPT-4o) handles interpretation directly -- no separate vision model needed. The key is **prompt engineering**:

- Sketches: "This is a hand-drawn game level sketch. Identify walls, platforms, spawn points, enemies, and items. Map spatial layout to a 3D/2D scene."
- Screenshots: "This is a screenshot from another game. Recreate the scene layout and style using SpawnForge entities. Do not copy copyrighted assets."
- Diagrams: "This is a game design diagram. Identify game mechanics, entity relationships, and create the described systems."

### Phase 3: Combined Voice+Vision (Phase 1+2 Prerequisite)

User sketches on paper, takes a photo, then narrates: "This is a dungeon crawler -- the big room is the boss arena, the narrow parts are corridors with traps."

No new architecture needed -- Phase 1 transcript + Phase 2 image both feed into the same chat message.

## Constraints

- **No real-time voice streaming** in Phase 1 -- press-to-talk only. Streaming transcription adds complexity (WebSocket, partial results) with minimal UX gain for game creation use cases.
- **No on-device transcription** -- Whisper API is server-side. Offline support deferred.
- **Image size limit: 4MB** -- browser memory and API limits. Client-side resize for larger images.
- **Vision accuracy** -- sketches are inherently ambiguous. The AI should ask clarifying questions rather than guessing wrong. Prompt must instruct: "If the sketch is ambiguous, ask the user to clarify before building."
- **Token cost** -- vision messages cost ~2-4x more tokens than text. Track and display cost in UI.

## Performance Budgets

| Operation | Budget |
|-----------|--------|
| Audio recording start | < 100ms (MediaRecorder init) |
| Transcription (60s audio) | < 5s (Whisper API) |
| Image resize (client-side) | < 500ms |
| Vision interpretation | Same as normal chat (~2-10s depending on complexity) |

## Acceptance Criteria

- Given the chat panel is open, When the user clicks the mic button and speaks "Create a platformer with 3 platforms and a player", Then the transcript appears in the input field and can be sent as a normal message.
- Given an image of a hand-drawn level sketch is attached, When the user sends the message "Build this level", Then the AI creates entities matching the spatial layout in the sketch.
- Given the user has no remaining tokens, When they try to record audio, Then the mic button is disabled with a tooltip "Insufficient tokens for voice input."
- Given the user is on a free tier, When they try to upload an image, Then they see an upgrade prompt (vision is Pro+ feature due to cost).

## Alternatives Considered

1. **Browser-local Whisper (whisper.cpp WASM)** -- Rejected. ~150MB model download, slow on mobile, poor accuracy vs. API. Revisit when WebGPU compute is widespread.
2. **Separate vision model (CLIP, SAM)** -- Rejected. Multimodal LLMs handle sketch interpretation better than pipeline of specialized models. Simpler architecture.
3. **Real-time voice streaming** -- Deferred. Press-to-talk is sufficient for game creation (not a conversational assistant).

## Phased Delivery

| Phase | Scope | Effort |
|-------|-------|--------|
| 1 | Voice input (mic button, Whisper transcription) | ~3 days |
| 2 | Vision input (image upload, multimodal chat) | ~3 days |
| 3 | Combined voice+vision, prompt refinement | ~1 day |
