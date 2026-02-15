/**
 * Physics slice - manages 3D and 2D physics state.
 * TODO: Extract full implementation from editorStore.ts
 */

import { StateCreator } from 'zustand';
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
  removePhysics2d: (entityId: string) => void;
  togglePhysics2d: (entityId: string, enabled: boolean) => void;
  setJoint2d: (entityId: string, data: Joint2dData) => void;
  removeJoint2d: (entityId: string) => void;
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
    if (dispatchCommand) dispatchCommand('set_physics_2d', { entityId, ...data, enabled });
  },
  updatePhysics2d: (entityId, data) => {
    set(state => ({ physics2d: { ...state.physics2d, [entityId]: data } }));
    if (dispatchCommand) dispatchCommand('update_physics_2d', { entityId, ...data });
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
    if (dispatchCommand) dispatchCommand('set_joint_2d', { entityId, ...data });
  },
  removeJoint2d: (entityId) => {
    set(state => {
      const { [entityId]: _, ...rest } = state.joints2d;
      return { joints2d: rest };
    });
    if (dispatchCommand) dispatchCommand('remove_joint_2d', { entityId });
  },
});
