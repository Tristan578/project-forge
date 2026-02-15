/** Token costs for all AI operations */
export const TOKEN_COSTS = {
  // Chat
  chat_short: 5,
  chat_long: 15,

  // Chat (new granular)
  chat_standard: 1,
  chat_premium: 5,
  chat_premium_opus: 15,

  // 3D Generation
  '3d_generation_standard': 100,
  '3d_generation_high': 200,

  // Texture
  texture_generation: 30,

  // Image-to-3D
  image_to_3d: 150,

  // Voice (per 1k chars)
  voice_generation: 40,

  // Music
  music_generation: 80,

  // SFX
  sfx_generation: 20,

  // Skybox
  skybox_generation: 50,

  // Compound (estimated averages — actual cost may vary)
  compound_scene_simple: 50,
  compound_scene_complex: 300,
} as const;

export type OperationType = keyof typeof TOKEN_COSTS;

/** Monthly token allocation per tier */
export const TIER_MONTHLY_TOKENS = {
  starter: 50,
  hobbyist: 300,
  creator: 1000,
  pro: 3000,
} as const;

/** Add-on token packages */
export const TOKEN_PACKAGES = {
  spark: { tokens: 1000, priceCents: 1200, label: 'Spark' },
  blaze: { tokens: 5000, priceCents: 4900, label: 'Blaze' },
  inferno: { tokens: 20000, priceCents: 14900, label: 'Inferno' },
} as const;

export type TokenPackage = keyof typeof TOKEN_PACKAGES;

/** Resolve the token cost for a given operation with optional quality parameter */
export function getTokenCost(operation: string, quality?: string): number {
  // Handle quality variants
  if (operation === '3d_generation') {
    return quality === 'high'
      ? TOKEN_COSTS['3d_generation_high']
      : TOKEN_COSTS['3d_generation_standard'];
  }

  if (operation === 'chat_message') {
    return quality === 'long'
      ? TOKEN_COSTS.chat_long
      : TOKEN_COSTS.chat_short;
  }

  const cost = TOKEN_COSTS[operation as OperationType];
  return cost ?? 0; // Free operations (scene editing) cost 0 tokens
}
