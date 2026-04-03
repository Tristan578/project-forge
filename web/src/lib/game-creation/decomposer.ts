/**
 * Phase 2A — Game Creation Orchestrator: Decomposer Layer.
 *
 * Converts a natural language game description into an OrchestratorGDD via
 * LLM call + Zod schema validation. Retries up to MAX_RETRIES times on
 * invalid JSON or schema failures. Sanitizes all string fields to prevent
 * second-stage prompt injection.
 *
 * Spec: specs/2026-03-25-game-creation-orchestrator-phase2a-v4.md (lines 322–578)
 */

import { z } from 'zod';
import { fetchAI } from '@/lib/ai/client';
import { AI_MODEL_PRIMARY } from '@/lib/ai/models';
import { sanitizePrompt } from '@/lib/ai/contentSafety';
// [FIX: V4-4] Import zSystemCategory from types.ts (single source of truth)
import { zSystemCategory } from './types';
import type { OrchestratorGDD, SystemCategory } from './types';

// ---------------------------------------------------------------------------
// Zod schemas for LLM output validation
// ---------------------------------------------------------------------------

const SYSTEM_CATEGORIES: SystemCategory[] = [
  'movement', 'input', 'camera', 'world', 'challenge',
  'entities', 'progression', 'feedback', 'narrative',
  'audio', 'visual', 'physics',
];

const zGameSystem = z.object({
  category: zSystemCategory,
  type: z.string().min(1).max(100),
  config: z.record(z.string(), z.unknown()),
  priority: z.enum(['core', 'secondary', 'polish']),
  dependsOn: z.array(zSystemCategory).default([]),
});

const zFeelDirective = z.object({
  mood: z.string().min(1).max(100),
  pacing: z.enum(['slow', 'medium', 'fast']),
  weight: z.enum(['floaty', 'light', 'medium', 'heavy', 'weighty']),
  referenceGames: z.array(z.string().max(100)).max(5).default([]),
  oneLiner: z.string().min(1).max(200),
});

const zEntityBlueprint = z.object({
  name: z.string().min(1).max(100),
  role: z.enum(['player', 'enemy', 'npc', 'decoration', 'trigger', 'interactable', 'projectile']),
  systems: z.array(zSystemCategory),
  appearance: z.string().max(300),
  behaviors: z.array(z.string().max(200)),
});

const zSceneBlueprint = z.object({
  name: z.string().min(1).max(100),
  purpose: z.string().max(200),
  systems: z.array(zSystemCategory),
  entities: z.array(zEntityBlueprint),
  transitions: z.array(z.object({
    to: z.string().min(1),
    trigger: z.string().min(1),
  })),
});

const zAssetNeed = z.object({
  type: z.enum(['3d-model', 'texture', 'sound', 'music', 'voice', 'sprite']),
  description: z.string().min(1).max(300),
  entityRef: z.string().optional(),
  styleDirective: z.string().max(300),
  priority: z.enum(['required', 'nice-to-have']),
  fallback: z.string().regex(/^(primitive|builtin):[a-z][a-z0-9_-]{0,63}$/),
});

const zDecompositionOutput = z.object({
  title: z.string().min(1).max(200),
  systems: z.array(zGameSystem).min(1),
  scenes: z.array(zSceneBlueprint).min(1),
  assetManifest: z.array(zAssetNeed),
  estimatedScope: z.enum(['small', 'medium', 'large']),
  styleDirective: z.string().max(500),
  feelDirective: zFeelDirective,
  constraints: z.array(z.string().max(200)),
});

export type DecompositionOutput = z.infer<typeof zDecompositionOutput>;

// ---------------------------------------------------------------------------
// LLM prompt template
// ---------------------------------------------------------------------------

const DECOMPOSITION_SYSTEM_PROMPT = `You are a game systems architect for SpawnForge, a browser-based game engine.

Given a game description, decompose it into composable SYSTEMS -- not genres. Every game is a combination of independent functional systems.

## Available System Categories
${SYSTEM_CATEGORIES.map(c => `- "${c}"`).join('\n')}

## Rules
1. NEVER use genre labels. Decompose into functional systems only.
2. Every game MUST have at least: one movement OR input system, one camera system, and one world system.
3. Set system priorities: "core" for essential gameplay, "secondary" for important polish, "polish" for nice-to-have.
4. Set dependsOn correctly: movement depends on physics, camera depends on entities, feedback depends on challenge, etc.
5. The feelDirective captures the EMOTIONAL EXPERIENCE, not just function. A "cozy farming sim" and a "hardcore farming sim" have similar systems but different feel.
6. Asset fallbacks must use format "primitive:<name>" or "builtin:<name>" (e.g., "primitive:cube", "builtin:footstep").
7. Limit assetManifest to items the game genuinely needs. Fewer high-impact assets over many decorative ones.
8. estimatedScope: "small" = 1-3 scenes, few entities; "medium" = 3-8 scenes, moderate entities; "large" = 8+ scenes, many entities.

## Output Format
Respond with ONLY valid JSON matching this exact structure (no markdown, no explanation):
{
  "title": "string",
  "systems": [{ "category": "movement", "type": "walk+jump", "config": { "gravity": 20 }, "priority": "core", "dependsOn": ["physics"] }],
  "scenes": [{ "name": "string", "purpose": "string", "systems": ["movement"], "entities": [{ "name": "string", "role": "player|enemy|npc|decoration|trigger|interactable|projectile", "systems": ["movement"], "appearance": "string", "behaviors": ["string"] }], "transitions": [{ "to": "scene name", "trigger": "description" }] }],
  "assetManifest": [{ "type": "3d-model|texture|sound|music|voice|sprite", "description": "string", "entityRef": "optional entity name", "styleDirective": "string", "priority": "required|nice-to-have", "fallback": "primitive:cube" }],
  "estimatedScope": "small|medium|large",
  "styleDirective": "string",
  "feelDirective": { "mood": "string", "pacing": "slow|medium|fast", "weight": "floaty|light|medium|heavy|weighty", "referenceGames": ["string"], "oneLiner": "string" },
  "constraints": ["string"]
}`;

// ---------------------------------------------------------------------------
// Decomposition function
// ---------------------------------------------------------------------------

const MAX_RETRIES = 2;

/**
 * Decompose a natural language game description into a structured OrchestratorGDD.
 *
 * Calls the LLM with a systems-not-genres prompt, validates JSON output against
 * Zod schemas, sanitizes all string fields to block second-stage prompt injection,
 * and retries up to MAX_RETRIES times on parse/schema failures.
 *
 * @throws {Error} If the prompt is unsafe, or if all retries are exhausted.
 */
export async function decomposeIntoSystems(
  prompt: string,
  projectType: '2d' | '3d',
): Promise<OrchestratorGDD> {
  // [S3] Sanitize the user prompt before LLM call
  const sanitized = sanitizePrompt(prompt, 1000);
  if (!sanitized.safe) {
    throw new Error(`Prompt rejected: ${sanitized.reason}`);
  }
  const cleanPrompt = sanitized.filtered!;

  let lastError: Error | null = null;

  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    const userMessage = [
      `Game description: ${cleanPrompt}`,
      `Project type: ${projectType}`,
      attempt > 0
        ? '(Previous attempt had invalid output. Please follow the JSON schema exactly.)'
        : '',
    ].filter(Boolean).join('\n');

    let content: string;
    try {
      content = await fetchAI(userMessage, {
        model: AI_MODEL_PRIMARY,
        sceneContext: '',
        thinking: false,
        systemOverride: DECOMPOSITION_SYSTEM_PROMPT,
        priority: 2,
      });
    } catch (err) {
      lastError = new Error(
        `Attempt ${attempt + 1}: LLM call failed: ${err instanceof Error ? err.message : String(err)}`,
      );
      continue;
    }

    // Parse JSON from response — strip markdown fences if present
    let jsonStr = content.trim();
    const fenceMatch = jsonStr.match(/```(?:json)?\s*\n?([\s\S]*?)\n?```/);
    if (fenceMatch) {
      jsonStr = fenceMatch[1].trim();
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(jsonStr);
    } catch {
      lastError = new Error(
        `Attempt ${attempt + 1}: Failed to parse JSON from LLM response`,
      );
      continue;
    }

    // Validate against Zod schema
    const result = zDecompositionOutput.safeParse(parsed);
    if (!result.success) {
      const issues = result.error.issues
        .map(i => `${i.path.join('.')}: ${i.message}`)
        .join('; ');
      lastError = new Error(
        `Attempt ${attempt + 1}: Schema validation failed: ${issues}`,
      );
      continue;
    }

    const data = result.data;

    // [S3] Sanitize all GDD string fields before they become second-stage LLM inputs
    const sanitizedTitle = sanitizePrompt(data.title, 200);
    const sanitizedStyle = sanitizePrompt(data.styleDirective, 500);
    const sanitizedOneLiner = sanitizePrompt(data.feelDirective.oneLiner, 200);

    // [FIX: NS2] Sanitize mood and each referenceGames entry.
    // These are LLM-generated strings that flow into second-stage prompts
    // (e.g. physics_profile, audio, visual executors receive feelDirective).
    // Without sanitization, a malicious LLM response could inject prompts
    // via mood or referenceGames fields.
    const sanitizedMood = sanitizePrompt(data.feelDirective.mood, 100);

    // [FIX: V4-5] Unsafe referenceGames entries are dropped entirely (same
    // pattern as constraints). Falling back to raw .slice() would pass
    // unsanitized LLM output into second-stage prompts.
    const sanitizedRefGames: string[] = [];
    for (const game of data.feelDirective.referenceGames) {
      const gameResult = sanitizePrompt(game, 100);
      // [FIX: NS2] Check .safe before using .filtered
      if (gameResult.safe) {
        sanitizedRefGames.push(gameResult.filtered ?? game.slice(0, 100));
      }
      // Unsafe entries are dropped — not truncated to raw substring
    }

    // [FIX: NB3] Sanitize constraints: check .safe BEFORE using .filtered.
    // If sanitization marks a constraint as unsafe (entirely composed of
    // injection patterns), reject it rather than silently passing through.
    const sanitizedConstraints: string[] = [];
    for (const c of data.constraints) {
      const cResult = sanitizePrompt(c, 200);
      if (cResult.safe) {
        sanitizedConstraints.push(cResult.filtered ?? c.slice(0, 200));
      }
      // [FIX: NB3] Unsafe constraints are dropped entirely — they were
      // composed entirely of injection content. We do NOT fall back to
      // the raw string because that would pass unsanitized text to
      // downstream LLM prompts.
    }

    return {
      id: crypto.randomUUID(),
      // [FIX: Sentry] Never fall back to raw unsanitized LLM output.
      // If title is unsafe (injection content), use a generic fallback.
      title: sanitizedTitle.safe
        ? sanitizedTitle.filtered!
        : 'Untitled Game',
      description: cleanPrompt,
      systems: data.systems,
      // Sanitize nested string fields in scenes (entity names, purposes, behaviors).
      // These flow into executor inputs and downstream LLM prompts.
      scenes: data.scenes.map(scene => {
        const sName = sanitizePrompt(scene.name, 200);
        const sPurpose = sanitizePrompt(scene.purpose, 500);
        return {
          ...scene,
          name: sName.safe ? sName.filtered! : 'Scene',
          purpose: sPurpose.safe ? sPurpose.filtered! : '',
          transitions: scene.transitions.map(t => {
            const tTo = sanitizePrompt(t.to, 100);
            const tTrigger = sanitizePrompt(t.trigger, 200);
            return {
              to: tTo.safe ? tTo.filtered! : '',
              trigger: tTrigger.safe ? tTrigger.filtered! : '',
            };
          }).filter(t => t.to.length > 0),
          entities: scene.entities.map(entity => {
            const eName = sanitizePrompt(entity.name, 200);
            const eAppearance = sanitizePrompt(entity.appearance, 300);
            return {
              ...entity,
              name: eName.safe ? eName.filtered! : 'Entity',
              appearance: eAppearance.safe ? eAppearance.filtered! : 'default appearance',
              behaviors: entity.behaviors
                .map(b => sanitizePrompt(b, 100))
                .filter(s => s.safe)
                .map(s => s.filtered!),
            };
          }),
        };
      }),
      assetManifest: data.assetManifest.map(a => {
        // [S4] Sanitize styleDirective on each asset
        const assetStyle = sanitizePrompt(a.styleDirective, 300);
        return {
          ...a,
          // If unsafe, fall back to generic description — never pass raw unsanitized
          // LLM output to downstream asset generation prompts
          styleDirective: assetStyle.safe
            ? assetStyle.filtered!
            : 'default style',
        };
      }),
      estimatedScope: data.estimatedScope,
      // [FIX: Sentry] Never fall back to raw unsanitized LLM output.
      styleDirective: sanitizedStyle.safe
        ? sanitizedStyle.filtered!
        : 'default style',
      feelDirective: {
        ...data.feelDirective,
        // [FIX: NS2] mood sanitized
        // [FIX: V4-5] Unsafe mood falls back to 'neutral', not raw string.
        // A mood string that is entirely injection content must not be passed
        // to second-stage prompts (physics_profile, audio, visual executors).
        mood: sanitizedMood.safe
          ? sanitizedMood.filtered!
          : 'neutral',
        // [FIX: NS2] referenceGames entries sanitized
        referenceGames: sanitizedRefGames,
        // [FIX: Sentry] Never fall back to raw unsanitized LLM output.
        oneLiner: sanitizedOneLiner.safe
          ? sanitizedOneLiner.filtered!
          : 'A new game experience',
      },
      constraints: sanitizedConstraints, // [FIX: NB3] unsafe constraints dropped
      projectType,
    };
  }

  throw lastError ?? new Error('decomposeIntoSystems failed after all retries');
}
