import { bundleScripts } from './scriptBundler';
import { generateGameHTML, type GameTemplateOptions } from './gameTemplate';
import { useEditorStore } from '@/stores/editorStore';
import { exportAsZip, type ZipExportOptions } from './zipExporter';
import type { LoadingScreenConfig } from './loadingScreen';
import type { ExportPreset } from './presets';

export interface ExportOptions {
  title: string;
  mode: 'single-html' | 'zip' | 'pwa';
  resolution: GameTemplateOptions['resolution'];
  bgColor: string;
  includeDebug: boolean;
  preset?: ExportPreset;
  customLoadingScreen?: LoadingScreenConfig;
}

export async function exportGame(options: ExportOptions): Promise<Blob> {
  const store = useEditorStore.getState();

  // 1. Get scene data (trigger export from engine)
  const sceneData = await getSceneData();

  // 2. Bundle scripts
  const scripts = bundleScripts(store.allScripts);

  // 3. Get UI data
  let uiDataJson: string | undefined;
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { useUIBuilderStore } = require('@/stores/uiBuilderStore');
    const uiData = useUIBuilderStore.getState().serialize();
    if (uiData && uiData.screens && uiData.screens.length > 0) {
      uiDataJson = JSON.stringify(uiData);
    }
  } catch {
    // uiBuilderStore not available yet
  }

  // 4. Get mobile touch config
  const mobileTouchConfig = store.mobileTouchConfig;
  const mobileTouchConfigJson = mobileTouchConfig?.enabled ? JSON.stringify(mobileTouchConfig) : undefined;

  // 5. Branch based on export mode
  if (options.mode === 'zip' || options.mode === 'pwa') {
    // ZIP or PWA export with separated assets
    const zipOptions: ZipExportOptions = {
      format: options.mode,
      includeSourceMaps: options.preset?.includeSourceMaps ?? false,
      compressTextures: options.preset?.compressTextures ?? false,
      customLoadingScreen: options.customLoadingScreen,
      title: options.title,
      resolution: options.resolution,
      bgColor: options.bgColor,
      includeDebug: options.includeDebug,
    };

    return await exportAsZip(sceneData, store.allScripts, zipOptions);
  }

  // Default: Single HTML export
  // 6. Generate HTML
  const html = generateGameHTML({
    title: options.title,
    bgColor: options.bgColor,
    resolution: options.resolution,
    sceneData: JSON.stringify(sceneData),
    scriptBundle: scripts.code,
    includeDebug: options.includeDebug,
    uiData: uiDataJson,
    mobileTouchConfig: mobileTouchConfigJson,
  });

  return new Blob([html], { type: 'text/html' });
}

async function getSceneData(): Promise<unknown> {
  return new Promise((resolve) => {
    // Listen for the export response event
    const handler = (event: Event) => {
      const customEvent = event as CustomEvent;
      window.removeEventListener('forge:scene-exported', handler);
      // The event contains { json, name }, parse the json
      try {
        const sceneData = JSON.parse(customEvent.detail.json);
        // Inject UI data from uiBuilderStore
        const uiData = injectUIData(sceneData);
        resolve(uiData);
      } catch (err) {
        console.error('[Export] Failed to parse scene data:', err);
        resolve(buildSceneFromStore());
      }
    };
    window.addEventListener('forge:scene-exported', handler);

    // Trigger export_scene command
    const store = useEditorStore.getState();
    store.saveScene(); // Uses the existing saveScene action which calls export_scene

    // Timeout fallback — use current store state if export event doesn't fire
    setTimeout(() => {
      window.removeEventListener('forge:scene-exported', handler);
      // Build scene data from store state as fallback
      resolve(buildSceneFromStore());
    }, 2000);
  });
}

function injectUIData(sceneData: unknown): unknown {
  // Dynamically import uiBuilderStore to avoid circular dependency
  const sceneObj = sceneData as Record<string, unknown>;
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { useUIBuilderStore } = require('@/stores/uiBuilderStore');
    const uiData = useUIBuilderStore.getState().serialize();
    sceneObj.gameUi = JSON.stringify(uiData);
  } catch {
    // uiBuilderStore not available (no UI builder phase implemented yet)
    sceneObj.gameUi = null;
  }
  return sceneObj;
}

function buildSceneFromStore(): unknown {
  // Fallback: construct scene data from Zustand store
  const store = useEditorStore.getState();
  return {
    name: store.sceneName || 'Untitled Game',
    entities: store.sceneGraph,
    // Additional data would come from the engine
  };
}

export function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}
