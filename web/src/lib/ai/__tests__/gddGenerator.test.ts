import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  detectGenre,
  estimateScope,
  buildUserPrompt,
  parseGDDResponse,
  gddToMarkdown,
  GDD_SYSTEM_PROMPT,
  GDD_STANDARD_SECTIONS,
  generateGDD,
  type GameDesignDocument,
} from '../gddGenerator';

vi.mock('@/lib/ai/client', () => ({
  fetchAI: vi.fn(),
  streamAI: vi.fn(),
}));

// ---------------------------------------------------------------------------
// detectGenre
// ---------------------------------------------------------------------------

describe('detectGenre', () => {
  it('detects platformer genre from keywords', () => {
    expect(detectGenre('a platformer where you jump over obstacles')).toBe('Platformer');
  });

  it('detects puzzle genre', () => {
    expect(detectGenre('a brain puzzle with logic riddles')).toBe('Puzzle');
  });

  it('detects RPG genre', () => {
    expect(detectGenre('an rpg with quests and leveling up')).toBe('RPG');
  });

  it('detects shooter genre', () => {
    expect(detectGenre('a first-person shooter with guns and bullets')).toBe('Shooter');
  });

  it('detects horror genre', () => {
    expect(detectGenre('a haunted castle with spooky ghosts')).toBe('Horror');
  });

  it('detects racing genre', () => {
    expect(detectGenre('a kart racing game on a track')).toBe('Racing');
  });

  it('detects strategy genre', () => {
    expect(detectGenre('a tower defense strategy game')).toBe('Strategy');
  });

  it('detects runner genre', () => {
    expect(detectGenre('an endless runner auto-runner game')).toBe('Runner');
  });

  it('returns Action as fallback for ambiguous prompts', () => {
    expect(detectGenre('a game with things in it')).toBe('Action');
  });

  it('is case-insensitive', () => {
    expect(detectGenre('A PLATFORMER GAME')).toBe('Platformer');
  });

  it('picks the genre with the most keyword matches', () => {
    // "jump" + "platform" = 2 for Platformer, vs "shoot" = 1 for Shooter
    expect(detectGenre('a platform jump game where you also shoot')).toBe('Platformer');
  });
});

// ---------------------------------------------------------------------------
// estimateScope
// ---------------------------------------------------------------------------

describe('estimateScope', () => {
  it('returns small for simple prompts', () => {
    expect(estimateScope('a simple jumping game')).toBe('small');
  });

  it('returns medium for moderately complex prompts', () => {
    expect(estimateScope('a game with an inventory, dialogue, and story')).toBe('medium');
  });

  it('returns large for highly complex prompts', () => {
    expect(estimateScope('a multiplayer open world game with crafting, inventory, dialogue, and story')).toBe('large');
  });

  it('handles empty prompt', () => {
    expect(estimateScope('')).toBe('small');
  });

  it('is case-insensitive', () => {
    expect(estimateScope('MULTIPLAYER OPEN WORLD with CRAFTING and INVENTORY')).toBe('large');
  });
});

// ---------------------------------------------------------------------------
// buildUserPrompt
// ---------------------------------------------------------------------------

describe('buildUserPrompt', () => {
  it('builds basic prompt with game idea', () => {
    const result = buildUserPrompt('a castle platformer');
    expect(result).toContain('Game idea: a castle platformer');
    expect(result).toContain('Generate the complete GDD as JSON.');
  });

  it('includes genre override when provided', () => {
    const result = buildUserPrompt('a castle game', { genre: 'Horror' });
    expect(result).toContain('Genre preference: Horror');
  });

  it('includes scope override when provided', () => {
    const result = buildUserPrompt('a castle game', { scope: 'large' });
    expect(result).toContain('Target scope: large');
  });

  it('includes both genre and scope when provided', () => {
    const result = buildUserPrompt('a castle game', { genre: 'RPG', scope: 'medium' });
    expect(result).toContain('Genre preference: RPG');
    expect(result).toContain('Target scope: medium');
  });

  it('omits genre line when not provided', () => {
    const result = buildUserPrompt('a game', {});
    expect(result).not.toContain('Genre preference');
  });
});

// ---------------------------------------------------------------------------
// GDD_SYSTEM_PROMPT
// ---------------------------------------------------------------------------

describe('GDD_SYSTEM_PROMPT', () => {
  it('contains JSON schema instructions', () => {
    expect(GDD_SYSTEM_PROMPT).toContain('"title"');
    expect(GDD_SYSTEM_PROMPT).toContain('"genre"');
    expect(GDD_SYSTEM_PROMPT).toContain('"sections"');
    expect(GDD_SYSTEM_PROMPT).toContain('"mechanics"');
  });

  it('instructs to respond with valid JSON only', () => {
    expect(GDD_SYSTEM_PROMPT).toContain('Respond with ONLY valid JSON');
  });

  it('references all 8 standard sections', () => {
    for (const section of GDD_STANDARD_SECTIONS) {
      expect(GDD_SYSTEM_PROMPT).toContain(section);
    }
  });
});

// ---------------------------------------------------------------------------
// parseGDDResponse — valid inputs
// ---------------------------------------------------------------------------

describe('parseGDDResponse', () => {
  const validGDD: GameDesignDocument = {
    title: 'Star Castle',
    genre: 'Platformer',
    summary: 'A platformer set in a haunted castle.',
    sections: [
      { title: 'Overview', content: 'Game overview' },
      { title: 'Core Mechanics', content: 'Jump and run' },
      { title: 'Player Experience', content: 'Fun and challenging' },
      { title: 'Art Direction', content: 'Pixel art style' },
      { title: 'Audio Design', content: 'Chiptune music' },
      { title: 'Level Design', content: '10 levels' },
      { title: 'UI/UX', content: 'Simple HUD' },
      { title: 'Technical Requirements', content: 'WebGL2' },
    ],
    mechanics: ['jumping', 'collecting', 'enemies'],
    artStyle: 'pixel art',
    targetPlatform: 'web',
    estimatedScope: 'small',
  };

  it('parses valid JSON string', () => {
    const result = parseGDDResponse(JSON.stringify(validGDD));
    expect(result.title).toBe('Star Castle');
    expect(result.genre).toBe('Platformer');
    expect(result.estimatedScope).toBe('small');
    expect(result.sections).toHaveLength(8);
    expect(result.mechanics).toEqual(['jumping', 'collecting', 'enemies']);
  });

  it('strips markdown code fences', () => {
    const wrapped = '```json\n' + JSON.stringify(validGDD) + '\n```';
    const result = parseGDDResponse(wrapped);
    expect(result.title).toBe('Star Castle');
  });

  it('strips code fences without json language marker', () => {
    const wrapped = '```\n' + JSON.stringify(validGDD) + '\n```';
    const result = parseGDDResponse(wrapped);
    expect(result.title).toBe('Star Castle');
  });

  it('handles subsections', () => {
    const withSubs = {
      ...validGDD,
      sections: [
        {
          title: 'Overview',
          content: 'Top level',
          subsections: [
            { title: 'Theme', content: 'Dark fantasy' },
            { title: 'Setting', content: 'Medieval castle' },
          ],
        },
        ...validGDD.sections.slice(1),
      ],
    };
    const result = parseGDDResponse(JSON.stringify(withSubs));
    expect(result.sections[0].subsections).toHaveLength(2);
    expect(result.sections[0].subsections![0].title).toBe('Theme');
  });

  it('adds missing standard sections', () => {
    const partial = {
      title: 'Minimal',
      genre: 'Puzzle',
      summary: 'A puzzle game',
      sections: [{ title: 'Overview', content: 'Just an overview' }],
      mechanics: ['matching'],
      artStyle: 'minimalist',
      targetPlatform: 'web',
      estimatedScope: 'small',
    };
    const result = parseGDDResponse(JSON.stringify(partial));
    // Should have all 8 sections
    const titles = result.sections.map((s) => s.title);
    for (const standard of GDD_STANDARD_SECTIONS) {
      expect(titles).toContain(standard);
    }
  });

  it('defaults missing string fields', () => {
    const minimal = { sections: [], mechanics: [] };
    const result = parseGDDResponse(JSON.stringify(minimal));
    expect(result.title).toBe('Untitled Game');
    expect(result.genre).toBe('Action');
    expect(result.summary).toBe('');
    expect(result.artStyle).toBe('');
    expect(result.targetPlatform).toBe('web');
    expect(result.estimatedScope).toBe('medium');
  });

  it('defaults invalid estimatedScope to medium', () => {
    const bad = { ...validGDD, estimatedScope: 'huge' };
    const result = parseGDDResponse(JSON.stringify(bad));
    expect(result.estimatedScope).toBe('medium');
  });

  it('filters out non-string mechanics', () => {
    const bad = { ...validGDD, mechanics: ['valid', 42, null, 'also valid'] };
    const result = parseGDDResponse(JSON.stringify(bad));
    expect(result.mechanics).toEqual(['valid', 'also valid']);
  });

  it('handles non-array sections gracefully', () => {
    const bad = { ...validGDD, sections: 'not an array' };
    const result = parseGDDResponse(JSON.stringify(bad));
    // Should still have all standard sections added
    expect(result.sections.length).toBe(8);
  });

  it('skips invalid section objects', () => {
    const bad = {
      ...validGDD,
      sections: [
        { title: 'Overview', content: 'Valid' },
        { noTitle: true },
        null,
        42,
        { title: 'Core Mechanics', content: 'Also valid' },
      ],
    };
    const result = parseGDDResponse(JSON.stringify(bad));
    const titles = result.sections.map((s) => s.title);
    expect(titles).toContain('Overview');
    expect(titles).toContain('Core Mechanics');
  });
});

// ---------------------------------------------------------------------------
// parseGDDResponse — error cases
// ---------------------------------------------------------------------------

describe('parseGDDResponse — errors', () => {
  it('throws on empty string', () => {
    expect(() => parseGDDResponse('')).toThrow('Failed to parse GDD response as JSON');
  });

  it('throws on invalid JSON', () => {
    expect(() => parseGDDResponse('not json at all')).toThrow('Failed to parse GDD response as JSON');
  });

  it('throws on non-object JSON (string)', () => {
    expect(() => parseGDDResponse('"just a string"')).toThrow('GDD response is not a JSON object');
  });

  it('throws on non-object JSON (array)', () => {
    expect(() => parseGDDResponse('[1,2,3]')).toThrow('GDD response is not a JSON object');
  });

  it('throws on null JSON', () => {
    expect(() => parseGDDResponse('null')).toThrow('GDD response is not a JSON object');
  });
});

// ---------------------------------------------------------------------------
// gddToMarkdown
// ---------------------------------------------------------------------------

describe('gddToMarkdown', () => {
  const gdd: GameDesignDocument = {
    title: 'Test Game',
    genre: 'Puzzle',
    summary: 'A test puzzle game.',
    sections: [
      { title: 'Overview', content: 'Game overview text' },
      {
        title: 'Core Mechanics',
        content: 'Main mechanics',
        subsections: [{ title: 'Matching', content: 'Match-3 system' }],
      },
    ],
    mechanics: ['matching', 'combos', 'power-ups'],
    artStyle: 'cartoon',
    targetPlatform: 'web',
    estimatedScope: 'small',
  };

  it('includes title as H1', () => {
    const md = gddToMarkdown(gdd);
    expect(md).toContain('# Test Game');
  });

  it('includes metadata fields', () => {
    const md = gddToMarkdown(gdd);
    expect(md).toContain('**Genre:** Puzzle');
    expect(md).toContain('**Scope:** small');
    expect(md).toContain('**Platform:** web');
    expect(md).toContain('**Art Style:** cartoon');
  });

  it('includes summary as blockquote', () => {
    const md = gddToMarkdown(gdd);
    expect(md).toContain('> A test puzzle game.');
  });

  it('includes mechanics list', () => {
    const md = gddToMarkdown(gdd);
    expect(md).toContain('- matching');
    expect(md).toContain('- combos');
    expect(md).toContain('- power-ups');
  });

  it('includes sections as H2', () => {
    const md = gddToMarkdown(gdd);
    expect(md).toContain('## Overview');
    expect(md).toContain('## Core Mechanics');
  });

  it('includes subsections as H3', () => {
    const md = gddToMarkdown(gdd);
    expect(md).toContain('### Matching');
    expect(md).toContain('Match-3 system');
  });

  it('handles GDD with no mechanics', () => {
    const noMechanics = { ...gdd, mechanics: [] };
    const md = gddToMarkdown(noMechanics);
    expect(md).not.toContain('## Key Mechanics');
  });
});

// ---------------------------------------------------------------------------
// GDD_STANDARD_SECTIONS
// ---------------------------------------------------------------------------

describe('GDD_STANDARD_SECTIONS', () => {
  it('has exactly 8 sections', () => {
    expect(GDD_STANDARD_SECTIONS).toHaveLength(8);
  });

  it('includes all expected sections', () => {
    expect(GDD_STANDARD_SECTIONS).toContain('Overview');
    expect(GDD_STANDARD_SECTIONS).toContain('Core Mechanics');
    expect(GDD_STANDARD_SECTIONS).toContain('Player Experience');
    expect(GDD_STANDARD_SECTIONS).toContain('Art Direction');
    expect(GDD_STANDARD_SECTIONS).toContain('Audio Design');
    expect(GDD_STANDARD_SECTIONS).toContain('Level Design');
    expect(GDD_STANDARD_SECTIONS).toContain('UI/UX');
    expect(GDD_STANDARD_SECTIONS).toContain('Technical Requirements');
  });
});

// ---------------------------------------------------------------------------
// generateGDD (integration — mocked fetchAI)
// ---------------------------------------------------------------------------

describe('generateGDD', () => {
  const mockGDD: GameDesignDocument = {
    title: 'Star Castle',
    genre: 'Platformer',
    summary: 'Collect stars in a haunted castle.',
    sections: GDD_STANDARD_SECTIONS.map((s) => ({ title: s, content: `${s} content` })),
    mechanics: ['jumping', 'collecting'],
    artStyle: 'pixel art',
    targetPlatform: 'web',
    estimatedScope: 'small',
  };

  let fetchAIMock: ReturnType<typeof vi.fn>;

  beforeEach(async () => {
    vi.resetAllMocks();
    const client = await import('@/lib/ai/client');
    fetchAIMock = vi.mocked(client.fetchAI);
  });

  it('throws on empty prompt', async () => {
    await expect(generateGDD('')).rejects.toThrow('Game description cannot be empty');
  });

  it('throws on whitespace-only prompt', async () => {
    await expect(generateGDD('   ')).rejects.toThrow('Game description cannot be empty');
  });

  it('throws on non-ok response', async () => {
    fetchAIMock.mockRejectedValue(new Error('Rate limit reached — please wait a moment and try again.'));
    await expect(generateGDD('a game')).rejects.toThrow(/rate limit/i);
  });

  it('throws on empty AI response', async () => {
    fetchAIMock.mockResolvedValue('');
    await expect(generateGDD('a game')).rejects.toThrow('AI returned an empty response');
  });

  it('parses a valid streamed GDD response', async () => {
    fetchAIMock.mockResolvedValue(JSON.stringify(mockGDD));

    const result = await generateGDD('a platformer in a haunted castle');
    expect(result.title).toBe('Star Castle');
    expect(result.genre).toBe('Platformer');
    expect(result.mechanics).toEqual(['jumping', 'collecting']);
  });

  it('sends correct request body', async () => {
    fetchAIMock.mockResolvedValue(JSON.stringify(mockGDD));

    await generateGDD('a puzzle game', { genre: 'Puzzle', scope: 'small' });

<<<<<<< HEAD
    expect(fetchAIMock).toHaveBeenCalledOnce();
    const [prompt, options] = fetchAIMock.mock.calls[0] as [string, Record<string, unknown>];
    expect(prompt).toContain('Game idea: a puzzle game');
    expect(prompt).toContain('Genre preference: Puzzle');
    expect(prompt).toContain('Target scope: small');
    expect(options.systemOverride).toBeDefined();
=======
    expect(fetchSpy).toHaveBeenCalledOnce();
    const body = JSON.parse(fetchSpy.mock.calls[0][1]!.body as string);
    expect(body.messages[0].content).toContain('Game idea: a puzzle game');
    expect(body.messages[0].content).toContain('Genre preference: Puzzle');
    expect(body.messages[0].content).toContain('Target scope: small');
    expect(body.systemOverride).not.toBeUndefined();
>>>>>>> origin/fix/remaining-audit-gaps-push
  });

  it('handles error event in SSE stream', async () => {
    fetchAIMock.mockRejectedValue(new Error('Token limit exceeded'));

    await expect(generateGDD('a game')).rejects.toThrow('Token limit exceeded');
  });
});
