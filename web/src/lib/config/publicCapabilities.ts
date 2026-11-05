/**
 * What production can actually deliver, as flags the public copy reads.
 *
 * The pricing cards, `llms.txt`-style summaries and FAQ answers used to promise
 * four things the shipped deployment could not back: platform-funded asset
 * generation, asset generation through the user's own provider key, platform AI
 * keys on the top plan, and external-MCP access on the middle plan. Each promise
 * is now written against one of the three flags below,
 * so the copy and the capability cannot drift apart silently: flip the flag
 * and the copy changes with it, in the same commit.
 *
 * Keep this module free of Node-only imports. It is read by
 * `lib/billing/tierPlans.ts`, which `app/pricing/opengraph-image.tsx` loads on
 * the Edge runtime, and by client components through that module.
 */

/** The public-facing capabilities production may or may not deliver today. */
export interface PublicCapabilityFlags {
  /**
   * True only when production holds the `PLATFORM_*` generation keys
   * (`PLATFORM_KEY_ENV` in `lib/config/providers.ts`), so a paid user without
   * their own key can generate 3D models, textures, sound and music.
   */
  platformGenerationKeys: boolean;
  /**
   * True only when generating an asset through a user's OWN provider key (BYOK:
   * Meshy for 3D models and textures, ElevenLabs for sound, voice and music) has
   * been shown to work end to end in production, so the copy may say "with your
   * own API key" as a present-tense capability.
   */
  byokGeneration: boolean;
  /**
   * True only when the production build was made with
   * `NEXT_PUBLIC_MCP_BRIDGE=true`, so an external MCP client can attach to the
   * hosted editor (after the in-tab consent prompt).
   */
  hostedMcp: boolean;
}

/**
 * MANUAL FLAG. Production runs zero `PLATFORM_*` generation keys (#9117), which
 * `/api/health` reports as "Available only with your own API key". Nothing in
 * this repository can read the production environment, so this is a committed
 * claim, not a measurement: set it to `true` in the same change that records one
 * real artifact generated through a platform key (the #9117 done-when), and not
 * before. `publicCapabilities.test.ts` pins every public surface to it.
 */
export const PLATFORM_GENERATION_KEYS_PROVISIONED = false;

/**
 * MANUAL FLAG. `docs/capability-matrix.md` records every BYOK generation cell
 * (`generation:model3d`, `texture`, `sfx`, `voice`, `music`) as
 * implemented-unverified: the routes resolve a user's Meshy or ElevenLabs key,
 * but no artifact has been generated through one in production. Decided
 * 2026-11-05 on #10457: until that has happened, public copy says asset
 * generation is "coming after launch" rather than "bring your own key". Like
 * `PLATFORM_GENERATION_KEYS_PROVISIONED` this is a committed claim, not a
 * measurement: set it to `true` in the same change that records one real
 * artifact generated end to end through a user key in production (and moves the
 * matrix cell to proven), and not before. `publicCapabilities.test.ts` pins
 * every public surface to it.
 */
export const BYOK_GENERATION_VERIFIED = false;

/**
 * Whether the hosted editor accepts external MCP clients. Read as a literal
 * `process.env.NEXT_PUBLIC_MCP_BRIDGE` member expression, exactly as
 * `mcpBridgeEnabled()` reads it (Next.js only substitutes the fully-qualified
 * form), so the pricing copy flips on the same build-time switch that opens the
 * bridge. Unlike `mcpBridgeEnabled()` this does NOT treat a non-production build
 * as "on": marketing copy describes production, not a developer's laptop.
 * Decision tracked in #9722.
 */
export function hostedMcpEnabled(): boolean {
  return process.env.NEXT_PUBLIC_MCP_BRIDGE === 'true';
}

/** The flags as this build sees them. */
export function currentPublicCapabilities(): PublicCapabilityFlags {
  return {
    platformGenerationKeys: PLATFORM_GENERATION_KEYS_PROVISIONED,
    byokGeneration: BYOK_GENERATION_VERIFIED,
    hostedMcp: hostedMcpEnabled(),
  };
}
