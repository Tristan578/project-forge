// Animation channel handler — async animation queries.

import type { AsyncHandler } from '../asyncChannelRouter';

export interface AnimationChannelDeps {
  dispatchCommand: (command: string, payload: unknown) => unknown;
}

export function createAnimationHandler(deps: AnimationChannelDeps): AsyncHandler {
  return async (method: string, args: Record<string, unknown>) => {
    switch (method) {
      case 'listClips': {
        const result = deps.dispatchCommand('list_animation_clips', {
          entityId: args.entityId,
        });
        return result ?? [];
      }
      case 'getClipDuration': {
        const result = deps.dispatchCommand('get_clip_duration', {
          entityId: args.entityId,
          clipName: args.clipName,
        });
        return result ?? 0;
      }
      default:
        throw new Error(`Unknown animation method: ${method}`);
    }
  };
}
