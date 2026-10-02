/**
 * @vitest-environment node
 *
 * Does every generation status route that resolves a provider key refuse a
 * poll for a job the caller does not own, BEFORE resolving the key — and does
 * every POST route behind such a status route bind the job id it hands out?
 *
 * This is the structural half of the #10262 control. Each half of the binding
 * is mocked in the other half's tests (`bindProviderJob` in the handler
 * suites, `verifyProviderJobOwner` in every `status/route.test.ts`), so a new
 * status route that skips the check, or a POST route that binds nothing,
 * passes every behavioural test. `resolveApiKey` returns the PLATFORM key for
 * a zero-cost status check, so a missing check is a cross-user read of another
 * person's result with the platform's credentials.
 *
 * A SHAPE check, read through the TypeScript parser (the same approach as
 * `egressGuardCoverage.test.ts`): a text scan would accept the call inside a
 * comment or a string, and the ORDER and the GATING of the call are the whole
 * property. What a status route must contain, in the same function body as
 * every `resolveApiKey(...)` call and ahead of the statement that holds it:
 *
 *   const <o> = await verifyProviderJobOwner(<user>, <provider>, <jobId>);
 *   if (<o> !== 'owner') return <refusal>;
 *
 * - both as TOP-LEVEL statements of that body, so neither can sit in a branch
 *   the key resolution does not share;
 * - `const`, so the verdict cannot be reassigned between check and use;
 * - the comparison is `!== 'owner'` exactly. `=== 'not_owner'` is REJECTED: the
 *   lookup has a third answer (`'unverifiable'`, a failed lookup), and a check
 *   written against the miss rather than the hit lets that one through to the
 *   key — fail-open on a DB error;
 * - the third argument is the id the route polls: a `const` read from
 *   `searchParams.get('jobId')` in the same body;
 * - both names RESOLVE to their modules (an import of the real export, not a
 *   same-named local), the aliasing class that defeated the static passes in
 *   #9736.
 *
 * FAILS CLOSED ON ZERO (lessons-learned #9), and every rule is proven able to
 * REPORT by mutating the REAL route sources in memory and asserting each
 * mutation applied before trusting the red (#11, #16, #18, #19).
 *
 * WHAT THIS DOES NOT PROVE. That the lookup is correct, or that the refusal
 * maps to the right status: those are `src/lib/generate/__tests__/
 * jobOwnership.test.ts`, `jobOwnershipResponse.test.ts` and each
 * `status/route.test.ts`.
 */
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';

const WEB_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../..');
const GENERATE = path.join(WEB_ROOT, 'src', 'app', 'api', 'generate');

const RESOLVER_MODULE = '@/lib/keys/resolver';
const RESOLVE = 'resolveApiKey';
const OWNERSHIP_MODULE = '@/lib/generate/jobOwnership';
const VERIFY = 'verifyProviderJobOwner';
const HANDLER_MODULE = '@/lib/api/createGenerationHandler';
const HANDLER = 'createGenerationHandler';

/**
 * Status routes that resolve NO key themselves, pinned as a set so adding one
 * is a decision rather than a silent exemption. `music/status` answers a
 * static terminal state (ElevenLabs music is synchronous; see its docblock).
 * A status route that reached a provider through a HELPER instead of calling
 * `resolveApiKey` directly would land here — and must not be accepted until
 * this gate is taught to follow that helper.
 */
const STATUS_ROUTES_RESOLVING_NO_KEY = ['music'];

/** Local names this module binds to `name` exported from `moduleName`. */
function importedLocalNames(sf: ts.SourceFile, moduleName: string, name: string): Set<string> {
  const out = new Set<string>();
  for (const statement of sf.statements) {
    if (!ts.isImportDeclaration(statement)) continue;
    if (!ts.isStringLiteral(statement.moduleSpecifier)) continue;
    if (statement.moduleSpecifier.text !== moduleName) continue;
    if (statement.importClause?.isTypeOnly) continue;
    const bindings = statement.importClause?.namedBindings;
    if (!bindings || !ts.isNamedImports(bindings)) continue;
    for (const spec of bindings.elements) {
      if (spec.isTypeOnly) continue;
      if ((spec.propertyName?.text ?? spec.name.text) === name) out.add(spec.name.text);
    }
  }
  // A top-level declaration of the same local name shadows the import.
  for (const statement of sf.statements) {
    if (ts.isFunctionDeclaration(statement) && statement.name) out.delete(statement.name.text);
    if (ts.isVariableStatement(statement)) {
      for (const decl of statement.declarationList.declarations) {
        if (ts.isIdentifier(decl.name)) out.delete(decl.name.text);
      }
    }
  }
  return out;
}

const isConst = (list: ts.VariableDeclarationList): boolean =>
  (list.flags & ts.NodeFlags.Const) !== 0;

function unwrapAwait(expr: ts.Expression | undefined): ts.Expression | undefined {
  let e = expr;
  while (e && ts.isParenthesizedExpression(e)) e = e.expression;
  return e && ts.isAwaitExpression(e) ? e.expression : undefined;
}

/** `const <name> = <x>.get('jobId')` — the polled id, as every status route reads it. */
function polledIdNames(body: ts.Block): Set<string> {
  const out = new Set<string>();
  for (const statement of body.statements) {
    if (!ts.isVariableStatement(statement) || !isConst(statement.declarationList)) continue;
    for (const decl of statement.declarationList.declarations) {
      const init = decl.initializer;
      if (
        ts.isIdentifier(decl.name)
        && init && ts.isCallExpression(init)
        && ts.isPropertyAccessExpression(init.expression)
        && init.expression.name.text === 'get'
        && init.arguments.length === 1
        && ts.isStringLiteral(init.arguments[0])
        && init.arguments[0].text === 'jobId'
      ) {
        out.add(decl.name.text);
      }
    }
  }
  return out;
}

/** `return <expr>;`, alone or as the last statement of a block. */
function returnsValue(stmt: ts.Statement): boolean {
  if (ts.isReturnStatement(stmt)) return !!stmt.expression;
  if (ts.isBlock(stmt) && stmt.statements.length > 0) {
    const last = stmt.statements[stmt.statements.length - 1];
    return ts.isReturnStatement(last) && !!last.expression;
  }
  return false;
}

/** `<name> !== 'owner'` or `'owner' !== <name>`. */
function refusesNonOwner(cond: ts.Expression, name: string): boolean {
  let e = cond;
  while (ts.isParenthesizedExpression(e)) e = e.expression;
  if (!ts.isBinaryExpression(e)) return false;
  if (e.operatorToken.kind !== ts.SyntaxKind.ExclamationEqualsEqualsToken) return false;
  const [l, r] = [e.left, e.right];
  const isName = (n: ts.Expression) => ts.isIdentifier(n) && n.text === name;
  const isOwner = (n: ts.Expression) => ts.isStringLiteral(n) && n.text === 'owner';
  return (isName(l) && isOwner(r)) || (isOwner(l) && isName(r));
}

/**
 * Index of the first top-level statement of `body` at which the ownership
 * refusal has fully happened (the `if` after the `const`), or -1.
 */
function guardIndex(body: ts.Block, verifyNames: Set<string>): number {
  const polled = polledIdNames(body);
  const verdicts = new Set<string>();
  for (let i = 0; i < body.statements.length; i++) {
    const statement = body.statements[i];
    if (ts.isVariableStatement(statement) && isConst(statement.declarationList)) {
      for (const decl of statement.declarationList.declarations) {
        const call = unwrapAwait(decl.initializer);
        if (
          ts.isIdentifier(decl.name)
          && call && ts.isCallExpression(call)
          && ts.isIdentifier(call.expression)
          && verifyNames.has(call.expression.text)
          && call.arguments.length === 3
          && ts.isIdentifier(call.arguments[2])
          && polled.has(call.arguments[2].text)
        ) {
          verdicts.add(decl.name.text);
        }
      }
      continue;
    }
    if (
      ts.isIfStatement(statement)
      && !statement.elseStatement
      && returnsValue(statement.thenStatement)
      && [...verdicts].some((v) => refusesNonOwner(statement.expression, v))
    ) {
      return i;
    }
  }
  return -1;
}

function enclosingBody(node: ts.Node): ts.Block | undefined {
  for (let n: ts.Node | undefined = node.parent; n; n = n.parent) {
    if (ts.isFunctionLike(n)) {
      const body = (n as ts.FunctionLikeDeclarationBase).body;
      return body && ts.isBlock(body) ? body : undefined;
    }
  }
  return undefined;
}

function topLevelIndex(body: ts.Block, node: ts.Node): number {
  let n: ts.Node = node;
  while (n.parent && n.parent !== body) n = n.parent;
  return body.statements.indexOf(n as ts.Statement);
}

export interface StatusRouteAnalysis {
  /** Executable `resolveApiKey(...)` calls (comments and strings are not calls). */
  keyResolutions: number;
  /** Each key resolution with no ownership refusal ahead of it, by line. */
  unguarded: string[];
}

export function analyseStatusRoute(source: string, fileName = 'route.ts'): StatusRouteAnalysis {
  const sf = ts.createSourceFile(fileName, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  const resolveNames = importedLocalNames(sf, RESOLVER_MODULE, RESOLVE);
  const verifyNames = importedLocalNames(sf, OWNERSHIP_MODULE, VERIFY);
  const out: StatusRouteAnalysis = { keyResolutions: 0, unguarded: [] };

  const visit = (node: ts.Node): void => {
    if (ts.isCallExpression(node)) {
      const callee = node.expression;
      // Any call spelled `resolveApiKey` — through the resolved import, an
      // alias of it, or a namespace (`keys.resolveApiKey`) — is a key
      // resolution. Over-counting only makes the gate stricter.
      const isResolve = (ts.isIdentifier(callee) && (resolveNames.has(callee.text) || callee.text === RESOLVE))
        || (ts.isPropertyAccessExpression(callee) && callee.name.text === RESOLVE);
      if (isResolve) {
        out.keyResolutions += 1;
        const body = enclosingBody(node);
        const at = body ? topLevelIndex(body, node) : -1;
        const guard = body ? guardIndex(body, verifyNames) : -1;
        if (!body || guard < 0 || guard >= at) {
          const { line } = sf.getLineAndCharacterOfPosition(node.getStart(sf));
          out.unguarded.push(`line ${line + 1}`);
        }
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
  return out;
}

function propertyNamed(obj: ts.ObjectLiteralExpression, name: string): ts.ObjectLiteralElementLike | undefined {
  return obj.properties.find((p) => p.name && ts.isIdentifier(p.name) && p.name.text === name);
}

/** Is the property present with a value that can produce an id (a function or a reference)? */
function bindsSomething(prop: ts.ObjectLiteralElementLike | undefined): boolean {
  if (!prop) return false;
  if (ts.isMethodDeclaration(prop) || ts.isShorthandPropertyAssignment(prop)) return true;
  if (!ts.isPropertyAssignment(prop)) return false;
  const v = prop.initializer;
  if (ts.isIdentifier(v) && v.text === 'undefined') return false;
  return ts.isArrowFunction(v) || ts.isFunctionExpression(v) || ts.isIdentifier(v) || ts.isPropertyAccessExpression(v);
}

export interface PostRouteAnalysis {
  /** `createGenerationHandler({...})` calls whose config object the analyser read. */
  handlers: number;
  /** How many of them declare `jobIdForOwnership` or `asyncJob.providerJobId`. */
  binding: number;
}

/**
 * `createGenerationHandler` binds `jobIdForOwnership ?? asyncJob.providerJobId`
 * (see `maybeBindJobOwnership`). A config with neither binds nothing, so the
 * owner's own polls are refused — or, worse, someone "fixes" that by removing
 * the status-route check.
 */
export function analysePostRoute(source: string, fileName = 'route.ts'): PostRouteAnalysis {
  const sf = ts.createSourceFile(fileName, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  const handlerNames = importedLocalNames(sf, HANDLER_MODULE, HANDLER);
  const out: PostRouteAnalysis = { handlers: 0, binding: 0 };
  const visit = (node: ts.Node): void => {
    if (
      ts.isCallExpression(node)
      && ts.isIdentifier(node.expression)
      && handlerNames.has(node.expression.text)
    ) {
      const config = node.arguments[0];
      out.handlers += 1;
      if (config && ts.isObjectLiteralExpression(config)) {
        const direct = bindsSomething(propertyNamed(config, 'jobIdForOwnership'));
        const asyncJob = propertyNamed(config, 'asyncJob');
        const viaAsync = !!asyncJob
          && ts.isPropertyAssignment(asyncJob)
          && ts.isObjectLiteralExpression(asyncJob.initializer)
          && bindsSomething(propertyNamed(asyncJob.initializer, 'providerJobId'));
        if (direct || viaAsync) out.binding += 1;
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
  return out;
}

interface StatusRoute {
  /** The generation type: `model`, `sprite`, ... */
  type: string;
  statusFile: string;
  postFile: string;
}

/** Every `generate/<type>/status/route.ts`, at any depth. */
function walkStatusRoutes(dir: string, out: StatusRoute[] = []): StatusRoute[] {
  for (const entry of readdirSync(dir)) {
    const full = path.join(dir, entry);
    if (!statSync(full).isDirectory() || entry === '__tests__' || entry === 'node_modules') continue;
    const statusFile = path.join(full, 'route.ts');
    if (entry === 'status' && existsSync(statusFile)) {
      out.push({
        type: path.relative(GENERATE, dir).split(path.sep).join('/'),
        statusFile,
        postFile: path.join(dir, 'route.ts'),
      });
    }
    walkStatusRoutes(full, out);
  }
  return out;
}

/** Apply a text mutation and REFUSE to continue if it did not land (lessons-learned #19). */
function mutate(source: string, find: RegExp, replace: string): string {
  const global = new RegExp(find.source, find.flags.includes('g') ? find.flags : `${find.flags}g`);
  const hits = source.match(global)?.length ?? 0;
  expect(hits, `mutation ${find} must match the real source`).toBeGreaterThan(0);
  const next = source.replace(global, replace);
  expect(next).not.toBe(source);
  return next;
}

const GUARD_IF = /^[ \t]*if \(ownership !== 'owner'\) return jobOwnershipRefusal\(ownership\);[ \t]*$/m;
const GUARD_CONST = /^([ \t]*)(const ownership = await verifyProviderJobOwner\()/m;

describe('job-id ownership coverage (#10262)', () => {
  const routes = walkStatusRoutes(GENERATE);
  const analysed = routes.map((r) => ({
    ...r,
    source: readFileSync(r.statusFile, 'utf8'),
    status: analyseStatusRoute(readFileSync(r.statusFile, 'utf8'), r.statusFile),
  }));
  const resolving = analysed.filter((r) => r.status.keyResolutions > 0);

  it('finds status routes, and key-resolving ones, to check at all', () => {
    // Fail closed on zero: a walk that stops matching is the walk breaking.
    expect(routes.length).toBeGreaterThan(0);
    expect(resolving.length).toBeGreaterThan(0);
  });

  it('pins the status routes that resolve no key, so a new one is a decision', () => {
    const none = analysed.filter((r) => r.status.keyResolutions === 0).map((r) => r.type).sort();
    expect(none).toEqual(STATUS_ROUTES_RESOLVING_NO_KEY);
  });

  it("refuses a non-'owner' verdict before EVERY key resolution in every status route", () => {
    const unguarded = resolving.flatMap((r) =>
      r.status.unguarded.map((where) => `${r.type}/status/route.ts ${where}`),
    );
    expect(
      unguarded,
      `${unguarded.length} resolveApiKey call(s) run without an ownership refusal ahead of them. Add, in the same `
      + 'function body and before the call: `const ownership = await verifyProviderJobOwner(userId, provider, jobId);` '
      + "+ `if (ownership !== 'owner') return jobOwnershipRefusal(ownership);` — see src/lib/generate/jobOwnership.ts.",
    ).toEqual([]);
  });

  it('binds the job id in every POST route that sits behind a key-resolving status route', () => {
    const problems = resolving.flatMap((r) => {
      if (!existsSync(r.postFile)) return [`${r.type}/route.ts is missing`];
      const post = analysePostRoute(readFileSync(r.postFile, 'utf8'), r.postFile);
      if (post.handlers === 0) return [`${r.type}/route.ts has no ${HANDLER}({...}) call the gate can read`];
      return post.binding === post.handlers
        ? []
        : [`${r.type}/route.ts: ${post.handlers - post.binding} handler(s) set neither jobIdForOwnership nor asyncJob.providerJobId`];
    });
    expect(problems).toEqual([]);
  });

  // -------------------------------------------------------------------------
  // The gate can REPORT. Mutations run against the REAL sources, and each
  // asserts it applied before its result is trusted.
  // -------------------------------------------------------------------------

  it('reports each real status route with its refusal DELETED', () => {
    expect(resolving.length).toBeGreaterThan(0);
    for (const r of resolving) {
      const mutated = mutate(r.source, GUARD_IF, '');
      expect(analyseStatusRoute(mutated).unguarded, r.type).not.toEqual([]);
    }
  });

  it('reports each real status route with its check COMMENTED OUT', () => {
    for (const r of resolving) {
      let mutated = mutate(r.source, GUARD_IF, '  // if (ownership !== \'owner\') return jobOwnershipRefusal(ownership);');
      mutated = mutate(mutated, GUARD_CONST, '$1// $2');
      expect(analyseStatusRoute(mutated).unguarded, r.type).not.toEqual([]);
    }
  });

  it("reports each real status route whose refusal tests the MISS ('not_owner') instead of the hit", () => {
    // The fail-open shape for a three-state verdict: 'unverifiable' (a failed
    // lookup) would sail past this to the platform key.
    for (const r of resolving) {
      const mutated = mutate(r.source, /ownership !== 'owner'/, "ownership === 'not_owner'");
      expect(analyseStatusRoute(mutated).unguarded, r.type).not.toEqual([]);
    }
  });

  it('reports each real status route whose check runs on something other than the polled jobId', () => {
    for (const r of resolving) {
      const mutated = mutate(r.source, /(verifyProviderJobOwner\([^)]*), jobId\)/, '$1, otherId)');
      expect(analyseStatusRoute(mutated).unguarded, r.type).not.toEqual([]);
    }
  });

  it('reports each real POST route with its binding removed', () => {
    for (const r of resolving) {
      const source = readFileSync(r.postFile, 'utf8');
      const mutated = mutate(source, /\b(jobIdForOwnership|providerJobId):/, '$1Removed:');
      const post = analysePostRoute(mutated);
      expect(post.handlers, r.type).toBeGreaterThan(0);
      expect(post.binding, r.type).toBeLessThan(post.handlers);
    }
  });

  it('reports the shapes a text match would accept', () => {
    const imports = "import { resolveApiKey } from '@/lib/keys/resolver';\n"
      + "import { verifyProviderJobOwner } from '@/lib/generate/jobOwnership';\n";
    const head = "  const jobId = searchParams.get('jobId');\n";
    const guard = "  const ownership = await verifyProviderJobOwner(u, p, jobId);\n"
      + "  if (ownership !== 'owner') return refuse(ownership);\n";
    const call = '  await resolveApiKey(u, p, 0, op);\n';
    const fn = (body: string) => `${imports}async function GET_impl() {\n${body}}\n`;

    // The accepted shape, so the analyser is not simply reporting everything.
    expect(analyseStatusRoute(fn(head + guard + call))).toEqual({ keyResolutions: 1, unguarded: [] });

    // Guard AFTER the call.
    expect(analyseStatusRoute(fn(head + call + guard)).unguarded).toHaveLength(1);
    // Guard inside a branch the call does not share.
    expect(analyseStatusRoute(fn(`${head}  if (flag) {\n${guard}  }\n${call}`)).unguarded).toHaveLength(1);
    // `if` that does not return.
    expect(analyseStatusRoute(fn(head
      + "  const ownership = await verifyProviderJobOwner(u, p, jobId);\n"
      + "  if (ownership !== 'owner') console.warn(ownership);\n" + call)).unguarded).toHaveLength(1);
    // `let` verdict (reassignable between check and use).
    expect(analyseStatusRoute(fn(head + guard.replace('const ownership', 'let ownership') + call)).unguarded)
      .toHaveLength(1);
    // Truthiness of the verdict: every state is a non-empty string, so this refuses nothing.
    expect(analyseStatusRoute(fn(head
      + "  const ownership = await verifyProviderJobOwner(u, p, jobId);\n"
      + '  if (!ownership) return refuse(ownership);\n' + call)).unguarded).toHaveLength(1);
    // The check in a comment only (every line of it).
    const commented = guard.split('\n').filter(Boolean).map((l) => `  // ${l.trim()}`).join('\n');
    expect(analyseStatusRoute(fn(`${head}${commented}\n${call}`)).unguarded).toHaveLength(1);
    // A same-named LOCAL shadowing the import.
    expect(analyseStatusRoute(
      `const verifyProviderJobOwner = async () => 'owner';\n${fn(head + guard + call)}`,
    ).unguarded).toHaveLength(1);
    // The name imported from somewhere else.
    expect(analyseStatusRoute(fn(head + guard + call).replace(
      "from '@/lib/generate/jobOwnership'", "from './local'",
    )).unguarded).toHaveLength(1);
    // The call through an alias or a namespace is still a key resolution.
    expect(analyseStatusRoute(
      "import { resolveApiKey as rk } from '@/lib/keys/resolver';\nasync function g() {\n  await rk(u);\n}\n",
    )).toEqual({ keyResolutions: 1, unguarded: ['line 3'] });
    expect(analyseStatusRoute('async function g() {\n  await keys.resolveApiKey(u);\n}\n').keyResolutions)
      .toBe(1);
  });

  it('reads both POST binding spellings, and rejects an explicit undefined', () => {
    const imp = "import { createGenerationHandler } from '@/lib/api/createGenerationHandler';\n";
    expect(analysePostRoute(`${imp}createGenerationHandler({ jobIdForOwnership: (r) => r.jobId });`))
      .toEqual({ handlers: 1, binding: 1 });
    expect(analysePostRoute(`${imp}createGenerationHandler({ asyncJob: { providerJobId: (r) => r.jobId } });`))
      .toEqual({ handlers: 1, binding: 1 });
    expect(analysePostRoute(`${imp}createGenerationHandler({ asyncJob: { type: 'sprite' } });`))
      .toEqual({ handlers: 1, binding: 0 });
    expect(analysePostRoute(`${imp}createGenerationHandler({ jobIdForOwnership: undefined });`))
      .toEqual({ handlers: 1, binding: 0 });
  });
});
