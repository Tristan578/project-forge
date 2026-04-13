/**
 * Tests for panel and command lifecycle analytics tracking.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockTrack = vi.fn();
vi.mock('@vercel/analytics', () => ({
  track: mockTrack,
}));

describe('panelTracking', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
  });

  describe('trackPanelOpened', () => {
    it('calls track with panel_opened event and panelId', async () => {
      const { trackPanelOpened } = await import('@/lib/analytics/panelTracking');
      trackPanelOpened('inspector');
      expect(mockTrack).toHaveBeenCalledWith('panel_opened', expect.objectContaining({ panelId: 'inspector' }));
    });

    it('includes env dimension', async () => {
      const { trackPanelOpened } = await import('@/lib/analytics/panelTracking');
      trackPanelOpened('ai-chat');
      const [, props] = mockTrack.mock.calls[0];
      expect(props).toHaveProperty('env');
    });

    it('tracks different panel IDs correctly', async () => {
      const { trackPanelOpened } = await import('@/lib/analytics/panelTracking');
      trackPanelOpened('material-library');
      expect(mockTrack).toHaveBeenCalledWith('panel_opened', expect.objectContaining({ panelId: 'material-library' }));
    });
  });

  describe('trackPanelClosed', () => {
    it('calls track with panel_closed event, panelId, and durationMs', async () => {
      const { trackPanelClosed } = await import('@/lib/analytics/panelTracking');
      trackPanelClosed('inspector', 5000);
      expect(mockTrack).toHaveBeenCalledWith('panel_closed', expect.objectContaining({
        panelId: 'inspector',
        durationMs: 5000,
      }));
    });

    it('includes env dimension', async () => {
      const { trackPanelClosed } = await import('@/lib/analytics/panelTracking');
      trackPanelClosed('physics', 1234);
      const [, props] = mockTrack.mock.calls[0];
      expect(props).toHaveProperty('env');
    });

    it('handles zero duration', async () => {
      const { trackPanelClosed } = await import('@/lib/analytics/panelTracking');
      trackPanelClosed('quick-panel', 0);
      expect(mockTrack).toHaveBeenCalledWith('panel_closed', expect.objectContaining({ durationMs: 0 }));
    });
  });

  describe('trackCommandDispatched', () => {
    it('calls track with command_dispatched event and commandName', async () => {
      const { trackCommandDispatched } = await import('@/lib/analytics/panelTracking');
      trackCommandDispatched('spawn_entity');
      expect(mockTrack).toHaveBeenCalledWith('command_dispatched', expect.objectContaining({ commandName: 'spawn_entity' }));
    });

    it('includes env dimension', async () => {
      const { trackCommandDispatched } = await import('@/lib/analytics/panelTracking');
      trackCommandDispatched('set_material');
      const [, props] = mockTrack.mock.calls[0];
      expect(props).toHaveProperty('env');
    });

    it('tracks different command names', async () => {
      const { trackCommandDispatched } = await import('@/lib/analytics/panelTracking');
      trackCommandDispatched('delete_entities');
      expect(mockTrack).toHaveBeenCalledWith('command_dispatched', expect.objectContaining({ commandName: 'delete_entities' }));
    });
  });

  describe('trackGenerationStarted', () => {
    it('calls track with generation_started event and moduleName', async () => {
      const { trackGenerationStarted } = await import('@/lib/analytics/panelTracking');
      trackGenerationStarted('meshy_3d');
      expect(mockTrack).toHaveBeenCalledWith('generation_started', expect.objectContaining({ moduleName: 'meshy_3d' }));
    });

    it('includes env dimension', async () => {
      const { trackGenerationStarted } = await import('@/lib/analytics/panelTracking');
      trackGenerationStarted('elevenlabs_sfx');
      const [, props] = mockTrack.mock.calls[0];
      expect(props).toHaveProperty('env');
    });
  });

  describe('trackGenerationCompleted', () => {
    it('calls track with generation_completed event, moduleName, durationMs, and success=true', async () => {
      const { trackGenerationCompleted } = await import('@/lib/analytics/panelTracking');
      trackGenerationCompleted('suno_music', 8500, true);
      expect(mockTrack).toHaveBeenCalledWith('generation_completed', expect.objectContaining({
        moduleName: 'suno_music',
        durationMs: 8500,
        success: true,
      }));
    });

    it('calls track with success=false on failure', async () => {
      const { trackGenerationCompleted } = await import('@/lib/analytics/panelTracking');
      trackGenerationCompleted('meshy_texture', 3000, false);
      expect(mockTrack).toHaveBeenCalledWith('generation_completed', expect.objectContaining({
        success: false,
      }));
    });

    it('includes env dimension', async () => {
      const { trackGenerationCompleted } = await import('@/lib/analytics/panelTracking');
      trackGenerationCompleted('replicate', 2000, true);
      const [, props] = mockTrack.mock.calls[0];
      expect(props).toHaveProperty('env');
    });

    it('handles zero duration', async () => {
      const { trackGenerationCompleted } = await import('@/lib/analytics/panelTracking');
      trackGenerationCompleted('instant', 0, true);
      expect(mockTrack).toHaveBeenCalledWith('generation_completed', expect.objectContaining({ durationMs: 0 }));
    });
  });

  describe('trackGamePublished', () => {
    it('calls track with game_published_detail, entityCount, and projectSizeKb', async () => {
      const { trackGamePublished } = await import('@/lib/analytics/panelTracking');
      trackGamePublished(42, 1500);
      expect(mockTrack).toHaveBeenCalledWith('game_published_detail', expect.objectContaining({
        entityCount: 42,
        projectSizeKb: 1500,
      }));
    });

    it('includes env dimension', async () => {
      const { trackGamePublished } = await import('@/lib/analytics/panelTracking');
      trackGamePublished(0, 0);
      const [, props] = mockTrack.mock.calls[0];
      expect(props).toHaveProperty('env');
    });

    it('handles large entity counts', async () => {
      const { trackGamePublished } = await import('@/lib/analytics/panelTracking');
      trackGamePublished(10000, 50000);
      expect(mockTrack).toHaveBeenCalledWith('game_published_detail', expect.objectContaining({
        entityCount: 10000,
        projectSizeKb: 50000,
      }));
    });
  });

  describe('env dimension consistency', () => {
    it('all tracking functions include env in every call', async () => {
      const mod = await import('@/lib/analytics/panelTracking');
      mod.trackPanelOpened('p1');
      mod.trackPanelClosed('p1', 1000);
      mod.trackCommandDispatched('cmd');
      mod.trackGenerationStarted('mod');
      mod.trackGenerationCompleted('mod', 500, true);
      mod.trackGamePublished(5, 100);

      for (const call of mockTrack.mock.calls) {
        const [, props] = call;
        expect(props).toHaveProperty('env');
      }
    });
  });
});
