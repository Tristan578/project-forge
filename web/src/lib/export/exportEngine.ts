import { bundleScripts } from './scriptBundler';
import { generateGameHTML, type GameTemplateOptions } from './gameTemplate';
import { useEditorStore } from '@/stores/editorStore';

export interface ExportOptions {
  title: string;
  mode: 'single-html' | 'zip';
  resolution: GameTemplateOptions['resolution'];
  bgColor: string;
  includeDebug: boolean;
}

export async function exportGame(options: ExportOptions): Promise<Blob> {
  const store = useEditorStore.getState();

  // 1. Get scene data (trigger export from engine)
  const sceneData = await getSceneData();

  // 2. Bundle scripts
  const scripts = bundleScripts(store.allScripts);

  // 3. Generate HTML
  const html = generateGameHTML({
    title: options.title,
    bgColor: options.bgColor,
    resolution: options.resolution,
    sceneData: JSON.stringify(sceneData),
    scriptBundle: scripts.code,
    includeDebug: options.includeDebug,
  });

  // For now, always produce single HTML
  // ZIP mode with embedded WASM would require fetching the binary, which is complex
  // We'll generate HTML that loads WASM from a CDN or relative path
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
        resolve(sceneData);
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
