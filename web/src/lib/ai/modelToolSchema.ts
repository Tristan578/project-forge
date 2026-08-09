/**
 * The model-facing view of an MCP manifest command's schema.
 *
 * The manifest is written for a direct-to-engine MCP client. A few of its
 * parameters are real there but must never reach a model, so every surface that
 * turns the manifest into tool definitions has to filter them out. There are two
 * such surfaces — `lib/ai/spawnforgeAgent.getAgentTools()` (the live chat path)
 * and `lib/chat/tools.getChatTools()` — and filtering in only one of them leaves
 * the parameter on offer.
 */

/**
 * The schema shape both tool surfaces hand to their SDK.
 *
 * Only these three keys are emitted — which is what both surfaces already did
 * before they shared this helper. The index signature is there to satisfy
 * `toolAdapter.ManifestTool`'s object form, which declares one.
 */
export interface ModelToolSchema {
  [key: string]: unknown;
  type: string;
  properties: Record<string, unknown>;
  required: string[];
}

/**
 * Manifest parameters that are real for a direct-to-engine MCP client but must not
 * be offered to the model.
 *
 * `spawn_entity.id` is the only entry today, and it is the reason this seam exists:
 * an MCP client driving the engine directly has a legitimate use for supplying its
 * own entity id, but the chat path does not — `transformHandlers.spawn_entity`
 * forwards only `entityType` and `name`, so a model-supplied id is silently
 * discarded, and `sceneGraphSlice.spawnEntity` mints the id itself and returns it
 * synchronously anyway. Were it wired through, the engine's `is_valid_override_id`
 * validates only length and control characters; an id that collides with an
 * existing entity is accepted, and every id-matching loop in the engine then
 * addresses the wrong entity.
 */
export const EXCLUDED_TOOL_PROPERTIES: Record<string, readonly string[]> = {
  spawn_entity: ['id'],
};

/**
 * Normalize a manifest command's `parameters` into an object schema, minus any
 * properties withheld from the model.
 *
 * `parameters` is typed loosely because the manifest still carries a legacy
 * array-of-parameters form for some commands; anything that is not an object
 * schema normalizes to an empty one. Never mutates its input — the manifest is a
 * static JSON import shared with the MCP server, which offers the excluded
 * parameters legitimately.
 */
export function modelToolSchema(commandName: string, parameters: unknown): ModelToolSchema {
  const isObjectSchema = !!parameters && !Array.isArray(parameters) && typeof parameters === 'object';
  const schema = (isObjectSchema ? parameters : {}) as {
    type?: string;
    properties?: Record<string, unknown>;
    required?: string[];
  };

  const properties = schema.properties || {};
  const required = schema.required || [];
  const excluded = EXCLUDED_TOOL_PROPERTIES[commandName];

  return {
    type: schema.type || 'object',
    properties: excluded
      ? Object.fromEntries(Object.entries(properties).filter(([key]) => !excluded.includes(key)))
      : properties,
    required: excluded ? required.filter((key) => !excluded.includes(key)) : required,
  };
}
