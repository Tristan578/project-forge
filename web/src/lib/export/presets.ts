/**
 * Export Presets
 * Pre-configured export settings for common scenarios
 */

import type { LoadingScreenConfig } from './loadingScreen';

export interface ExportPreset {
  name: string;
  description: string;
  format: 'single-html' | 'zip' | 'pwa';
  includeSourceMaps: boolean;
  compressTextures: boolean;
  resolution: 'responsive' | '1920x1080' | '1280x720';
  includeDebug: boolean;
  loadingScreen: LoadingScreenConfig;
}

export const EXPORT_PRESETS: Record<string, ExportPreset> = {
  'web-optimized': {
    name: 'Web Optimized',
    description: 'Best for web hosting - optimized file sizes and fast loading',
    format: 'zip',
    includeSourceMaps: false,
    compressTextures: true,
    resolution: 'responsive',
    includeDebug: false,
    loadingScreen: {
      backgroundColor: '#1a1a1a',
      progressBarColor: '#6366f1',
      progressStyle: 'bar',
      title: undefined,
      subtitle: 'Loading...',
    },
  },

  'self-contained': {
    name: 'Self-Contained',
    description: 'Single HTML file - easy to share and host anywhere',
    format: 'single-html',
    includeSourceMaps: false,
    compressTextures: false,
    resolution: 'responsive',
    includeDebug: false,
    loadingScreen: {
      backgroundColor: '#000000',
      progressBarColor: '#4ade80',
      progressStyle: 'spinner',
      title: undefined,
      subtitle: undefined,
    },
  },

  'itch-io': {
    name: 'itch.io',
    description: 'Optimized for itch.io upload - follows platform guidelines',
    format: 'zip',
    includeSourceMaps: false,
    compressTextures: true,
    resolution: 'responsive',
    includeDebug: false,
    loadingScreen: {
      backgroundColor: '#fa5c5c',
      progressBarColor: '#ffffff',
      progressStyle: 'bar',
      title: undefined,
      subtitle: 'Loading...',
    },
  },

  'newgrounds': {
    name: 'Newgrounds',
    description: 'Optimized for Newgrounds - single file with branding',
    format: 'single-html',
    includeSourceMaps: false,
    compressTextures: true,
    resolution: '1280x720',
    includeDebug: false,
    loadingScreen: {
      backgroundColor: '#000000',
      progressBarColor: '#ff6600',
      progressStyle: 'dots',
      title: undefined,
      subtitle: undefined,
    },
  },

  'pwa-mobile': {
    name: 'PWA (Mobile)',
    description: 'Progressive Web App - installable on mobile devices',
    format: 'pwa',
    includeSourceMaps: false,
    compressTextures: true,
    resolution: 'responsive',
    includeDebug: false,
    loadingScreen: {
      backgroundColor: '#0f172a',
      progressBarColor: '#3b82f6',
      progressStyle: 'spinner',
      title: undefined,
      subtitle: 'Installing...',
    },
  },

  debug: {
    name: 'Debug',
    description: 'Development build with debug info and source maps',
    format: 'zip',
    includeSourceMaps: true,
    compressTextures: false,
    resolution: 'responsive',
    includeDebug: true,
    loadingScreen: {
      backgroundColor: '#18181b',
      progressBarColor: '#eab308',
      progressStyle: 'bar',
      title: 'Debug Build',
      subtitle: 'Console logs enabled',
    },
  },
};

export function getPresetNames(): string[] {
  return Object.keys(EXPORT_PRESETS);
}

export function getPreset(name: string): ExportPreset | undefined {
  return EXPORT_PRESETS[name];
}
