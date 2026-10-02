/**
 * @vitest-environment node
 *
 * Pins the exact values in `vercel.ts` (PF-1060 / #9097). This migration's
 * whole point is that a bad edit fails `tsc --noEmit`; this suite is the
 * runtime half — it fails a mutation to any load-bearing value even though
 * TypeScript would happily accept a different (wrong) string, boolean, or
 * array here.
 *
 * Mutation record — each mutation was applied to `web/vercel.ts` (or the
 * tree), confirmed applied by diff, run against this suite, then restored:
 * - installCommand: dropped `cd .. && `             -> install-command test red
 * - git.deploymentEnabled: false -> true             -> git-deploys test red
 * - framework: 'nextjs' -> 'other'                   -> framework/build test red
 * - buildCommand: 'npm run build' -> 'next build'    -> framework/build test red
 * - outputDirectory: '.next' -> 'out'                -> framework/build test red
 * - regions: ['iad1'] -> ['sfo1']                    -> region test red
 * - cron schedule: every 15 min -> every 5 min       -> cron test red
 * - `import type` -> value `import`                  -> type-only-imports test red
 * - created an empty web/vercel.json                 -> no-vercel.json test red
 */
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';
import { config } from '../../vercel';

/**
 * Every module reference in `web/vercel.ts`, and whether it survives esbuild
 * as a runtime load. Parsed with the TypeScript compiler rather than grepped,
 * so a commented-out line, a string literal or a multi-line import cannot
 * fool it (lessons-learned #16/#18).
 */
function moduleReferences(source: string): { specifier: string; typeOnly: boolean }[] {
  const file = ts.createSourceFile('vercel.ts', source, ts.ScriptTarget.Latest, true);
  const refs: { specifier: string; typeOnly: boolean }[] = [];
  const visit = (node: ts.Node): void => {
    if (ts.isImportDeclaration(node) && ts.isStringLiteral(node.moduleSpecifier)) {
      // A bare `import 'x'` has no clause and always loads at runtime.
      refs.push({
        specifier: node.moduleSpecifier.text,
        typeOnly: node.importClause?.isTypeOnly === true,
      });
    } else if (
      ts.isExportDeclaration(node) &&
      node.moduleSpecifier &&
      ts.isStringLiteral(node.moduleSpecifier)
    ) {
      refs.push({ specifier: node.moduleSpecifier.text, typeOnly: node.isTypeOnly });
    } else if (ts.isImportEqualsDeclaration(node)) {
      refs.push({ specifier: node.moduleReference.getText(file), typeOnly: node.isTypeOnly });
    } else if (
      ts.isCallExpression(node) &&
      (node.expression.kind === ts.SyntaxKind.ImportKeyword ||
        (ts.isIdentifier(node.expression) && node.expression.text === 'require'))
    ) {
      refs.push({ specifier: node.arguments[0]?.getText(file) ?? '', typeOnly: false });
    }
    ts.forEachChild(node, visit);
  };
  visit(file);
  return refs;
}

describe('vercel.ts config', () => {
  it('keeps the single-root-lockfile install command intact', () => {
    // Must reach ABOVE web/ (`cd ..`) because package-lock.json lives at the
    // repo root. Losing "cd .." here breaks every build (see file header).
    expect(config.installCommand).toBe('cd .. && npm ci && npm run build --workspace=packages/ui');
  });

  it('keeps git-triggered deploys disabled', () => {
    // Deploys are driven by cd.yml, not Vercel's own git integration.
    // Losing this starts double-deploying every push.
    expect(config.git).toEqual({ deploymentEnabled: false });
  });

  it('preserves framework, build command, and output directory', () => {
    expect(config.framework).toBe('nextjs');
    expect(config.buildCommand).toBe('npm run build');
    expect(config.outputDirectory).toBe('.next');
  });

  it('keeps the deployment region pinned to iad1', () => {
    expect(config.regions).toEqual(['iad1']);
  });

  it('keeps exactly one health-monitor cron, on its existing schedule', () => {
    expect(config.crons).toEqual([
      {
        path: '/api/cron/health-monitor',
        schedule: '*/15 * * * *',
      },
    ]);
  });

  it('imports nothing at runtime, so it evaluates before any npm install', () => {
    // The Vercel CLI compiles this file on the CD runner (esbuild,
    // `packages: "external"`) before `vercel deploy`, and deploy-staging runs
    // no `npm ci` first. A value import such as `routes` from
    // `@vercel/config/v1` would fail every deploy with "Cannot find package".
    const refs = moduleReferences(readFileSync(join(__dirname, '../../vercel.ts'), 'utf8'));
    // Vacuity guard: the typed `VercelConfig` import must be found, or this
    // walk is inspecting nothing and the assertion below proves nothing.
    expect(refs).toContainEqual({ specifier: '@vercel/config/v1', typeOnly: true });
    expect(refs.filter((r) => !r.typeOnly)).toEqual([]);
  });

  it('does not keep a web/vercel.json beside vercel.ts', () => {
    // Vercel reads exactly ONE project config file (see the vercel.ts
    // header). A vercel.json restored next to it breaks that invariant, and
    // the pins above would no longer establish what a deploy is built with.
    // Vacuity guard: the path must resolve to the directory that holds
    // vercel.ts, or this existence check is looking in the wrong place.
    const webRoot = join(__dirname, '../..');
    expect(existsSync(join(webRoot, 'vercel.ts'))).toBe(true);
    expect(existsSync(join(webRoot, 'vercel.json'))).toBe(false);
  });
});
