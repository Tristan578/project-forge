/**
 * Script slice - manages entity scripts and input bindings.
 * TODO: Extract full implementation from editorStore.ts
 */

import { StateCreator } from 'zustand';
import type { ScriptData, ScriptLogEntry, InputBinding, InputPreset } from './types';

export interface ScriptSlice {
  primaryScript: ScriptData | null;
  allScripts: Record<string, ScriptData>;
  scriptLogs: ScriptLogEntry[];
  inputBindings: InputBinding[];
  inputPreset: InputPreset;

  setScript: (entityId: string, source: string, enabled: boolean, template?: string) => void;
  removeScript: (entityId: string) => void;
  applyScriptTemplate: (entityId: string, templateId: string, source: string) => void;
  setPrimaryScript: (script: ScriptData | null) => void;
  setEntityScript: (entityId: string, script: ScriptData | null) => void;
  addScriptLog: (entry: ScriptLogEntry) => void;
  clearScriptLogs: () => void;
  setInputBinding: (binding: InputBinding) => void;
  removeInputBinding: (actionName: string) => void;
  setInputPreset: (preset: 'fps' | 'platformer' | 'topdown' | 'racing') => void;
  setInputBindings: (bindings: InputBinding[], preset: InputPreset) => void;
}

let dispatchCommand: ((command: string, payload: unknown) => void) | null = null;

export function setScriptDispatcher(dispatcher: (command: string, payload: unknown) => void): void {
  dispatchCommand = dispatcher;
}

export const createScriptSlice: StateCreator<ScriptSlice, [], [], ScriptSlice> = (set, get) => ({
  primaryScript: null,
  allScripts: {},
  scriptLogs: [],
  inputBindings: [],
  inputPreset: null,

  setScript: (entityId, source, enabled, template) => {
    set(state => ({ allScripts: { ...state.allScripts, [entityId]: { source, enabled, template } } }));
    if (dispatchCommand) dispatchCommand('set_script', { entityId, source, enabled, template });
  },
  removeScript: (entityId) => {
    set(state => {
      const { [entityId]: _, ...rest } = state.allScripts;
      return { allScripts: rest };
    });
    if (dispatchCommand) dispatchCommand('remove_script', { entityId });
  },
  applyScriptTemplate: (entityId, templateId, source) => {
    set(state => ({ allScripts: { ...state.allScripts, [entityId]: { source, enabled: true, template: templateId } } }));
    if (dispatchCommand) dispatchCommand('set_script', { entityId, source, enabled: true, template: templateId });
  },
  setPrimaryScript: (script) => set({ primaryScript: script }),
  setEntityScript: (_entityId, script) => set({ primaryScript: script }),
  addScriptLog: (entry) => {
    const state = get();
    // Keep max 200 log entries
    const logs = [...state.scriptLogs, entry].slice(-200);
    set({ scriptLogs: logs });
  },
  clearScriptLogs: () => set({ scriptLogs: [] }),
  setInputBinding: (binding) => {
    const state = get();
    const existing = state.inputBindings.findIndex(b => b.actionName === binding.actionName);
    const updated = existing >= 0
      ? state.inputBindings.map((b, i) => i === existing ? binding : b)
      : [...state.inputBindings, binding];
    set({ inputBindings: updated });
    if (dispatchCommand) dispatchCommand('set_input_binding', binding);
  },
  removeInputBinding: (actionName) => {
    const state = get();
    set({ inputBindings: state.inputBindings.filter(b => b.actionName !== actionName) });
    if (dispatchCommand) dispatchCommand('remove_input_binding', { actionName });
  },
  setInputPreset: (preset) => {
    set({ inputPreset: preset });
    if (dispatchCommand) dispatchCommand('set_input_preset', { preset });
  },
  setInputBindings: (bindings, preset) => set({ inputBindings: bindings, inputPreset: preset }),
});
