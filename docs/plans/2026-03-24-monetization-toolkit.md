# Spec: In-Game Monetization Toolkit

> **Status:** DRAFT
> **Date:** 2026-03-24
> **Ticket:** PF-574

## Problem

Game creators who publish via SpawnForge have no way to monetize their games. Supporting ads, in-app purchases (IAP), and season passes enables creators to earn revenue, which increases platform stickiness and justifies higher subscription tiers.

## Solution

A configuration-driven monetization layer. Creators configure monetization options in the editor; the export pipeline bundles the appropriate SDKs; the game runtime exposes `forge.monetization.*` APIs. SpawnForge takes a platform fee on transactions (Stripe Connect).

### Phase 1: Ad Integration + Configuration (MVP)

**Web Changes:**
- `web/src/stores/monetizationStore.ts` — Zustand store. Types: `MonetizationConfig` (ads: AdConfig, iap: IapConfig, seasonPass: SeasonPassConfig), `AdConfig` (provider, adUnitIds, placements[]), `AdPlacement` (type: banner|interstitial|rewarded, trigger, frequency)
- `web/src/components/editor/MonetizationPanel.tsx` — Editor panel for configuring ad placements, IAP products, and season passes. Tier-gated: Creator+ only
- `web/src/lib/chat/handlers/monetizationHandlers.ts` — MCP handlers
- `web/src/lib/export/monetizationBundler.ts` — Injects ad SDK script tags and config into exported game HTML

**MCP Commands (6):**
- `configure_ads` — Set ad provider (AdMob, Unity Ads stub), ad unit IDs, placement rules
- `add_ad_placement` — Define when/where an ad appears (between levels, on death, rewarded for extra life)
- `configure_iap` — Define purchasable items (cosmetics, level packs, power-ups) with prices
- `configure_season_pass` — Define season pass tiers, rewards, duration
- `get_monetization_config` — Returns the full monetization configuration
- `remove_monetization` — Strips all monetization from the project

**Script API:**
- `forge.monetization.showAd(type, placement)` — Triggers an ad. Returns promise resolving when ad completes (for rewarded ads)
- `forge.monetization.purchase(productId)` — Triggers IAP flow. Returns promise with purchase result
- `forge.monetization.isAdFree()` — Checks if player purchased ad-free
- `forge.monetization.getSeasonPassTier()` — Returns current player's season pass tier

### Phase 2: IAP Backend (Stripe Connect)

- `web/src/app/api/play/[userId]/[slug]/purchase/route.ts` — Stripe Checkout session creation for IAP
- Stripe Connect: creators onboard as connected accounts, SpawnForge takes 15% platform fee
- Purchase validation: server-side receipt verification, entitlement stored in localStorage + server
- `web/src/app/api/play/[userId]/[slug]/entitlements/route.ts` — GET player entitlements

### Phase 3: Season Pass + Analytics

- Season pass progression tracking (XP-based, time-gated rewards)
- Creator revenue dashboard: `/dashboard/revenue` showing earnings, ad impressions, purchases
- Analytics events pushed to PostHog for creator insights

## Constraints

- Tier-gated: Creator ($19/mo) and Pro ($49/mo) tiers only. Free/Hobbyist see "Upgrade" prompt
- Ad SDKs are injected at export time, NOT loaded in the editor (no ads during editing)
- Phase 1 ads are config-only + script API stubs. Actual ad SDK integration requires choosing a provider partner
- IAP requires Stripe Connect onboarding (Phase 2) — not available without Stripe account
- Platform fee (15%) applied via Stripe Connect `application_fee_percent`
- All monetary amounts in USD cents to avoid float precision issues
- No real-money gambling mechanics allowed (enforced in review)

## Acceptance Criteria

- Given a Creator-tier user, When they open MonetizationPanel, Then ad placement and IAP configuration options are available
- Given a Free-tier user, When they open MonetizationPanel, Then an upgrade prompt is shown
- Given a configured rewarded ad placement, When `forge.monetization.showAd('rewarded', 'extra-life')` is called in a script, Then the ad callback resolves with `{ rewarded: true }` (stubbed in Phase 1)
- Given IAP products configured, When the game is exported, Then the export HTML includes the monetization config and `forge.monetization.*` API is available
- Given a monetization config, When `remove_monetization` is called, Then all ads, IAP, and season pass config is cleared

## Alternatives Considered

- **Built-in ad server:** Rejected — we are not an ad network. Integrate with established providers.
- **Cryptocurrency/NFT integration:** Rejected — regulatory complexity, negative community perception, not aligned with "Canva for games" positioning.
- **Revenue share via SpawnForge tokens:** Rejected — adds monetary system complexity. Stripe Connect is proven and handles compliance.
