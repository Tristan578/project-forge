# Spec: AI Procedural Animation from Descriptions

> **Status:** DRAFT -- Awaiting Approval
> **Date:** 2026-03-24
> **Ticket:** PF-563
> **Scope:** Generate walk/run/attack animations from natural language descriptions

## Problem

SpawnForge has a procedural animation module (`web/src/lib/ai/proceduralAnimation.ts`, 663 lines) that generates 10 animation types algorithmically from bone names. While functional, the animations are formulaic -- every "walk" looks identical regardless of character personality. Users want to describe animations in natural language ("a tired old man shuffling forward", "a ninja doing a spinning kick") and get unique, character-appropriate motion.

## Existing Infrastructure

- `web/src/lib/ai/proceduralAnimation.ts` -- algorithmic generator: `generateAnimation()`, `classifyBones()`, `animationToClipData()`, 10 types, 4 style presets
- `web/src/components/editor/ProceduralAnimPanel.tsx` -- UI panel for procedural anim generation
- `engine/src/core/commands/animation.rs` -- 20+ animation commands: play, pause, create_animation_clip, add_keyframe, etc.
- `engine/src/core/pending/animation.rs` -- `AnimationRequest`, `AnimationAction` enums
- `engine/src/bridge/animation.rs` -- GLTF animation registration, clip playback
- `web/src/stores/slices/types.ts` -- `AnimationClipData`, `AnimationTrack`, `AnimationKeyframe` types
- `web/src/lib/ai/models.ts` -- AI provider configuration
- `web/src/app/api/generate/` -- established generation route pattern

## Solution

Layer an LLM-powered description interpreter on top of the existing procedural system. The LLM does not generate raw keyframes (too noisy, too many parameters). Instead, it maps a natural language description to a structured parameter set that feeds the existing `generateAnimation()` pipeline with per-bone amplitude/timing/style overrides.

### Architecture

```
"a tired old man shuffling forward"
    |  POST /api/generate/animation
    v
LLM structured output -> AnimationSpec {
  baseType: "walk",
  speed: 0.4,
  amplitude: 0.6,
  style: "realistic",
  boneOverrides: {
    spine: { bendForward: 15, sway: 0.3 },
    leftArm: { swingAmplitude: 0.3 },
    ...
  },
  timing: { stanceRatio: 0.7 }
}
    |  mergeWithDefaults()
    v
generateAnimation(bones, type, mergedParams)
    |  animationToClipData()
    v
create_animation_clip command -> Bevy ECS
```

### Phase 1: LLM Parameter Extraction + Enhanced Generator

**Web Changes**

1. `web/src/lib/ai/animationDescriptionParser.ts` -- Pure-function module:
   - `AnimationSpec` type -- structured representation of an animation description: base type, global params, per-bone overrides (bend angles, swing amplitudes, timing offsets), transition hints
   - `buildAnimationPrompt(description, availableBones): string` -- creates prompt with bone inventory and parameter schema for structured output
   - `parseAnimationSpec(llmResponse): AnimationSpec` -- validates and clamps all values to safe ranges
   - `mergeSpecWithDefaults(spec, defaults): AnimationParams` -- overlays LLM-derived params onto base type defaults
   - `DESCRIPTION_EXAMPLES: { input: string, output: AnimationSpec }[]` -- few-shot examples for prompt engineering

2. Enhancement to `web/src/lib/ai/proceduralAnimation.ts`:
   - New `BoneOverrides` type: per-bone amplitude, phase offset, angle bias, secondary motion
   - Extended `AnimationParams` with optional `boneOverrides: Record<string, BoneOverrides>` and `timing: TimingParams`
   - `generateAnimation()` applies overrides during keyframe computation -- existing callers unaffected (overrides default to empty)

3. `web/src/app/api/generate/animation/route.ts` -- API route:
   - Auth + rate limit (10 req / 5 min) + token billing (`animation_generation`: 20 tokens)
   - Input: `{ description: string, entityId: string, boneNames?: string[] }`
   - If `boneNames` not provided, queries entity's skeleton via `get_animation_state`
   - Uses AI SDK `generateObject()` with Zod schema for `AnimationSpec`
   - Returns: `{ clipData: AnimationClipData, spec: AnimationSpec }`

4. Update `web/src/components/editor/ProceduralAnimPanel.tsx`:
   - Add text input field: "Describe the animation you want..."
   - "Generate from Description" button alongside existing type-based generation
   - Show generated `AnimationSpec` as editable parameter sliders (user can tweak after generation)
   - Preview button plays the clip on the selected entity

5. `web/src/lib/chat/handlers/animationGenerationHandler.ts`:
   - Handles: "make a walk animation for this character that looks sneaky", "generate a death animation where they fall backwards"
   - Extracts entity context, calls API, applies clip

**MCP Commands (2 new)**

| Command | Params | Description |
|---------|--------|-------------|
| `generate_animation_from_description` | `{ entityId, description, speed?, style? }` | AI-interpret description into procedural animation |
| `list_animation_presets` | `{}` | Return available base types and style options |

### Phase 2: Blend Trees + Refinement

6. Animation blending from descriptions: "blend between the walk and the limp at 60/40"
   - Uses existing `set_animation_blend_weight` command
   - LLM outputs blend graph specification

7. Iterative refinement: "make the arms swing more", "slow down the legs"
   - Stores previous `AnimationSpec` in generation history
   - LLM receives previous spec + delta instruction, outputs modified spec

### Phase 3: AI Motion Matching (Future)

8. Motion dataset integration -- index of reference animations from Mixamo/similar
9. LLM selects closest reference, then parametrically modifies to match description
10. Requires cloud-hosted motion database (separate infrastructure)

## Engine Changes (Rust)

**None required.** The existing `create_animation_clip` and `add_keyframe` commands are sufficient. The LLM output is transformed entirely in JS into the existing `AnimationClipData` format, which the engine already consumes.

If Phase 3 motion matching requires server-side interpolation, a new `blend_animation_clips` command could be added to `core/commands/animation.rs`, but this is deferred.

## Constraints

- **No new Rust/WASM changes** -- all AI logic is JS-side, animation data flows through existing commands
- **Bone name variance** -- models from different sources use different naming (Mixamo vs. custom). `classifyBones()` already handles 6+ naming conventions; new ones may need additions
- **Quality ceiling** -- procedural keyframe animation cannot match motion-capture quality. This is a rapid prototyping tool, not a AAA animation pipeline. Set user expectations via UI copy
- **Token cost** -- single LLM call per generation (~20 tokens). Refinement iterations each cost a call
- **Latency** -- LLM structured output takes 2-5 seconds. Show progress indicator
- **Parameter clamping** -- all LLM-output values clamped to safe ranges (angles 0-180, amplitudes 0-3, speeds 0.1-5) to prevent broken animations

## Acceptance Criteria

- Given a humanoid entity with standard bones, When user types "a robot walking stiffly", Then a walk animation is generated with reduced joint ranges and mechanical timing within 5 seconds
- Given the same entity, When user types "make the arms swing less", Then the previous animation is refined with reduced arm amplitude without regenerating from scratch
- Given an entity with non-standard bone names (e.g., Mixamo `mixamorig:LeftUpLeg`), When animation is generated, Then bones are correctly classified and animated
- Given an entity with no skeleton, When animation generation is requested, Then an error message explains that the entity needs a skeletal rig
- Given an AI chat message "create a jumping animation for the knight", When processed, Then `generate_animation_from_description` is called with the selected entity and description

## Alternatives Considered

1. **Raw keyframe generation by LLM** -- Rejected: LLMs produce noisy floating-point sequences. Even with structured output, 16 bones x 3 axes x 20 keyframes = 960 values -- too error-prone and expensive per call. Parameterizing the existing generator is more reliable.
2. **Diffusion-based motion generation (MDM, MotionDiffuse)** -- Rejected for now: requires GPU inference server, model hosting (~2GB), and significant latency (10-30s). Could be Phase 3 with a cloud endpoint.
3. **Client-side ML model** -- Rejected: ONNX runtime in WASM adds binary size and the models are too large for browser delivery. Server-side only.
