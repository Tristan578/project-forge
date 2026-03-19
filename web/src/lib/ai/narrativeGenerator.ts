/**
 * Narrative Arc Generator — converts a story premise into a full branching
 * narrative structure with acts, scenes, characters, dialogue, choices and
 * multiple endings. The output can be exported to the existing DialogueTree
 * system for in-game playback.
 */

import type {
  DialogueTree,
  DialogueNode,
  DialogueChoice,
} from '@/stores/dialogueStore';

// ============================================================================
// Types
// ============================================================================

export interface NarrativeArc {
  title: string;
  genre: string;
  themes: string[];
  acts: Act[];
  characters: Character[];
  endings: Ending[];
}

export interface Act {
  number: number;
  name: string;
  scenes: NarrativeScene[];
  turningPoint: string;
}

export interface NarrativeScene {
  id: string;
  name: string;
  description: string;
  dialogue: DialogueLine[];
  choices?: Choice[];
  nextSceneId?: string;
}

export interface DialogueLine {
  speaker: string;
  text: string;
  emotion?: string;
}

export interface Choice {
  text: string;
  consequence: string;
  nextSceneId: string;
  affectsEnding?: string;
}

export interface Character {
  name: string;
  role: 'protagonist' | 'antagonist' | 'ally' | 'neutral';
  description: string;
  motivation: string;
}

export interface Ending {
  id: string;
  name: string;
  type: 'good' | 'neutral' | 'bad' | 'secret';
  description: string;
  conditions: string[];
}

// ============================================================================
// Narrative Presets
// ============================================================================

export interface NarrativePreset {
  id: string;
  name: string;
  description: string;
  actStructure: { name: string; purpose: string }[];
  suggestedCharacterRoles: Character['role'][];
  endingTypes: Ending['type'][];
}

export const NARRATIVE_PRESETS: Record<string, NarrativePreset> = {
  hero_journey: {
    id: 'hero_journey',
    name: "Hero's Journey",
    description:
      'Classic 3-act structure: call to adventure, trials and growth, triumphant return.',
    actStructure: [
      { name: 'The Call', purpose: 'Ordinary world disrupted, hero called to adventure' },
      { name: 'The Trials', purpose: 'Tests, allies, enemies, approaching the innermost cave' },
      { name: 'The Return', purpose: 'Climax, transformation, return with the elixir' },
    ],
    suggestedCharacterRoles: ['protagonist', 'antagonist', 'ally'],
    endingTypes: ['good', 'neutral', 'bad'],
  },
  mystery: {
    id: 'mystery',
    name: 'Mystery',
    description:
      'Discovery, investigation, red herrings, and a dramatic reveal.',
    actStructure: [
      { name: 'Discovery', purpose: 'Crime or mystery discovered, initial clues' },
      { name: 'Investigation', purpose: 'Gathering evidence, interviews, red herrings' },
      { name: 'Revelation', purpose: 'Truth uncovered, confrontation, resolution' },
    ],
    suggestedCharacterRoles: ['protagonist', 'neutral', 'antagonist'],
    endingTypes: ['good', 'bad', 'secret'],
  },
  romance: {
    id: 'romance',
    name: 'Romance',
    description:
      'Two characters meet, face conflict, separate, and potentially reunite.',
    actStructure: [
      { name: 'The Meeting', purpose: 'Characters meet, initial attraction or friction' },
      { name: 'The Conflict', purpose: 'Obstacles, misunderstandings, growing apart' },
      { name: 'The Resolution', purpose: 'Grand gesture, reconciliation or parting' },
    ],
    suggestedCharacterRoles: ['protagonist', 'ally', 'neutral'],
    endingTypes: ['good', 'neutral', 'bad'],
  },
  survival: {
    id: 'survival',
    name: 'Survival',
    description:
      'Calm before the storm, disaster strikes, desperate struggle, escape or death.',
    actStructure: [
      { name: 'The Calm', purpose: 'Establish normalcy, introduce stakes' },
      { name: 'The Disaster', purpose: 'Catastrophe strikes, resources dwindle' },
      { name: 'The Reckoning', purpose: 'Final push for survival, ultimate test' },
    ],
    suggestedCharacterRoles: ['protagonist', 'ally', 'antagonist'],
    endingTypes: ['good', 'bad', 'secret'],
  },
};

// ============================================================================
// AI Generation (prompt-based)
// ============================================================================

export interface NarrativeGenerationOptions {
  preset?: string;
  actCount?: number;
}

/**
 * Build the system prompt for narrative generation.
 * Exported for testing.
 */
export function buildNarrativePrompt(
  premise: string,
  options?: NarrativeGenerationOptions,
): string {
  const preset = options?.preset ? NARRATIVE_PRESETS[options.preset] : undefined;
  const actCount = options?.actCount ?? preset?.actStructure.length ?? 3;

  let systemPrompt =
    'You are a narrative designer for a video game. Generate a branching narrative arc as valid JSON.\n\n';
  systemPrompt += `Story premise: "${premise}"\n`;
  systemPrompt += `Number of acts: ${actCount}\n`;

  if (preset) {
    systemPrompt += `\nNarrative structure: ${preset.name}\n`;
    systemPrompt += `Description: ${preset.description}\n`;
    systemPrompt += 'Act structure:\n';
    for (const act of preset.actStructure) {
      systemPrompt += `  - ${act.name}: ${act.purpose}\n`;
    }
  }

  systemPrompt += `
Return a JSON object matching this schema exactly:
{
  "title": "string",
  "genre": "string",
  "themes": ["string"],
  "acts": [
    {
      "number": 1,
      "name": "string",
      "scenes": [
        {
          "id": "scene_1_1",
          "name": "string",
          "description": "string",
          "dialogue": [
            { "speaker": "string", "text": "string", "emotion": "string (optional)" }
          ],
          "choices": [
            {
              "text": "string",
              "consequence": "string",
              "nextSceneId": "scene_id",
              "affectsEnding": "ending_id (optional)"
            }
          ],
          "nextSceneId": "scene_id (for linear scenes without choices)"
        }
      ],
      "turningPoint": "string"
    }
  ],
  "characters": [
    {
      "name": "string",
      "role": "protagonist|antagonist|ally|neutral",
      "description": "string",
      "motivation": "string"
    }
  ],
  "endings": [
    {
      "id": "ending_good",
      "name": "string",
      "type": "good|neutral|bad|secret",
      "description": "string",
      "conditions": ["string describing how to reach this ending"]
    }
  ]
}

Rules:
- Each act must have at least 2 scenes
- At least one scene per act must have choices for branching
- Scene IDs must be unique (format: scene_ACT_SCENE, e.g. scene_1_1)
- Choices must reference valid scene IDs as nextSceneId
- Scenes without choices must have nextSceneId pointing to the next scene
- Terminal scenes (leading to an ending) should have nextSceneId set to null
- Include at least 2 characters
- Include at least 2 endings of different types
- Every ending must be reachable through some choice path
- Return ONLY the JSON, no markdown fences or explanation`;

  return systemPrompt;
}

/**
 * Generate a full narrative arc from a text premise using an AI provider.
 *
 * In production, `fetchFn` would call the `/api/chat` endpoint or a direct
 * Claude API call. We inject it for testability and flexibility.
 */
export async function generateNarrative(
  premise: string,
  fetchFn: (prompt: string) => Promise<string>,
  options?: NarrativeGenerationOptions,
): Promise<NarrativeArc> {
  const prompt = buildNarrativePrompt(premise, options);
  const raw = await fetchFn(prompt);
  return parseNarrativeResponse(raw);
}

// ============================================================================
// Response Parsing & Validation
// ============================================================================

/**
 * Parse a raw JSON string (potentially with markdown fences) into a
 * validated NarrativeArc.
 */
export function parseNarrativeResponse(raw: string): NarrativeArc {
  // Strip markdown code fences if present
  let cleaned = raw.trim();
  if (cleaned.startsWith('```')) {
    const firstNewline = cleaned.indexOf('\n');
    cleaned = cleaned.slice(firstNewline + 1);
    const lastFence = cleaned.lastIndexOf('```');
    if (lastFence !== -1) {
      cleaned = cleaned.slice(0, lastFence);
    }
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(cleaned.trim());
  } catch {
    throw new Error('Failed to parse narrative response as JSON');
  }

  return validateNarrativeArc(parsed);
}

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

/**
 * Validate a parsed JSON value against the NarrativeArc schema.
 * Throws descriptive errors on invalid structures.
 */
export function validateNarrativeArc(data: unknown): NarrativeArc {
  if (!isObject(data)) {
    throw new Error('Narrative must be a JSON object');
  }

  if (typeof data.title !== 'string' || data.title.length === 0) {
    throw new Error('Narrative must have a non-empty title');
  }
  if (typeof data.genre !== 'string' || data.genre.length === 0) {
    throw new Error('Narrative must have a non-empty genre');
  }
  if (!Array.isArray(data.themes) || data.themes.length === 0) {
    throw new Error('Narrative must have at least one theme');
  }
  if (!Array.isArray(data.acts) || data.acts.length === 0) {
    throw new Error('Narrative must have at least one act');
  }
  if (!Array.isArray(data.characters) || data.characters.length < 2) {
    throw new Error('Narrative must have at least 2 characters');
  }
  if (!Array.isArray(data.endings) || data.endings.length < 2) {
    throw new Error('Narrative must have at least 2 endings');
  }

  const allSceneIds = new Set<string>();
  const acts: Act[] = [];

  for (const act of data.acts) {
    acts.push(validateAct(act, allSceneIds));
  }

  const characters: Character[] = data.characters.map(validateCharacter);
  const endings: Ending[] = data.endings.map(validateEnding);

  // Verify scene cross-references
  validateSceneConnections(acts, allSceneIds);

  return {
    title: data.title as string,
    genre: data.genre as string,
    themes: data.themes as string[],
    acts,
    characters,
    endings,
  };
}

function validateAct(data: unknown, allSceneIds: Set<string>): Act {
  if (!isObject(data)) throw new Error('Act must be a JSON object');
  if (typeof data.number !== 'number') throw new Error('Act must have a number');
  if (typeof data.name !== 'string') throw new Error('Act must have a name');
  if (typeof data.turningPoint !== 'string') throw new Error('Act must have a turningPoint');
  if (!Array.isArray(data.scenes) || data.scenes.length === 0) {
    throw new Error(`Act ${data.number} must have at least one scene`);
  }

  const scenes: NarrativeScene[] = [];
  for (const scene of data.scenes) {
    const validated = validateScene(scene);
    if (allSceneIds.has(validated.id)) {
      throw new Error(`Duplicate scene ID: ${validated.id}`);
    }
    allSceneIds.add(validated.id);
    scenes.push(validated);
  }

  return {
    number: data.number as number,
    name: data.name as string,
    scenes,
    turningPoint: data.turningPoint as string,
  };
}

function validateScene(data: unknown): NarrativeScene {
  if (!isObject(data)) throw new Error('Scene must be a JSON object');
  if (typeof data.id !== 'string' || data.id.length === 0) {
    throw new Error('Scene must have a non-empty id');
  }
  if (typeof data.name !== 'string') throw new Error('Scene must have a name');
  if (typeof data.description !== 'string') throw new Error('Scene must have a description');
  if (!Array.isArray(data.dialogue)) throw new Error('Scene must have a dialogue array');

  const dialogue: DialogueLine[] = data.dialogue.map(validateDialogueLine);

  let choices: Choice[] | undefined;
  if (Array.isArray(data.choices) && data.choices.length > 0) {
    choices = data.choices.map(validateChoice);
  }

  const nextSceneId =
    typeof data.nextSceneId === 'string' ? data.nextSceneId : undefined;

  return {
    id: data.id as string,
    name: data.name as string,
    description: data.description as string,
    dialogue,
    choices,
    nextSceneId,
  };
}

function validateDialogueLine(data: unknown): DialogueLine {
  if (!isObject(data)) throw new Error('Dialogue line must be a JSON object');
  if (typeof data.speaker !== 'string') throw new Error('Dialogue line must have a speaker');
  if (typeof data.text !== 'string') throw new Error('Dialogue line must have text');

  return {
    speaker: data.speaker as string,
    text: data.text as string,
    emotion: typeof data.emotion === 'string' ? (data.emotion as string) : undefined,
  };
}

function validateChoice(data: unknown): Choice {
  if (!isObject(data)) throw new Error('Choice must be a JSON object');
  if (typeof data.text !== 'string') throw new Error('Choice must have text');
  if (typeof data.consequence !== 'string') throw new Error('Choice must have a consequence');
  if (typeof data.nextSceneId !== 'string') throw new Error('Choice must have a nextSceneId');

  return {
    text: data.text as string,
    consequence: data.consequence as string,
    nextSceneId: data.nextSceneId as string,
    affectsEnding:
      typeof data.affectsEnding === 'string' ? (data.affectsEnding as string) : undefined,
  };
}

const VALID_ROLES = new Set(['protagonist', 'antagonist', 'ally', 'neutral']);

function validateCharacter(data: unknown): Character {
  if (!isObject(data)) throw new Error('Character must be a JSON object');
  if (typeof data.name !== 'string') throw new Error('Character must have a name');
  if (typeof data.role !== 'string' || !VALID_ROLES.has(data.role as string)) {
    throw new Error(`Character role must be one of: ${[...VALID_ROLES].join(', ')}`);
  }
  if (typeof data.description !== 'string') throw new Error('Character must have a description');
  if (typeof data.motivation !== 'string') throw new Error('Character must have a motivation');

  return {
    name: data.name as string,
    role: data.role as Character['role'],
    description: data.description as string,
    motivation: data.motivation as string,
  };
}

const VALID_ENDING_TYPES = new Set(['good', 'neutral', 'bad', 'secret']);

function validateEnding(data: unknown): Ending {
  if (!isObject(data)) throw new Error('Ending must be a JSON object');
  if (typeof data.id !== 'string') throw new Error('Ending must have an id');
  if (typeof data.name !== 'string') throw new Error('Ending must have a name');
  if (typeof data.type !== 'string' || !VALID_ENDING_TYPES.has(data.type as string)) {
    throw new Error(`Ending type must be one of: ${[...VALID_ENDING_TYPES].join(', ')}`);
  }
  if (typeof data.description !== 'string') throw new Error('Ending must have a description');
  if (!Array.isArray(data.conditions)) throw new Error('Ending must have conditions array');

  return {
    id: data.id as string,
    name: data.name as string,
    type: data.type as Ending['type'],
    description: data.description as string,
    conditions: data.conditions as string[],
  };
}

/**
 * Verify that all nextSceneId references in choices and scenes point to
 * valid scene IDs (or are null for terminal scenes).
 */
function validateSceneConnections(acts: Act[], allSceneIds: Set<string>): void {
  for (const act of acts) {
    for (const scene of act.scenes) {
      if (scene.nextSceneId && !allSceneIds.has(scene.nextSceneId)) {
        throw new Error(
          `Scene "${scene.id}" references unknown nextSceneId "${scene.nextSceneId}"`,
        );
      }
      if (scene.choices) {
        for (const choice of scene.choices) {
          if (!allSceneIds.has(choice.nextSceneId)) {
            throw new Error(
              `Choice in scene "${scene.id}" references unknown nextSceneId "${choice.nextSceneId}"`,
            );
          }
        }
      }
    }
  }
}

// ============================================================================
// Dead End Detection
// ============================================================================

/**
 * Find scenes that have no outgoing connections (no nextSceneId and no choices).
 * Terminal scenes are expected if they represent endings, but orphaned dead ends
 * without any choices are flagged.
 */
export function findDeadEnds(arc: NarrativeArc): string[] {
  const deadEnds: string[] = [];
  for (const act of arc.acts) {
    for (const scene of act.scenes) {
      const hasNext = !!scene.nextSceneId;
      const hasChoices = !!scene.choices && scene.choices.length > 0;
      if (!hasNext && !hasChoices) {
        deadEnds.push(scene.id);
      }
    }
  }
  return deadEnds;
}

// ============================================================================
// Dialogue Tree Export
// ============================================================================

/**
 * Convert a NarrativeArc into the existing DialogueTree format used by the
 * dialogue system (dialogueStore.ts). Each NarrativeScene becomes a sequence
 * of text nodes followed by an optional choice node.
 */
export function narrativeToDialogueTree(arc: NarrativeArc): DialogueTree {
  const nodes: DialogueNode[] = [];
  let firstNodeId: string | null = null;

  // Map from scene ID to its first dialogue node ID
  const sceneEntryNodeMap = new Map<string, string>();

  // First pass: create entry node IDs for each scene
  for (const act of arc.acts) {
    for (const scene of act.scenes) {
      const entryId = `${scene.id}_d0`;
      sceneEntryNodeMap.set(scene.id, entryId);
      if (!firstNodeId) firstNodeId = entryId;
    }
  }

  // Second pass: create all nodes
  for (const act of arc.acts) {
    for (const scene of act.scenes) {
      const dialogueLines = scene.dialogue;
      const sceneChoices = scene.choices;

      for (let i = 0; i < dialogueLines.length; i++) {
        const line = dialogueLines[i];
        const nodeId = `${scene.id}_d${i}`;
        const isLast = i === dialogueLines.length - 1;

        let next: string | null;
        if (!isLast) {
          next = `${scene.id}_d${i + 1}`;
        } else if (sceneChoices && sceneChoices.length > 0) {
          next = `${scene.id}_choices`;
        } else if (scene.nextSceneId) {
          next = sceneEntryNodeMap.get(scene.nextSceneId) ?? null;
        } else {
          next = `${scene.id}_end`;
        }

        nodes.push({
          type: 'text',
          id: nodeId,
          speaker: line.speaker,
          text: line.text,
          next,
        });
      }

      // Choice node
      if (sceneChoices && sceneChoices.length > 0) {
        const choiceNodeId = `${scene.id}_choices`;
        const choices: DialogueChoice[] = sceneChoices.map((c, idx) => ({
          id: `${choiceNodeId}_${idx}`,
          text: c.text,
          nextNodeId: sceneEntryNodeMap.get(c.nextSceneId) ?? null,
        }));

        nodes.push({
          type: 'choice',
          id: choiceNodeId,
          choices,
        });
      }

      // End node for terminal scenes
      const hasNext = !!scene.nextSceneId;
      const hasChoices = !!sceneChoices && sceneChoices.length > 0;
      if (!hasNext && !hasChoices) {
        nodes.push({
          type: 'end',
          id: `${scene.id}_end`,
        });
      }
    }
  }

  return {
    id: `narrative_${arc.title.toLowerCase().replace(/[^a-z0-9]+/g, '_')}`,
    name: arc.title,
    nodes,
    startNodeId: firstNodeId ?? 'start',
    variables: {},
  };
}

// ============================================================================
// Scene Graph Utilities
// ============================================================================

/**
 * Build an adjacency list of scene connections for visualization.
 */
export function buildSceneGraph(
  arc: NarrativeArc,
): Map<string, { targets: string[]; sceneName: string }> {
  const graph = new Map<string, { targets: string[]; sceneName: string }>();

  for (const act of arc.acts) {
    for (const scene of act.scenes) {
      const targets: string[] = [];
      if (scene.nextSceneId) targets.push(scene.nextSceneId);
      if (scene.choices) {
        for (const choice of scene.choices) {
          targets.push(choice.nextSceneId);
        }
      }
      graph.set(scene.id, { targets, sceneName: scene.name });
    }
  }

  return graph;
}

/**
 * Collect all unique scene IDs from a narrative arc.
 */
export function getAllSceneIds(arc: NarrativeArc): string[] {
  const ids: string[] = [];
  for (const act of arc.acts) {
    for (const scene of act.scenes) {
      ids.push(scene.id);
    }
  }
  return ids;
}
