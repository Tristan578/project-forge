/**
 * Client-side cloud save helpers.
 *
 * Extracted from SceneToolbar so the save logic is testable and reusable
 * without coupling it to a specific component.
 */

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
 * @returns CloudSaveResult indicating success or failure
 */
export async function saveSceneToCloud(
  projectId: string,
  name: string,
  sceneJson: string,
): Promise<CloudSaveResult> {
  let sceneData: unknown;
  try {
    sceneData = JSON.parse(sceneJson);
  } catch {
    return { ok: false, error: 'Invalid scene JSON — could not parse before cloud save' };
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
