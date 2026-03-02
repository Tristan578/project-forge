/**
 * Dialogue system handlers for MCP commands.
 * Manages dialogue trees and nodes via useDialogueStore.
 */

import { z } from 'zod';
import type { ToolHandler } from './types';
import { parseArgs } from './types';

export const dialogueHandlers: Record<string, ToolHandler> = {
  create_dialogue_tree: async (args, _ctx) => {
    const p = parseArgs(
      z.object({
        name: z.string().min(1),
        startNodeText: z.string().optional(),
      }),
      args,
    );
    if (p.error) return p.error;
    const { useDialogueStore } = await import('@/stores/dialogueStore');
    const treeId = useDialogueStore.getState().addTree(
      p.data.name,
      p.data.startNodeText,
    );
    return { success: true, result: { treeId, message: `Created dialogue tree: ${p.data.name}` } };
  },

  add_dialogue_node: async (args, _ctx) => {
    const p = parseArgs(
      z.object({
        treeId: z.string().min(1),
        nodeType: z.string().min(1),
        text: z.string().optional(),
        speaker: z.string().optional(),
        connectFromNodeId: z.string().optional(),
      }),
      args,
    );
    if (p.error) return p.error;
    const { useDialogueStore } = await import('@/stores/dialogueStore');
    const { treeId, nodeType, text, speaker, connectFromNodeId } = p.data;
    const nodeId = `node_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    let node;
    switch (nodeType) {
      case 'text':
        node = { id: nodeId, type: 'text' as const, speaker: speaker ?? 'NPC', text: text ?? '', next: null };
        break;
      case 'choice':
        node = { id: nodeId, type: 'choice' as const, text: text ?? '', choices: [] };
        break;
      case 'condition':
        node = { id: nodeId, type: 'condition' as const, condition: { type: 'equals' as const, variable: '', value: true }, onTrue: null, onFalse: null };
        break;
      case 'action':
        node = { id: nodeId, type: 'action' as const, actions: [], next: null };
        break;
      case 'end':
        node = { id: nodeId, type: 'end' as const };
        break;
      default:
        return { success: false, error: `Unknown node type: ${nodeType}` };
    }
    useDialogueStore.getState().addNode(treeId, node);
    // Connect from another node if specified
    if (connectFromNodeId) {
      const tree = useDialogueStore.getState().dialogueTrees[treeId];
      if (tree) {
        const fromNode = tree.nodes.find(n => n.id === connectFromNodeId);
        if (fromNode && 'next' in fromNode) {
          useDialogueStore.getState().updateNode(treeId, fromNode.id, { next: nodeId } as Record<string, unknown>);
        }
      }
    }
    return { success: true, result: { nodeId, message: `Added ${nodeType} node` } };
  },

  set_dialogue_choice: async (args, _ctx) => {
    const p = parseArgs(
      z.object({
        treeId: z.string().min(1),
        nodeId: z.string().min(1),
        choiceText: z.string().min(1),
        nextNodeId: z.string().optional(),
      }),
      args,
    );
    if (p.error) return p.error;
    const { useDialogueStore } = await import('@/stores/dialogueStore');
    const { treeId, nodeId, choiceText, nextNodeId } = p.data;
    const tree = useDialogueStore.getState().dialogueTrees[treeId];
    if (!tree) return { success: false, error: 'Tree not found' };
    const choiceNode = tree.nodes.find(n => n.id === nodeId);
    if (!choiceNode || choiceNode.type !== 'choice') return { success: false, error: 'Choice node not found' };
    const choiceId = `choice_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    const newChoices = [...choiceNode.choices, { id: choiceId, text: choiceText, nextNodeId: nextNodeId ?? null }];
    useDialogueStore.getState().updateNode(treeId, nodeId, { choices: newChoices } as Record<string, unknown>);
    return { success: true, result: { choiceId, message: 'Choice added' } };
  },

  remove_dialogue_tree: async (args, _ctx) => {
    const p = parseArgs(z.object({ treeId: z.string().min(1) }), args);
    if (p.error) return p.error;
    const { useDialogueStore } = await import('@/stores/dialogueStore');
    useDialogueStore.getState().removeTree(p.data.treeId);
    return { success: true, result: { message: 'Dialogue tree removed' } };
  },

  get_dialogue_tree: async (args, _ctx) => {
    const p = parseArgs(z.object({ treeId: z.string().min(1) }), args);
    if (p.error) return p.error;
    const { useDialogueStore } = await import('@/stores/dialogueStore');
    const tree = useDialogueStore.getState().dialogueTrees[p.data.treeId];
    if (!tree) return { success: false, error: 'Tree not found' };
    return { success: true, result: tree };
  },

  set_dialogue_node_voice: async (args, _ctx) => {
    const p = parseArgs(
      z.object({
        treeId: z.string().min(1),
        nodeId: z.string().min(1),
        voiceAssetId: z.string().min(1),
      }),
      args,
    );
    if (p.error) return p.error;
    const { useDialogueStore } = await import('@/stores/dialogueStore');
    useDialogueStore.getState().updateNode(
      p.data.treeId,
      p.data.nodeId,
      { voiceAsset: p.data.voiceAssetId } as Record<string, unknown>,
    );
    return { success: true, result: { message: 'Voice asset assigned' } };
  },

  export_dialogue_tree: async (args, _ctx) => {
    const p = parseArgs(z.object({ treeId: z.string().min(1) }), args);
    if (p.error) return p.error;
    const { useDialogueStore } = await import('@/stores/dialogueStore');
    const json = useDialogueStore.getState().exportTree(p.data.treeId);
    if (!json) return { success: false, error: 'Tree not found' };
    return { success: true, result: { json } };
  },

  import_dialogue_tree: async (args, _ctx) => {
    const p = parseArgs(z.object({ jsonData: z.string().min(1) }), args);
    if (p.error) return p.error;
    const { useDialogueStore } = await import('@/stores/dialogueStore');
    const treeId = useDialogueStore.getState().importTree(p.data.jsonData);
    if (!treeId) return { success: false, error: 'Failed to import tree' };
    return { success: true, result: { treeId, message: 'Dialogue tree imported' } };
  },
};
