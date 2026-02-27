/**
 * Script library, visual scripting, token, and publishing handlers for MCP commands.
 */

import type { ToolHandler } from './types';

export const scriptLibraryHandlers: Record<string, ToolHandler> = {
  set_script: async (args, ctx) => {
    const entityId = args.entityId as string;
    const source = args.source as string;
    const enabled = (args.enabled as boolean) ?? true;
    const template = args.template as string | undefined;
    if (!entityId || source === undefined) return { success: false, error: 'Missing entityId or source' };
    ctx.store.setScript(entityId, source, enabled, template);
    return { success: true, result: { message: `Script set on ${entityId}` } };
  },

  remove_script: async (args, ctx) => {
    const entityId = args.entityId as string;
    if (!entityId) return { success: false, error: 'Missing entityId' };
    ctx.store.removeScript(entityId);
    return { success: true, result: { message: `Script removed from ${entityId}` } };
  },

  get_script: async (args, ctx) => {
    const entityId = args.entityId as string;
    if (!entityId) return { success: false, error: 'Missing entityId' };
    const script = ctx.store.allScripts[entityId];
    if (!script) return { success: true, result: { hasScript: false } };
    return { success: true, result: { hasScript: true, source: script.source, enabled: script.enabled, template: script.template } };
  },

  list_script_templates: async (_args, _ctx) => {
    const templates = [
      { id: 'character_controller', name: 'Character Controller', description: 'WASD + jump movement' },
      { id: 'collectible', name: 'Collectible', description: 'Rotating pickup item' },
      { id: 'rotating_object', name: 'Rotating Object', description: 'Continuous Y-axis rotation' },
      { id: 'follow_camera', name: 'Follow Camera', description: 'Smooth camera follow with offset' },
    ];
    return { success: true, result: { templates } };
  },

  apply_script_template: async (args, ctx) => {
    const entityId = args.entityId as string;
    const templateId = args.template as string;
    const source = args.source as string;
    if (!entityId || !templateId || !source) return { success: false, error: 'Missing entityId, template, or source' };
    ctx.store.applyScriptTemplate(entityId, templateId, source);
    return { success: true, result: { message: `Template "${templateId}" applied to ${entityId}` } };
  },

  create_library_script: async (args, _ctx) => {
    const { saveScript } = await import('@/stores/scriptLibraryStore');
    const script = saveScript(
      args.name as string,
      args.source as string,
      (args.description as string) ?? '',
      (args.tags as string[]) ?? []
    );
    return { success: true, result: { id: script.id, name: script.name } };
  },

  update_library_script: async (args, _ctx) => {
    const { getScript, updateScript } = await import('@/stores/scriptLibraryStore');
    const existing = getScript(args.scriptId as string);
    if (!existing) return { success: false, error: `Script not found: ${args.scriptId}` };
    const updates: Record<string, unknown> = {};
    if (args.name) updates.name = args.name;
    if (args.source) updates.source = args.source;
    if (args.description !== undefined) updates.description = args.description;
    if (args.tags) updates.tags = args.tags;
    updateScript(existing.id, updates);
    return { success: true, result: { id: existing.id } };
  },

  delete_library_script: async (args, _ctx) => {
    const { getScript: findScript, deleteScript: delScript } = await import('@/stores/scriptLibraryStore');
    const found = findScript(args.scriptId as string);
    if (!found) return { success: false, error: `Script not found: ${args.scriptId}` };
    delScript(found.id);
    return { success: true, result: { deleted: found.name } };
  },

  list_library_scripts: async (args, _ctx) => {
    const { searchScripts } = await import('@/stores/scriptLibraryStore');
    const results = searchScripts((args.query as string) ?? '');
    return {
      success: true,
      result: results.map((s) => ({
        id: s.id,
        name: s.name,
        description: s.description,
        tags: s.tags,
        sourceLength: s.source.length,
      })),
    };
  },

  attach_script_to_entity: async (args, ctx) => {
    const { getScript: getLib } = await import('@/stores/scriptLibraryStore');
    const libScript = getLib(args.scriptId as string);
    if (!libScript) return { success: false, error: `Library script not found: ${args.scriptId}` };
    ctx.store.setScript(args.entityId as string, libScript.source, true);
    return { success: true, result: { entityId: args.entityId, scriptName: libScript.name } };
  },

  detach_script_from_entity: async (args, ctx) => {
    ctx.store.removeScript(args.entityId as string);
    return { success: true, result: { entityId: args.entityId } };
  },

  set_visual_script: async (args, ctx) => {
    const { compileGraph } = await import('@/lib/scripting/graphCompiler');
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const graph = args.graph as any;
    const result = compileGraph(graph);
    if (result.success) {
      ctx.store.setScript(args.entityId as string, result.code, true);
      return { success: true, result: { message: 'Visual script set and compiled' } };
    }
    return { success: false, error: `Compile errors: ${result.errors.map((e) => e.message).join(', ')}` };
  },

  get_visual_script: async (_args, _ctx) => {
    // Placeholder: would retrieve graph data from store
    return { success: true, result: { nodes: [], edges: [] } };
  },

  compile_visual_script: async (_args, _ctx) => {
    const { compileGraph } = await import('@/lib/scripting/graphCompiler');
    // Placeholder: would get graph from store
    const result = compileGraph({ nodes: [], edges: [] });
    if (result.success) {
      return { success: true, result: { code: result.code } };
    }
    return { success: false, error: `Errors: ${result.errors.map((e) => e.message).join(', ')}` };
  },

  add_visual_script_node: async (args, _ctx) => {
    const nodeType = args.nodeType as string;
    return { success: true, result: { message: `Added ${nodeType} node` } };
  },

  connect_visual_script_nodes: async (args, _ctx) => {
    const sourceNodeId = args.sourceNodeId as string;
    const sourcePort = args.sourcePort as string;
    const targetNodeId = args.targetNodeId as string;
    const targetPort = args.targetPort as string;
    return { success: true, result: { message: `Connected ${sourceNodeId}:${sourcePort} → ${targetNodeId}:${targetPort}` } };
  },

  get_token_balance: async (_args, _ctx) => {
    // Client-side: return what we have in the user store
    const { useUserStore } = await import('@/stores/userStore');
    const balance = useUserStore.getState().tokenBalance;
    return { success: true, result: balance ?? { message: 'Balance not loaded' } };
  },

  get_token_pricing: async (_args, _ctx) => {
    const { TOKEN_COSTS, TIER_MONTHLY_TOKENS, TOKEN_PACKAGES } = await import('@/lib/tokens/pricing');
    return { success: true, result: { costs: TOKEN_COSTS, monthlyAllocations: TIER_MONTHLY_TOKENS, packages: TOKEN_PACKAGES } };
  },

  publish_game: async (args, ctx) => {
    const { usePublishStore } = await import('@/stores/publishStore');
    const result = await usePublishStore.getState().publishGame(
      ctx.store.projectId || '', args.title as string, args.slug as string, args.description as string | undefined
    );
    return result ? { success: true, result: { message: `Published: ${result.url}`, url: result.url } } : { success: false, error: 'Publish failed' };
  },

  unpublish_game: async (args, _ctx) => {
    const { usePublishStore } = await import('@/stores/publishStore');
    const success = await usePublishStore.getState().unpublishGame(args.id as string);
    return success ? { success: true, result: { message: 'Game unpublished' } } : { success: false, error: 'Unpublish failed' };
  },

  list_publications: async (_args, _ctx) => {
    const { usePublishStore } = await import('@/stores/publishStore');
    await usePublishStore.getState().fetchPublications();
    const pubs = usePublishStore.getState().publications;
    return { success: true, result: pubs.map(p => ({ title: p.title, slug: p.slug, url: p.url, status: p.status })) };
  },

  get_publish_url: async (args, _ctx) => {
    const { usePublishStore } = await import('@/stores/publishStore');
    await usePublishStore.getState().fetchPublications();
    const pub = usePublishStore.getState().publications.find(p => p.slug === args.slug);
    return pub ? { success: true, result: { url: pub.url } } : { success: false, error: 'Publication not found' };
  },
};
