/**
 * Stripe Entitlements → capability mapping (PF-911 / #8821).
 *
 * Stripe's Entitlements API lets each Product carry a set of Features (each with
 * a stable `lookup_key`). When a customer's active feature set changes, Stripe
 * emits `entitlements.active_entitlement_summary.updated`, whose payload carries
 * the customer's currently-active entitlements. We persist the active feature
 * `lookup_key`s on `users.active_features` and map them onto the product
 * capabilities the web client reads (`canUseAI` / `canUseMCP` / `canPublish`).
 *
 * This module is the single source of truth for that mapping. It is pure (no IO,
 * no Stripe SDK), so it is trivially testable and usable on both the server
 * (webhook persistence) and the client (capability gating in userStore).
 *
 * GUARD: When `active_features` is null/undefined/empty (no entitlement summary
 * has been received yet, the Entitlements feature is not configured in the
 * Stripe dashboard, or a transient/out-of-order empty summary arrived), callers
 * MUST fall back to the legacy tier-derived defaults. This keeps the change
 * purely additive — missing or empty provisioning never strips a tiered user's
 * existing access (#8831).
 */

/** The product capabilities gated in the web client. */
export type Capability = 'canUseAI' | 'canUseMCP' | 'canPublish';

/**
 * Canonical Stripe entitlement feature lookup_keys. These MUST match the
 * `lookup_key` configured on each Feature in the Stripe dashboard (see the
 * provisioning checklist on PR #8821). Kept as a const map so a typo is a
 * compile error, not a silent gating miss.
 */
export const FEATURE_KEYS = {
  AI_GENERATION: 'ai_generation',
  MCP_ACCESS: 'mcp_access',
  PUBLISH_GAMES: 'publish_games',
} as const;

export type FeatureKey = (typeof FEATURE_KEYS)[keyof typeof FEATURE_KEYS];

/** Which feature lookup_key grants each capability. */
const CAPABILITY_FEATURE: Record<Capability, FeatureKey> = {
  canUseAI: FEATURE_KEYS.AI_GENERATION,
  canUseMCP: FEATURE_KEYS.MCP_ACCESS,
  canPublish: FEATURE_KEYS.PUBLISH_GAMES,
};

/**
 * Normalize an arbitrary persisted/serialized value into a clean string[] of
 * feature lookup_keys. Tolerates null/undefined, non-arrays, and non-string
 * members (jsonb round-trips, hand-edited rows, malformed webhook payloads)
 * without throwing — returns `null` to signal "no usable feature set", so the
 * caller falls back to tier defaults rather than silently denying access.
 *
 * An EMPTY feature set also normalizes to `null` (→ tier fallback), NOT to `[]`
 * (#8831). Stripe gives no event-ordering guarantee, so a paying customer can
 * transiently receive an empty `entitlements.active_entitlement_summary.updated`
 * (or have `active_features` cleared on cancellation) before the authoritative
 * non-empty summary lands. Treating empty as an authoritative deny would strip
 * every paid capability with no tier backstop until the next event — exactly the
 * failure mode the GUARD exists to prevent. A genuinely-downgraded customer is
 * still correctly restricted because their *tier* (the fallback) is downgraded
 * in lockstep, so the fallback yields the right answer in both cases.
 */
export function normalizeFeatures(value: unknown): string[] | null {
  if (!Array.isArray(value)) return null;
  const features = value.filter((f): f is string => typeof f === 'string' && f.length > 0);
  return features.length > 0 ? features : null;
}

/**
 * Resolve a single capability from an active feature set.
 *
 * @param features  The persisted active feature lookup_keys, or null/undefined
 *                  when no entitlement summary is available.
 * @param fallback  The legacy tier-derived value to use when `features` is
 *                  absent (the entitlements guard).
 */
export function hasCapability(
  capability: Capability,
  features: string[] | null | undefined,
  fallback: boolean
): boolean {
  const normalized = normalizeFeatures(features);
  if (normalized === null) return fallback;
  return normalized.includes(CAPABILITY_FEATURE[capability]);
}

/**
 * Extract the active feature lookup_keys from a Stripe
 * `entitlements.active_entitlement_summary.updated` event payload.
 *
 * The summary object's `entitlements.data[]` is a list of ActiveEntitlements,
 * each carrying a `lookup_key`. We read defensively (the SDK surface for this
 * resource is comparatively new) and dedupe. Returns an empty array when the
 * customer has no active entitlements. That `[]` is what gets persisted to
 * `active_features`; on READ it normalizes back to tier fallback (see
 * {@link normalizeFeatures} / #8831), so a transient or out-of-order empty
 * summary cannot strip a paying customer's capabilities.
 */
export function featuresFromSummary(summary: unknown): string[] {
  if (!summary || typeof summary !== 'object') return [];
  const entitlements = (summary as { entitlements?: { data?: unknown } }).entitlements;
  const data = entitlements?.data;
  if (!Array.isArray(data)) return [];
  const keys = data
    .map((e) =>
      e && typeof e === 'object' && typeof (e as { lookup_key?: unknown }).lookup_key === 'string'
        ? (e as { lookup_key: string }).lookup_key
        : null
    )
    .filter((k): k is string => k !== null && k.length > 0);
  return Array.from(new Set(keys));
}

/** Extract the Stripe customer id from an active-entitlement-summary payload. */
export function customerIdFromSummary(summary: unknown): string | null {
  if (!summary || typeof summary !== 'object') return null;
  const customer = (summary as { customer?: unknown }).customer;
  if (typeof customer === 'string') return customer.length > 0 ? customer : null;
  if (customer && typeof customer === 'object' && typeof (customer as { id?: unknown }).id === 'string') {
    return (customer as { id: string }).id;
  }
  return null;
}
