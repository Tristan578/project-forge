import { bundleScripts } from './scriptBundler';
import { generateGameHTML, type GameTemplateOptions, type EmbeddedWasmData } from './gameTemplate';
import { useEditorStore } from '@/stores/editorStore';
import { exportAsZip, type ZipExportOptions } from './zipExporter';
import type { LoadingScreenConfig } from './loadingScreen';
import type { ExportFormat, ExportPreset } from './presets';
import type { CompressionConfig } from './textureCompression';

export interface ExportOptions {
  title: string;
  mode: ExportFormat;
  resolution: GameTemplateOptions['resolution'];
  bgColor: string;
  includeDebug: boolean;
  preset?: ExportPreset;
  customLoadingScreen?: LoadingScreenConfig;
  orientationLock?: 'landscape' | 'portrait' | 'none';
  textureCompressionConfig?: CompressionConfig;
  signal?: AbortSignal;
}

function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) {
    throw new DOMException('Export cancelled', 'AbortError');
  }
}

export async function exportGame(options: ExportOptions): Promise<Blob> {
  const { signal } = options;
  const store = useEditorStore.getState();

  // 1. Get scene data (trigger export from engine)
  throwIfAborted(signal);
  const sceneData = await getSceneData(signal);

  // 2. Bundle scripts
  throwIfAborted(signal);
  const scripts = bundleScripts(store.allScripts);

  throwIfAborted(signal);

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

  throwIfAborted(signal);

  // 5. Branch based on export mode
  throwIfAborted(signal);
  if (options.mode === 'zip' || options.mode === 'pwa' || options.mode === 'embed') {
    // ZIP, PWA, or Embed export with separated assets
    const zipOptions: ZipExportOptions = {
      format: options.mode,
      includeSourceMaps: options.preset?.includeSourceMaps ?? false,
      compressTextures: options.preset?.compressTextures ?? (options.textureCompressionConfig?.format !== 'original' && options.textureCompressionConfig != null),
      textureCompressionConfig: options.textureCompressionConfig,
      customLoadingScreen: options.customLoadingScreen,
      title: options.title,
      resolution: options.resolution,
      bgColor: options.bgColor,
      includeDebug: options.includeDebug,
      orientationLock: options.orientationLock,
      signal,
    };

    return await exportAsZip(sceneData, store.allScripts, zipOptions);
  }

  // Default: Single HTML export
  // 6. Fetch WASM engine files for inlining
  throwIfAborted(signal);
  const embeddedWasm = await fetchWasmForInlining(signal);

  if (Object.keys(embeddedWasm).length === 0) {
    throw new Error(
      'Failed to fetch WASM engine files for single-HTML export. ' +
      'Ensure the engine has been built and deployed to the CDN, or use ZIP export instead.',
    );
  }

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
    embeddedWasm,
    orientationLock: options.orientationLock,
  });

  return new Blob([html], { type: 'text/html' });
}

async function getSceneData(signal?: AbortSignal): Promise<unknown> {
  return new Promise((resolve, reject) => {
    // eslint-disable-next-line prefer-const -- timeoutId must be declared before cleanup but assigned after
    let timeoutId: ReturnType<typeof setTimeout>;

    const cleanup = () => {
      clearTimeout(timeoutId);
      window.removeEventListener('forge:scene-exported', handler);
      signal?.removeEventListener('abort', onAbort);
    };

    // Listen for the export response event
    const handler = (event: Event) => {
      cleanup();
      const customEvent = event as CustomEvent;
      try {
        const sceneData = JSON.parse(customEvent.detail.json);
        const uiData = injectUIData(sceneData);
        resolve(uiData);
      } catch (err) {
        console.error('[Export] Failed to parse scene data:', err);
        resolve(buildSceneFromStore());
      }
    };

    // Abort signal listener
    const onAbort = () => {
      cleanup();
      reject(new DOMException('Export cancelled', 'AbortError'));
    };

    // Check if already aborted before setting up listeners
    if (signal?.aborted) {
      reject(new DOMException('Export cancelled', 'AbortError'));
      return;
    }

    window.addEventListener('forge:scene-exported', handler);
    signal?.addEventListener('abort', onAbort);

    // Timeout — if engine doesn't respond, reject rather than producing a
    // broken export with only entity names and no materials/physics/scripts.
    // The 5s timeout gives the engine time for large scenes (#8185).
    timeoutId = setTimeout(() => {
      cleanup();
      reject(new Error(
        'Engine did not respond to export request within 5 seconds. ' +
        'Ensure the engine is loaded and the scene is ready before exporting.',
      ));
    }, 5000);

    // Trigger export_scene command
    const store = useEditorStore.getState();
    store.saveScene();
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
  // Fallback: construct scene data from Zustand store when the engine
  // export event doesn't fire. Include all store data needed to produce
  // a playable scene — not just the entity graph (#8185).
  const store = useEditorStore.getState();
  return {
    name: store.sceneName || 'Untitled Game',
    entities: store.sceneGraph,
    scripts: store.allScripts,
    ambientLight: store.ambientLight,
    environment: store.environment,
    primaryMaterial: store.primaryMaterial,
    primaryPhysics: store.primaryPhysics,
    physicsEnabled: store.physicsEnabled,
  };
}

/**
 * Fetch WASM engine files for inlining into single-HTML export.
 * Returns base64-encoded JS glue and WASM binary for each available variant.
 */
async function fetchWasmForInlining(signal?: AbortSignal): Promise<Record<string, EmbeddedWasmData>> {
  const result: Record<string, EmbeddedWasmData> = {};
  const variants = ['webgl2', 'webgpu'];

  for (const variant of variants) {
    throwIfAborted(signal);
    const runtimeBase = `/engine-pkg-${variant}-runtime/`;
    const editorBase = `/engine-pkg-${variant}/`;

    try {
      let jsResponse = await fetch(runtimeBase + 'forge_engine.js', { signal });
      if (!jsResponse.ok) jsResponse = await fetch(editorBase + 'forge_engine.js', { signal });

      let wasmResponse = await fetch(runtimeBase + 'forge_engine_bg.wasm', { signal });
      if (!wasmResponse.ok) wasmResponse = await fetch(editorBase + 'forge_engine_bg.wasm', { signal });

      if (jsResponse.ok && wasmResponse.ok) {
        const jsText = await jsResponse.text();
        const wasmBuffer = await wasmResponse.arrayBuffer();
        result[variant] = {
          jsBase64: arrayBufferToBase64(new TextEncoder().encode(jsText).buffer as ArrayBuffer),
          wasmBase64: arrayBufferToBase64(wasmBuffer),
        };
      }
    } catch (err) {
      if (err instanceof DOMException && err.name === 'AbortError') throw err;
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
