/**
 * Vercel Web Analytics custom event tracking.
 *
 * Client-side: import { trackEvent } from '@/lib/analytics/events'
 * Server-side: import { trackServerEvent } from '@/lib/analytics/events.server'
 *
 * All events include the current environment for dashboard filtering.
 */

import { track } from '@vercel/analytics';

const env = process.env.NEXT_PUBLIC_VERCEL_ENV ?? process.env.NODE_ENV ?? 'unknown';

// ---------------------------------------------------------------------------
// Onboarding funnel
// ---------------------------------------------------------------------------

export function trackSignupComplete(tier: string) {
  track('signup_complete', { tier, env });
}

export function trackFirstSceneCreated() {
  track('first_scene_created', { env });
}

export function trackFirstEntitySpawned(entityType: string) {
  track('first_entity_spawned', { entityType, env });
}

export function trackTutorialStarted(tutorialName: string) {
  track('tutorial_started', { tutorialName, env });
}

export function trackTutorialCompleted(tutorialName: string) {
  track('tutorial_completed', { tutorialName, env });
}

// ---------------------------------------------------------------------------
// Core engagement
// ---------------------------------------------------------------------------

export function trackAIChatMessageSent(model: string) {
  track('ai_chat_message_sent', { model, env });
}

export function trackAIAssetGenerated(type: string, provider: string) {
  track('ai_asset_generated', { type, provider, env });
}

export function trackGameExported(format: string) {
  track('game_exported', { format, env });
}

export function trackGamePublished(tier: string) {
  track('game_published', { tier, env });
}

export function trackTemplateUsed(templateName: string) {
  track('template_used', { templateName, env });
}

export function trackPlayModeStarted() {
  track('play_mode_started', { env });
}

export function trackProjectCreated() {
  track('project_created', { env });
}

// ---------------------------------------------------------------------------
// Monetization
// ---------------------------------------------------------------------------

export function trackBYOKKeyAdded(provider: string) {
  track('byok_key_added', { provider, env });
}

// ---------------------------------------------------------------------------
// Feature discovery
// ---------------------------------------------------------------------------

export function trackFeatureUsed(feature: string) {
  track('feature_used', { feature, env });
}

export function trackEditorPanelOpened(panel: string) {
  track('editor_panel_opened', { panel, env });
}

