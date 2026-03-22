/**
 * Core modification engine for incremental game modification via natural language.
 *
 * Allows users to describe changes like "make the enemies faster" or
 * "change the background to sunset" and have the AI produce a structured
 * modification plan that maps to SpawnForge engine commands.
 */

import type { SceneContext, EntitySummary } from './sceneContext';
import { AI_MODEL_PRIMARY } from './models';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Scope of the modification request. */
export type ModificationScope = 'selected' | 'scene' | 'all';

/** User request to modify aspects of the game. */
export interface ModificationRequest {
  description: string;
  scope?: ModificationScope;
}

/** A single step in a modification plan. */
export interface ModificationStep {
  action: 'update' | 'add' | 'remove';
  entityId?: string;
  component: string;
  changes: Record<string, unknown>;
  command: string;
}

/** A complete plan produced by the AI for a modification request. */
export interface ModificationPlan {
  steps: ModificationStep[];
  affectedEntities: string[];
  summary: string;
  confidence: number;
}

// ---------------------------------------------------------------------------
// System prompt
// ---------------------------------------------------------------------------

export const MODIFIER_SYSTEM_PROMPT = `You are a game modification assistant for SpawnForge, a browser-based 2D/3D game engine.
Given the current scene context and a user's modification request, produce a JSON modification plan.

The plan must be a JSON object with these fields:
- "steps": array of modification steps, each with:
  - "action": "update" | "add" | "remove"
  - "entityId": entity ID string (required for update/remove, omit for add)
  - "component": component being modified (e.g. "transform", "material", "light", "physics", "audio", "script", "game_component", "environment")
  - "changes": object with the property changes (command-specific payload fields)
  - "command": the SpawnForge engine command name to execute (e.g. "set_transform", "set_material", "set_ambient_light", "spawn_entity", "despawn_entity")
- "affectedEntities": array of entity ID strings that will be modified
- "summary": human-readable summary of changes (1-2 sentences)
- "confidence": number 0-1 indicating confidence in the plan

Available engine commands include:
- set_transform: { entityId, position?, rotation?, scale? }
- set_material: { entityId, baseColor?, metallic?, perceptualRoughness?, emissive?, ... }
- set_light: { entityId, color?, intensity?, range?, shadowsEnabled? }
- set_physics: { entityId, bodyType?, restitution?, friction?, density?, gravityScale? }
- set_ambient_light: { color?, brightness? }
- set_environment: { clearColor?, fogEnabled?, fogColor?, fogStart?, fogEnd? }
- set_skybox: { preset? } (presets: "studio", "sunset", "overcast", "night", "bright_day")
- spawn_entity: { entityType, name?, position? }
- despawn_entity: { entityId }
- set_post_processing: { bloom?, chromaticAberration?, colorGrading?, sharpening? }
- set_script: { entityId, source, enabled? }
- set_game_component: { entityId, componentType, config }

When the scope is "selected", only modify entities in the selectedIds list.
When the scope is "scene", modify any entity in the scene.
Match entities by name or type when the user refers to them naturally.

IMPORTANT: Return ONLY valid JSON. No markdown, no explanation, just the JSON object.`;

// ---------------------------------------------------------------------------
// Plan generation
// ---------------------------------------------------------------------------

/** Options for AI-based plan generation. */
export interface PlanGenerationOptions {
  /** Fetch function for calling the AI API. Defaults to global fetch. */
  fetchFn?: typeof fetch;
  /** API endpoint for chat completions. */
  apiEndpoint?: string;
  /** AI model to use. */
  model?: string;
}

/**
 * Filter entities by scope.
 */
export function filterEntitiesByScope(
  entities: EntitySummary[],
  selectedIds: string[],
  scope: ModificationScope,
): EntitySummary[] {
  if (scope === 'selected' && selectedIds.length > 0) {
    const selectedSet = new Set(selectedIds);
    return entities.filter((e) => selectedSet.has(e.id));
  }
  // 'scene' and 'all' return everything
  return entities;
}

/**
 * Build the user prompt that includes scene context + modification request.
 */
export function buildModificationPrompt(
  request: ModificationRequest,
  context: SceneContext,
): string {
  // Fall back to 'scene' scope when 'selected' is requested but nothing is selected
  const requestedScope = request.scope ?? 'scene';
  const scope: ModificationScope =
    requestedScope === 'selected' && context.selectedIds.length === 0
      ? 'scene'
      : requestedScope;
  const relevantEntities = filterEntitiesByScope(
    context.entities,
    context.selectedIds,
    scope,
  );

  const entityList = relevantEntities
    .map((e) => `  - "${e.name}" (id: ${e.id}, type: ${e.type}, components: [${e.components.join(', ')}]${!e.visible ? ', hidden' : ''})`)
    .join('\n');

  const sections = [
    `## Modification Request`,
    `"${request.description}"`,
    `Scope: ${scope}`,
    '',
    `## Scene Entities (${relevantEntities.length})`,
    entityList || '(empty scene)',
    '',
    `## Selected Entities`,
    context.selectedIds.length > 0
      ? context.selectedIds.join(', ')
      : '(none)',
    '',
    `## Scene Settings`,
    JSON.stringify(context.sceneSettings, null, 2),
  ];

  return sections.join('\n');
}

/**
 * Parse an AI response string into a ModificationPlan.
 * Handles common response quirks (markdown fences, trailing commas).
 */
export function parseModificationPlan(responseText: string): ModificationPlan {
  // Strip markdown code fences if present
  let cleaned = responseText.trim();
  if (cleaned.startsWith('```')) {
    cleaned = cleaned.replace(/^```(?:json)?\s*\n?/, '').replace(/\n?```\s*$/, '');
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(cleaned);
  } catch {
    throw new Error(`Failed to parse AI response as JSON: ${cleaned.slice(0, 200)}`);
  }

  if (!parsed || typeof parsed !== 'object') {
    throw new Error('AI response is not an object');
  }

  const obj = parsed as Record<string, unknown>;

  // Validate required fields
  if (!Array.isArray(obj.steps)) {
    throw new Error('Modification plan missing "steps" array');
  }

  const steps: ModificationStep[] = [];
  for (const rawStep of obj.steps) {
    if (!rawStep || typeof rawStep !== 'object') continue;
    const step = rawStep as Record<string, unknown>;

    const action = step.action as string;
    if (!['update', 'add', 'remove'].includes(action)) {
      continue; // Skip invalid steps
    }

    steps.push({
      action: action as 'update' | 'add' | 'remove',
      entityId: typeof step.entityId === 'string' ? step.entityId : undefined,
      component: typeof step.component === 'string' ? step.component : 'unknown',
      changes: (step.changes && typeof step.changes === 'object')
        ? step.changes as Record<string, unknown>
        : {},
      command: typeof step.command === 'string' ? step.command : '',
    });
  }

  const affectedEntities = Array.isArray(obj.affectedEntities)
    ? (obj.affectedEntities as unknown[]).filter((x): x is string => typeof x === 'string')
    : steps.filter((s) => s.entityId).map((s) => s.entityId!);

  const summary = typeof obj.summary === 'string'
    ? obj.summary
    : `${steps.length} modification step(s) planned`;

  const confidence = typeof obj.confidence === 'number'
    ? Math.max(0, Math.min(1, obj.confidence))
    : 0.5;

  return { steps, affectedEntities, summary, confidence };
}

/**
 * Plan a modification by calling the AI API.
 */
export async function planModification(
  request: ModificationRequest,
  sceneContext: SceneContext,
  options: PlanGenerationOptions = {},
): Promise<ModificationPlan> {
  const {
    fetchFn = fetch,
    apiEndpoint = '/api/chat',
    model = AI_MODEL_PRIMARY,
  } = options;

  const userPrompt = buildModificationPrompt(request, sceneContext);

  const response = await fetchFn(apiEndpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model,
      system: MODIFIER_SYSTEM_PROMPT,
      messages: [{ role: 'user', content: userPrompt }],
      max_tokens: 4096,
    }),
  });

  if (!response.ok) {
    throw new Error(`AI API returned ${response.status}: ${response.statusText}`);
  }

  const data = await response.json() as { content?: string; text?: string; choices?: Array<{ message?: { content?: string } }> };

  // Handle various response formats
  const text = data.content
    ?? data.text
    ?? data.choices?.[0]?.message?.content
    ?? '';

  if (!text) {
    throw new Error('AI API returned empty response');
  }

  return parseModificationPlan(text);
}

// ---------------------------------------------------------------------------
// Plan execution
// ---------------------------------------------------------------------------

/** Result of executing a single modification step. */
export interface StepExecutionResult {
  step: ModificationStep;
  success: boolean;
  error?: string;
}

/**
 * Execute a modification plan by dispatching engine commands.
 * Returns results for each step.
 */
export function executeModificationPlan(
  plan: ModificationPlan,
  dispatch: (cmd: string, payload: unknown) => void,
): StepExecutionResult[] {
  const results: StepExecutionResult[] = [];

  for (const step of plan.steps) {
    try {
      if (!step.command) {
        results.push({ step, success: false, error: 'Missing command name' });
        continue;
      }

      // Build the command payload from the step
      const payload: Record<string, unknown> = { ...step.changes };
      if (step.entityId) {
        payload.entityId = step.entityId;
      }

      dispatch(step.command, payload);
      results.push({ step, success: true });
    } catch (err) {
      results.push({
        step,
        success: false,
        error: err instanceof Error ? err.message : 'Unknown error',
      });
    }
  }

  return results;
}
