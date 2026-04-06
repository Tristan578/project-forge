/**
 * Prompt enrichment utility for AI asset generation.
 *
 * Queries the editor store for game context (project type, scene name, entity names,
 * game components, art style) and wraps user prompts with appropriate metadata
 * before sending to any provider.
 */

import type { EditorState } from '@/stores/editorStore';
import { loadLockedStyle, generateStylePromptModifier } from '@/lib/ai/artStyleEngine';

export type GenerationCategory =
  | 'model'
  | 'texture'
  | 'sfx'
  | 'voice'
  | 'music'
  | 'skybox'
  | 'sprite'
  | 'sprite_sheet'
  | 'tileset';

interface EnrichmentContext {
  projectType: '2d' | '3d';
  sceneName: string;
  entityNames: string[];
  entityCount: number;
  gameComponentTypes: string[];
  /** e.g. "platformer", "RPG", "horror" — inferred from scene content */
  inferredGenre: string | null;
}

/** Extract enrichment context from the editor store state. */
export function getEnrichmentContext(store: EditorState): EnrichmentContext {
  const sceneGraph = store.sceneGraph;
  const nodes = Object.values(sceneGraph.nodes);
  const entityNames = nodes.map((n) => n.name).filter((n) => n !== 'Camera');

  // Collect unique game component types across all entities
  const allComponents = store.allGameComponents ?? {};
  const componentTypes = new Set<string>();
  for (const comps of Object.values(allComponents)) {
    for (const c of comps) {
      componentTypes.add(c.type);
    }
  }

  const genre = inferGenre(entityNames, Array.from(componentTypes));

  return {
    projectType: store.projectType,
    sceneName: store.sceneName,
    entityNames,
    entityCount: nodes.length,
    gameComponentTypes: Array.from(componentTypes),
    inferredGenre: genre,
  };
}

/** Infer a likely game genre from entity names and game components. */
function inferGenre(entityNames: string[], componentTypes: string[]): string | null {
  const names = entityNames.map((n) => n.toLowerCase()).join(' ');
  const comps = componentTypes.map((c) => c.toLowerCase()).join(' ');
  const all = `${names} ${comps}`;

  if (/platform|jump|sidescroll/.test(all)) return 'platformer';
  if (/rpg|inventory|quest|npc|dialogue/.test(all)) return 'RPG';
  if (/horror|zombie|dark|creepy|ghost/.test(all)) return 'horror';
  if (/puzzle|match|logic|switch/.test(all)) return 'puzzle';
  if (/shooter|bullet|weapon|gun|ammo/.test(all)) return 'shooter';
  if (/racing|car|track|speed|lap/.test(all)) return 'racing';
  if (/space|asteroid|ship|planet/.test(all)) return 'space';
  if (/fantasy|dragon|magic|wizard|sword/.test(all)) return 'fantasy';
  if (/runner|endless|obstacle|dodge/.test(all)) return 'endless runner';
  if (/explore|open.?world|wander/.test(all)) return 'exploration';
  return null;
}

/** Build a context prefix string for the given generation type. */
function buildPrefix(ctx: EnrichmentContext, category: GenerationCategory): string {
  const parts: string[] = [];

  // Project type context
  if (ctx.projectType === '2d') {
    parts.push('2D game asset');
  } else {
    parts.push('3D game asset');
  }

  // Genre context
  if (ctx.inferredGenre) {
    parts.push(`${ctx.inferredGenre} game`);
  }

  // Category-specific hints
  switch (category) {
    case 'model':
      parts.push('optimized for real-time WebGPU rendering');
      parts.push('game-ready 3D model');
      break;
    case 'texture':
      parts.push('PBR material texture');
      parts.push('seamless and tileable');
      break;
    case 'sfx':
      parts.push('game sound effect');
      break;
    case 'music':
      parts.push('game soundtrack');
      parts.push('loopable');
      break;
    case 'skybox':
      // Skybox already enriched server-side with "Equirectangular panorama skybox:"
      break;
    case 'sprite':
      parts.push('game sprite');
      parts.push('transparent background');
      break;
    case 'sprite_sheet':
      parts.push('sprite sheet animation frames');
      break;
    case 'tileset':
      parts.push('tileset for tile-based game');
      parts.push('consistent style across tiles');
      break;
    case 'voice':
      // Voice doesn't use a prompt — uses text + voiceStyle
      break;
  }

  return parts.join(', ');
}

/**
 * Enrich a user prompt with game context.
 * Returns the enriched prompt string.
 */
export function enrichPrompt(
  userPrompt: string,
  category: GenerationCategory,
  store: EditorState
): string {
  const ctx = getEnrichmentContext(store);
  const prefix = buildPrefix(ctx, category);

  // Don't enrich if no meaningful context or for voice (uses text, not prompt)
  if (!prefix || category === 'voice') {
    return userPrompt;
  }

  // Skybox already has server-side enrichment, just add game context
  if (category === 'skybox') {
    const gameParts: string[] = [];
    if (ctx.inferredGenre) gameParts.push(`${ctx.inferredGenre} game`);
    if (ctx.sceneName && ctx.sceneName !== 'Untitled') gameParts.push(`scene: ${ctx.sceneName}`);
    if (gameParts.length === 0) return userPrompt;
    return `${userPrompt}, ${gameParts.join(', ')}`;
  }

  // Scene name context (if meaningful)
  const sceneHint = ctx.sceneName && ctx.sceneName !== 'Untitled'
    ? `, for scene "${ctx.sceneName}"`
    : '';

  // Append locked art style modifier when a style is locked.
  // localStorage-backed data can be stale or malformed, so ignore invalid locks
  // rather than breaking prompt enrichment.
  let styleSuffix = '';
  try {
    const lockedStyle = loadLockedStyle();
    if (lockedStyle) {
      styleSuffix = `. ${generateStylePromptModifier(lockedStyle.style)}`;
    }
  } catch {
    // Invalid/corrupt localStorage data — skip style modifier
  }

  return `${prefix}${sceneHint}: ${userPrompt}${styleSuffix}`;
}

/**
 * Enrich voice generation parameters with character context.
 * Returns enriched voiceStyle based on dialogue character data.
 */
export function enrichVoiceStyle(
  speaker: string | undefined,
  baseStyle: string
): string {
  if (!speaker) return baseStyle;

  // Map common character archetypes to voice styles
  const name = speaker.toLowerCase();
  if (/villain|evil|dark|antagonist/.test(name)) return 'sinister';
  if (/hero|brave|warrior|knight/.test(name)) return 'excited';
  if (/elder|wise|sage|mentor/.test(name)) return 'calm';
  if (/child|kid|young/.test(name)) return 'friendly';
  if (/robot|ai|machine|android/.test(name)) return 'neutral';

  return baseStyle;
}

/**
 * Get SFX category context from an entity name.
 * Helps the provider generate more appropriate sounds.
 */
export function enrichSfxPrompt(
  userPrompt: string,
  entityName: string | undefined,
  store: EditorState
): string {
  const ctx = getEnrichmentContext(store);
  const parts: string[] = ['game sound effect'];

  if (ctx.inferredGenre) parts.push(`${ctx.inferredGenre} game`);

  // Try to infer sound category from entity name
  if (entityName) {
    const name = entityName.toLowerCase();
    if (/button|click|ui|menu/.test(name)) parts.push('UI sound');
    else if (/explo|boom|blast|impact/.test(name)) parts.push('impact/explosion');
    else if (/foot|step|walk|run/.test(name)) parts.push('footstep');
    else if (/ambient|wind|rain|nature|water/.test(name)) parts.push('ambient');
    else if (/sword|attack|hit|punch|slash/.test(name)) parts.push('combat');
    else if (/door|open|close|creak/.test(name)) parts.push('interaction');
    else if (/coin|collect|pickup|power/.test(name)) parts.push('collectible/pickup');
  }

  return `${parts.join(', ')}: ${userPrompt}`;
}

/**
 * Enrich music prompt with scene and genre context.
 */
export function enrichMusicPrompt(
  userPrompt: string,
  store: EditorState
): string {
  const ctx = getEnrichmentContext(store);
  const parts: string[] = ['game soundtrack', 'loopable'];

  if (ctx.inferredGenre) parts.push(`${ctx.inferredGenre} game`);
  if (ctx.sceneName && ctx.sceneName !== 'Untitled') {
    parts.push(`for scene "${ctx.sceneName}"`);
  }

  return `${parts.join(', ')}: ${userPrompt}`;
}
