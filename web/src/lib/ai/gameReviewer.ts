/**
 * AI Game Reviewer — analyzes game content and generates a professional review
 * with scores, pros/cons, and improvement suggestions.
 */

import type { EditorState } from '@/stores/editorStore';

// ---- Types ----

export interface ReviewScores {
  funFactor: number;
  polish: number;
  difficulty: number;
  originality: number;
  accessibility: number;
  replayability: number;
}

export interface GameReview {
  title: string;
  summary: string;
  scores: ReviewScores;
  pros: string[];
  cons: string[];
  suggestions: string[];
  overallRating: number;
  reviewText: string;
}

export interface ReviewContext {
  gameTitle: string;
  genre: string;
  mechanics: string[];
  entityCount: number;
  sceneCount: number;
  hasAudio: boolean;
  hasParticles: boolean;
  hasPhysics: boolean;
  scriptCount: number;
  hasDialogue: boolean;
  hasUI: boolean;
  hasAnimations: boolean;
  hasSkybox: boolean;
  hasPostProcessing: boolean;
  projectType: '2d' | '3d';
  entityTypes: string[];
  lightCount: number;
}

// ---- Rating Descriptors ----

export function getRatingDescriptor(rating: number): string {
  if (rating >= 9) return 'Outstanding';
  if (rating >= 7) return 'Impressive';
  if (rating >= 4) return 'Good Start';
  return 'Needs Work';
}

// ---- Score Clamping ----

export function clampScore(value: number): number {
  if (typeof value !== 'number' || isNaN(value)) return 5;
  return Math.max(1, Math.min(10, Math.round(value)));
}

function clampScores(scores: Partial<ReviewScores>): ReviewScores {
  return {
    funFactor: clampScore(scores.funFactor ?? 5),
    polish: clampScore(scores.polish ?? 5),
    difficulty: clampScore(scores.difficulty ?? 5),
    originality: clampScore(scores.originality ?? 5),
    accessibility: clampScore(scores.accessibility ?? 5),
    replayability: clampScore(scores.replayability ?? 5),
  };
}

// ---- Context Builder ----

export function buildReviewContext(getState: () => EditorState): ReviewContext {
  const state = getState();
  const nodes = Object.values(state.sceneGraph.nodes);
  const entityCount = nodes.length;

  // Detect entity types and features from scene graph components
  const entityTypes: string[] = [];
  let lightCount = 0;
  let hasPhysics = false;
  let hasParticles = false;
  let hasAudio = false;
  let hasAnimations = false;

  for (const node of nodes) {
    const comps = node.components;
    if (comps.includes('PointLight') || comps.includes('DirectionalLight') || comps.includes('SpotLight')) {
      lightCount++;
    }
    if (comps.includes('Mesh3d') && !entityTypes.includes('mesh')) entityTypes.push('mesh');
    if (comps.includes('PointLight') && !entityTypes.includes('point_light')) entityTypes.push('point_light');
    if (comps.includes('DirectionalLight') && !entityTypes.includes('directional_light')) entityTypes.push('directional_light');
    if (comps.includes('SpotLight') && !entityTypes.includes('spot_light')) entityTypes.push('spot_light');
    if (comps.includes('TerrainEnabled') && !entityTypes.includes('terrain')) entityTypes.push('terrain');

    // Detect features from component tags
    if (comps.includes('PhysicsEnabled') || comps.includes('RigidBody')) hasPhysics = true;
    if (comps.includes('ParticleEnabled') || comps.includes('ParticleEffect')) hasParticles = true;
    if (comps.includes('AudioEnabled') || comps.includes('AudioSource')) hasAudio = true;
    if (comps.includes('AnimationPlayer') || comps.includes('AnimationClip')) hasAnimations = true;
  }

  // Also check store-level flags for primary entity
  if (state.physicsEnabled) hasPhysics = true;
  if (state.particleEnabled) hasParticles = true;
  if (state.primaryAudio) hasAudio = true;
  if (state.primaryAnimation?.availableClips?.length) hasAnimations = true;

  // Check scripts
  const scriptCount = state.allScripts
    ? Object.values(state.allScripts).filter((s) => s.enabled).length
    : 0;

  // Detect mechanics from game components
  const mechanics: string[] = [];
  if (state.allGameComponents) {
    for (const comps of Object.values(state.allGameComponents)) {
      for (const comp of comps) {
        if (!mechanics.includes(comp.type)) {
          mechanics.push(comp.type);
        }
      }
    }
  }

  // Scene count
  const sceneCount = state.scenes ? state.scenes.length : 1;

  // Post-processing
  const pp = state.postProcessing;
  const hasPostProcessing = pp
    ? Boolean(pp.bloom?.enabled || pp.chromaticAberration?.enabled)
    : false;

  // Environment
  const hasSkybox = Boolean(state.environment?.skyboxPreset);

  // Dialogue
  let hasDialogue = false;
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { useDialogueStore } = require('@/stores/dialogueStore');
    const dialogueState = useDialogueStore.getState();
    hasDialogue = Object.keys(dialogueState.dialogueTrees).length > 0;
  } catch {
    // dialogueStore not available
  }

  // UI
  let hasUI = false;
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { useUIBuilderStore } = require('@/stores/uiBuilderStore');
    const uiState = useUIBuilderStore.getState();
    hasUI = (uiState.screens?.length ?? 0) > 0;
  } catch {
    // uiBuilderStore not available
  }

  // Project type
  const projectType = (state as unknown as { projectType?: '2d' | '3d' }).projectType ?? '3d';

  // Genre inference from mechanics
  let genre = 'general';
  if (mechanics.includes('characterController') && mechanics.includes('health')) {
    genre = 'action';
  } else if (mechanics.includes('characterController')) {
    genre = 'platformer';
  } else if (mechanics.includes('winCondition') && mechanics.includes('collectible')) {
    genre = 'puzzle';
  } else if (hasDialogue) {
    genre = 'adventure';
  }

  return {
    gameTitle: state.sceneName ?? 'Untitled',
    genre,
    mechanics,
    entityCount,
    sceneCount,
    hasAudio,
    hasParticles,
    hasPhysics,
    scriptCount,
    hasDialogue,
    hasUI,
    hasAnimations,
    hasSkybox,
    hasPostProcessing,
    projectType,
    entityTypes,
    lightCount,
  };
}

// ---- System Prompt ----

export const REVIEWER_SYSTEM_PROMPT = `You are an experienced indie game journalist reviewing a game built in SpawnForge, a browser-based game engine. You write professional, constructive reviews that help developers improve their games.

Your review should be honest but encouraging. Focus on what works well and provide specific, actionable suggestions for improvement. Consider the game from a player's perspective.

Respond ONLY with a valid JSON object (no markdown, no code fences) matching this exact structure:
{
  "title": "A catchy review headline",
  "summary": "2-3 sentence overview of the game",
  "scores": {
    "funFactor": <1-10>,
    "polish": <1-10>,
    "difficulty": <1-10>,
    "originality": <1-10>,
    "accessibility": <1-10>,
    "replayability": <1-10>
  },
  "pros": ["strength 1", "strength 2", "strength 3"],
  "cons": ["weakness 1", "weakness 2"],
  "suggestions": ["specific improvement 1", "specific improvement 2", "specific improvement 3"],
  "overallRating": <1-10>,
  "reviewText": "A 2-3 paragraph professional review"
}

Score guidelines:
- funFactor: How enjoyable is the gameplay loop?
- polish: Visual quality, effects, audio, attention to detail
- difficulty: How well-balanced is the challenge? (5 = well-balanced, 1 = too easy, 10 = too hard)
- originality: How creative is the concept and execution?
- accessibility: How easy is it for new players to pick up?
- replayability: How much reason is there to play again?

Be specific about what you observe in the game data. Reference actual entities, mechanics, and features.`;

// ---- Response Parser ----

export function parseReviewResponse(raw: string): GameReview {
  // Try to extract JSON from the response
  let jsonStr = raw.trim();

  // Strip markdown code fences if present
  const fenceMatch = jsonStr.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fenceMatch) {
    jsonStr = fenceMatch[1].trim();
  }

  try {
    const parsed = JSON.parse(jsonStr) as Partial<GameReview>;
    return {
      title: typeof parsed.title === 'string' ? parsed.title : 'Game Review',
      summary: typeof parsed.summary === 'string' ? parsed.summary : 'No summary available.',
      scores: clampScores(parsed.scores ?? {}),
      pros: Array.isArray(parsed.pros) ? parsed.pros.filter((p): p is string => typeof p === 'string').slice(0, 10) : [],
      cons: Array.isArray(parsed.cons) ? parsed.cons.filter((c): c is string => typeof c === 'string').slice(0, 10) : [],
      suggestions: Array.isArray(parsed.suggestions) ? parsed.suggestions.filter((s): s is string => typeof s === 'string').slice(0, 10) : [],
      overallRating: clampScore(parsed.overallRating ?? 5),
      reviewText: typeof parsed.reviewText === 'string' ? parsed.reviewText : 'Review text unavailable.',
    };
  } catch {
    // Malformed response — return defaults
    return {
      title: 'Game Review',
      summary: 'The AI was unable to generate a complete review. Please try again.',
      scores: clampScores({}),
      pros: [],
      cons: [],
      suggestions: ['Try running the review again for better results.'],
      overallRating: 5,
      reviewText: raw || 'No review text was generated.',
    };
  }
}

// ---- Review Generator ----

function buildReviewPrompt(context: ReviewContext): string {
  const lines: string[] = [];
  lines.push(`Game Title: "${context.gameTitle}"`);
  lines.push(`Project Type: ${context.projectType.toUpperCase()}`);
  lines.push(`Detected Genre: ${context.genre}`);
  lines.push(`Entity Count: ${context.entityCount}`);
  lines.push(`Scene Count: ${context.sceneCount}`);
  lines.push(`Light Count: ${context.lightCount}`);
  lines.push(`Script Count: ${context.scriptCount}`);

  if (context.entityTypes.length > 0) {
    lines.push(`Entity Types: ${context.entityTypes.join(', ')}`);
  }

  if (context.mechanics.length > 0) {
    lines.push(`Game Mechanics: ${context.mechanics.join(', ')}`);
  }

  const features: string[] = [];
  if (context.hasPhysics) features.push('physics simulation');
  if (context.hasAudio) features.push('audio/sound effects');
  if (context.hasParticles) features.push('particle effects');
  if (context.hasAnimations) features.push('animations');
  if (context.hasDialogue) features.push('dialogue system');
  if (context.hasUI) features.push('custom UI screens');
  if (context.hasSkybox) features.push('skybox/environment');
  if (context.hasPostProcessing) features.push('post-processing effects');

  if (features.length > 0) {
    lines.push(`Active Features: ${features.join(', ')}`);
  } else {
    lines.push('Active Features: none detected');
  }

  return lines.join('\n');
}

export async function generateReview(context: ReviewContext): Promise<GameReview> {
  const prompt = buildReviewPrompt(context);

  const response = await fetch('/api/chat', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      messages: [{ role: 'user', content: `Please review this game based on the following data:\n\n${prompt}` }],
      model: 'claude-haiku-4-5-20251001',
      sceneContext: '',
      thinking: false,
      systemOverride: REVIEWER_SYSTEM_PROMPT,
    }),
  });

  if (!response.ok) {
    const err = await response.json().catch(() => ({ error: response.statusText }));
    throw new Error((err as { error?: string }).error || `Review request failed: ${response.status}`);
  }

  // Read the streaming response and collect all text
  const reader = response.body?.getReader();
  if (!reader) throw new Error('No response body');

  const decoder = new TextDecoder();
  let buffer = '';
  let fullText = '';

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split('\n');
    buffer = lines.pop() || '';

    for (const line of lines) {
      if (!line.startsWith('data: ')) continue;
      const data = line.slice(6);
      if (data === '[DONE]') continue;

      try {
        const event = JSON.parse(data) as { type: string; text?: string };
        if (event.type === 'text_delta' && event.text) {
          fullText += event.text;
        }
      } catch {
        // skip malformed events
      }
    }
  }

  return parseReviewResponse(fullText);
}
