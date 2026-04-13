/**
 * Tests for Vercel Web Analytics custom event wrappers.
 *
 * Verifies that each function calls `track` with the correct event name
 * and properties, and that the `env` dimension is always included.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock @vercel/analytics before importing the module under test.
const mockTrack = vi.fn();
vi.mock('@vercel/analytics', () => ({
  track: mockTrack,
}));

describe('Vercel analytics event wrappers', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
  });

  // -------------------------------------------------------------------------
  // Onboarding funnel
  // -------------------------------------------------------------------------

  it('trackSignupComplete calls track with tier', async () => {
    const { trackSignupComplete } = await import('@/lib/analytics/events');
    trackSignupComplete('pro');
    expect(mockTrack).toHaveBeenCalledWith('signup_complete', expect.objectContaining({ tier: 'pro' }));
  });

  it('trackFirstSceneCreated calls track', async () => {
    const { trackFirstSceneCreated } = await import('@/lib/analytics/events');
    trackFirstSceneCreated();
    expect(mockTrack).toHaveBeenCalledWith('first_scene_created', expect.objectContaining({}));
  });

  it('trackFirstEntitySpawned calls track with entityType', async () => {
    const { trackFirstEntitySpawned } = await import('@/lib/analytics/events');
    trackFirstEntitySpawned('cube');
    expect(mockTrack).toHaveBeenCalledWith('first_entity_spawned', expect.objectContaining({ entityType: 'cube' }));
  });

  it('trackTutorialStarted calls track with tutorialName', async () => {
    const { trackTutorialStarted } = await import('@/lib/analytics/events');
    trackTutorialStarted('intro');
    expect(mockTrack).toHaveBeenCalledWith('tutorial_started', expect.objectContaining({ tutorialName: 'intro' }));
  });

  it('trackTutorialCompleted calls track with tutorialName', async () => {
    const { trackTutorialCompleted } = await import('@/lib/analytics/events');
    trackTutorialCompleted('intro');
    expect(mockTrack).toHaveBeenCalledWith('tutorial_completed', expect.objectContaining({ tutorialName: 'intro' }));
  });

  // -------------------------------------------------------------------------
  // Core engagement
  // -------------------------------------------------------------------------

  it('trackAIChatMessageSent calls track with model', async () => {
    const { trackAIChatMessageSent } = await import('@/lib/analytics/events');
    trackAIChatMessageSent('claude-sonnet-4-6');
    expect(mockTrack).toHaveBeenCalledWith('ai_chat_message_sent', expect.objectContaining({ model: 'claude-sonnet-4-6' }));
  });

  it('trackAIAssetGenerated calls track with type and provider', async () => {
    const { trackAIAssetGenerated } = await import('@/lib/analytics/events');
    trackAIAssetGenerated('sprite', 'replicate');
    expect(mockTrack).toHaveBeenCalledWith('ai_asset_generated', expect.objectContaining({ type: 'sprite', provider: 'replicate' }));
  });

  it('trackGameExported calls track with format', async () => {
    const { trackGameExported } = await import('@/lib/analytics/events');
    trackGameExported('zip');
    expect(mockTrack).toHaveBeenCalledWith('game_exported', expect.objectContaining({ format: 'zip' }));
  });

  it('trackGamePublished calls track with tier', async () => {
    const { trackGamePublished } = await import('@/lib/analytics/events');
    trackGamePublished('creator');
    expect(mockTrack).toHaveBeenCalledWith('game_published', expect.objectContaining({ tier: 'creator' }));
  });

  it('trackTemplateUsed calls track with templateName', async () => {
    const { trackTemplateUsed } = await import('@/lib/analytics/events');
    trackTemplateUsed('platformer');
    expect(mockTrack).toHaveBeenCalledWith('template_used', expect.objectContaining({ templateName: 'platformer' }));
  });

  it('trackPlayModeStarted calls track', async () => {
    const { trackPlayModeStarted } = await import('@/lib/analytics/events');
    trackPlayModeStarted();
    expect(mockTrack).toHaveBeenCalledWith('play_mode_started', expect.objectContaining({}));
  });

  it('trackProjectCreated calls track', async () => {
    const { trackProjectCreated } = await import('@/lib/analytics/events');
    trackProjectCreated();
    expect(mockTrack).toHaveBeenCalledWith('project_created', expect.objectContaining({}));
  });

  // -------------------------------------------------------------------------
  // Monetization
  // -------------------------------------------------------------------------

  it('trackBYOKKeyAdded calls track with provider', async () => {
    const { trackBYOKKeyAdded } = await import('@/lib/analytics/events');
    trackBYOKKeyAdded('anthropic');
    expect(mockTrack).toHaveBeenCalledWith('byok_key_added', expect.objectContaining({ provider: 'anthropic' }));
  });

  // -------------------------------------------------------------------------
  // Feature discovery
  // -------------------------------------------------------------------------

  it('trackFeatureUsed calls track with feature', async () => {
    const { trackFeatureUsed } = await import('@/lib/analytics/events');
    trackFeatureUsed('physics-joints');
    expect(mockTrack).toHaveBeenCalledWith('feature_used', expect.objectContaining({ feature: 'physics-joints' }));
  });

  it('trackEditorPanelOpened calls track with panel', async () => {
    const { trackEditorPanelOpened } = await import('@/lib/analytics/events');
    trackEditorPanelOpened('gdd-generator');
    expect(mockTrack).toHaveBeenCalledWith('editor_panel_opened', expect.objectContaining({ panel: 'gdd-generator' }));
  });

  // -------------------------------------------------------------------------
  // New functions: command dispatch and AI generation
  // -------------------------------------------------------------------------

  it('trackCommandDispatched calls track with command name', async () => {
    const { trackCommandDispatched } = await import('@/lib/analytics/events');
    trackCommandDispatched('spawn_entity');
    expect(mockTrack).toHaveBeenCalledWith('command_dispatched', expect.objectContaining({ command: 'spawn_entity' }));
  });

  it('trackCommandDispatched includes env dimension', async () => {
    const { trackCommandDispatched } = await import('@/lib/analytics/events');
    trackCommandDispatched('set_material');
    const [, props] = mockTrack.mock.calls[0];
    expect(props).toHaveProperty('env');
  });

  it('trackAIAssetGenerated includes both type and provider', async () => {
    const { trackAIAssetGenerated } = await import('@/lib/analytics/events');
    trackAIAssetGenerated('model', 'meshy');
    expect(mockTrack).toHaveBeenCalledWith('ai_asset_generated', expect.objectContaining({
      type: 'model',
      provider: 'meshy',
    }));
  });

  it('trackAIAssetGenerated includes env dimension', async () => {
    const { trackAIAssetGenerated } = await import('@/lib/analytics/events');
    trackAIAssetGenerated('music', 'suno');
    const [, props] = mockTrack.mock.calls[0];
    expect(props).toHaveProperty('env');
  });

  it('all tracking functions include env dimension', async () => {
    const mod = await import('@/lib/analytics/events');
    mod.trackSignupComplete('starter');
    mod.trackFirstSceneCreated();
    mod.trackAIChatMessageSent('claude-sonnet-4-6');
    mod.trackCommandDispatched('delete_entity');
    mod.trackAIAssetGenerated('texture', 'meshy');
    mod.trackEditorPanelOpened('inspector');

    for (const call of mockTrack.mock.calls) {
      const [, props] = call;
      expect(props).toHaveProperty('env');
    }
  });
});
