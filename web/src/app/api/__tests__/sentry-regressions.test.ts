/**
 * Sentry regression tests — cover exact failure modes discovered by Sentry Seer.
 *
 * Each test is named after the PR that introduced the bug and the specific
 * failure class. These are lightweight structural assertions that add <2s
 * to the test suite.
 *
 * @see https://github.com/Tristan578/project-forge/issues/7836
 */
import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync } from 'fs';
import { join } from 'path';

const GENERATE_DIR = join(__dirname, '..', 'generate');

/**
 * #1 — PR #6887: voice/batch route missing maxDuration.
 * All /api/generate/* routes make AI provider calls that take 15-60s.
 * Without `export const maxDuration`, Vercel kills at 10s default.
 *
 * Exception: refund/route.ts does NOT make AI calls (no maxDuration needed).
 */
describe('Regression #1: maxDuration on all generate routes', () => {
  // refund route doesn't make AI calls (no maxDuration needed)
  const EXEMPT_ROUTES = new Set(['refund']);

  it('every generate route exports maxDuration', () => {
    const dirs = readdirSync(GENERATE_DIR, { withFileTypes: true })
      .filter((d) => d.isDirectory())
      .map((d) => d.name);

    const missing: string[] = [];

    for (const dir of dirs) {
      if (EXEMPT_ROUTES.has(dir)) continue;

      const routeFile = join(GENERATE_DIR, dir, 'route.ts');
      try {
        const content = readFileSync(routeFile, 'utf-8');
        if (!content.includes('export const maxDuration')) {
          missing.push(`generate/${dir}/route.ts`);
        }
      } catch {
        // Directory without route.ts (e.g. has only a batch/ subdir)
      }

      // Also check batch routes
      const batchFile = join(GENERATE_DIR, dir, 'batch', 'route.ts');
      try {
        const content = readFileSync(batchFile, 'utf-8');
        if (!content.includes('export const maxDuration')) {
          missing.push(`generate/${dir}/batch/route.ts`);
        }
      } catch {
        // No batch route — OK
      }
    }

    expect(missing, `Routes missing maxDuration: ${missing.join(', ')}`).toEqual([]);
  });
});

/**
 * #2 — PR #6888: Double refund (server auto-refund + client usageId).
 * When server-side refund is configured, success responses should NOT
 * include usageId — otherwise the client also refunds, causing double credit.
 *
 * We verify this structurally: if a route calls refundTokens in its catch
 * block, it should NOT include usageId in success responses.
 */
describe('Regression #2: no double-refund via usageId leak', () => {
  it('routes with server-side refund do not leak usageId in success JSON', () => {
    // refund/route.ts is the refund endpoint itself — exempt
    const EXEMPT = new Set(['refund']);
    const dirs = readdirSync(GENERATE_DIR, { withFileTypes: true })
      .filter((d) => d.isDirectory() && !EXEMPT.has(d.name))
      .map((d) => d.name);

    const violations: string[] = [];

    for (const dir of dirs) {
      const routeFile = join(GENERATE_DIR, dir, 'route.ts');
      try {
        const content = readFileSync(routeFile, 'utf-8');
        const hasServerRefund = content.includes('refundTokens(');
        // Check if usageId appears as an actual property in NextResponse.json.
        // Must match `usageId,` or `usageId:` on the same line — NOT in comments.
        const lines = content.split('\n');
        let inJsonResponse = false;
        let hasUsageIdInResponse = false;
        for (const line of lines) {
          const trimmed = line.trim();
          if (trimmed.startsWith('//')) continue; // Skip comment lines
          if (trimmed.includes('NextResponse.json(')) inJsonResponse = true;
          if (inJsonResponse && /\busageId\b/.test(trimmed) && !trimmed.startsWith('//')) {
            hasUsageIdInResponse = true;
            break;
          }
          if (inJsonResponse && trimmed.includes(');')) inJsonResponse = false;
        }

        if (hasServerRefund && hasUsageIdInResponse) {
          violations.push(`generate/${dir}/route.ts — has refundTokens() AND exposes usageId in response`);
        }
      } catch {
        // No route file
      }
    }

    expect(violations, `Double-refund risk: ${violations.join(', ')}`).toEqual([]);
  });
});

/**
 * #3 — PR #6889: Race condition in Upstash singleton init.
 * Concurrent calls to getUpstashLimiter must return the same instance.
 * Already fixed via promise-lock pattern — this test verifies the module
 * export surface.
 */
describe('Regression #3: rateLimit module exports', () => {
  it('exports rateLimit as an async function', async () => {
    const mod = await import('@/lib/rateLimit');
    expect(typeof mod.rateLimit).toBe('function');
  });

  it('exports distributedRateLimit as an async function', async () => {
    const mod = await import('@/lib/rateLimit/distributed');
    expect(typeof mod.distributedRateLimit).toBe('function');
  });
});

/**
 * #4 — PR #6886: Iterating sceneGraph instead of sceneGraph.nodes.
 * SceneGraph is an object with a .nodes property. Direct iteration fails.
 * Check that no source file does `sceneGraph.forEach` or `sceneGraph.map`.
 */
describe('Regression #4: sceneGraph.nodes not sceneGraph', () => {
  it('no source file iterates sceneGraph directly (must use .nodes)', () => {
    const SRC_DIR = join(__dirname, '..', '..', '..', 'lib', 'chat', 'handlers');
    const violations: string[] = [];

    try {
      const files = readdirSync(SRC_DIR).filter((f) => f.endsWith('.ts') && !f.endsWith('.test.ts'));
      for (const file of files) {
        const content = readFileSync(join(SRC_DIR, file), 'utf-8');
        // Match sceneGraph.forEach, sceneGraph.map, sceneGraph.filter
        // but NOT sceneGraph.nodes.forEach etc.
        if (/sceneGraph\.(forEach|map|filter|find|some|every|reduce)\(/.test(content)) {
          violations.push(file);
        }
      }
    } catch {
      // Directory doesn't exist — skip
    }

    expect(violations, `Files iterating sceneGraph directly: ${violations.join(', ')}`).toEqual([]);
  });
});

/**
 * #5 — PR #6884: Non-uniform shuffle using sort with random comparator.
 * Array.sort(() => Math.random() - 0.5) produces biased results.
 * Check that no source file uses this anti-pattern.
 */
describe('Regression #5: no biased shuffle via sort+random', () => {
  it('no source file uses sort(() => Math.random())', () => {
    const LIB_DIR = join(__dirname, '..', '..', '..', 'lib');
    const violations: string[] = [];

    function scanDir(dir: string) {
      try {
        const entries = readdirSync(dir, { withFileTypes: true });
        for (const entry of entries) {
          const fullPath = join(dir, entry.name);
          if (entry.isDirectory() && !entry.name.startsWith('__')) {
            scanDir(fullPath);
          } else if (entry.name.endsWith('.ts') && !entry.name.endsWith('.test.ts')) {
            const content = readFileSync(fullPath, 'utf-8');
            if (/\.sort\(\s*\(\s*\)\s*=>\s*Math\.random\(\)/.test(content)) {
              violations.push(fullPath.replace(LIB_DIR + '/', ''));
            }
          }
        }
      } catch {
        // Skip inaccessible directories
      }
    }

    scanDir(LIB_DIR);
    expect(violations, `Biased shuffle: ${violations.join(', ')}`).toEqual([]);
  });
});

/**
 * #6 — PR #6882: SSE stream parsed as response.json().
 * AI modules using streaming must NOT call .json() on the response —
 * streaming responses return ReadableStream, not JSON.
 * Check that generate routes with streaming don't have .json() on the AI response.
 */
describe('Regression #6: streaming responses not parsed as JSON', () => {
  it('generate routes using streamText do not call .json() on the result', () => {
    const dirs = readdirSync(GENERATE_DIR, { withFileTypes: true })
      .filter((d) => d.isDirectory())
      .map((d) => d.name);

    const violations: string[] = [];

    for (const dir of dirs) {
      const routeFile = join(GENERATE_DIR, dir, 'route.ts');
      try {
        const content = readFileSync(routeFile, 'utf-8');
        const usesStreaming = content.includes('streamText') || content.includes('StreamingTextResponse');
        const callsJson = /result\.(json|text)\(\)/.test(content);

        if (usesStreaming && callsJson) {
          violations.push(`generate/${dir}/route.ts — uses streaming but calls .json()/.text() on result`);
        }
      } catch {
        // No route file
      }
    }

    expect(violations, `Stream/JSON mismatch: ${violations.join(', ')}`).toEqual([]);
  });
});
