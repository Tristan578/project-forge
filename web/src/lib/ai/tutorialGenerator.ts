/**
 * AI Auto-Tutorial Generator
 *
 * Analyzes a game scene's entities and game components to detect mechanics,
 * then uses AI to generate a progressive tutorial plan that teaches players
 * the game step-by-step.
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface GameMechanic {
  name: string;
  description: string;
  inputRequired: string;
  complexity: number;
}

export interface TutorialStep {
  order: number;
  mechanic: string;
  instruction: string;
  triggerCondition: string;
  completionCondition: string;
  hint?: string;
}

export interface TutorialPlan {
  steps: TutorialStep[];
  estimatedDuration: string;
  difficulty: 'beginner' | 'intermediate';
  introText: string;
  completionText: string;
}

export interface TutorialGenerateOptions {
  maxSteps?: number;
}

// ---------------------------------------------------------------------------
// Scene context type (minimal shape we need from the editor store)
// ---------------------------------------------------------------------------

export interface SceneEntityContext {
  entityId: string;
  name: string;
  components: string[];
  gameComponents?: Array<{ type: string }>;
  hasPhysics?: boolean;
  hasScript?: boolean;
  hasAudio?: boolean;
}

// ---------------------------------------------------------------------------
// Mechanic detection
// ---------------------------------------------------------------------------

interface MechanicDetector {
  name: string;
  description: string;
  inputRequired: string;
  complexity: number;
  detect: (entity: SceneEntityContext) => boolean;
}

const MECHANIC_DETECTORS: MechanicDetector[] = [
  {
    name: 'Movement',
    description: 'Player character can move around the game world',
    inputRequired: 'WASD / Arrow keys / Joystick',
    complexity: 1,
    detect: (e) =>
      e.gameComponents?.some((c) => c.type === 'characterController') ?? false,
  },
  {
    name: 'Collecting Items',
    description: 'Player can pick up collectible objects',
    inputRequired: 'Walk into items to collect',
    complexity: 2,
    detect: (e) =>
      e.gameComponents?.some((c) => c.type === 'collectible') ?? false,
  },
  {
    name: 'Health & Damage',
    description: 'Player has a health bar and can take damage',
    inputRequired: 'Avoid hazards',
    complexity: 3,
    detect: (e) =>
      e.gameComponents?.some((c) => c.type === 'health') ?? false,
  },
  {
    name: 'Damage Zones',
    description: 'Hazardous areas that hurt the player',
    inputRequired: 'Navigate around danger zones',
    complexity: 3,
    detect: (e) =>
      e.gameComponents?.some((c) => c.type === 'damageZone') ?? false,
  },
  {
    name: 'Checkpoints',
    description: 'Save progress at checkpoint locations',
    inputRequired: 'Reach checkpoint markers',
    complexity: 2,
    detect: (e) =>
      e.gameComponents?.some((c) => c.type === 'checkpoint') ?? false,
  },
  {
    name: 'Teleportation',
    description: 'Portals that transport the player to another location',
    inputRequired: 'Enter teleporter zones',
    complexity: 3,
    detect: (e) =>
      e.gameComponents?.some((c) => c.type === 'teleporter') ?? false,
  },
  {
    name: 'Moving Platforms',
    description: 'Platforms that move along a path',
    inputRequired: 'Time jumps onto moving platforms',
    complexity: 4,
    detect: (e) =>
      e.gameComponents?.some((c) => c.type === 'movingPlatform') ?? false,
  },
  {
    name: 'Trigger Zones',
    description: 'Areas that activate events when entered',
    inputRequired: 'Walk into trigger areas',
    complexity: 2,
    detect: (e) =>
      e.gameComponents?.some((c) => c.type === 'triggerZone') ?? false,
  },
  {
    name: 'Enemy Spawners',
    description: 'Points that generate enemies or obstacles',
    inputRequired: 'Deal with spawned enemies',
    complexity: 5,
    detect: (e) =>
      e.gameComponents?.some((c) => c.type === 'spawner') ?? false,
  },
  {
    name: 'Following Enemies',
    description: 'Enemies that track and follow the player',
    inputRequired: 'Evade or defeat followers',
    complexity: 5,
    detect: (e) =>
      e.gameComponents?.some((c) => c.type === 'follower') ?? false,
  },
  {
    name: 'Projectiles',
    description: 'Shooting or throwing projectiles',
    inputRequired: 'Click / Tap to fire',
    complexity: 4,
    detect: (e) =>
      e.gameComponents?.some((c) => c.type === 'projectile') ?? false,
  },
  {
    name: 'Win Condition',
    description: 'Goal or objective to complete the level',
    inputRequired: 'Complete the objective',
    complexity: 1,
    detect: (e) =>
      e.gameComponents?.some((c) => c.type === 'winCondition') ?? false,
  },
  {
    name: 'Dialogue',
    description: 'NPC conversations and story dialogue',
    inputRequired: 'Interact with NPCs',
    complexity: 2,
    detect: (e) =>
      e.gameComponents?.some((c) => c.type === 'dialogueTrigger') ?? false,
  },
  {
    name: 'Physics Interaction',
    description: 'Objects react to physics forces and collisions',
    inputRequired: 'Push or interact with physics objects',
    complexity: 3,
    detect: (e) => e.hasPhysics === true && !(e.gameComponents?.some((c) => c.type === 'characterController') ?? false),
  },
  {
    name: 'Scripted Behavior',
    description: 'Custom scripted game logic',
    inputRequired: 'Varies by script',
    complexity: 4,
    detect: (e) => e.hasScript === true,
  },
];

/**
 * Detect game mechanics present in the scene by analyzing entity components.
 * Returns a deduplicated list sorted by complexity (simplest first).
 */
export function detectMechanics(entities: SceneEntityContext[]): GameMechanic[] {
  const found = new Set<string>();
  const mechanics: GameMechanic[] = [];

  for (const entity of entities) {
    for (const detector of MECHANIC_DETECTORS) {
      if (!found.has(detector.name) && detector.detect(entity)) {
        found.add(detector.name);
        mechanics.push({
          name: detector.name,
          description: detector.description,
          inputRequired: detector.inputRequired,
          complexity: detector.complexity,
        });
      }
    }
  }

  // Sort by complexity ascending (teach simple mechanics first)
  mechanics.sort((a, b) => a.complexity - b.complexity);

  return mechanics;
}

// ---------------------------------------------------------------------------
// AI Tutorial Plan Generation
// ---------------------------------------------------------------------------

export const TUTORIAL_SYSTEM_PROMPT = `You are a game design educator specializing in tutorial design and progressive disclosure. Given a list of game mechanics, generate a structured tutorial plan in JSON format that teaches each mechanic step-by-step.

Design principles:
1. PROGRESSIVE DISCLOSURE: Introduce one mechanic at a time. Never overwhelm the player.
2. SAFE LEARNING: Each step should have a safe environment to practice (no fail states during learning).
3. BUILD ON PREVIOUS: Later steps should require using previously learned mechanics.
4. CLEAR FEEDBACK: Every step needs a clear completion condition so the player knows they succeeded.
5. HINT SYSTEM: Provide optional hints for players who get stuck.

The JSON MUST conform to this exact schema:
{
  "steps": [
    {
      "order": 1,
      "mechanic": "Name of the mechanic being taught",
      "instruction": "What to tell the player (2-3 sentences, friendly tone)",
      "triggerCondition": "What triggers this tutorial step to appear",
      "completionCondition": "What the player must do to complete this step",
      "hint": "Optional hint shown after a delay if the player is stuck"
    }
  ],
  "estimatedDuration": "How long the tutorial should take (e.g., '2-3 minutes')",
  "difficulty": "beginner or intermediate",
  "introText": "Welcome message shown at the start of the tutorial (1-2 sentences)",
  "completionText": "Congratulations message shown when all steps are complete (1-2 sentences)"
}

Rules:
- Order mechanics from simplest to most complex
- Each step teaches exactly ONE mechanic
- Instructions should be concise, encouraging, and action-oriented
- triggerCondition describes when the step activates (e.g., "previous step completed", "player enters area")
- completionCondition describes the success criteria (e.g., "player moves 5 units", "player collects 3 items")
- Respond with ONLY valid JSON. No markdown, no explanation, no code fences.`;

/**
 * Build the user prompt for AI tutorial generation.
 */
export function buildTutorialPrompt(
  mechanics: GameMechanic[],
  options?: TutorialGenerateOptions,
): string {
  const mechanicList = mechanics
    .map(
      (m, i) =>
        `${i + 1}. ${m.name} (complexity: ${m.complexity}/5) — ${m.description}. Input: ${m.inputRequired}`,
    )
    .join('\n');

  const parts = [
    `Game mechanics detected in the scene:\n${mechanicList}`,
  ];

  if (options?.maxSteps) {
    parts.push(
      `Maximum tutorial steps: ${options.maxSteps} (prioritize the most important mechanics)`,
    );
  }

  parts.push(
    `Generate a progressive tutorial plan that teaches these mechanics in order of complexity.`,
  );

  return parts.join('\n\n');
}

// ---------------------------------------------------------------------------
// Response parser
// ---------------------------------------------------------------------------

const VALID_DIFFICULTIES: ReadonlySet<string> = new Set([
  'beginner',
  'intermediate',
]);

function parseStep(raw: unknown, index: number): TutorialStep | null {
  if (!raw || typeof raw !== 'object') return null;
  const obj = raw as Record<string, unknown>;

  if (typeof obj.mechanic !== 'string' || typeof obj.instruction !== 'string') {
    return null;
  }

  return {
    order: typeof obj.order === 'number' ? obj.order : index + 1,
    mechanic: obj.mechanic,
    instruction: obj.instruction,
    triggerCondition:
      typeof obj.triggerCondition === 'string'
        ? obj.triggerCondition
        : 'Previous step completed',
    completionCondition:
      typeof obj.completionCondition === 'string'
        ? obj.completionCondition
        : 'Complete the action',
    hint: typeof obj.hint === 'string' ? obj.hint : undefined,
  };
}

/**
 * Parse a raw AI response string into a TutorialPlan.
 * Handles JSON extraction from markdown code fences and validates structure.
 * Throws if the response is not parseable.
 */
export function parseTutorialResponse(raw: string): TutorialPlan {
  let jsonStr = raw.trim();
  const fenceMatch = jsonStr.match(/```(?:json)?\s*\n?([\s\S]*?)\n?```/);
  if (fenceMatch) {
    jsonStr = fenceMatch[1].trim();
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(jsonStr);
  } catch {
    throw new Error('Failed to parse tutorial response as JSON');
  }

  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('Tutorial response is not a JSON object');
  }

  const obj = parsed as Record<string, unknown>;

  // Parse steps
  let steps: TutorialStep[] = [];
  if (Array.isArray(obj.steps)) {
    steps = obj.steps
      .map((s: unknown, i: number) => parseStep(s, i))
      .filter((s): s is TutorialStep => s !== null);
  }

  if (steps.length === 0) {
    throw new Error('Tutorial plan contains no valid steps');
  }

  // Ensure ordering is sequential
  steps.sort((a, b) => a.order - b.order);

  const difficulty =
    typeof obj.difficulty === 'string' && VALID_DIFFICULTIES.has(obj.difficulty)
      ? (obj.difficulty as 'beginner' | 'intermediate')
      : 'beginner';

  return {
    steps,
    estimatedDuration:
      typeof obj.estimatedDuration === 'string'
        ? obj.estimatedDuration
        : `${steps.length}-${steps.length * 2} minutes`,
    difficulty,
    introText:
      typeof obj.introText === 'string'
        ? obj.introText
        : 'Welcome! Let\'s learn the basics of this game.',
    completionText:
      typeof obj.completionText === 'string'
        ? obj.completionText
        : 'Great job! You\'ve completed the tutorial.',
  };
}

// ---------------------------------------------------------------------------
// AI Generator (calls /api/chat endpoint)
// ---------------------------------------------------------------------------

/**
 * Parse an SSE stream from the /api/chat endpoint and collect all text deltas.
 */
async function readSSEStream(reader: ReadableStreamDefaultReader<Uint8Array>): Promise<string> {
  const decoder = new TextDecoder();
  let buffer = '';
  let content = '';

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

      let event: Record<string, unknown>;
      try {
        event = JSON.parse(data) as Record<string, unknown>;
      } catch {
        // Partial JSON chunk — skip and continue reading
        continue;
      }
      if (event.type === 'text_delta' && typeof event.text === 'string') {
        content += event.text;
      }
      if (event.type === 'error' && typeof event.message === 'string') {
        throw new Error(event.message);
      }
    }
  }

  return content;
}

/**
 * Generate a tutorial plan from detected game mechanics using AI.
 * Calls the /api/chat endpoint with a specialized system prompt.
 */
export async function generateTutorialPlan(
  mechanics: GameMechanic[],
  options?: TutorialGenerateOptions,
): Promise<TutorialPlan> {
  if (mechanics.length === 0) {
    throw new Error('No game mechanics detected. Add game components to your scene first.');
  }

  const userMessage = buildTutorialPrompt(mechanics, options);

  const response = await fetch('/api/chat', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      messages: [{ role: 'user', content: userMessage }],
      model: 'claude-sonnet-4-5-20250929',
      sceneContext: '',
      thinking: false,
      systemOverride: TUTORIAL_SYSTEM_PROMPT,
    }),
  });

  if (!response.ok) {
    const errorData = await response
      .json()
      .catch(() => ({ error: response.statusText }));
    throw new Error(
      (errorData as Record<string, string>).error ||
        `Tutorial generation failed: ${response.status}`,
    );
  }

  const reader = response.body?.getReader();
  if (!reader) throw new Error('No response body');

  const content = await readSSEStream(reader);

  if (!content.trim()) {
    throw new Error('AI returned an empty response');
  }

  return parseTutorialResponse(content);
}

// ---------------------------------------------------------------------------
// Tutorial plan to script export
// ---------------------------------------------------------------------------

/**
 * Convert a TutorialPlan into a TypeScript game script that can be used
 * with the forge.* scripting API to drive in-game tutorial overlays.
 */
export function tutorialPlanToScript(plan: TutorialPlan): string {
  const stepsJson = JSON.stringify(plan.steps, null, 2);

  return `// Auto-generated tutorial script
// Duration: ${plan.estimatedDuration} | Difficulty: ${plan.difficulty}

const TUTORIAL_STEPS = ${stepsJson};

let currentStep = 0;

function showStep(step) {
  forge.ui.showOverlay({
    text: step.instruction,
    hint: step.hint || null,
    position: 'bottom-center',
  });
}

function onInit() {
  forge.ui.showOverlay({
    text: ${JSON.stringify(plan.introText)},
    position: 'top-center',
    duration: 3000,
  });

  setTimeout(() => {
    if (TUTORIAL_STEPS.length > 0) {
      showStep(TUTORIAL_STEPS[0]);
    }
  }, 3500);
}

function advanceStep() {
  currentStep++;
  if (currentStep >= TUTORIAL_STEPS.length) {
    forge.ui.showOverlay({
      text: ${JSON.stringify(plan.completionText)},
      position: 'center',
      duration: 5000,
    });
    return;
  }
  showStep(TUTORIAL_STEPS[currentStep]);
}

// Export for the forge runtime
forge.on('init', onInit);
forge.on('tutorial_advance', advanceStep);
`;
}
