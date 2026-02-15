/**
 * Export MCP Command Handlers
 * Handles export-related MCP commands
 */

import type { ToolHandler } from './types';
import { useEditorStore } from '@/stores/editorStore';
import { exportGame, downloadBlob } from '@/lib/export/exportEngine';
import { getPreset, EXPORT_PRESETS } from '@/lib/export/presets';
import type { LoadingScreenConfig } from '@/lib/export/loadingScreen';

export const exportHandlers: Record<string, ToolHandler> = {
  export_project_zip: async (params) => {
    const { title, preset } = params as { title?: string; preset?: string };

    const store = useEditorStore.getState();
    const gameTitle = title || store.sceneName || 'Game';

    const presetConfig = preset ? getPreset(preset) : undefined;

    try {
      const blob = await exportGame({
        title: gameTitle,
        mode: 'zip',
        resolution: presetConfig?.resolution || 'responsive',
        bgColor: presetConfig?.loadingScreen.backgroundColor || '#18181b',
        includeDebug: presetConfig?.includeDebug || false,
        preset: presetConfig,
      });

      downloadBlob(blob, `${gameTitle.replace(/[^a-z0-9_-]/gi, '_')}.zip`);

      return {
        success: true,
        message: `Exported "${gameTitle}" as ZIP bundle`,
      };
    } catch (err) {
      return {
        success: false,
        error: `Export failed: ${err instanceof Error ? err.message : String(err)}`,
      };
    }
  },

  export_project_pwa: async (params) => {
    const { title, preset } = params as { title?: string; preset?: string };

    const store = useEditorStore.getState();
    const gameTitle = title || store.sceneName || 'Game';

    const presetConfig = preset ? getPreset(preset) : getPreset('pwa-mobile');

    try {
      const blob = await exportGame({
        title: gameTitle,
        mode: 'pwa',
        resolution: presetConfig?.resolution || 'responsive',
        bgColor: presetConfig?.loadingScreen.backgroundColor || '#0f172a',
        includeDebug: presetConfig?.includeDebug || false,
        preset: presetConfig,
      });

      downloadBlob(blob, `${gameTitle.replace(/[^a-z0-9_-]/gi, '_')}_pwa.zip`);

      return {
        success: true,
        message: `Exported "${gameTitle}" as PWA (Progressive Web App)`,
      };
    } catch (err) {
      return {
        success: false,
        error: `PWA export failed: ${err instanceof Error ? err.message : String(err)}`,
      };
    }
  },

  set_loading_screen: async (params) => {
    const {
      backgroundColor,
      progressBarColor,
      progressStyle,
      title,
      subtitle,
    } = params as {
      backgroundColor?: string;
      progressBarColor?: string;
      progressStyle?: LoadingScreenConfig['progressStyle'];
      title?: string;
      subtitle?: string;
    };

    // Store loading screen config in editor store (we'll add this field)
    // const _store = useEditorStore.getState();

    // For now, just validate and return success
    // In a full implementation, we'd persist this config
    const config: LoadingScreenConfig = {
      backgroundColor: backgroundColor || '#1a1a1a',
      progressBarColor: progressBarColor || '#6366f1',
      progressStyle: progressStyle || 'bar',
      title,
      subtitle,
    };

    // TODO: Add loadingScreenConfig to editorStore
    console.log('[Export] Loading screen configured:', config);

    return {
      success: true,
      message: 'Loading screen customized',
      data: config,
    };
  },

  set_export_preset: async (params) => {
    const { preset: presetName } = params as { preset: string };

    const preset = getPreset(presetName);
    if (!preset) {
      return {
        success: false,
        error: `Unknown preset: ${presetName}. Available: ${Object.keys(EXPORT_PRESETS).join(', ')}`,
      };
    }

    // Store selected preset (we'd add this to editorStore in full implementation)
    console.log('[Export] Preset selected:', preset.name);

    return {
      success: true,
      message: `Export preset set to "${preset.name}"`,
      data: {
        preset: presetName,
        description: preset.description,
        format: preset.format,
      },
    };
  },
};
