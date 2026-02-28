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
        customLoadingScreen: store.loadingScreenConfig ?? undefined,
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
        customLoadingScreen: store.loadingScreenConfig ?? undefined,
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
      backgroundColor = '#18181b',
      progressBarColor = '#6366f1',
      progressStyle = 'bar',
      title,
      subtitle,
      logoDataUrl,
    } = params as Partial<LoadingScreenConfig>;

    const validStyles = ['bar', 'spinner', 'dots', 'none'] as const;
    if (!validStyles.includes(progressStyle as typeof validStyles[number])) {
      return {
        success: false,
        error: `Invalid progressStyle: ${progressStyle}. Must be one of: ${validStyles.join(', ')}`,
      };
    }

    const config: LoadingScreenConfig = {
      backgroundColor,
      progressBarColor,
      progressStyle: progressStyle as LoadingScreenConfig['progressStyle'],
      title,
      subtitle,
      logoDataUrl,
    };

    useEditorStore.getState().setLoadingScreenConfig(config);

    return {
      success: true,
      message: `Loading screen configured: ${progressStyle} style, bg=${backgroundColor}`,
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

    return {
      success: false,
      error: `Export preset "${preset.name}" recognized but not yet persisted. Export preset storage requires editor store integration planned for a future release.`,
    };
  },
};
