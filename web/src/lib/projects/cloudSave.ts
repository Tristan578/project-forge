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
 * @param arrangement - Optional explicit metadata override. Omit to retain the
 *   arrangement already attached by the scene export producer; null clears it.
 * @returns CloudSaveResult indicating success or failure
 */
export async function saveSceneToCloud(
  projectId: string,
  name: string,
  sceneJson: string,
  arrangement?: MusicArrangement | null,
): Promise<CloudSaveResult> {
  let sceneData: unknown;
  try {
    sceneData = JSON.parse(sceneJson);
  } catch {
    return { ok: false, error: 'Invalid scene JSON — could not parse before cloud save' };
  }

  // Only merge when the parsed scene is an object (it always is for a real
  // engine export); a non-object scene is passed through untouched.
  if (arrangement !== undefined && sceneData && typeof sceneData === 'object' && !Array.isArray(sceneData)) {
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
