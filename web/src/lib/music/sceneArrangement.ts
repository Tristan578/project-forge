/** Frontend-only scene metadata follows the engine's scene load/export boundaries. */
import { applyArrangementToSceneData, readArrangementFromSceneData, useMusicArrangementStore } from './arrangementStore';
import { ARRANGEMENT_SCENE_DATA_KEY, type MusicArrangement } from './arrangementTypes';

type PendingArrangement = { arrangement: MusicArrangement | null };
let pending: PendingArrangement | null = null;

/** Stage before dispatch; the rollback only owns this still-unconsumed load. */
export function stageSceneArrangement(json?: string): () => void {
  let arrangement: MusicArrangement | null = null;
  if (json !== undefined) {
    try { arrangement = readArrangementFromSceneData(JSON.parse(json)); } catch { /* engine rejects malformed JSON */ }
  }
  const previous = pending;
  const staged = { arrangement };
  pending = staged;
  return () => { if (pending === staged) pending = previous; };
}

/** Adopt metadata only when the engine confirms a replacement, including an empty scene. */
export function applyStagedSceneArrangement(): void {
  const staged = pending;
  pending = null;
  useMusicArrangementStore.getState().hydrate(staged?.arrangement ?? null);
}

/** A project change discards both the outgoing history and its pending metadata. */
export function resetSceneArrangement(): void {
  pending = null;
  useMusicArrangementStore.getState().hydrate(null);
}

/** Enrich the single export event before any autosave, download, capture or cloud consumer. */
export function includeSceneArrangement(json: string): string {
  try {
    const scene: unknown = JSON.parse(json);
    if (!scene || typeof scene !== 'object' || Array.isArray(scene)) return json;
    const arrangement = useMusicArrangementStore.getState().serialize();
    if (!arrangement && !(ARRANGEMENT_SCENE_DATA_KEY in scene)) return json;
    return JSON.stringify(applyArrangementToSceneData(scene as Record<string, unknown>, arrangement));
  } catch { return json; }
}
