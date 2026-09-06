/**
 * @vitest-environment node
 *
 * Is every route handler wrapped in `withEgressGuard`?
 *
 * This is the enforcement half of the #9736 control, and it is deliberately a
 * SHAPE check rather than a dataflow one.
 *
 * Three review-board passes proved that asking a static rule "can the caught
 * error reach a client?" is not answerable over an open-ended language: each
 * pass closed the shapes the previous one found, and each next pass found more,
 * ending with one-line bypasses (`const sink = cache; sink.set(...)`, a hoisted
 * `function detail()`, a tagged template). The runtime guard moved the property
 * off that question entirely — however the body was assembled, it passes
 * through one function on its way out.
 *
 * What is left to enforce is a question a parser CAN answer with certainty:
 * "is the exported `GET` the result of calling `withEgressGuard`?" A route that
 * forgets the wrapper is simply named here, by path and method.
 *
 * Read through the TypeScript parser, not a regex: a text scan would be fooled
 * by the identifier appearing in a comment or a string, and the exact shape of
 * the export is the whole property.
 *
 * FAILS CLOSED ON ZERO. A walk that matches nothing passes vacuously and reads
 * as coverage (lessons-learned #9), so the file count and the method count are
 * both asserted to be non-trivial, and the analyser is separately proven able
 * to REPORT — a check that cannot fail is worse than no check (#11).
 *
 * WHAT THIS DOES NOT PROVE. That the guard redacts anything: that is
 * `src/lib/security/__tests__/egressGuard.test.ts`, which drives real leaking
 * handlers through it and asserts on the SERIALIZED response.
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';

const WEB_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../..');
const APP = path.join(WEB_ROOT, 'src', 'app');

/** Exactly the names Next.js treats as route handler exports. */
const HTTP_METHODS = new Set(['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS']);

const GUARD = 'withEgressGuard';

interface MethodExport {
  method: string;
  wrapped: boolean;
  /** How it is exported, for the failure message. */
  shape: string;
}

/**
 * Every HTTP method this module exports, and whether the export is a
 * `withEgressGuard(...)` call. Exported-and-not-a-guard-call is the failure;
 * a method that is not exported at all is not a route handler and is ignored.
 */
export function analyseRouteModule(source: string, fileName = 'route.ts'): MethodExport[] {
  const sf = ts.createSourceFile(fileName, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  const out: MethodExport[] = [];

  const isExported = (node: ts.Node): boolean =>
    ts.canHaveModifiers(node)
    && (ts.getModifiers(node) ?? []).some((m) => m.kind === ts.SyntaxKind.ExportKeyword);

  for (const statement of sf.statements) {
    if (ts.isFunctionDeclaration(statement) && statement.name && isExported(statement)) {
      if (HTTP_METHODS.has(statement.name.text)) {
        out.push({ method: statement.name.text, wrapped: false, shape: 'exported function declaration' });
      }
      continue;
    }

    if (ts.isVariableStatement(statement) && isExported(statement)) {
      for (const decl of statement.declarationList.declarations) {
        if (!ts.isIdentifier(decl.name) || !HTTP_METHODS.has(decl.name.text)) continue;
        const init = decl.initializer;
        const wrapped = !!init
          && ts.isCallExpression(init)
          && ts.isIdentifier(init.expression)
          && init.expression.text === GUARD;
        out.push({
          method: decl.name.text,
          wrapped,
          shape: wrapped ? `${GUARD}(...)` : 'exported const, not a withEgressGuard(...) call',
        });
      }
      continue;
    }

    // `export { handler as GET }` — a re-export bypasses the wrapper just as
    // effectively as an unwrapped const, so it is a violation unless the alias
    // resolves to a guard call, which this analyser deliberately does not try
    // to prove.
    if (ts.isExportDeclaration(statement) && statement.exportClause && ts.isNamedExports(statement.exportClause)) {
      for (const spec of statement.exportClause.elements) {
        if (HTTP_METHODS.has(spec.name.text)) {
          out.push({ method: spec.name.text, wrapped: false, shape: 'named re-export' });
        }
      }
    }
  }

  return out;
}

function findRouteFiles(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = path.join(dir, entry);
    if (statSync(full).isDirectory()) {
      if (entry === 'node_modules' || entry === '__tests__') continue;
      findRouteFiles(full, out);
    } else if (entry === 'route.ts') {
      out.push(full);
    }
  }
  return out;
}

const rel = (file: string): string => path.relative(WEB_ROOT, file).split(path.sep).join('/');

describe('withEgressGuard coverage', () => {
  const routeFiles = findRouteFiles(APP);
  const analysed = routeFiles.map((file) => ({
    file: rel(file),
    methods: analyseRouteModule(readFileSync(file, 'utf8'), file),
  }));

  it('finds route handlers to check at all', () => {
    // Fail closed on zero. If the walk stops matching, that is the walk
    // breaking, not the codebase losing its API.
    expect(routeFiles.length).toBeGreaterThan(90);
    const methodCount = analysed.reduce((n, r) => n + r.methods.length, 0);
    expect(methodCount).toBeGreaterThan(100);
  });

  it('exports at least one HTTP method from every route.ts', () => {
    // A route file whose handler the analyser cannot see would otherwise pass
    // the wrapper check vacuously.
    const empty = analysed.filter((r) => r.methods.length === 0).map((r) => r.file);
    expect(empty, 'route.ts files with no HTTP method export the analyser can see').toEqual([]);
  });

  it('wraps every exported HTTP method in withEgressGuard', () => {
    const unwrapped = analysed.flatMap((r) =>
      r.methods.filter((m) => !m.wrapped).map((m) => `${r.file} -> ${m.method} (${m.shape})`),
    );
    expect(
      unwrapped,
      `${unwrapped.length} route handler(s) return responses that do not pass through the egress `
      + 'guard. Wrap them: `async function handleGET(...) {...}` + '
      + '`export const GET = withEgressGuard(handleGET);` — see src/lib/security/egressGuard.ts.',
    ).toEqual([]);
  });

  it('reports an unwrapped handler, in each shape it can take', () => {
    // The assertion above is only worth anything if a violation is reachable.
    // These are the four spellings a route can use to export a handler.
    expect(analyseRouteModule('export async function GET() { return new Response("x"); }'))
      .toEqual([{ method: 'GET', wrapped: false, shape: 'exported function declaration' }]);
    expect(analyseRouteModule('export const POST = handler;'))
      .toEqual([{ method: 'POST', wrapped: false, shape: 'exported const, not a withEgressGuard(...) call' }]);
    expect(analyseRouteModule('export const DELETE = somethingElse(handler);'))
      .toEqual([{ method: 'DELETE', wrapped: false, shape: 'exported const, not a withEgressGuard(...) call' }]);
    expect(analyseRouteModule('const h = 1; export { h as PATCH };'))
      .toEqual([{ method: 'PATCH', wrapped: false, shape: 'named re-export' }]);
    // ...and accepts the wrapped shape, so it is not simply reporting everything.
    expect(analyseRouteModule('export const GET = withEgressGuard(handleGET);'))
      .toEqual([{ method: 'GET', wrapped: true, shape: 'withEgressGuard(...)' }]);
    // A non-handler export is not a route handler and must not be reported.
    expect(analyseRouteModule("export const dynamic = 'force-dynamic';")).toEqual([]);
  });
});
