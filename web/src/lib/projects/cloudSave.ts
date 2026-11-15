/**
 * Client-side cloud save helpers.
 *
 * Extracted from SceneToolbar so the save logic is testable and reusable
 * without coupling it to a specific component.
 */

import { applyArrangementToSceneData } from '@/lib/music/arrangementStore';
import type { MusicArrangement } from '@/lib/music/arrangementTypes';

export interface CloudSaveResult {
  ok: boolean;
  savedAt?: string;
  error?: string;
}

/**
 * Persist a scene to the cloud by PUT-ing to /api/projects/:id.
 *
 * @param projectId - The project's database ID
 * @param name - Scene/project name to store
 * @param sceneJson - Serialized scene JSON string from the engine
 * @param arrangement - The music arrangement to persist alongside the scene
 *   (#9854). Merged into the same `sceneData` object the route already accepts,
 *   under a namespaced key; `null`/empty leaves no arrangement behind. This is
 *   why persistence needs no new table: the arrangement rides the existing
 *   project payload.
 * @returns CloudSaveResult indicating success or failure
 */
export async function saveSceneToCloud(
  projectId: string,
  name: string,
  sceneJson: string,
  arrangement: MusicArrangement | null = null,
): Promise<CloudSaveResult> {
  let sceneData: unknown;
  try {
    sceneData = JSON.parse(sceneJson);
  } catch {
    return { ok: false, error: 'Invalid scene JSON — could not parse before cloud save' };
  }

  // Only merge when the parsed scene is an object (it always is for a real
  // engine export); a non-object scene is passed through untouched.
  if (sceneData && typeof sceneData === 'object' && !Array.isArray(sceneData)) {
    sceneData = applyArrangementToSceneData(sceneData as Record<string, unknown>, arrangement);
  }

  try {
    const res = await fetch(`/api/projects/${projectId}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, sceneData }),
    });

    if (res.ok) {
      return { ok: true, savedAt: new Date().toISOString() };
    }

    const text = await res.text().catch(() => '');
    return { ok: false, error: `Server returned ${res.status}${text ? `: ${text}` : ''}` };
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Network error';
    return { ok: false, error: message };
  }
}
