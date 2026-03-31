import { z } from 'zod';
import { fetchAI } from '@/lib/ai/client';
import { AI_MODEL_PRIMARY } from '@/lib/ai/models';
import { sanitizePrompt } from '@/lib/ai/contentSafety';
import type { ExecutorDefinition, ExecutorContext, ExecutorResult } from '../types';
import { zSystemCategory } from '../types';
import { makeStepError, successResult, failResult } from './shared';

// --- [S6] PREREQUISITE: Reflect and Proxy must be in SHADOWED_GLOBALS ---
// Before this executor can be used in production, the following MUST be added
// to web/src/lib/scripting/scriptWorker.ts SHADOWED_GLOBALS:
//   'Reflect', 'Proxy'
// Without this, LLM-generated scripts could use Reflect/Proxy to escape
// the sandbox.

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
  projectType: z.enum(['2d', '3d']),
});

const SCRIPT_SYSTEM_PROMPT = `You are a game script generator for SpawnForge, a browser-based game engine.

Generate a TypeScript game script that runs in a sandboxed Web Worker. The script has access to the forge API.

## Available APIs
- forge.entity.getPosition(entityId) -> [x, y, z]
- forge.entity.setPosition(entityId, x, y, z)
- forge.entity.getRotation(entityId) -> [x, y, z]
- forge.entity.setRotation(entityId, x, y, z)
- forge.entity.getScale(entityId) -> [x, y, z]
- forge.entity.setScale(entityId, x, y, z)
- forge.input.isKeyDown(key) -> boolean
- forge.input.isKeyJustPressed(key) -> boolean
- forge.physics.applyForce(entityId, x, y, z)
- forge.physics.applyImpulse(entityId, x, y, z)
- forge.physics.setVelocity(entityId, x, y, z)
- forge.audio.play(entityId)
- forge.audio.stop(entityId)
- forge.scene.load(sceneName)
- forge.time.delta -> number (seconds)
- forge.ui.setText(widgetId, text)
- forge.ui.setVisible(widgetId, visible)

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
7. Return ONLY the script code. No markdown, no explanation, no code fences.`;

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
  // Must define at least onStart or onUpdate
  if (!code.includes('onStart') && !code.includes('onUpdate')) {
    return {
      valid: false,
      reason: 'Script must define onStart() or onUpdate()',
    };
  }
  return { valid: true };
}

// [FIX: NU1] Dynamic confidence scoring for custom scripts.
const FORGE_NAMESPACES = [
  'forge.entity', 'forge.input', 'forge.physics', 'forge.audio',
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

    const { system, description, targetEntityId, projectType } = parsed.data;

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
      `Generate a script for entity "${safeEntityId.filtered}" (project: ${projectType}).`,
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
    ctx.dispatchCommand('set_script', {
      entityId: targetEntityId,
      source: code,
      enabled: true,
    });

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

