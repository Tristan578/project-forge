/**
 * Dialogue system handlers for MCP commands.
 * Manages dialogue trees and nodes via useDialogueStore.
 */

import type { ToolHandler } from './types';

export const dialogueHandlers: Record<string, ToolHandler> = {
  create_dialogue_tree: async (args, _ctx) => {
    const { useDialogueStore } = await import('@/stores/dialogueStore');
    const treeId = useDialogueStore.getState().addTree(
      args.name as string,
      args.startNodeText as string | undefined,
    );
    return { success: true, result: { treeId, message: `Created dialogue tree: ${args.name}` } };
  },

  add_dialogue_node: async (args, _ctx) => {
    const { useDialogueStore } = await import('@/stores/dialogueStore');
    const nodeType = args.nodeType as string;
    const nodeId = `node_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    let node;
    switch (nodeType) {
      case 'text':
        node = { id: nodeId, type: 'text' as const, speaker: (args.speaker as string) || 'NPC', text: (args.text as string) || '', next: null };
        break;
      case 'choice':
        node = { id: nodeId, type: 'choice' as const, text: (args.text as string) || '', choices: [] };
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
    useDialogueStore.getState().addNode(args.treeId as string, node);
    // Connect from another node if specified
    if (args.connectFromNodeId) {
      const tree = useDialogueStore.getState().dialogueTrees[args.treeId as string];
      if (tree) {
        const fromNode = tree.nodes.find(n => n.id === args.connectFromNodeId);
        if (fromNode && 'next' in fromNode) {
          useDialogueStore.getState().updateNode(args.treeId as string, fromNode.id, { next: nodeId } as Record<string, unknown>);
        }
      }
    }
    return { success: true, result: { nodeId, message: `Added ${nodeType} node` } };
  },

  set_dialogue_choice: async (args, _ctx) => {
    const { useDialogueStore } = await import('@/stores/dialogueStore');
    const tree = useDialogueStore.getState().dialogueTrees[args.treeId as string];
    if (!tree) return { success: false, error: 'Tree not found' };
    const choiceNode = tree.nodes.find(n => n.id === args.nodeId);
    if (!choiceNode || choiceNode.type !== 'choice') return { success: false, error: 'Choice node not found' };
    const choiceId = `choice_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    const newChoices = [...choiceNode.choices, { id: choiceId, text: args.choiceText as string, nextNodeId: (args.nextNodeId as string) || null }];
    useDialogueStore.getState().updateNode(args.treeId as string, args.nodeId as string, { choices: newChoices } as Record<string, unknown>);
    return { success: true, result: { choiceId, message: 'Choice added' } };
  },

  remove_dialogue_tree: async (args, _ctx) => {
    const { useDialogueStore } = await import('@/stores/dialogueStore');
    useDialogueStore.getState().removeTree(args.treeId as string);
    return { success: true, result: { message: 'Dialogue tree removed' } };
  },

  get_dialogue_tree: async (args, _ctx) => {
    const { useDialogueStore } = await import('@/stores/dialogueStore');
    const tree = useDialogueStore.getState().dialogueTrees[args.treeId as string];
    if (!tree) return { success: false, error: 'Tree not found' };
    return { success: true, result: tree };
  },

  set_dialogue_node_voice: async (args, _ctx) => {
    const { useDialogueStore } = await import('@/stores/dialogueStore');
    useDialogueStore.getState().updateNode(
      args.treeId as string,
      args.nodeId as string,
      { voiceAsset: args.voiceAssetId } as Record<string, unknown>,
    );
    return { success: true, result: { message: 'Voice asset assigned' } };
  },

  export_dialogue_tree: async (args, _ctx) => {
    const { useDialogueStore } = await import('@/stores/dialogueStore');
    const json = useDialogueStore.getState().exportTree(args.treeId as string);
    if (!json) return { success: false, error: 'Tree not found' };
    return { success: true, result: { json } };
  },

  import_dialogue_tree: async (args, _ctx) => {
    const { useDialogueStore } = await import('@/stores/dialogueStore');
    const treeId = useDialogueStore.getState().importTree(args.jsonData as string);
    if (!treeId) return { success: false, error: 'Failed to import tree' };
    return { success: true, result: { treeId, message: 'Dialogue tree imported' } };
  },
};
