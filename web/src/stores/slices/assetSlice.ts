/**
 * Asset slice - manages asset registry and texture loading.
 */

import { StateCreator } from 'zustand';
import { decodeBase64ToArrayBuffer, queueAudioImport } from '@/lib/audio/entityAudioGraph';
import { boundDisplayName, checkTexturePayload } from '@/lib/engine/textureFormatGuard';
import { showPersistentError } from '@/lib/toast';
import type { AssetMetadata } from './types';

/**
 * The answer to an import or texture load. `success: false` carries the
 * reason - the format gate's or the engine's own sentence - so the chat tool
 * can hand it to the model and a picker can show it.
 */
export interface AssetCommandResult {
  success: boolean;
  error?: string;
}

export interface AssetSlice {
  assetRegistry: Record<string, AssetMetadata>;

  importGltf: (dataBase64: string, name: string, targetEntityId?: string, assetId?: string) => AssetCommandResult;
  loadTexture: (dataBase64: string, name: string, entityId: string, slot: string) => AssetCommandResult;
  removeTexture: (entityId: string, slot: string) => void;
  importAudio: (dataBase64: string, name: string, assetId?: string) => void;
  placeAsset: (assetId: string) => void;
  deleteAsset: (assetId: string) => void;
  setAssetRegistry: (assets: Record<string, AssetMetadata>) => void;
  addAssetToRegistry: (asset: AssetMetadata) => void;
  removeAssetFromRegistry: (assetId: string) => void;
}

/**
 * What a dispatch can answer with. Structurally identical to `CommandResponse`
 * in `@/hooks/useEngine`, restated here so a store slice does not import a hook
 * module (which imports the store back). Only an explicit `success: false` is a
 * rejection - every test double and every pre-PF-1098 caller returns nothing.
 */
type DispatchResult = { success: boolean; error?: string | undefined; threw?: true } | void;

let dispatchCommand: ((command: string, payload: unknown) => DispatchResult) | null = null;

export function setAssetDispatcher(dispatcher: (command: string, payload: unknown) => DispatchResult): void {
  dispatchCommand = dispatcher;
}

/** The longest engine reason relayed into a notification; longer ones are cut with a marker. */
const MAX_RELAYED_REASON = 512;

/**
 * Turn a dispatch answer into this slice's result, showing an engine
 * REFUSAL to the person.
 *
 * `editorStore`'s tracked dispatcher already logs every rejection and shows a
 * generic "Couldn't ..." once per command per session. A format refusal is
 * different: the engine answers `<command> refused: <reason>` with a sentence
 * written for the person (which image is KTX2, what to convert it to), it
 * echoes no file content, and it has to be seen for EVERY refused file, not
 * the first. So that prefix is the contract: a refusal is shown here,
 * persistent because it carries a remediation, deduped by id so N identical
 * failures make one toast. Any other rejection - a parse error, an
 * uninitialised queue, a throw - is left to the generic report.
 */
function surfaceRefusal(
  command: 'import_gltf' | 'load_texture',
  response: DispatchResult,
  name: string,
): AssetCommandResult {
  if (!response || response.success !== false) return { success: true };
  const prefix = `${command} refused: `;
  if (response.threw || !response.error?.startsWith(prefix)) {
    return { success: false, error: response.error ?? 'The engine rejected the change.' };
  }
  const reason = truncateReason(response.error.slice(prefix.length));
  showRefusal(command, name, reason);
  return { success: false, error: reason };
}

/**
 * The refusal toast: names the file, carries the reason, and is keyed by
 * command AND file so dropping several files shows one toast each (the same
 * file refused twice collapses) instead of the last reason overwriting the
 * rest under one id.
 */
function showRefusal(command: 'import_gltf' | 'load_texture', name: string, reason: string): void {
  const lead = command === 'load_texture'
    ? `Couldn't load "${boundDisplayName(name)}" as a texture`
    : `Couldn't import "${boundDisplayName(name)}"`;
  showPersistentError(`${lead}: ${reason}`, { id: `${command}-refused:${name}` });
}

function truncateReason(reason: string): string {
  return reason.length > MAX_RELAYED_REASON
    ? `${reason.slice(0, MAX_RELAYED_REASON)}… [truncated]`
    : reason;
}

export const createAssetSlice: StateCreator<AssetSlice, [], [], AssetSlice> = (set, get) => ({
  assetRegistry: {},

  importGltf: (dataBase64, name, targetEntityId, assetId) => {
    // Conditional spread: when no target is supplied (or it's an empty string),
    // the payload is byte-identical to the original { dataBase64, name } so existing
    // callers and tests are unaffected. When present, the engine replaces that
    // entity's model/mesh in place instead of spawning a new root.
    if (!dispatchCommand) return { success: true };
    const response = dispatchCommand('import_gltf', {
      dataBase64,
      name,
      ...(targetEntityId ? { targetEntityId } : {}),
      ...(assetId ? { id: assetId } : {}),
    });
    // The engine inspects the document before queueing it (a KTX2 or Basis
    // Universal texture, or an unreadable file, is refused by name - #10396).
    return surfaceRefusal('import_gltf', response, name);
  },
  loadTexture: (dataBase64, name, entityId, slot) => {
    // The same allowlist the engine applies, run before the command is built
    // so a picker or the generation poller sees the refusal and the accepted
    // formats without a round trip (#10396). The engine's gate is the real one.
    const check = checkTexturePayload(dataBase64);
    if (!check.ok) {
      showRefusal('load_texture', name, check.error);
      return { success: false, error: check.error };
    }
    if (!dispatchCommand) return { success: true };
    const response = dispatchCommand('load_texture', { dataBase64, name, entityId, slot });
    return surfaceRefusal('load_texture', response, name);
  },
  removeTexture: (entityId, slot) => {
    if (dispatchCommand) dispatchCommand('remove_texture', { entityId, slot });
  },
  importAudio: (dataBase64, name, assetId) => {
    // The engine receives `dataBase64` to validate the payload and record its
    // decoded size, while playback remains JS-side. Hold the bytes until
    // `ASSET_IMPORTED` names the asset id the engine minted, then
    // `ingestImportedAudioAsset` decodes them under that id.
    //
    // Queued only when the dispatch actually happens: the queue is drained by
    // `ASSET_IMPORTED`, which only ever arrives in response to this command, so
    // queueing without dispatching leaves an entry that nothing can claim —
    // occupying one of the FIFO's slots until it is evicted by real imports.
    if (!dispatchCommand) return;
    const bytes = decodeBase64ToArrayBuffer(dataBase64);
    if (bytes) queueAudioImport(name, bytes);
    dispatchCommand('import_audio', { dataBase64, name, ...(assetId ? { id: assetId } : {}) });
  },
  placeAsset: (assetId) => {
    if (dispatchCommand) dispatchCommand('place_asset', { assetId });
  },
  deleteAsset: (assetId) => {
    set(state => {
      const { [assetId]: _, ...rest } = state.assetRegistry;
      return { assetRegistry: rest };
    });
    if (dispatchCommand) dispatchCommand('delete_asset', { assetId });
  },
  setAssetRegistry: (assets) => set({ assetRegistry: assets }),
  addAssetToRegistry: (asset) => {
    const state = get();
    set({ assetRegistry: { ...state.assetRegistry, [asset.id]: asset } });
  },
  removeAssetFromRegistry: (assetId) => {
    set(state => {
      const { [assetId]: _, ...rest } = state.assetRegistry;
      return { assetRegistry: rest };
    });
  },
});
