/**
 * AI Game Design Document (GDD) Generator
 *
 * Generates structured GDDs from a single-sentence game description prompt.
 * Uses the /api/chat endpoint to call Claude and parse the response into
 * a typed GameDesignDocument structure.
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface GDDSection {
  title: string;
  content: string;
  subsections?: GDDSection[];
}

export interface GameDesignDocument {
  title: string;
  genre: string;
  summary: string;
  sections: GDDSection[];
  mechanics: string[];
  artStyle: string;
  targetPlatform: string;
  estimatedScope: 'small' | 'medium' | 'large';
}

export interface GDDGenerateOptions {
  genre?: string;
  scope?: 'small' | 'medium' | 'large';
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

export const GDD_STANDARD_SECTIONS = [
  'Overview',
  'Core Mechanics',
  'Player Experience',
  'Art Direction',
  'Audio Design',
  'Level Design',
  'UI/UX',
  'Technical Requirements',
] as const;

const VALID_SCOPES: ReadonlySet<string> = new Set(['small', 'medium', 'large']);

export const GDD_SYSTEM_PROMPT = `You are a game design expert. Given a game idea description, generate a structured Game Design Document (GDD) in JSON format.

The JSON MUST conform to this exact schema:
{
  "title": "Game Title",
  "genre": "Primary genre (e.g., Platformer, RPG, Puzzle, Shooter, Adventure)",
  "summary": "1-2 sentence elevator pitch of the game",
  "sections": [
    {
      "title": "Overview",
      "content": "High-level description of the game concept, theme, and core loop",
      "subsections": [
        { "title": "Theme", "content": "..." },
        { "title": "Setting", "content": "..." }
      ]
    },
    {
      "title": "Core Mechanics",
      "content": "Primary gameplay mechanics and systems",
      "subsections": [
        { "title": "Movement", "content": "..." },
        { "title": "Combat/Interaction", "content": "..." }
      ]
    },
    {
      "title": "Player Experience",
      "content": "Target emotions, difficulty curve, session length"
    },
    {
      "title": "Art Direction",
      "content": "Visual style, color palette, reference inspirations"
    },
    {
      "title": "Audio Design",
      "content": "Music style, sound effects approach, ambient audio"
    },
    {
      "title": "Level Design",
      "content": "Level structure, progression, world layout"
    },
    {
      "title": "UI/UX",
      "content": "Interface design, HUD elements, menu flow"
    },
    {
      "title": "Technical Requirements",
      "content": "Performance targets, platform considerations, engine features needed"
    }
  ],
  "mechanics": ["mechanic1", "mechanic2", "mechanic3"],
  "artStyle": "Brief art style description (e.g., 'pixel art', 'low-poly 3D', 'hand-drawn')",
  "targetPlatform": "web",
  "estimatedScope": "small|medium|large"
}

Rules:
- Always include all 8 standard sections in order: Overview, Core Mechanics, Player Experience, Art Direction, Audio Design, Level Design, UI/UX, Technical Requirements
- Each section must have a "title" and "content" field. Subsections are optional
- The "mechanics" array should list 3-8 distinct gameplay mechanics
- estimatedScope: "small" = weekend project, "medium" = 1-4 weeks, "large" = 1+ months
- targetPlatform is always "web" (this is a browser-based game engine)
- Respond with ONLY valid JSON. No markdown, no explanation, no code fences.`;

// ---------------------------------------------------------------------------
// Genre detection
// ---------------------------------------------------------------------------

const GENRE_KEYWORDS: Record<string, string[]> = {
  Platformer: ['platformer', 'jump', 'jumping', 'platform', 'side-scroller', 'sidescroller', 'mario'],
  RPG: ['rpg', 'role-playing', 'roleplay', 'quest', 'leveling', 'level up', 'xp', 'experience points'],
  Puzzle: ['puzzle', 'match', 'brain', 'logic', 'riddle', 'sokoban', 'tetris'],
  Shooter: ['shooter', 'shoot', 'gun', 'fps', 'bullet', 'weapon', 'combat'],
  Adventure: ['adventure', 'explore', 'exploration', 'story', 'narrative', 'journey'],
  Racing: ['racing', 'race', 'car', 'kart', 'speed', 'track', 'driving'],
  Strategy: ['strategy', 'tower defense', 'rts', 'turn-based', 'tactics', 'base building'],
  Simulation: ['simulation', 'sim', 'farm', 'tycoon', 'management', 'sandbox'],
  Horror: ['horror', 'scary', 'haunted', 'spooky', 'creepy', 'dark', 'survival horror'],
  Fighting: ['fighting', 'fighter', 'brawl', 'melee', 'arena'],
  Runner: ['runner', 'endless runner', 'auto-runner', 'infinite'],
};

/**
 * Detect probable genre from user prompt text.
 * Returns best-matching genre or 'Action' as fallback.
 */
export function detectGenre(prompt: string): string {
  const lower = prompt.toLowerCase();
  let bestGenre = 'Action';
  let bestScore = 0;

  for (const [genre, keywords] of Object.entries(GENRE_KEYWORDS)) {
    let score = 0;
    for (const kw of keywords) {
      if (lower.includes(kw)) score++;
    }
    if (score > bestScore) {
      bestScore = score;
      bestGenre = genre;
    }
  }

  return bestGenre;
}

// ---------------------------------------------------------------------------
// Scope estimation
// ---------------------------------------------------------------------------

const COMPLEXITY_INDICATORS: Record<string, number> = {
  multiplayer: 3,
  'online': 2,
  'procedural': 2,
  'open world': 3,
  'crafting': 2,
  'inventory': 1,
  'dialogue': 2,
  'ai enemies': 2,
  'boss': 1,
  'levels': 1,
  'physics': 1,
  'particle': 1,
  'animation': 1,
  'story': 2,
  'save': 1,
  'leaderboard': 1,
};

/**
 * Estimate project scope from prompt complexity.
 */
export function estimateScope(prompt: string): 'small' | 'medium' | 'large' {
  const lower = prompt.toLowerCase();
  let complexity = 0;

  for (const [indicator, weight] of Object.entries(COMPLEXITY_INDICATORS)) {
    if (lower.includes(indicator)) {
      complexity += weight;
    }
  }

  if (complexity >= 6) return 'large';
  if (complexity >= 3) return 'medium';
  return 'small';
}

// ---------------------------------------------------------------------------
// System prompt builder
// ---------------------------------------------------------------------------

/**
 * Build the user message for the AI, incorporating optional overrides.
 */
export function buildUserPrompt(prompt: string, options?: GDDGenerateOptions): string {
  const parts: string[] = [`Game idea: ${prompt}`];

  if (options?.genre) {
    parts.push(`Genre preference: ${options.genre}`);
  }

  if (options?.scope) {
    parts.push(`Target scope: ${options.scope}`);
  }

  parts.push('Generate the complete GDD as JSON.');
  return parts.join('\n');
}

// ---------------------------------------------------------------------------
// Response parser
// ---------------------------------------------------------------------------

function isValidScope(s: unknown): s is 'small' | 'medium' | 'large' {
  return typeof s === 'string' && VALID_SCOPES.has(s);
}

function parseSection(raw: unknown): GDDSection | null {
  if (!raw || typeof raw !== 'object') return null;
  const obj = raw as Record<string, unknown>;
  if (typeof obj.title !== 'string' || typeof obj.content !== 'string') return null;

  const section: GDDSection = {
    title: obj.title,
    content: obj.content,
  };

  if (Array.isArray(obj.subsections)) {
    const subs = obj.subsections
      .map((s: unknown) => parseSection(s))
      .filter((s): s is GDDSection => s !== null);
    if (subs.length > 0) {
      section.subsections = subs;
    }
  }

  return section;
}

/**
 * Parse a raw AI response string into a GameDesignDocument.
 * Handles JSON extraction from markdown code fences and validates structure.
 * Throws if the response is not parseable.
 */
export function parseGDDResponse(raw: string): GameDesignDocument {
  // Strip markdown code fences if present
  let jsonStr = raw.trim();
  const fenceMatch = jsonStr.match(/```(?:json)?\s*\n?([\s\S]*?)\n?```/);
  if (fenceMatch) {
    jsonStr = fenceMatch[1].trim();
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(jsonStr);
  } catch {
    throw new Error('Failed to parse GDD response as JSON');
  }

  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('GDD response is not a JSON object');
  }

  const obj = parsed as Record<string, unknown>;

  // Validate required string fields
  const title = typeof obj.title === 'string' ? obj.title : 'Untitled Game';
  const genre = typeof obj.genre === 'string' ? obj.genre : 'Action';
  const summary = typeof obj.summary === 'string' ? obj.summary : '';
  const artStyle = typeof obj.artStyle === 'string' ? obj.artStyle : '';
  const targetPlatform = typeof obj.targetPlatform === 'string' ? obj.targetPlatform : 'web';
  const estimatedScope = isValidScope(obj.estimatedScope) ? obj.estimatedScope : 'medium';

  // Parse sections
  let sections: GDDSection[] = [];
  if (Array.isArray(obj.sections)) {
    sections = obj.sections
      .map((s: unknown) => parseSection(s))
      .filter((s): s is GDDSection => s !== null);
  }

  // Ensure all standard sections are present
  const existingTitles = new Set(sections.map((s) => s.title));
  for (const standardTitle of GDD_STANDARD_SECTIONS) {
    if (!existingTitles.has(standardTitle)) {
      sections.push({
        title: standardTitle,
        content: 'To be determined.',
      });
    }
  }

  // Parse mechanics
  let mechanics: string[] = [];
  if (Array.isArray(obj.mechanics)) {
    mechanics = obj.mechanics.filter((m): m is string => typeof m === 'string');
  }

  return {
    title,
    genre,
    summary,
    sections,
    mechanics,
    artStyle,
    targetPlatform,
    estimatedScope,
  };
}

// ---------------------------------------------------------------------------
// GDD Generator
// ---------------------------------------------------------------------------

/**
 * Generate a Game Design Document from a single prompt.
 * Calls the /api/chat endpoint and parses the response.
 */
export async function generateGDD(
  prompt: string,
  options?: GDDGenerateOptions,
): Promise<GameDesignDocument> {
  if (!prompt.trim()) {
    throw new Error('Game description cannot be empty');
  }

  const userMessage = buildUserPrompt(prompt, options);

  const response = await fetch('/api/chat', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      messages: [{ role: 'user', content: userMessage }],
      model: 'claude-sonnet-4-5-20250929',
      sceneContext: '',
      thinking: false,
      systemOverride: GDD_SYSTEM_PROMPT,
    }),
  });

  if (!response.ok) {
    const errorData = await response.json().catch(() => ({ error: response.statusText }));
    throw new Error(
      (errorData as Record<string, string>).error || `GDD generation failed: ${response.status}`,
    );
  }

  // Parse SSE stream for text content
  const reader = response.body?.getReader();
  if (!reader) throw new Error('No response body');

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

      try {
        const event = JSON.parse(data) as Record<string, unknown>;
        if (event.type === 'text_delta' && typeof event.text === 'string') {
          content += event.text;
        }
        if (event.type === 'error' && typeof event.message === 'string') {
          throw new Error(event.message);
        }
      } catch (e) {
        // Re-throw if it's our own error
        if (e instanceof Error && e.message !== 'Failed to parse GDD response as JSON') {
          if (e.message.startsWith('GDD') || !data.startsWith('{')) continue;
          throw e;
        }
      }
    }
  }

  if (!content.trim()) {
    throw new Error('AI returned an empty response');
  }

  return parseGDDResponse(content);
}

// ---------------------------------------------------------------------------
// Export to Markdown
// ---------------------------------------------------------------------------

function sectionToMarkdown(section: GDDSection, level: number): string {
  const heading = '#'.repeat(level);
  let md = `${heading} ${section.title}\n\n${section.content}\n\n`;
  if (section.subsections) {
    for (const sub of section.subsections) {
      md += sectionToMarkdown(sub, level + 1);
    }
  }
  return md;
}

/**
 * Convert a GameDesignDocument to a Markdown string.
 */
export function gddToMarkdown(gdd: GameDesignDocument): string {
  const lines: string[] = [];

  lines.push(`# ${gdd.title}\n`);
  lines.push(`**Genre:** ${gdd.genre}`);
  lines.push(`**Scope:** ${gdd.estimatedScope}`);
  lines.push(`**Platform:** ${gdd.targetPlatform}`);
  lines.push(`**Art Style:** ${gdd.artStyle}\n`);
  lines.push(`> ${gdd.summary}\n`);

  if (gdd.mechanics.length > 0) {
    lines.push(`## Key Mechanics\n`);
    for (const m of gdd.mechanics) {
      lines.push(`- ${m}`);
    }
    lines.push('');
  }

  for (const section of gdd.sections) {
    lines.push(sectionToMarkdown(section, 2));
  }

  return lines.join('\n');
}
