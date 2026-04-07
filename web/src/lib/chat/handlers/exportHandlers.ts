/**
 * Export MCP Command Handlers
 * Handles export-related MCP commands
 */

import { z } from 'zod';
import type { ToolHandler } from './types';
import { parseArgs } from './types';
import { useEditorStore } from '@/stores/editorStore';
import { exportGame, downloadBlob } from '@/lib/export/exportEngine';
import { getPreset, EXPORT_PRESETS } from '@/lib/export/presets';
import type { LoadingScreenConfig } from '@/lib/export/loadingScreen';

export const exportHandlers: Record<string, ToolHandler> = {
  export_project_zip: async (args) => {
    const p = parseArgs(z.object({
      title: z.string().optional(),
      preset: z.string().optional(),
    }), args);
    if (p.error) return p.error;

    const store = useEditorStore.getState();
    const gameTitle = p.data.title || store.sceneName || 'Game';
    const presetConfig = p.data.preset ? getPreset(p.data.preset) : store.exportPreset?.config;

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

  export_project_pwa: async (args) => {
    const p = parseArgs(z.object({
      title: z.string().optional(),
      preset: z.string().optional(),
    }), args);
    if (p.error) return p.error;

    const store = useEditorStore.getState();
    const gameTitle = p.data.title || store.sceneName || 'Game';
    const presetConfig = p.data.preset ? getPreset(p.data.preset) : undefined;

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

  set_loading_screen: async (args) => {
    const CSS_COLOR_RE = /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{4}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/;
    const p = parseArgs(z.object({
      backgroundColor: z.string().regex(CSS_COLOR_RE, 'backgroundColor must be a hex color (e.g. #18181b)').optional(),
      progressBarColor: z.string().regex(CSS_COLOR_RE, 'progressBarColor must be a hex color (e.g. #6366f1)').optional(),
      progressStyle: z.enum(['bar', 'spinner', 'dots', 'none']).optional(),
      title: z.string().optional(),
      subtitle: z.string().optional(),
      logoDataUrl: z.string().optional(),
    }), args);
    if (p.error) return p.error;

    const config: LoadingScreenConfig = {
      backgroundColor: p.data.backgroundColor ?? '#18181b',
      progressBarColor: p.data.progressBarColor ?? '#6366f1',
      progressStyle: p.data.progressStyle ?? 'bar',
      title: p.data.title,
      subtitle: p.data.subtitle,
      logoDataUrl: p.data.logoDataUrl,
    };

    useEditorStore.getState().setLoadingScreenConfig(config);

    return {
      success: true,
      message: `Loading screen configured: ${config.progressStyle} style, bg=${config.backgroundColor}`,
    };
  },

  set_export_preset: async (args) => {
    const p = parseArgs(z.object({ preset: z.string().min(1) }), args);
    if (p.error) return p.error;

    const preset = getPreset(p.data.preset);
    if (!preset) {
      return {
        success: false,
        error: `Unknown preset: ${p.data.preset}. Available: ${Object.keys(EXPORT_PRESETS).join(', ')}`,
      };
    }

    useEditorStore.getState().setExportPreset(p.data.preset, preset);

    return {
      success: true,
      message: `Export preset "${preset.name}" saved (${preset.format}, ${preset.resolution}). The preset is stored for reference — individual export commands determine the actual output format.`,
    };
  },
};
