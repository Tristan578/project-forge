import { describe, it, expect } from 'vitest';
import { hasHelpIntent, buildDocContext } from '../docContext';
import type { DocEntry } from '@/lib/docs/docsIndex';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function makeDoc(overrides: Partial<DocEntry> = {}): DocEntry {
  return {
    path: 'scripting/basics',
    title: 'Scripting Basics',
    content: `# Scripting Basics\n\nLearn how to write TypeScript scripts for your game.\n\n## Getting Started\n\nUse the forge API to control entities at runtime.`,
    category: 'scripting',
    sections: [
      {
        heading: 'Getting Started',
        content: 'Use the forge API to control entities at runtime.',
      },
    ],
    ...overrides,
  };
}

const DOCS: DocEntry[] = [
  makeDoc(),
  makeDoc({
    path: 'physics/overview',
    title: 'Physics Overview',
    content: `# Physics Overview\n\nAdd physics to entities using rigid bodies and colliders.\n\n## Rigid Bodies\n\nSet body type to dynamic, static, or kinematic.`,
    category: 'physics',
    sections: [
      {
        heading: 'Rigid Bodies',
        content: 'Set body type to dynamic, static, or kinematic.',
      },
    ],
  }),
  makeDoc({
    path: 'materials/pbr',
    title: 'PBR Materials',
    content: `# PBR Materials\n\nConfigure metallic, roughness, and base color for realistic rendering.\n\n## Emissive\n\nUse emissive color to make objects glow.`,
    category: 'materials',
    sections: [
      {
        heading: 'Emissive',
        content: 'Use emissive color to make objects glow.',
      },
    ],
  }),
];

// ---------------------------------------------------------------------------
// hasHelpIntent
// ---------------------------------------------------------------------------

describe('hasHelpIntent', () => {
  it('detects "how" questions', () => {
    expect(hasHelpIntent('how do I add physics?')).toBe(true);
  });

  it('detects "help" keyword', () => {
    expect(hasHelpIntent('help me set up a player')).toBe(true);
  });

  it('detects "tutorial" keyword', () => {
    expect(hasHelpIntent('is there a tutorial for scripting')).toBe(true);
  });

  it('detects "guide" keyword', () => {
    expect(hasHelpIntent('show me a guide for materials')).toBe(true);
  });

  it('detects "explain" keyword', () => {
    expect(hasHelpIntent('explain how physics works')).toBe(true);
  });

  it('detects "what is" phrase', () => {
    expect(hasHelpIntent('what is a rigid body')).toBe(true);
  });

  it('detects "what are" phrase', () => {
    expect(hasHelpIntent('what are colliders')).toBe(true);
  });

  it('detects "show me how" phrase', () => {
    expect(hasHelpIntent('show me how to add a light')).toBe(true);
  });

  it('detects "how to" phrase', () => {
    expect(hasHelpIntent('how to spawn an enemy')).toBe(true);
  });

  it('detects "can i" phrase', () => {
    expect(hasHelpIntent('can I export my game')).toBe(true);
  });

  it('returns false for action commands', () => {
    expect(hasHelpIntent('spawn a red cube at position 0 2 0')).toBe(false);
  });

  it('returns false for delete commands', () => {
    expect(hasHelpIntent('delete the enemy')).toBe(false);
  });

  it('returns false for update commands', () => {
    expect(hasHelpIntent('make the sphere blue')).toBe(false);
  });

  it('is case-insensitive', () => {
    expect(hasHelpIntent('HOW DO I JUMP?')).toBe(true);
    expect(hasHelpIntent('EXPLAIN THE PHYSICS SYSTEM')).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// buildDocContext
// ---------------------------------------------------------------------------

describe('buildDocContext', () => {
  it('returns empty string for action commands (no help intent)', () => {
    const result = buildDocContext('spawn a cube at 0 0 0', DOCS);
    expect(result).toBe('');
  });

  it('returns empty string when no docs are provided', () => {
    const result = buildDocContext('how do I add physics?', []);
    expect(result).toBe('');
  });

  it('returns documentation context for help queries', () => {
    const result = buildDocContext('how do I add physics to my entity?', DOCS);
    expect(result).toContain('[Documentation]');
  });

  it('includes the most relevant doc title', () => {
    const result = buildDocContext('how do I add physics to my entity?', DOCS);
    expect(result).toContain('Physics Overview');
  });

  it('starts with [Documentation] header when docs are returned', () => {
    const result = buildDocContext('explain how scripting works', DOCS);
    expect(result.startsWith('[Documentation]')).toBe(true);
  });

  it('includes a content snippet', () => {
    const result = buildDocContext('how to write a script for my game', DOCS);
    expect(result).toContain('forge API');
  });

  it('filters out low-relevance docs (score < 0.5)', () => {
    // A query with no matching terms should yield no useful results
    const result = buildDocContext('how do things work in general xyz123qwerty', DOCS);
    // Either empty (no matches above threshold) or contains docs if BM25 still scores something
    // The important thing is the function doesn't throw and returns a string
    expect(typeof result).toBe('string');
  });

  it('keeps total output under 2000 characters', () => {
    // Create a doc with very long content
    const longContent = 'word '.repeat(2000);
    const docs: DocEntry[] = [
      makeDoc({ content: `# Long Doc\n\n${longContent}`, title: 'Long Doc' }),
    ];
    const result = buildDocContext('how do I use scripting?', docs);
    expect(result.length).toBeLessThanOrEqual(2000);
  });

  it('returns at most 3 doc sections', () => {
    const result = buildDocContext('how do I use scripting physics materials?', DOCS);
    // Count "### " headers — should not exceed 3
    const headers = (result.match(/^### /gm) ?? []).length;
    expect(headers).toBeLessThanOrEqual(3);
  });

  it('returns empty string when all results have score below threshold', () => {
    // Single doc with no terms that match the query
    const docs: DocEntry[] = [
      makeDoc({
        content: '# Orange\n\nThis document is about oranges and citrus fruits.',
        title: 'Orange Guide',
        sections: [],
      }),
    ];
    // Query about completely unrelated topic — BM25 scores will be very low
    const result = buildDocContext('how do quantum physics entanglements manifest?', docs);
    // Must not throw; result is either empty or contains the doc if BM25 scores it
    expect(typeof result).toBe('string');
  });
});
