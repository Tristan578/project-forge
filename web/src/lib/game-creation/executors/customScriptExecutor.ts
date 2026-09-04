import { z } from 'zod';
import { fetchAI } from '@/lib/ai/client';
import { AI_MODEL_PRIMARY } from '@/lib/ai/models';
import { sanitizePrompt } from '@/lib/ai/contentSafety';
import type { ExecutorDefinition, ExecutorContext, ExecutorResult } from '../types';
import { zSystemCategory } from '../types';
import { makeStepError, successResult, failResult } from './shared';
import { sendCommands } from './engineDispatch';

// --- [S6] PREREQUISITE: Reflect and Proxy must be in SHADOWED_GLOBALS ---
// [S6] Sandbox requirement: Reflect and Proxy must remain in SHADOWED_GLOBALS.
// This executor relies on Reflect and Proxy being shadowed in
// web/src/lib/scripting/sandboxGlobals.ts (verified: both present).

// [FIX: V4-4] Use zSystemCategory for type-safe category validation.
// Using z.string() would allow arbitrary strings to flow into LLM prompts.
const inputSchema = z.object({
  system: z.object({
    category: zSystemCategory,          // [FIX: V4-4] Enum, not freeform string
    type: z.string().min(1).max(100),
    config: z.record(z.string(), z.unknown()),
  }),
  description: z.string().min(1),
  targetEntityId: z.string().min(1),    // [B6] Entity binding is required
  // The designed name, carried alongside the id for the LLM prompt only. The engine
  // matches set_script on the EntityId component, never on EntityName, so the name
  // must never be what we bind to. Optional: a plan built before this field existed
  // still runs, falling back to naming the entity by its id in the prompt.
  targetEntityName: z.string().min(1).max(200).optional(),
  projectType: z.enum(['2d', '3d']),
});

/**
 * EVERY SIGNATURE BELOW IS COPIED FROM `web/src/lib/scripting/forgeTypes.ts`.
 *
 * It used to advertise a `forge.entity` namespace with six transform methods,
 * `forge.input.isKeyDown`, `forge.input.isKeyJustPressed`, `forge.ui.setText`
 * and `forge.ui.setVisible`. None of those exist — 10 of the 18 listed calls
 * were imaginary — so every script this executor generated for the five
 * unregistered system categories (input, narrative, audio, visual, physics)
 * threw on its first frame inside a sandboxed worker, where nothing in the
 * pipeline can see it. Transforms are TOP-LEVEL on `forge`, input is
 * `isPressed`/`justPressed`, and UI text is `updateText` (PF-1114).
 *
 * `forgeApiConformance.test.ts` extracts every `forge.*` reference from this
 * block and resolves each against `FORGE_TYPE_DEFINITIONS`, so an invented
 * method fails a test instead of shipping. Exported for exactly that.
 */
export const SCRIPT_SYSTEM_PROMPT = `You are a game script generator for SpawnForge, a browser-based game engine.

Generate a TypeScript game script that runs in a sandboxed Web Worker. The script has access to the forge API.

## Available APIs
Transforms are top-level on forge. There is no separate per-entity namespace: call them on forge itself and pass the entity id.
- forge.getTransform(entityId) -> { position: [x, y, z], rotation: [x, y, z], scale: [x, y, z] } | null
- forge.setPosition(entityId, x, y, z)
- forge.setRotation(entityId, x, y, z)
- forge.translate(entityId, dx, dy, dz)
- forge.rotate(entityId, dx, dy, dz)
- forge.spawn(type, options) -> entityId
- forge.destroy(entityId)
- forge.setColor(entityId, r, g, b, a)
- forge.setVisibility(entityId, visible)
- forge.log(message)
- forge.input.isPressed(action) -> boolean
- forge.input.justPressed(action) -> boolean
- forge.input.getAxis(action) -> number
- forge.physics.applyForce(entityId, fx, fy, fz)
- forge.physics.applyImpulse(entityId, fx, fy, fz)
- forge.physics.setVelocity(entityId, vx, vy, vz)
- forge.physics.isGrounded(entityId) -> boolean (synchronous; true while a character controller touches the ground -- gate jumps on it)
- forge.physics.distanceTo(entityIdA, entityIdB) -> number
- forge.physics.onCollisionEnter(entityId, callback)
- forge.scene.findByName(name) -> entityId[]
- forge.scene.getEntityName(entityId) -> string | null
- forge.scene.load(sceneName)
- forge.audio.play(entityId)
- forge.audio.stop(entityId)
- forge.time.delta -> number (seconds)
- forge.ui.showText(id, text, x, y, options)
- forge.ui.updateText(id, text)
- forge.ui.removeText(id)

## Script Structure
Variables declared at module scope persist across frames.

function onStart() { /* Called once when the entity spawns */ }
function onUpdate(dt: number) { /* Called every frame */ }
function onDestroy() { /* Called when the entity is removed */ }

## Rules
1. NEVER use fetch, XMLHttpRequest, WebSocket, eval, Function constructor, import, require
2. NEVER use Reflect, Proxy, globalThis, self, window, document
3. NEVER access __proto__ or constructor.constructor
4. Use ONLY the forge.* API for engine interaction
5. Keep scripts simple and focused on one behavior
6. Use onUpdate(dt) for frame-by-frame logic, multiply movement by dt
7. MOVING AN ENEMY OR AN NPC: use forge.translate or forge.setPosition. Those entities are spawned as FIXED sensor bodies, so forge.physics.applyForce, applyImpulse and setVelocity do nothing to them and report no error. Physics forces are for the player and for projectiles.
8. Return ONLY the script code. No markdown, no explanation, no code fences.`;

// [B6] Output validation: check for sandbox escape attempts
const FORBIDDEN_PATTERNS = [
  /\beval\b/,
  /\bFunction\b\s*\(/,
  /\bfetch\b/,
  /\bXMLHttpRequest\b/,
  /\bWebSocket\b/,
  /\bimportScripts\b/,
  /\bReflect\b/,
  /\bProxy\b/,
  /\bglobalThis\b/,
  /\b__proto__\b/,
  /constructor\.constructor/,
  /\brequire\b\s*\(/,
  /\bimport\b\s*\(/,
  /\bimport\b\s*[{\w*]/,     // static ES module imports: import x, import {x}, import * as, import{x}
];

function validateGeneratedScript(
  code: string,
): { valid: boolean; reason?: string } {
  for (const pattern of FORBIDDEN_PATTERNS) {
    if (pattern.test(code)) {
      return {
        valid: false,
        reason: `Script contains forbidden pattern: ${pattern.source}`,
      };
    }
  }
  // Must define at least onStart or onUpdate as actual function declarations
  // Use regex to avoid matching comments or string literals containing these names
  const hasOnStart = /\bfunction\s+onStart\b|\bonStart\s*[=(]/.test(code);
  const hasOnUpdate = /\bfunction\s+onUpdate\b|\bonUpdate\s*[=(]/.test(code);
  if (!hasOnStart && !hasOnUpdate) {
    return {
      valid: false,
      reason: 'Script must define onStart() or onUpdate()',
    };
  }
  return { valid: true };
}

// [FIX: NU1] Dynamic confidence scoring for custom scripts.
//
// `forge.entity` is NOT in this list and must not come back: no such namespace
// is declared in `forgeTypes.ts`, so counting it rewarded a script for using an
// API that does not exist — the more imaginary namespaces a script used, the
// more "complex" it scored, while the real signal (does this run at all?) went
// unmeasured (PF-1114).
const FORGE_NAMESPACES = [
  'forge.input', 'forge.physics', 'forge.audio',
  'forge.scene', 'forge.time', 'forge.ui', 'forge.camera',
  'forge.physics2d', 'forge.sprite', 'forge.skeleton2d',
  'forge.dialogue', 'forge.tilemap',
];

function computeScriptConfidence(code: string): 'high' | 'medium' | 'low' {
  const lineCount = code.split('\n').length;
  const namespacesUsed = FORGE_NAMESPACES.filter(ns => code.includes(ns)).length;

  // high if <30 lines and uses basic APIs (<=2 namespaces)
  if (lineCount < 30 && namespacesUsed <= 2) {
    return 'high';
  }
  // low if 3+ namespaces or >80 lines -- complex scripts are more likely to have bugs
  if (namespacesUsed >= 3 || lineCount > 80) {
    return 'low';
  }
  return 'medium';
}

export const customScriptExecutor: ExecutorDefinition = {
  name: 'custom_script_generate',
  inputSchema,
  userFacingErrorMessage:
    'Could not generate a custom script. This behavior will need manual implementation.',

  async execute(
    input: Record<string, unknown>,
    ctx: ExecutorContext,
  ): Promise<ExecutorResult> {
    const parsed = inputSchema.safeParse(input);
    if (!parsed.success) {
      return failResult(
        makeStepError(
          'INVALID_INPUT',
          parsed.error.message,
          this.userFacingErrorMessage,
        ),
      );
    }

    const { system, description, targetEntityId, targetEntityName, projectType } = parsed.data;

    // [S3] Sanitize the description before using it in the LLM prompt
    const sanitized = sanitizePrompt(description, 500);
    if (!sanitized.safe) {
      return failResult(
        makeStepError(
          'UNSAFE_INPUT',
          `Description rejected: ${sanitized.reason}`,
          this.userFacingErrorMessage,
        ),
      );
    }

    // [FIX: NS1] Sanitize system.config values before interpolation into the LLM prompt.
    // Config values come from the LLM's first-stage output (decomposer) and could contain
    // injection payloads. We serialize only primitive values and cap string length.
    // Objects and arrays are excluded to prevent nested injection vectors.
    const safeConfigEntries: Record<string, string | number | boolean> = {};
    for (const [key, val] of Object.entries(system.config)) {
      if (typeof val === 'number' || typeof val === 'boolean') {
        safeConfigEntries[key] = val;
      } else if (typeof val === 'string') {
        const sanitizedVal = sanitizePrompt(val, 100);
        if (sanitizedVal.safe && sanitizedVal.filtered) {
          safeConfigEntries[key] = sanitizedVal.filtered;
        }
        // Unsafe string values are silently dropped from the prompt
      }
      // Objects, arrays, null, undefined are excluded from the prompt
    }

    // [FIX: V4-3] Sanitize targetEntityId before interpolation into LLM prompt.
    const safeEntityId = sanitizePrompt(targetEntityId, 100);
    if (!safeEntityId.safe) {
      return failResult(
        makeStepError(
          'UNSAFE_INPUT',
          `Entity ID rejected: ${safeEntityId.reason}`,
          this.userFacingErrorMessage,
        ),
      );
    }

    // The entity name originates in the LLM-authored GDD, so it is untrusted text on
    // its way into a second prompt — same gate as every other interpolated field.
    let promptEntityLabel = safeEntityId.filtered;
    if (targetEntityName !== undefined) {
      const safeEntityName = sanitizePrompt(targetEntityName, 100);
      if (!safeEntityName.safe) {
        return failResult(
          makeStepError(
            'UNSAFE_INPUT',
            `Entity name rejected: ${safeEntityName.reason}`,
            this.userFacingErrorMessage,
          ),
        );
      }
      promptEntityLabel = safeEntityName.filtered;
    }

    // [FIX: V4-4] Sanitize system.type before interpolation into LLM prompt.
    const safeType = sanitizePrompt(system.type, 100);
    if (!safeType.safe) {
      return failResult(
        makeStepError(
          'UNSAFE_INPUT',
          `System type rejected: ${safeType.reason}`,
          this.userFacingErrorMessage,
        ),
      );
    }

    const userMessage = [
      `Generate a script for entity "${promptEntityLabel}" (project: ${projectType}).`,
      `System: ${system.category}:${safeType.filtered}`,
      `Behavior: ${sanitized.filtered}`,
      Object.keys(safeConfigEntries).length > 0
        ? `Config hints: ${JSON.stringify(safeConfigEntries)}`
        : '',
    ].filter(Boolean).join('\n');

    let scriptCode: string;
    try {
      scriptCode = await fetchAI(userMessage, {
        model: AI_MODEL_PRIMARY,
        sceneContext: '',
        thinking: false,
        systemOverride: SCRIPT_SYSTEM_PROMPT,
        priority: 2,
      });
    } catch (err) {
      return failResult(
        makeStepError(
          'AI_CALL_FAILED',
          String(err),
          this.userFacingErrorMessage,
          true,
        ),
      );
    }

    // Strip markdown fences if present
    let code = scriptCode.trim();
    const fenceMatch = code.match(
      /```(?:typescript|ts|javascript|js)?\s*\n?([\s\S]*?)\n?```/,
    );
    if (fenceMatch) {
      code = fenceMatch[1].trim();
    }

    // [B6] Validate the generated script
    const validation = validateGeneratedScript(code);
    if (!validation.valid) {
      return failResult(
        makeStepError(
          'SCRIPT_VALIDATION_FAILED',
          validation.reason!,
          this.userFacingErrorMessage,
          true,
        ),
      );
    }

    // [FIX: NB1] Bind script to entity via set_script command (NOT update_script).
    // Dispatch the ORIGINAL targetEntityId, never safeEntityId.filtered — sanitizing
    // rewrites the string, and the engine matches this byte-for-byte against the
    // entity's EntityId component (bridge/scripts.rs `apply_script_updates`). The
    // sanitized copy exists only to be safe inside the LLM prompt. A miss here is
    // SILENT: the engine's match loop simply never runs and emits nothing.
    if (!sendCommands(ctx, [{
      command: 'set_script',
      payload: { entityId: targetEntityId, source: code, enabled: true },
    }])) {
      return failResult(
        makeStepError(
          'COMMAND_FAILED',
          'Engine rejected the generated script',
          this.userFacingErrorMessage,
          true,
        ),
      );
    }

    // [FIX: NU1] Dynamic confidence based on script complexity
    const confidence = computeScriptConfidence(code);
    const confidenceWarnings: Record<string, string> = {
      high: 'This script is simple and likely correct.',
      medium: 'This script was AI-generated and may need manual adjustments.',
      low: 'This script is complex and should be reviewed carefully before use.',
    };

    return successResult({
      entityId: targetEntityId,
      scriptLength: code.length,
      lineCount: code.split('\n').length,
      confidence,
      warning: confidenceWarnings[confidence],
    });
  },
};

