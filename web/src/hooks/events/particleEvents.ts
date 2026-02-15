/**
 * Event handlers for particle systems.
 */

import { useEditorStore, type ParticleData } from '@/stores/editorStore';
import type { SetFn, GetFn } from './types';

export function handleParticleEvent(
  type: string,
  data: Record<string, unknown>,
  _set: SetFn,
  _get: GetFn
): boolean {
  switch (type) {
    case 'PARTICLE_CHANGED': {
      const payload = data as { entityId: string; enabled: boolean; particle: ParticleData | null };
      useEditorStore.getState().setEntityParticle(payload.entityId, payload.particle, payload.enabled);
      return true;
    }

    default:
      return false;
  }
}
