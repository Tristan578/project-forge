import { describe, it, expect } from 'vitest';
import {
  API_KEY_SCOPES,
  DEFAULT_API_KEY_SCOPES,
  SCOPE_DOMAINS,
  SCOPE_VERBS,
  SCOPE_PATTERN,
  isValidScope,
  scope,
  findInvalidScopes,
  type ApiKeyScope,
  type ScopeDomain,
} from '../scopes';

describe('API_KEY_SCOPES', () => {
  it('contains exactly the four canonical scopes', () => {
    expect(API_KEY_SCOPES).toEqual(['scene:read', 'scene:write', 'ai:generate', 'project:manage']);
  });

  it('is readonly (as const)', () => {
    // Verify it is a tuple of string literals, not a mutable array.
    // TypeScript enforces this at compile time; the runtime shape is a plain array.
    expect(Array.isArray(API_KEY_SCOPES)).toBe(true);
  });

  it('every scope matches the SCOPE_PATTERN', () => {
    for (const s of API_KEY_SCOPES) {
      expect(SCOPE_PATTERN.test(s), `"${s}" should match SCOPE_PATTERN`).toBe(true);
    }
  });
});

describe('DEFAULT_API_KEY_SCOPES', () => {
  it('equals API_KEY_SCOPES', () => {
    expect([...DEFAULT_API_KEY_SCOPES]).toEqual([...API_KEY_SCOPES]);
  });
});

describe('SCOPE_DOMAINS', () => {
  it('contains scene, ai, project', () => {
    expect(SCOPE_DOMAINS).toEqual(['scene', 'ai', 'project']);
  });
});

describe('SCOPE_VERBS', () => {
  it('scene domain has read and write verbs', () => {
    expect(SCOPE_VERBS.scene).toContain('read');
    expect(SCOPE_VERBS.scene).toContain('write');
  });

  it('ai domain has generate verb', () => {
    expect(SCOPE_VERBS.ai).toContain('generate');
  });

  it('project domain has manage verb', () => {
    expect(SCOPE_VERBS.project).toContain('manage');
  });

  it('every scope is constructible from domain + verb pairs', () => {
    for (const domain of SCOPE_DOMAINS as unknown as ScopeDomain[]) {
      for (const verb of SCOPE_VERBS[domain]) {
        const candidate = `${domain}:${verb}`;
        expect(API_KEY_SCOPES as readonly string[]).toContain(candidate);
      }
    }
  });
});

describe('SCOPE_PATTERN', () => {
  it('matches valid scope strings', () => {
    expect(SCOPE_PATTERN.test('scene:read')).toBe(true);
    expect(SCOPE_PATTERN.test('ai:generate')).toBe(true);
    expect(SCOPE_PATTERN.test('project:manage')).toBe(true);
    expect(SCOPE_PATTERN.test('foo:bar_baz')).toBe(true);
  });

  it('rejects malformed scope strings', () => {
    expect(SCOPE_PATTERN.test('')).toBe(false);
    expect(SCOPE_PATTERN.test('nocolon')).toBe(false);
    expect(SCOPE_PATTERN.test('has spaces:read')).toBe(false);
    expect(SCOPE_PATTERN.test(':read')).toBe(false);
    expect(SCOPE_PATTERN.test('scene:')).toBe(false);
    expect(SCOPE_PATTERN.test('Scene:Read')).toBe(false); // uppercase not allowed
  });
});

describe('isValidScope', () => {
  it('returns true for every canonical scope', () => {
    for (const s of API_KEY_SCOPES) {
      expect(isValidScope(s), `"${s}" should be valid`).toBe(true);
    }
  });

  it('returns false for unknown scopes', () => {
    expect(isValidScope('scene:delete')).toBe(false);
    expect(isValidScope('admin:all')).toBe(false);
    expect(isValidScope('')).toBe(false);
    expect(isValidScope('random')).toBe(false);
  });

  it('acts as a type guard (narrows to ApiKeyScope)', () => {
    const s: string = 'scene:read';
    if (isValidScope(s)) {
      // If this compiles without error the type guard works.
      const _typed: ApiKeyScope = s;
      expect(_typed).toBe('scene:read');
    } else {
      throw new Error('Expected isValidScope to return true for "scene:read"');
    }
  });
});

describe('scope()', () => {
  it('builds valid scope strings correctly', () => {
    expect(scope('scene', 'read')).toBe('scene:read');
    expect(scope('scene', 'write')).toBe('scene:write');
    expect(scope('ai', 'generate')).toBe('ai:generate');
    expect(scope('project', 'manage')).toBe('project:manage');
  });

  it('throws for unrecognized domain/verb combinations', () => {
    expect(() => scope('scene', 'delete')).toThrow('Invalid scope "scene:delete"');
    expect(() => scope('ai', 'read')).toThrow('Invalid scope "ai:read"');
    expect(() => scope('project', 'write')).toThrow('Invalid scope "project:write"');
  });

  it('error message lists all valid scopes', () => {
    let caught: Error | null = null;
    try {
      scope('scene', 'delete');
    } catch (err) {
      caught = err as Error;
    }
    expect(caught).not.toBeNull();
    for (const s of API_KEY_SCOPES) {
      expect(caught!.message).toContain(s);
    }
  });
});

describe('findInvalidScopes()', () => {
  it('returns empty array when all scopes are valid', () => {
    expect(findInvalidScopes(['scene:read', 'ai:generate'])).toEqual([]);
    expect(findInvalidScopes([...API_KEY_SCOPES])).toEqual([]);
  });

  it('returns only the invalid entries', () => {
    const result = findInvalidScopes(['scene:read', 'scene:delete', 'admin:all', 'ai:generate']);
    expect(result).toEqual(['scene:delete', 'admin:all']);
  });

  it('returns all entries when every scope is invalid', () => {
    const result = findInvalidScopes(['bad:scope', 'another:wrong']);
    expect(result).toEqual(['bad:scope', 'another:wrong']);
  });

  it('handles empty input', () => {
    expect(findInvalidScopes([])).toEqual([]);
  });

  it('handles readonly arrays', () => {
    const readOnly: readonly string[] = ['scene:read', 'invalid'];
    expect(findInvalidScopes(readOnly)).toEqual(['invalid']);
  });
});
