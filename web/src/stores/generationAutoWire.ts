/**
 * Generation auto-wire — connects completed AI generation jobs to the editor.
 *
 * When a generation job completes with `resultUrl` and the user requested
 * placement (`autoPlace` + `targetEntityId`), this module fetches the asset
 * and dispatches the appropriate editor command (importGltf / loadTexture /
 * importAudio + setAudio) so the result lands on the target entity without
 * a manual drag-drop.
 *
 * Decoupled from editorStore via a registered-handler pattern (matching
 * the existing slice dispatcher pattern in this folder) to avoid an import
 * cycle. Wired at boot from the editorStore composition root.
 *
 * Closes #8540.
 */

import { captureException } from '@/lib/monitoring/sentry-client';
import type { GenerationType } from './generationStore';

export interface AutoWireDispatchers {
  importGltf: (dataBase64: string, name: string) => void;
  loadTexture: (dataBase64: string, name: string, entityId: string, slot: string) => void;
  importAudio: (dataBase64: string, name: string) => void;
  setAudio: (entityId: string, data: { assetId: string }) => void;
}

let dispatchers: AutoWireDispatchers | null = null;

export function setAutoWireDispatchers(next: AutoWireDispatchers | null): void {
  dispatchers = next;
}

export interface AutoWireInput {
  type: GenerationType;
  resultUrl: string;
  prompt: string;
  targetEntityId?: string;
  materialSlot?: string;
}

const TEXTURE_TYPES: ReadonlySet<GenerationType> = new Set([
  'texture',
  'sprite',
  'sprite_sheet',
  'tileset',
  'pixel-art',
]);

const AUDIO_TYPES: ReadonlySet<GenerationType> = new Set(['sfx', 'voice', 'music']);

export async function autoWireGenerationResult(input: AutoWireInput): Promise<void> {
  if (!dispatchers) return;

  const name = sanitizeAssetName(input.prompt);

  let dataBase64: string;
  try {
    dataBase64 = await fetchAsBase64(input.resultUrl);
  } catch (err) {
    captureException(err, {
      context: 'generationAutoWire.fetch',
      url: input.resultUrl,
      type: input.type,
    });
    return;
  }

  if (input.type === 'model') {
    // Engine doesn't yet support replacing an existing entity with the imported
    // glTF in-place; we import alongside. Replacement is tracked separately —
    // the user can delete the placeholder once the model lands.
    dispatchers.importGltf(dataBase64, name);
    return;
  }

  if (TEXTURE_TYPES.has(input.type) && input.targetEntityId && input.materialSlot) {
    dispatchers.loadTexture(dataBase64, name, input.targetEntityId, input.materialSlot);
    return;
  }

  if (AUDIO_TYPES.has(input.type) && input.targetEntityId) {
    dispatchers.importAudio(dataBase64, name);
    dispatchers.setAudio(input.targetEntityId, { assetId: name });
    return;
  }

  // Skybox + unrecognized types are no-ops here — they require additional
  // engine surface (custom-URL skybox, asset placement) tracked in follow-ups.
}

async function fetchAsBase64(url: string): Promise<string> {
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`Failed to fetch generation result: ${res.status} ${res.statusText}`);
  }
  const blob = await res.blob();
  return blobToBase64(blob);
}

function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => {
      const result = typeof reader.result === 'string' ? reader.result : '';
      const idx = result.indexOf(',');
      resolve(idx >= 0 ? result.slice(idx + 1) : result);
    };
    reader.onerror = () => reject(reader.error ?? new Error('FileReader failed'));
    reader.readAsDataURL(blob);
  });
}

function sanitizeAssetName(prompt: string): string {
  const trimmed = prompt.trim().slice(0, 60);
  const safe = trimmed.replace(/[^a-zA-Z0-9_-]+/g, '_').replace(/^_+|_+$/g, '');
  return safe || 'generated';
}

// Test-only — reset registered dispatchers between tests.
export function _resetForTest(): void {
  dispatchers = null;
}
