import { bundleScripts } from './scriptBundler';
import { generateGameHTML, type GameTemplateOptions, type EmbeddedWasmData } from './gameTemplate';
import { useEditorStore } from '@/stores/editorStore';
import { exportAsZip, type ZipExportOptions } from './zipExporter';
import type { LoadingScreenConfig } from './loadingScreen';
import type { ExportFormat, ExportPreset } from './presets';

export interface ExportOptions {
  title: string;
  mode: ExportFormat;
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
  if (options.mode === 'zip' || options.mode === 'pwa' || options.mode === 'embed') {
    // ZIP, PWA, or Embed export with separated assets
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
  // 6. Fetch WASM engine files for inlining
  const embeddedWasm = await fetchWasmForInlining();

  // 7. Generate HTML with embedded WASM
  const html = generateGameHTML({
    title: options.title,
    bgColor: options.bgColor,
    resolution: options.resolution,
    sceneData: JSON.stringify(sceneData),
    scriptBundle: scripts.code,
    includeDebug: options.includeDebug,
    uiData: uiDataJson,
    mobileTouchConfig: mobileTouchConfigJson,
    embeddedWasm: Object.keys(embeddedWasm).length > 0 ? embeddedWasm : undefined,
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

/**
 * Fetch WASM engine files for inlining into single-HTML export.
 * Returns base64-encoded JS glue and WASM binary for each available variant.
 */
async function fetchWasmForInlining(): Promise<Record<string, EmbeddedWasmData>> {
  const result: Record<string, EmbeddedWasmData> = {};
  const variants = ['webgl2', 'webgpu'];

  for (const variant of variants) {
    const runtimeBase = `/engine-pkg-${variant}-runtime/`;
    const editorBase = `/engine-pkg-${variant}/`;

    try {
      let jsResponse = await fetch(runtimeBase + 'forge_engine.js');
      if (!jsResponse.ok) jsResponse = await fetch(editorBase + 'forge_engine.js');

      let wasmResponse = await fetch(runtimeBase + 'forge_engine_bg.wasm');
      if (!wasmResponse.ok) wasmResponse = await fetch(editorBase + 'forge_engine_bg.wasm');

      if (jsResponse.ok && wasmResponse.ok) {
        const jsText = await jsResponse.text();
        const wasmBuffer = await wasmResponse.arrayBuffer();
        result[variant] = {
          jsBase64: arrayBufferToBase64(new TextEncoder().encode(jsText).buffer as ArrayBuffer),
          wasmBase64: arrayBufferToBase64(wasmBuffer),
        };
      }
    } catch {
      console.warn(`[Export] Could not fetch WASM for ${variant}, skipping`);
    }
  }

  return result;
}

function arrayBufferToBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let binary = '';
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
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
