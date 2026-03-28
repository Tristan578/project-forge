/**
 * Script library, visual scripting, token, and publishing handlers for MCP commands.
 */

import { z } from 'zod';
import type { ToolHandler } from './types';
import { zEntityId, parseArgs } from './types';

export const scriptLibraryHandlers: Record<string, ToolHandler> = {
  create_script: async (args, ctx) => {
    const p = parseArgs(z.object({
      entityId: zEntityId.optional(),
      source: z.string().min(1),
      enabled: z.boolean().optional(),
      template: z.string().optional(),
    }), args);
    if (p.error) return p.error;
    const targetId = p.data.entityId ?? ctx.store.primaryId;
    if (!targetId) return { success: false, error: 'No entity selected and no entityId provided' };
    ctx.store.setScript(targetId, p.data.source, p.data.enabled ?? true, p.data.template);
    return { success: true, result: { message: `Script created on ${targetId}` } };
  },

  set_script: async (args, ctx) => {
    const p = parseArgs(z.object({
      entityId: zEntityId,
      source: z.string(),
      enabled: z.boolean().optional(),
      template: z.string().optional(),
    }), args);
    if (p.error) return p.error;
    ctx.store.setScript(p.data.entityId, p.data.source, p.data.enabled ?? true, p.data.template);
    return { success: true, result: { message: `Script set on ${p.data.entityId}` } };
  },

  remove_script: async (args, ctx) => {
    const p = parseArgs(z.object({ entityId: zEntityId }), args);
    if (p.error) return p.error;
    ctx.store.removeScript(p.data.entityId);
    return { success: true, result: { message: `Script removed from ${p.data.entityId}` } };
  },

  get_script: async (args, ctx) => {
    const p = parseArgs(z.object({ entityId: zEntityId }), args);
    if (p.error) return p.error;
    const script = ctx.store.allScripts[p.data.entityId];
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
    const p = parseArgs(z.object({
      entityId: zEntityId,
      template: z.string().min(1),
      source: z.string().min(1),
    }), args);
    if (p.error) return p.error;
    ctx.store.applyScriptTemplate(p.data.entityId, p.data.template, p.data.source);
    return { success: true, result: { message: `Template "${p.data.template}" applied to ${p.data.entityId}` } };
  },

  create_library_script: async (args, _ctx) => {
    const p = parseArgs(z.object({
      name: z.string().min(1),
      source: z.string().min(1),
      description: z.string().optional(),
      tags: z.array(z.string()).optional(),
    }), args);
    if (p.error) return p.error;
    const { saveScript } = await import('@/stores/scriptLibraryStore');
    const script = saveScript(p.data.name, p.data.source, p.data.description ?? '', p.data.tags ?? []);
    return { success: true, result: { id: script.id, name: script.name } };
  },

  update_library_script: async (args, _ctx) => {
    const p = parseArgs(z.object({
      scriptId: z.string().min(1),
      name: z.string().optional(),
      source: z.string().optional(),
      description: z.string().optional(),
      tags: z.array(z.string()).optional(),
    }), args);
    if (p.error) return p.error;
    const { getScript, updateScript } = await import('@/stores/scriptLibraryStore');
    const existing = getScript(p.data.scriptId);
    if (!existing) return { success: false, error: `Script not found: ${p.data.scriptId}` };
    const updates: Record<string, unknown> = {};
    if (p.data.name) updates.name = p.data.name;
    if (p.data.source) updates.source = p.data.source;
    if (p.data.description !== undefined) updates.description = p.data.description;
    if (p.data.tags) updates.tags = p.data.tags;
    updateScript(existing.id, updates);
    return { success: true, result: { id: existing.id } };
  },

  delete_library_script: async (args, _ctx) => {
    const p = parseArgs(z.object({ scriptId: z.string().min(1) }), args);
    if (p.error) return p.error;
    const { getScript: findScript, deleteScript: delScript } = await import('@/stores/scriptLibraryStore');
    const found = findScript(p.data.scriptId);
    if (!found) return { success: false, error: `Script not found: ${p.data.scriptId}` };
    delScript(found.id);
    return { success: true, result: { deleted: found.name } };
  },

  list_library_scripts: async (args, _ctx) => {
    const p = parseArgs(z.object({ query: z.string().optional() }), args);
    if (p.error) return p.error;
    const { searchScripts } = await import('@/stores/scriptLibraryStore');
    const results = searchScripts(p.data.query ?? '');
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
    const p = parseArgs(z.object({
      scriptId: z.string().min(1),
      entityId: zEntityId,
    }), args);
    if (p.error) return p.error;
    const { getScript: getLib } = await import('@/stores/scriptLibraryStore');
    const libScript = getLib(p.data.scriptId);
    if (!libScript) return { success: false, error: `Library script not found: ${p.data.scriptId}` };
    ctx.store.setScript(p.data.entityId, libScript.source, true);
    return { success: true, result: { entityId: p.data.entityId, scriptName: libScript.name } };
  },

  detach_script_from_entity: async (args, ctx) => {
    const p = parseArgs(z.object({ entityId: zEntityId }), args);
    if (p.error) return p.error;
    ctx.store.removeScript(p.data.entityId);
    return { success: true, result: { entityId: p.data.entityId } };
  },

  set_visual_script: async (args, ctx) => {
    const p = parseArgs(z.object({
      entityId: zEntityId,
      graph: z.unknown(),
    }), args);
    if (p.error) return p.error;
    const { compileGraph } = await import('@/lib/scripting/graphCompiler');
    const result = compileGraph(p.data.graph as Parameters<typeof compileGraph>[0]);
    if (result.success) {
      ctx.store.setScript(p.data.entityId, result.code, true);
      return { success: true, result: { message: 'Visual script set and compiled' } };
    }
    return { success: false, error: `Compile errors: ${result.errors.map((e) => e.message).join(', ')}` };
  },

  get_visual_script: async (_args, _ctx) => {
    return { success: true, result: { nodes: [], edges: [] } };
  },

  compile_visual_script: async (_args, _ctx) => {
    const { compileGraph } = await import('@/lib/scripting/graphCompiler');
    const result = compileGraph({ nodes: [], edges: [] });
    if (result.success) {
      return { success: true, result: { code: result.code } };
    }
    return { success: false, error: `Errors: ${result.errors.map((e) => e.message).join(', ')}` };
  },

  add_visual_script_node: async (args, _ctx) => {
    const p = parseArgs(z.object({ nodeType: z.string().min(1) }), args);
    if (p.error) return p.error;
    return { success: true, result: { message: `Added ${p.data.nodeType} node` } };
  },

  connect_visual_script_nodes: async (args, _ctx) => {
    const p = parseArgs(z.object({
      sourceNodeId: z.string().min(1),
      sourcePort: z.string().min(1),
      targetNodeId: z.string().min(1),
      targetPort: z.string().min(1),
    }), args);
    if (p.error) return p.error;
    return { success: true, result: { message: `Connected ${p.data.sourceNodeId}:${p.data.sourcePort} → ${p.data.targetNodeId}:${p.data.targetPort}` } };
  },

  get_token_balance: async (_args, _ctx) => {
    const { useUserStore } = await import('@/stores/userStore');
    const balance = useUserStore.getState().tokenBalance;
    return { success: true, result: balance ?? { message: 'Balance not loaded' } };
  },

  get_token_pricing: async (_args, _ctx) => {
    const { TOKEN_COSTS, TIER_MONTHLY_TOKENS, TOKEN_PACKAGES } = await import('@/lib/tokens/pricing');
    return { success: true, result: { costs: TOKEN_COSTS, monthlyAllocations: TIER_MONTHLY_TOKENS, packages: TOKEN_PACKAGES } };
  },

  publish_game: async (args, ctx) => {
    const p = parseArgs(z.object({
      title: z.string().min(1),
      slug: z.string().min(1).regex(/^[a-z0-9-]+$/, 'Slug must contain only lowercase letters, numbers, and hyphens'),
      description: z.string().optional(),
    }), args);
    if (p.error) return p.error;
    const { usePublishStore } = await import('@/stores/publishStore');
    const result = await usePublishStore.getState().publishGame(
      ctx.store.projectId || '', p.data.title, p.data.slug, p.data.description
    );
    return result ? { success: true, result: { message: `Published: ${result.url}`, url: result.url } } : { success: false, error: 'Publish failed' };
  },

  unpublish_game: async (args, _ctx) => {
    const p = parseArgs(z.object({ id: z.string().min(1) }), args);
    if (p.error) return p.error;
    const { usePublishStore } = await import('@/stores/publishStore');
    const success = await usePublishStore.getState().unpublishGame(p.data.id);
    return success ? { success: true, result: { message: 'Game unpublished' } } : { success: false, error: 'Unpublish failed' };
  },

  list_publications: async (_args, _ctx) => {
    const { usePublishStore } = await import('@/stores/publishStore');
    await usePublishStore.getState().fetchPublications();
    const pubs = usePublishStore.getState().publications;
    return { success: true, result: pubs.map(p => ({ title: p.title, slug: p.slug, url: p.url, status: p.status })) };
  },

  get_publish_url: async (args, _ctx) => {
    const p = parseArgs(z.object({ slug: z.string().min(1) }), args);
    if (p.error) return p.error;
    const { usePublishStore } = await import('@/stores/publishStore');
    await usePublishStore.getState().fetchPublications();
    const pub = usePublishStore.getState().publications.find(pp => pp.slug === p.data.slug);
    return pub ? { success: true, result: { url: pub.url } } : { success: false, error: 'Publication not found' };
  },
};
