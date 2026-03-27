import { describe, it, expect } from 'vitest';
import {
  BUILT_IN_TEMPLATES,
  PROMPT_CATEGORIES,
  fillTemplate,
  searchTemplates,
  filterByCategory,
  type PromptTemplate,
  type PromptCategory,
} from '@/data/promptTemplates';

describe('promptTemplates data', () => {
  it('has at least 10 built-in templates', () => {
    expect(BUILT_IN_TEMPLATES.length).toBeGreaterThanOrEqual(10);
  });

  it('every template has required fields', () => {
    for (const t of BUILT_IN_TEMPLATES) {
      expect(t.id).not.toBe('');
      expect(t.name).not.toBe('');
      expect(t.description).not.toBe('');
      expect(t.prompt).not.toBe('');
      expect(t.category).not.toBe('');
      expect(Array.isArray(t.variables)).toBe(true);
      expect(Array.isArray(t.tags)).toBe(true);
      expect(t.tags.length).toBeGreaterThan(0);
    }
  });

  it('all template IDs are unique', () => {
    const ids = BUILT_IN_TEMPLATES.map((t) => t.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('all template categories are valid', () => {
    const validCategories = Object.keys(PROMPT_CATEGORIES);
    for (const t of BUILT_IN_TEMPLATES) {
      expect(validCategories).toContain(t.category);
    }
  });

  it('every variable in a template has a matching placeholder in the prompt', () => {
    for (const t of BUILT_IN_TEMPLATES) {
      for (const v of t.variables) {
        expect(t.prompt).toContain(`{{${v.name}}}`);
      }
    }
  });

  it('select variables have options defined', () => {
    for (const t of BUILT_IN_TEMPLATES) {
      for (const v of t.variables) {
        if (v.type === 'select') {
          expect(v.options).toBeDefined();
          expect(v.options!.length).toBeGreaterThan(0);
        }
      }
    }
  });

  it('PROMPT_CATEGORIES has labels for all categories', () => {
    const cats: PromptCategory[] = [
      'scene-setup', 'entity-creation', 'materials', 'physics',
      'scripting', 'lighting', 'animation', 'optimization', 'gameplay',
    ];
    for (const c of cats) {
      expect(PROMPT_CATEGORIES[c]).toBeDefined();
      expect(PROMPT_CATEGORIES[c].label).not.toBe('');
      expect(PROMPT_CATEGORIES[c].description).not.toBe('');
    }
  });
});

describe('fillTemplate', () => {
  it('replaces single variable', () => {
    const result = fillTemplate('Hello {{name}}!', { name: 'World' });
    expect(result).toBe('Hello World!');
  });

  it('replaces multiple variables', () => {
    const result = fillTemplate('{{a}} and {{b}}', { a: 'X', b: 'Y' });
    expect(result).toBe('X and Y');
  });

  it('replaces repeated occurrences', () => {
    const result = fillTemplate('{{x}} {{x}} {{x}}', { x: 'hi' });
    expect(result).toBe('hi hi hi');
  });

  it('leaves unknown placeholders unchanged', () => {
    const result = fillTemplate('{{known}} {{unknown}}', { known: 'A' });
    expect(result).toBe('A {{unknown}}');
  });

  it('handles empty values map', () => {
    const result = fillTemplate('{{x}}', {});
    expect(result).toBe('{{x}}');
  });

  it('handles regex metacharacters in keys safely', () => {
    const result = fillTemplate('{{a.b}} and {{c+d}}', { 'a.b': 'X', 'c+d': 'Y' });
    expect(result).toBe('X and Y');
  });

  it('handles $ replacement tokens in values safely', () => {
    const result = fillTemplate('Price: {{price}}', { price: '$100' });
    expect(result).toBe('Price: $100');
  });

  it('works with real template', () => {
    const template = BUILT_IN_TEMPLATES.find((t) => t.id === 'scene-basic-3d')!;
    const result = fillTemplate(template.prompt, { groundSize: 'medium' });
    expect(result).toContain('medium');
    expect(result).not.toContain('{{groundSize}}');
  });
});

describe('searchTemplates', () => {
  it('returns all templates for empty query', () => {
    expect(searchTemplates(BUILT_IN_TEMPLATES, '')).toEqual(BUILT_IN_TEMPLATES);
    expect(searchTemplates(BUILT_IN_TEMPLATES, '  ')).toEqual(BUILT_IN_TEMPLATES);
  });

  it('matches by name', () => {
    const results = searchTemplates(BUILT_IN_TEMPLATES, 'Glass');
    expect(results.length).toBeGreaterThan(0);
    expect(results.some((t) => t.id === 'material-glass')).toBe(true);
  });

  it('matches by description', () => {
    const results = searchTemplates(BUILT_IN_TEMPLATES, 'transparent');
    expect(results.length).toBeGreaterThan(0);
  });

  it('matches by tag', () => {
    const results = searchTemplates(BUILT_IN_TEMPLATES, 'beginner');
    expect(results.length).toBeGreaterThan(0);
  });

  it('matches by category name', () => {
    const results = searchTemplates(BUILT_IN_TEMPLATES, 'physics');
    expect(results.length).toBeGreaterThan(0);
  });

  it('case insensitive', () => {
    const results = searchTemplates(BUILT_IN_TEMPLATES, 'GLASS');
    expect(results.length).toBeGreaterThan(0);
  });

  it('returns empty for non-matching query', () => {
    const results = searchTemplates(BUILT_IN_TEMPLATES, 'xyznonexistent');
    expect(results.length).toBe(0);
  });
});

describe('filterByCategory', () => {
  it('returns all templates for null category', () => {
    expect(filterByCategory(BUILT_IN_TEMPLATES, null)).toEqual(BUILT_IN_TEMPLATES);
  });

  it('filters by category correctly', () => {
    const results = filterByCategory(BUILT_IN_TEMPLATES, 'materials');
    expect(results.length).toBeGreaterThan(0);
    expect(results.every((t) => t.category === 'materials')).toBe(true);
  });

  it('returns empty for unused category filter on custom list', () => {
    const templates: PromptTemplate[] = [BUILT_IN_TEMPLATES[0]];
    const cat = templates[0].category === 'physics' ? 'materials' : 'physics';
    const results = filterByCategory(templates, cat as PromptCategory);
    expect(results.length).toBe(0);
  });
});
