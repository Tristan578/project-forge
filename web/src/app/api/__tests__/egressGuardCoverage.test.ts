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
const GUARD_MODULE = '@/lib/security/egressGuard';

/**
 * Every filename the App Router accepts as a route handler.
 *
 * The walk used to match `entry === 'route.ts'`. Next.js routes `route.js`,
 * `route.jsx`, `route.mjs` and `route.tsx` identically, so a handler added in
 * any of those four spellings was neither wrapped nor named here — and the
 * fail-closed floors could not notice, because `> 90 files` and `> 100 methods`
 * are satisfied by the existing `.ts` routes however many non-`.ts` routes
 * exist. The gate asserted the filename this repo currently uses rather than the
 * files Next.js will route (lessons-learned #1).
 */
const ROUTE_FILE = /^route\.(?:ts|tsx|js|jsx|mjs)$/;

/**
 * First-party response producers under `src/app` that are NOT route handlers and
 * are NOT wrapped. Pinned as a SET, so a new one is reported here rather than
 * joining a gap nobody restated. See KNOWN GAPS in egressGuard.ts, which names
 * these files explicitly — "any response produced by the framework itself" does
 * not describe them: the framework merely invokes them.
 */
const UNGUARDED_PRODUCERS = /^(?:sitemap|robots|opengraph-image|twitter-image|icon|apple-icon)\.(?:ts|tsx|js|jsx|mjs)$/;

const KNOWN_UNGUARDED_PRODUCERS = [
  'src/app/community/opengraph-image.tsx',
  'src/app/opengraph-image.tsx',
  'src/app/play/[userId]/[slug]/opengraph-image.tsx',
  'src/app/pricing/opengraph-image.tsx',
  'src/app/robots.ts',
  'src/app/sitemap.ts',
];

interface MethodExport {
  method: string;
  wrapped: boolean;
  /** How it is exported, for the failure message. */
  shape: string;
}

/**
 * Does this module import `withEgressGuard` FROM the guard module?
 *
 * Checking the identifier text alone accepts `const withEgressGuard = (h) => h;`
 * or an import of the same name from anywhere — the identical aliasing class
 * that defeated review passes 1-3 (`const R = NextResponse`), reappearing in the
 * half of the design that replaced them. The name has to RESOLVE.
 */
function importsGuard(sf: ts.SourceFile): boolean {
  for (const statement of sf.statements) {
    if (!ts.isImportDeclaration(statement)) continue;
    if (!ts.isStringLiteral(statement.moduleSpecifier)) continue;
    if (statement.moduleSpecifier.text !== GUARD_MODULE) continue;
    const clause = statement.importClause;
    if (!clause?.namedBindings || !ts.isNamedImports(clause.namedBindings)) continue;
    for (const spec of clause.namedBindings.elements) {
      // `import { withEgressGuard }` or `import { withEgressGuard as x }` —
      // the LOCAL name is what a call site writes, so it is the local name that
      // must be GUARD for the call below to mean this function.
      if (spec.name.text === GUARD && (spec.propertyName?.text ?? GUARD) === GUARD) return true;
    }
  }
  return false;
}

/**
 * Does this module DECLARE its own `withEgressGuard`, shadowing the import?
 * A route containing `const withEgressGuard = (h: Handler) => h;` passes an
 * identifier-text check with its responses never touching the chokepoint.
 */
function shadowsGuard(sf: ts.SourceFile): boolean {
  for (const statement of sf.statements) {
    if (ts.isFunctionDeclaration(statement) && statement.name?.text === GUARD) return true;
    if (ts.isVariableStatement(statement)) {
      for (const decl of statement.declarationList.declarations) {
        if (ts.isIdentifier(decl.name) && decl.name.text === GUARD) return true;
      }
    }
  }
  return false;
}

/**
 * Every HTTP method this module exports, and whether the export is a
 * `withEgressGuard(...)` call whose callee resolves to the guard module.
 * Exported-and-not-a-guard-call is the failure; a method that is not exported at
 * all is not a route handler and is ignored.
 */
export function analyseRouteModule(source: string, fileName = 'route.ts'): MethodExport[] {
  const kind = fileName.endsWith('x') ? ts.ScriptKind.TSX : ts.ScriptKind.TS;
  const sf = ts.createSourceFile(fileName, source, ts.ScriptTarget.Latest, true, kind);
  const out: MethodExport[] = [];

  const resolves = importsGuard(sf) && !shadowsGuard(sf);

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
        const called = !!init
          && ts.isCallExpression(init)
          && ts.isIdentifier(init.expression)
          && init.expression.text === GUARD;
        const wrapped = called && resolves;
        out.push({
          method: decl.name.text,
          wrapped,
          shape: wrapped
            ? `${GUARD}(...)`
            : called
              ? `${GUARD}(...) — but the name does not resolve to ${GUARD_MODULE}`
              : `exported const, not a ${GUARD}(...) call`,
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

interface Walk {
  routes: string[];
  producers: string[];
}

function walkApp(dir: string, out: Walk = { routes: [], producers: [] }): Walk {
  for (const entry of readdirSync(dir)) {
    const full = path.join(dir, entry);
    if (statSync(full).isDirectory()) {
      if (entry === 'node_modules' || entry === '__tests__') continue;
      walkApp(full, out);
    } else if (ROUTE_FILE.test(entry)) {
      out.routes.push(full);
    } else if (UNGUARDED_PRODUCERS.test(entry)) {
      out.producers.push(full);
    }
  }
  return out;
}

const rel = (file: string): string => path.relative(WEB_ROOT, file).split(path.sep).join('/');

describe('withEgressGuard coverage', () => {
  const walk = walkApp(APP);
  const routeFiles = walk.routes;
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

  it('sees only route spellings it was built to parse', () => {
    // The floors above cannot notice a new spelling: 100+ `.ts` files satisfy
    // them however many `.tsx` or `.mjs` routes exist. So the discovered
    // extension SET is asserted — an unexpected one fails here instead of being
    // silently skipped or silently mis-parsed.
    const extensions = [...new Set(routeFiles.map((f) => path.extname(f)))].sort();
    expect(extensions).toEqual(['.ts']);
  });

  it('exports at least one HTTP method from every route file', () => {
    // A route file whose handler the analyser cannot see would otherwise pass
    // the wrapper check vacuously.
    const empty = analysed.filter((r) => r.methods.length === 0).map((r) => r.file);
    expect(empty, 'route files with no HTTP method export the analyser can see').toEqual([]);
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

  it('pins the first-party response producers that are NOT guarded', () => {
    // sitemap.ts and the opengraph-image files are application code the
    // framework invokes, not framework-generated responses, so the gap list's
    // old wording invited a reader to infer coverage that does not exist. They
    // are named in egressGuard.ts's KNOWN GAPS and pinned here, so ADDING one is
    // a decision someone makes rather than a silent extension of the gap.
    expect(walk.producers.map(rel).sort()).toEqual(KNOWN_UNGUARDED_PRODUCERS);
  });

  it('reports an unwrapped handler, in each shape it can take', () => {
    // The assertion above is only worth anything if a violation is reachable.
    const imported = `import { ${GUARD} } from '${GUARD_MODULE}';\n`;
    expect(analyseRouteModule('export async function GET() { return new Response("x"); }'))
      .toEqual([{ method: 'GET', wrapped: false, shape: 'exported function declaration' }]);
    expect(analyseRouteModule('export const POST = handler;'))
      .toEqual([{ method: 'POST', wrapped: false, shape: `exported const, not a ${GUARD}(...) call` }]);
    expect(analyseRouteModule('export const DELETE = somethingElse(handler);'))
      .toEqual([{ method: 'DELETE', wrapped: false, shape: `exported const, not a ${GUARD}(...) call` }]);
    expect(analyseRouteModule('const h = 1; export { h as PATCH };'))
      .toEqual([{ method: 'PATCH', wrapped: false, shape: 'named re-export' }]);

    // ...and accepts the wrapped shape, so it is not simply reporting
    // everything. Note the import: the call alone is not enough.
    expect(analyseRouteModule(`${imported}export const GET = ${GUARD}(handleGET);`))
      .toEqual([{ method: 'GET', wrapped: true, shape: `${GUARD}(...)` }]);

    // A non-handler export is not a route handler and must not be reported.
    expect(analyseRouteModule("export const dynamic = 'force-dynamic';")).toEqual([]);
  });

  it('rejects a call whose name does not RESOLVE to the guard module', () => {
    // The aliasing class that defeated three static passes, reappearing in the
    // enforcement half. Each of these reads as wrapped to an identifier-text
    // check and is not.
    const unresolved = `${GUARD}(...) — but the name does not resolve to ${GUARD_MODULE}`;

    // No import at all.
    expect(analyseRouteModule(`export const GET = ${GUARD}(handleGET);`))
      .toEqual([{ method: 'GET', wrapped: false, shape: unresolved }]);

    // A locally-declared shadow.
    expect(analyseRouteModule(
      `import { ${GUARD} as real } from '${GUARD_MODULE}';\n`
      + `const ${GUARD} = (h: unknown) => h;\n`
      + `export const GET = ${GUARD}(handleGET);`,
    )).toEqual([{ method: 'GET', wrapped: false, shape: unresolved }]);

    // The name imported from somewhere else entirely.
    expect(analyseRouteModule(
      `import { ${GUARD} } from './local-helper';\nexport const GET = ${GUARD}(handleGET);`,
    )).toEqual([{ method: 'GET', wrapped: false, shape: unresolved }]);
  });

  it('parses a .tsx route, the spelling the old walk could not see', () => {
    // Not hypothetical for the analyser: TSX changes how `<T,>` and JSX parse,
    // so the file has to be handed to the parser as TSX or it mis-analyses.
    const source =
      `import { ${GUARD} } from '${GUARD_MODULE}';\nexport const GET = ${GUARD}(handleGET);`;
    expect(analyseRouteModule(source, 'route.tsx'))
      .toEqual([{ method: 'GET', wrapped: true, shape: `${GUARD}(...)` }]);
    expect(analyseRouteModule('export const GET = handler;', 'route.tsx'))
      .toEqual([{ method: 'GET', wrapped: false, shape: `exported const, not a ${GUARD}(...) call` }]);
  });
});
