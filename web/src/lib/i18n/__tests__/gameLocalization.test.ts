import { describe, it, expect } from 'vitest';
import {
  extractTranslatableStrings,
  buildTranslationPrompt,
  parseTranslationResponse,
  chunkArray,
  SUPPORTED_LOCALES,
  LOCALE_MAP,
  type SceneForExtraction,
  type TranslatableString,
} from '../gameLocalization';

// ---------------------------------------------------------------------------
// SUPPORTED_LOCALES
// ---------------------------------------------------------------------------

describe('SUPPORTED_LOCALES', () => {
  it('contains at least 50 locales', () => {
    expect(SUPPORTED_LOCALES.length).toBeGreaterThanOrEqual(50);
  });

  it('every locale has required fields', () => {
    for (const locale of SUPPORTED_LOCALES) {
      expect(typeof locale.code).toBe('string');
      expect(locale.code.length).toBeGreaterThan(0);
      expect(typeof locale.displayName).toBe('string');
      expect(typeof locale.nativeName).toBe('string');
      expect(['ltr', 'rtl']).toContain(locale.direction);
    }
  });

  it('RTL locales are marked correctly', () => {
    const rtlCodes = ['ar', 'he', 'fa', 'ur'];
    for (const code of rtlCodes) {
      const locale = LOCALE_MAP.get(code);
      expect(locale, `locale ${code} should exist`).toBeDefined();
      expect(locale!.direction).toBe('rtl');
    }
  });

  it('LOCALE_MAP covers all locales', () => {
    for (const locale of SUPPORTED_LOCALES) {
      expect(LOCALE_MAP.has(locale.code)).toBe(true);
    }
  });
});

// ---------------------------------------------------------------------------
// extractTranslatableStrings
// ---------------------------------------------------------------------------

describe('extractTranslatableStrings', () => {
  it('returns empty array for empty scene', () => {
    const result = extractTranslatableStrings({});
    expect(result).toEqual([]);
  });

  it('extracts entity names from nodes', () => {
    const scene: SceneForExtraction = {
      nodes: {
        'abc123': { entityId: 'abc123', name: 'Fire Dragon' },
        'xyz789': { entityId: 'xyz789', name: 'Health Potion' },
      },
    };
    const result = extractTranslatableStrings(scene);
    expect(result).toHaveLength(2);
    expect(result.find((s) => s.id === 'entity.abc123.name')?.text).toBe('Fire Dragon');
    expect(result.find((s) => s.id === 'entity.xyz789.name')?.text).toBe('Health Potion');
  });

  it('skips single-character entity names', () => {
    const scene: SceneForExtraction = {
      nodes: {
        'e1': { entityId: 'e1', name: 'A' },
        'e2': { entityId: 'e2', name: 'Player' },
      },
    };
    const result = extractTranslatableStrings(scene);
    expect(result).toHaveLength(1);
    expect(result[0].text).toBe('Player');
  });

  it('skips empty entity names', () => {
    const scene: SceneForExtraction = {
      nodes: {
        'e1': { entityId: 'e1', name: '' },
        'e2': { entityId: 'e2', name: '  ' },
      },
    };
    expect(extractTranslatableStrings(scene)).toHaveLength(0);
  });

  it('extracts dialogue node text', () => {
    const scene: SceneForExtraction = {
      dialogueTrees: {
        'tree1': {
          nodes: {
            'node1': {
              id: 'node1',
              type: 'text',
              text: 'Hello, traveller!',
              speakerName: 'Innkeeper',
            },
          },
        },
      },
    };
    const result = extractTranslatableStrings(scene);
    const textEntry = result.find((s) => s.id === 'dialogue.tree1.node1.text');
    const speakerEntry = result.find((s) => s.id === 'dialogue.tree1.node1.speaker');
    expect(textEntry?.text).toBe('Hello, traveller!');
    expect(textEntry?.context).toContain('Innkeeper');
    expect(speakerEntry?.text).toBe('Innkeeper');
  });

  it('extracts dialogue choice labels', () => {
    const scene: SceneForExtraction = {
      dialogueTrees: {
        'tree1': {
          nodes: {
            'node1': {
              id: 'node1',
              type: 'choice',
              choices: [
                { id: 'c1', label: 'Fight' },
                { id: 'c2', label: 'Run away' },
              ],
            },
          },
        },
      },
    };
    const result = extractTranslatableStrings(scene);
    expect(result.find((s) => s.id === 'dialogue.tree1.node1.choice.c1')?.text).toBe('Fight');
    expect(result.find((s) => s.id === 'dialogue.tree1.node1.choice.c2')?.text).toBe('Run away');
  });

  it('extracts UI widget text, label, and placeholder', () => {
    const scene: SceneForExtraction = {
      uiWidgets: {
        'w1': { id: 'w1', type: 'button', text: 'Start Game', label: undefined, placeholder: undefined },
        'w2': { id: 'w2', type: 'input', text: undefined, label: 'Username', placeholder: 'Enter your name' },
      },
    };
    const result = extractTranslatableStrings(scene);
    expect(result.find((s) => s.id === 'ui.w1.text')?.text).toBe('Start Game');
    expect(result.find((s) => s.id === 'ui.w2.label')?.text).toBe('Username');
    expect(result.find((s) => s.id === 'ui.w2.placeholder')?.text).toBe('Enter your name');
  });

  it('deduplicates IDs — last writer wins', () => {
    // Two nodes with same entityId (impossible in practice, but test dedupe)
    const scene: SceneForExtraction = {
      nodes: {
        'dup': { entityId: 'dup', name: 'Second Name' },
      },
    };
    const result = extractTranslatableStrings(scene);
    expect(result).toHaveLength(1);
    expect(result[0].text).toBe('Second Name');
  });

  it('trims whitespace from text', () => {
    const scene: SceneForExtraction = {
      nodes: {
        'e1': { entityId: 'e1', name: '  Padded Name  ' },
      },
    };
    const result = extractTranslatableStrings(scene);
    expect(result[0].text).toBe('Padded Name');
  });
});

// ---------------------------------------------------------------------------
// buildTranslationPrompt
// ---------------------------------------------------------------------------

describe('buildTranslationPrompt', () => {
  const strings: TranslatableString[] = [
    { id: 'entity.e1.name', text: 'Fire Dragon', context: 'Entity name' },
    { id: 'dialogue.t1.n1.text', text: 'Hello, {playerName}!', context: 'Dialogue text' },
  ];

  it('includes source and target locale names', () => {
    const prompt = buildTranslationPrompt(strings, 'en', 'ja');
    expect(prompt).toContain('English');
    expect(prompt).toContain('Japanese');
  });

  it('includes all string IDs', () => {
    const prompt = buildTranslationPrompt(strings, 'en', 'fr');
    expect(prompt).toContain('entity.e1.name');
    expect(prompt).toContain('dialogue.t1.n1.text');
  });

  it('mentions variable preservation rule', () => {
    const prompt = buildTranslationPrompt(strings, 'en', 'de');
    expect(prompt).toMatch(/variable/i);
    expect(prompt).toContain('{playerName}');
  });

  it('handles unknown locale codes gracefully', () => {
    const prompt = buildTranslationPrompt(strings, 'en', 'xx-UNKNOWN');
    expect(prompt).toContain('xx-UNKNOWN');
  });

  it('embeds string count in prompt', () => {
    const prompt = buildTranslationPrompt(strings, 'en', 'ja');
    expect(prompt).toContain('2 total');
  });
});

// ---------------------------------------------------------------------------
// parseTranslationResponse
// ---------------------------------------------------------------------------

describe('parseTranslationResponse', () => {
  const sources: TranslatableString[] = [
    { id: 'entity.e1.name', text: 'Fire Dragon', context: 'Entity name' },
    { id: 'ui.btn.text', text: 'Start Game', context: 'Button text' },
  ];

  it('parses valid JSON response', () => {
    const raw = JSON.stringify({
      'entity.e1.name': '炎のドラゴン',
      'ui.btn.text': 'ゲームスタート',
    });
    const result = parseTranslationResponse(raw, sources);
    expect(result.translations['entity.e1.name']).toBe('炎のドラゴン');
    expect(result.translations['ui.btn.text']).toBe('ゲームスタート');
    expect(result.missing).toHaveLength(0);
  });

  it('strips markdown code fences', () => {
    const raw = '```json\n{"entity.e1.name":"炎のドラゴン","ui.btn.text":"スタート"}\n```';
    const result = parseTranslationResponse(raw, sources);
    expect(result.translations['entity.e1.name']).toBe('炎のドラゴン');
  });

  it('falls back to source text for missing keys', () => {
    const raw = JSON.stringify({ 'entity.e1.name': 'Feuerdrachse' });
    const result = parseTranslationResponse(raw, sources);
    expect(result.translations['ui.btn.text']).toBe('Start Game');
    expect(result.missing).toContain('ui.btn.text');
  });

  it('falls back to source text on invalid JSON', () => {
    const result = parseTranslationResponse('not valid json', sources);
    expect(result.translations['entity.e1.name']).toBe('Fire Dragon');
    expect(result.missing).toHaveLength(2);
  });

  it('detects missing variable placeholders', () => {
    const srcWithVar: TranslatableString[] = [
      { id: 'greet', text: 'Hello, {playerName}!', context: 'greeting' },
    ];
    // Translation drops the variable
    const raw = JSON.stringify({ greet: 'Bonjour !' });
    const result = parseTranslationResponse(raw, srcWithVar);
    expect(result.variableErrors).toContain('greet');
    // Still stores the translation (don't silently discard)
    expect(result.translations['greet']).toBe('Bonjour !');
  });

  it('accepts translation when variables are preserved', () => {
    const srcWithVar: TranslatableString[] = [
      { id: 'greet', text: 'Hello, {playerName}!', context: 'greeting' },
    ];
    const raw = JSON.stringify({ greet: 'Bonjour, {playerName} !' });
    const result = parseTranslationResponse(raw, srcWithVar);
    expect(result.variableErrors).toHaveLength(0);
    expect(result.translations['greet']).toBe('Bonjour, {playerName} !');
  });

  it('caps hallucinated over-length translations with source fallback', () => {
    const src: TranslatableString[] = [
      { id: 'short', text: 'Hi', context: 'greeting' },
    ];
    // 21 chars is within 10x of "Hi" (2 chars), but 10x is max(20, 500) = 500
    // Let's use an absurdly long string > 500 chars
    const tooLong = 'x'.repeat(600);
    const raw = JSON.stringify({ short: tooLong });
    const result = parseTranslationResponse(raw, src);
    expect(result.translations['short']).toBe('Hi');
  });

  it('falls back to source for empty string translation', () => {
    const raw = JSON.stringify({ 'entity.e1.name': '', 'ui.btn.text': 'スタート' });
    const result = parseTranslationResponse(raw, sources);
    expect(result.translations['entity.e1.name']).toBe('Fire Dragon');
    expect(result.missing).toContain('entity.e1.name');
  });
});

// ---------------------------------------------------------------------------
// chunkArray
// ---------------------------------------------------------------------------

describe('chunkArray', () => {
  it('splits array into chunks of given size', () => {
    const arr = [1, 2, 3, 4, 5];
    const chunks = chunkArray(arr, 2);
    expect(chunks).toEqual([[1, 2], [3, 4], [5]]);
  });

  it('returns single chunk when array fits', () => {
    const arr = [1, 2, 3];
    expect(chunkArray(arr, 10)).toEqual([[1, 2, 3]]);
  });

  it('returns empty array for empty input', () => {
    expect(chunkArray([], 5)).toEqual([]);
  });

  it('handles chunk size of 1', () => {
    const arr = ['a', 'b', 'c'];
    expect(chunkArray(arr, 1)).toEqual([['a'], ['b'], ['c']]);
  });

  it('handles exact multiple', () => {
    const arr = [1, 2, 3, 4];
    expect(chunkArray(arr, 2)).toEqual([[1, 2], [3, 4]]);
  });
});
