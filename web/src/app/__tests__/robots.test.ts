/**
 * Tests for robots.ts metadata API route.
 *
 * @vitest-environment node
 */

import { describe, it, expect } from 'vitest';
import robots from '../robots';

describe('robots', () => {
  it('returns valid robots configuration', () => {
    const result = robots();

    expect(result.rules).toBeDefined();
    expect(Array.isArray(result.rules)).toBe(true);
  });

  it('allows crawling of root path', () => {
    const result = robots();
    const rules = Array.isArray(result.rules) ? result.rules : [result.rules];
    const mainRule = rules[0];

    expect(mainRule.userAgent).toBe('*');
    expect(mainRule.allow).toBe('/');
  });

  it('disallows api, admin, dev, and settings paths', () => {
    const result = robots();
    const rules = Array.isArray(result.rules) ? result.rules : [result.rules];
    const mainRule = rules[0];
    const disallow = mainRule.disallow as string[];

    expect(disallow).toContain('/api/');
    expect(disallow).toContain('/admin/');
    expect(disallow).toContain('/dev/');
    expect(disallow).toContain('/settings/');
  });

  it('includes sitemap URL', () => {
    const result = robots();
    expect(result.sitemap).toContain('/sitemap.xml');
  });

  describe('AI crawler rules', () => {
    const AI_BOTS = ['GPTBot', 'ChatGPT-User', 'Google-Extended', 'ClaudeBot', 'CCBot', 'PerplexityBot', 'Anthropic'];

    it('includes a rule for every expected AI crawler', () => {
      const result = robots();
      const rules = Array.isArray(result.rules) ? result.rules : [result.rules];
      const userAgents = rules.map((r) => r.userAgent);

      for (const bot of AI_BOTS) {
        expect(userAgents).toContain(bot);
      }
    });

    it('allows public content paths for AI crawlers', () => {
      const result = robots();
      const rules = Array.isArray(result.rules) ? result.rules : [result.rules];
      const gptRule = rules.find((r) => r.userAgent === 'GPTBot');

      expect(gptRule).toBeDefined();
      const allowed = gptRule!.allow as string[];
      expect(allowed).toContain('/');
      expect(allowed).toContain('/pricing');
      expect(allowed).toContain('/llms.txt');
      expect(allowed).toContain('/llms-full.txt');
    });

    it('disallows private paths for AI crawlers', () => {
      const result = robots();
      const rules = Array.isArray(result.rules) ? result.rules : [result.rules];
      const gptRule = rules.find((r) => r.userAgent === 'GPTBot');

      expect(gptRule).toBeDefined();
      const disallow = gptRule!.disallow as string[];
      expect(disallow).toContain('/api/');
      expect(disallow).toContain('/admin/');
      expect(disallow).toContain('/dev/');
    });
  });
});
