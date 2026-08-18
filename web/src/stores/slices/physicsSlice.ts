/**
 * Physics slice - manages 3D and 2D physics state.
 */

import { StateCreator } from 'zustand';
import {
  buildSetJoint2dPayload,
  buildSetPhysics2dPayload,
  buildUpdatePhysics2dPayload,
  defaultPhysics2dData,
} from '@/lib/physics/physics2dPayload';
import type { PhysicsData, JointData, Physics2dData, Joint2dData } from './types';

export interface PhysicsSlice {
  primaryPhysics: PhysicsData | null;
  physicsEnabled: boolean;
  debugPhysics: boolean;
  primaryJoint: JointData | null;
  physics2d: Record<string, Physics2dData>;
  physics2dEnabled: Record<string, boolean>;
  joints2d: Record<string, Joint2dData>;

  setPrimaryPhysics: (data: PhysicsData | null, enabled: boolean) => void;
  updatePhysics: (entityId: string, data: PhysicsData) => void;
  togglePhysics: (entityId: string, enabled: boolean) => void;
  toggleDebugPhysics: () => void;
  setDebugPhysics: (enabled: boolean) => void;
  setPrimaryJoint: (data: JointData | null) => void;
  createJoint: (entityId: string, data: JointData) => void;
  updateJoint: (entityId: string, updates: Partial<JointData>) => void;
  removeJoint: (entityId: string) => void;
  setPhysics2d: (entityId: string, data: Physics2dData, enabled: boolean) => void;
  updatePhysics2d: (entityId: string, data: Physics2dData) => void;
  applyPhysics2dFromEngine: (
    entityId: string,
    data: Partial<Physics2dData>,
    enabled: boolean,
  ) => void;
  removePhysics2d: (entityId: string) => void;
  togglePhysics2d: (entityId: string, enabled: boolean) => void;
  setJoint2d: (entityId: string, data: Joint2dData) => void;
  applyJoint2dFromEngine: (entityId: string, data: Joint2dData) => void;
  removeJoint2d: (entityId: string) => void;
  setGravity2d: (gravityX: number, gravityY: number) => void;
  setDebugPhysics2d: (enabled: boolean) => void;
}

let dispatchCommand: ((command: string, payload: unknown) => void) | null = null;

export function setPhysicsDispatcher(dispatcher: (command: string, payload: unknown) => void): void {
  dispatchCommand = dispatcher;
}

export const createPhysicsSlice: StateCreator<PhysicsSlice, [], [], PhysicsSlice> = (set, _get) => ({
  primaryPhysics: null,
  physicsEnabled: false,
  debugPhysics: false,
  primaryJoint: null,
  physics2d: {},
  physics2dEnabled: {},
  joints2d: {},

  setPrimaryPhysics: (data, enabled) => set({ primaryPhysics: data, physicsEnabled: enabled }),
  updatePhysics: (entityId, data) => {
    set({ primaryPhysics: data, physicsEnabled: true });
    if (dispatchCommand) dispatchCommand('update_physics', { entityId, ...data });
  },
  togglePhysics: (entityId, enabled) => {
    if (dispatchCommand) dispatchCommand('toggle_physics', { entityId, enabled });
  },
  toggleDebugPhysics: () => {
    if (dispatchCommand) dispatchCommand('toggle_debug_physics', {});
  },
  setDebugPhysics: (enabled) => set({ debugPhysics: enabled }),
  setPrimaryJoint: (data) => set({ primaryJoint: data }),
  createJoint: (entityId, data) => {
    if (dispatchCommand) dispatchCommand('create_joint', { entityId, ...data });
  },
  updateJoint: (entityId, updates) => {
    if (dispatchCommand) dispatchCommand('update_joint', { entityId, ...updates });
  },
  removeJoint: (entityId) => {
    if (dispatchCommand) dispatchCommand('remove_joint', { entityId });
  },
  setPhysics2d: (entityId, data, enabled) => {
    set(state => ({
      physics2d: { ...state.physics2d, [entityId]: data },
      physics2dEnabled: { ...state.physics2dEnabled, [entityId]: enabled },
    }));
    // Built, not spread: `set_physics2d` reads a NESTED `physicsData` object, so the
    // flat spread this used to send deserialized to nothing and every 2D physics
    // edit was dropped before it reached the simulation (PF-1167).
    if (dispatchCommand) {
      dispatchCommand('set_physics_2d', buildSetPhysics2dPayload(entityId, data, enabled));
    }
  },
  updatePhysics2d: (entityId, data) => {
    set(state => ({ physics2d: { ...state.physics2d, [entityId]: data } }));
    if (dispatchCommand) {
      dispatchCommand('update_physics_2d', buildUpdatePhysics2dPayload(entityId, data));
    }
  },
  /**
   * Write engine-reported 2D physics into the store WITHOUT dispatching.
   *
   * The inbound `PHYSICS2D_CHANGED` handler must not call `setPhysics2d`: that
   * dispatches `set_physics_2d` straight back at the engine, which is a FULL
   * REPLACE, so any field the event did not carry would be reset to its default
   * on the entity the engine just described. It also echoes a command per event.
   *
   * The patch is merged onto the entity's existing state — or onto engine
   * defaults for an entity the store has never seen — so a partial event cannot
   * blank the fields it left out.
   */
  applyPhysics2dFromEngine: (entityId, data, enabled) => {
    set(state => {
      const existing = Object.hasOwn(state.physics2d, entityId)
        ? state.physics2d[entityId]
        : defaultPhysics2dData();
      return {
        physics2d: { ...state.physics2d, [entityId]: { ...existing, ...data } },
        physics2dEnabled: { ...state.physics2dEnabled, [entityId]: enabled },
      };
    });
  },
  removePhysics2d: (entityId) => {
    set(state => {
      const { [entityId]: _, ...rest } = state.physics2d;
      const { [entityId]: _enabled, ...restEnabled } = state.physics2dEnabled;
      return { physics2d: rest, physics2dEnabled: restEnabled };
    });
    if (dispatchCommand) dispatchCommand('remove_physics_2d', { entityId });
  },
  togglePhysics2d: (entityId, enabled) => {
    set(state => ({ physics2dEnabled: { ...state.physics2dEnabled, [entityId]: enabled } }));
    if (dispatchCommand) dispatchCommand('toggle_physics_2d', { entityId, enabled });
  },
  setJoint2d: (entityId, data) => {
    set(state => ({ joints2d: { ...state.joints2d, [entityId]: data } }));
    // Built, not spread: the flat spread this used to send was a hard serde
    // reject on three counts at once, so every 2D joint the editor created was
    // dropped before it reached the simulation while the store kept its own
    // optimistic copy (PF-1167).
    if (dispatchCommand) dispatchCommand('set_joint_2d', buildSetJoint2dPayload(entityId, data));
  },
  /**
   * Write an engine-reported 2D joint into the store WITHOUT dispatching.
   *
   * Same reason as `applyPhysics2dFromEngine`: routing an inbound event through
   * `setJoint2d` would echo a `set_joint_2d` straight back at the engine that
   * just described the joint.
   */
  applyJoint2dFromEngine: (entityId, data) => {
    set(state => ({ joints2d: { ...state.joints2d, [entityId]: data } }));
  },
  removeJoint2d: (entityId) => {
    set(state => {
      const { [entityId]: _, ...rest } = state.joints2d;
      return { joints2d: rest };
    });
    if (dispatchCommand) dispatchCommand('remove_joint_2d', { entityId });
  },
  setGravity2d: (gravityX, gravityY) => {
    if (dispatchCommand) dispatchCommand('set_gravity2d', { gravityX, gravityY });
  },
  setDebugPhysics2d: (enabled) => {
    if (dispatchCommand) dispatchCommand('set_debug_physics2d', { enabled });
  },
});
