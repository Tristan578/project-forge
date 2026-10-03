/**
 * @vitest-environment node
 *
 * Does every route that resolves a provider key for a job the caller names
 * refuse a job the caller does not own, BEFORE resolving the key — and does
 * every POST route behind such a route bind the job id it hands out?
 *
 * This is the structural half of the #10262 control. Each half of the binding
 * is mocked in the other half's tests (`bindProviderJob` in the handler
 * suites, `verifyProviderJobOwner` in every `status/route.test.ts`), so a new
 * status route that skips the check, or a POST route that binds nothing,
 * passes every behavioural test. `resolveApiKey` returns the PLATFORM key for
 * a zero-cost status check, and `resolveByokOrPlatformKey` returns it with no
 * tier, balance or charge at all, so a missing check is a cross-user read of
 * another person's result with the platform's credentials.
 *
 * WHICH FILES — selected by the PROPERTY, not the directory name
 * (lessons-learned #21: "scope the gate to the property, not the filename").
 * Every file Next.js routes under `src/app` — `route.ts`, `.tsx`, `.js`,
 * `.jsx`, `.mjs` (the `ROUTE_FILE` set `egressGuardCoverage.test.ts` uses), at
 * any path, `status/[jobId]/route.ts` and `texture/poll/route.ts` included —
 * is parsed with the script kind its extension implies, and every one that
 * calls a KEY EXPORT of the resolver (or references one, or imports the
 * resolver module in a way the gate cannot follow) is SELECTED. The key
 * exports are DERIVED from `@/lib/keys/resolver`'s source on every run: every
 * exported VALUE binding, whatever its initializer (a function, a const alias
 * `= getPlatformKey`, a call result, a `satisfies`/`as` expression, a
 * `let`/`var`, `export default` keyed `default`, an export list, a class),
 * except the pinned `NON_KEY_RESOLVER_EXPORTS` (each re-checked to be a
 * function declaring a return type naming no key, or a plain error class);
 * types are not values, and an `export * from` refuses to derive at all —
 * `resolveApiKey` and `resolveByokOrPlatformKey` today, and any export added
 * later. "Calls" counts
 * a named import of a key export under ANY local name from ANY specifier
 * (`as resolveKey`, from `@/lib/keys/resolver`, `@/lib/keys/resolver.ts` or a
 * relative path — over-counting only makes the gate stricter). Where the MODULE is what matters
 * — a namespace, default, `import =` or dynamic import of the resolver, and the
 * module each guard callee must come from — the specifier is identified by
 * tsc's own module resolution with `web/tsconfig.json`'s options, against the
 * file's real path, never by its spelling. A selected route must pass every
 * rule below, or be in `KEY_RESOLVING_EXEMPTIONS`, where each entry carries a
 * reason AND a structural property the gate re-checks on every run (a
 * token-charged new operation is not a zero-cost status poll; a QStash callback
 * verifies its signature before resolving; a bundled secondary key resolved
 * inside the `execute` step of a charged `createGenerationHandler` generation,
 * for that step's authenticated `ctx.userId`). An exemption that no longer
 * resolves a key is stale and fails. Two floors are derived from source, not
 * counted: every endpoint in `STATUS_ENDPOINTS` (the map the poller dials)
 * must map to a walked route, and every one of them but the pinned
 * `STATUS_ROUTES_RESOLVING_NO_KEY` must be selected (lessons-learned #9, #18).
 *
 * A SHAPE check, read through the TypeScript parser AND its binder (a
 * single-file `ts.Program`, so names resolve the way the compiler resolves
 * them): a text scan would accept the call inside a comment or a string, and
 * the ORDER and the GATING of the call are the whole property. What a selected
 * route must contain, in the same function body as every key-export call
 * (`resolveApiKey(...)`, `resolveByokOrPlatformKey(...)`) and ahead of the
 * statement that holds it:
 *
 *   const <o> = await verifyProviderJobOwner(<user>, <provider>, <jobId>);
 *   if (<o> !== 'owner') return <refusal>;
 *
 * - both as TOP-LEVEL statements of that body, so neither can sit in a branch
 *   the key resolution does not share; and that body is the handler's own
 *   (a key resolved inside a nested function is reported);
 * - `const`, so the verdict cannot be reassigned between check and use;
 * - the comparison is `!== 'owner'` exactly. `=== 'not_owner'` is REJECTED: the
 *   lookup has a third answer (`'unverifiable'`, a failed lookup), and a check
 *   written against the miss rather than the hit lets that one through to the
 *   key — fail-open on a DB error;
 * - the first argument (`<user>`) is the AUTHENTICATED caller: `<mid>.userId`
 *   (a trailing `!` allowed), where `const <mid> = await withApiMiddleware(...)`
 *   is a top-level statement of the same body ahead of the check, and it is
 *   the same `<mid>.userId` the guarded key-export call passes as ITS
 *   first argument. A check run against a caller-chosen user
 *   (`searchParams.get('userId')`, a body field) would answer `'owner'` for
 *   whoever the caller names and hand them the platform key;
 * - `verifyProviderJobOwner` and `withApiMiddleware` RESOLVE to the import of
 *   the real export: the callee's symbol, per the TypeScript binder, must be
 *   that import specifier, in an import whose module tsc resolves to the real
 *   module's file (a look-alike module is rejected). A same-named const, function, parameter, catch
 *   binding or destructured name in ANY enclosing scope — or a top-level
 *   redeclaration — resolves elsewhere and is rejected (the aliasing class that
 *   defeated the static passes in #9736);
 * - the third argument is the POLLED id, and it is the ONLY value the handler
 *   reads from the request. The handler's request parameter may appear only as
 *   `withApiMiddleware(request, ...)` and as `request.url` in the one
 *   `const { searchParams } = new URL(request.url)`; `searchParams` only as the
 *   single `const <jobId> = searchParams.get('jobId')`; the middleware result
 *   only as `.error`, `.userId` and `.authContext` (`.body` is caller input);
 *   no second handler argument (route params); no `arguments` anywhere in the
 *   handler (`arguments[0]` is the request, `arguments[1]` the route params,
 *   under a name nothing above looks for). And the MODULES it takes values
 *   from are whitelisted too, because `next/headers` reads the request with no
 *   handler argument at all: every runtime static import is `next/server` or
 *   resolves (tsc's resolution, so `next/headers.js` and a relative path into
 *   node_modules are caught) to the app's own source under `src/`; there is no
 *   `import()`, no `require` reference and no `import x = require(...)`, since
 *   the gate cannot vet a module named at run time. A module can also be
 *   fetched through a GLOBAL with no import at all
 *   (`process.getBuiltinModule('module').createRequire(...)('next/headers')`),
 *   so the GLOBALS are whitelisted the same way (`ALLOWED_GLOBALS`: `new URL`,
 *   `Object.keys/values/entries`, `JSON`, `Math`, ...; never `process`,
 *   `globalThis`, `global`, `eval`, `Function` or `Reflect`), and the path
 *   from any value to `Function` is closed: no `constructor`, `prototype` or
 *   `__proto__` anywhere in the file, and every element access takes a
 *   literal name. So whatever the route
 *   sends the provider, the only caller-chosen value it can contain is the id
 *   the ownership check ran on. This is a whitelist of the ways IN, not a list
 *   of sinks — the set of sinks is unbounded (#9736).
 *
 * Every rule is proven able to REPORT by mutating the REAL route sources in
 * memory and asserting each mutation applied before trusting the red (#11,
 * #16, #18, #19).
 *
 * WHAT THIS DOES NOT PROVE.
 * - That the lookup is correct, or that the refusal maps to the right status:
 *   `src/lib/generate/__tests__/jobOwnership.test.ts`,
 *   `jobOwnershipResponse.test.ts` and each `status/route.test.ts` (which also
 *   assert the provider client receives the polled jobId, decoys beside it).
 * - A value DERIVED from the polled id (`jobId.slice(...)`) still passes: it is
 *   the caller's own verified id, but the gate does not prove the provider is
 *   sent the whole of it — the per-route tests above do.
 * - A key resolved inside a HELPER module the route calls is not followed.
 *   `createGenerationHandler` is one: its POST routes resolve a key for a new,
 *   token-charged generation, which polls no existing job. A status route that
 *   reached a provider through a helper would be reported only by the
 *   `STATUS_ENDPOINTS` floor (it would select nothing) — and must not be
 *   accepted until this gate is taught to follow that helper.
 * - A request read inside an app MODULE the route imports (a helper under
 *   `src/` that calls `headers()` and returns the value) is not followed, for
 *   the same reason as the helper limit above; the module whitelist stops the
 *   route reading next/headers itself, not an app helper doing it for it.
 * - Whether an exemption's REASON is true beyond the property re-checked here.
 */
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';
import { STATUS_ENDPOINTS } from '@/lib/generation/statusEndpoints';

const WEB_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../..');
const APP_ROOT = path.join(WEB_ROOT, 'src', 'app');

/** Every file name Next.js routes — the same set `egressGuardCoverage.test.ts` walks. */
const ROUTE_FILE = /^route\.(?:ts|tsx|js|jsx|mjs)$/;

const RESOLVER_MODULE = '@/lib/keys/resolver';
const RESOLVE = 'resolveApiKey';
/** The resolver's uncharged BYOK-or-platform lookup: a key with no tier, balance or charge in front of it. */
const RESOLVE_BYOK = 'resolveByokOrPlatformKey';
/**
 * The resolver's exports that return NO key, pinned. Every OTHER exported
 * value binding of the resolver module — whatever its initializer — is
 * treated as key-returning (see `KEY_EXPORTS`), so a new export selects its
 * callers until someone decides here that it returns no key. Each entry is
 * re-checked, in EVERY declaration of the name, to still be either a function
 * declaration or a `const` bound straight to a function, with a declared
 * return type naming neither `string` nor `ResolvedKey`, or an error class
 * (`extends Error`, a constructor and nothing else, no `return`) — so the pin
 * cannot be kept by an alias, a call result or a cast of something that does.
 */
const NON_KEY_RESOLVER_EXPORTS: readonly string[] = ['ApiKeyError', 'storeProviderKey', 'deleteProviderKey', 'listConfiguredProviders'];
/** The one framework module a selected route may import (see `moduleInputProblems`). */
const NEXT_SERVER_MODULE = 'next/server';
const SRC_ROOT = path.join(WEB_ROOT, 'src');
const OWNERSHIP_MODULE = '@/lib/generate/jobOwnership';
const VERIFY = 'verifyProviderJobOwner';
const MIDDLEWARE_MODULE = '@/lib/api/middleware';
const MIDDLEWARE = 'withApiMiddleware';
const HANDLER_MODULE = '@/lib/api/createGenerationHandler';
const HANDLER = 'createGenerationHandler';
const QSTASH_MODULE = '@/lib/qstash/client';
const QSTASH_VERIFY = 'verifyQstashSignature';
const STATUS_CHECK_CONST = 'STATUS_CHECK_OPERATION';
const STATUS_CHECK_LITERAL = 'status_check';
/** The middleware result's fields a selected handler may read. `body` is caller input. */
const MIDDLEWARE_FIELDS = new Set(['error', 'userId', 'authContext']);

/**
 * The options `web/tsconfig.json` resolves modules with — `paths` (`@/*`),
 * `moduleResolution: bundler`, `allowImportingTsExtensions` — so whether a
 * specifier names a module is decided the way tsc decides it, not by how the
 * specifier is spelled (`@/lib/keys/resolver`, `@/lib/keys/resolver.ts` and
 * `../../../../lib/keys/resolver` are one module). Only module resolution reads
 * these; each per-file program below still loads nothing but the file itself.
 */
const TSCONFIG = path.join(WEB_ROOT, 'tsconfig.json');
const RESOLUTION_OPTIONS: ts.CompilerOptions = (() => {
  const read = ts.readConfigFile(TSCONFIG, ts.sys.readFile);
  if (read.error) throw new Error(`cannot read ${TSCONFIG}: ${ts.flattenDiagnosticMessageText(read.error.messageText, '\n')}`);
  return ts.parseJsonConfigFileContent(read.config, ts.sys, WEB_ROOT, undefined, TSCONFIG).options;
})();
const RESOLUTION_CACHE = ts.createModuleResolutionCache(WEB_ROOT, (f) => f, RESOLUTION_OPTIONS);

/** The file `specifier`, written in `containingFile`, resolves to under tsc's rules — or undefined. */
function resolveModuleFile(specifier: string, containingFile: string): string | undefined {
  return ts.resolveModuleName(specifier, containingFile, RESOLUTION_OPTIONS, ts.sys, RESOLUTION_CACHE)
    .resolvedModule?.resolvedFileName;
}

/**
 * Where an in-memory source with a bare file name ('route.ts') is taken to
 * live, so its relative specifiers resolve against a real directory: two
 * levels under `src/app`, like `api/<name>/route.ts`.
 */
const SYNTHETIC_DIR = path.join(APP_ROOT, 'api', '__synthetic__');

/** The file each canonical module specifier resolves to (asserted to exist by the suite). */
const moduleFileCache = new Map<string, string | undefined>();
function canonicalModuleFile(moduleName: string): string | undefined {
  if (!moduleFileCache.has(moduleName)) {
    moduleFileCache.set(moduleName, resolveModuleFile(moduleName, path.join(SYNTHETIC_DIR, 'route.ts')));
  }
  return moduleFileCache.get(moduleName);
}

/** Is `file` (a resolved module path) the app's own source — under `web/src`, outside any node_modules? */
function isAppSourceFile(file: string | undefined): boolean {
  if (!file) return false;
  const resolved = path.resolve(file);
  return resolved.startsWith(SRC_ROOT + path.sep) && !resolved.split(path.sep).includes('node_modules');
}

export interface ResolverExport {
  /** The EXPORTED name (`default` for a default export). */
  name: string;
  /**
   * The declared return type's text when the export is a function declaration
   * or a `const` bound straight to a function or arrow expression (with no
   * type annotation of its own); otherwise undefined — an alias, a call
   * result, a wrapped or cast expression, a `let`/`var`, a re-export.
   */
  returnType: string | undefined;
  /**
   * An exported class that `extends Error` and whose only member is a
   * constructor with no `return` (so `new X()` is that error, nothing else).
   */
  errorClass: boolean;
}

/**
 * EVERY exported value binding of the resolver module's source, whatever its
 * initializer: a function declaration, every name an `export const/let/var`
 * binds (`export const k = getPlatformKey`, `= memoize(async () => ...)`,
 * `= (async () => ...) satisfies F`, a destructuring), `export default`
 * (keyed `default`), every name in an `export { ... }` list or
 * `export * as ns`, an exported enum, namespace or `import =`. A key can come
 * out of any of them, so the derivation does not ask what the value IS
 * (lessons-learned #21: the ways to build a value are unbounded); over-counting
 * only makes the gate stricter, and a non-key name is pinned in
 * `NON_KEY_RESOLVER_EXPORTS`.
 *
 * Classes are values and are counted too (a static or instance method can
 * return a key); `ApiKeyError`, which routes `instanceof`-test, is pinned.
 * Not counted: interfaces and types, which have no value. `export * from
 * '...'` adds names this source does not spell, so it THROWS: the gate
 * refuses to derive rather than derive a subset.
 */
export function resolverValueExports(source: string): ResolverExport[] {
  const sf = ts.createSourceFile('resolver.ts', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  const out: ResolverExport[] = [];
  const modifiers = (n: ts.Node) => (ts.canHaveModifiers(n) ? ts.getModifiers(n) ?? [] : []);
  const has = (n: ts.Node, kind: ts.SyntaxKind) => modifiers(n).some((m) => m.kind === kind);
  const exported = (st: ts.Statement) => has(st, ts.SyntaxKind.ExportKeyword);
  const exportName = (st: ts.Statement, local: string | undefined) =>
    (has(st, ts.SyntaxKind.DefaultKeyword) ? 'default' : local ?? 'default');
  const boundNames = (name: ts.BindingName): string[] => (ts.isIdentifier(name)
    ? [name.text]
    : (name.elements as ts.NodeArray<ts.ArrayBindingElement>).flatMap((el) => (ts.isOmittedExpression(el) ? [] : boundNames(el.name))));
  const errorClass = (c: ts.ClassDeclaration) => {
    const extendsError = (c.heritageClauses ?? []).some((h) => h.token === ts.SyntaxKind.ExtendsKeyword
      && h.types.length === 1 && ts.isIdentifier(h.types[0].expression) && h.types[0].expression.text === 'Error');
    let returns = false;
    forEachDescendant(c, (n) => { if (ts.isReturnStatement(n)) returns = true; });
    return extendsError && !returns && c.members.length === 1 && ts.isConstructorDeclaration(c.members[0]);
  };
  // Local names with no value, for `export { X }`.
  const typeLocals = new Set<string>();
  for (const st of sf.statements) {
    if (ts.isInterfaceDeclaration(st) || ts.isTypeAliasDeclaration(st)) typeLocals.add(st.name.text);
  }
  const value = (name: string, returnType?: string): ResolverExport => ({ name, returnType, errorClass: false });
  for (const st of sf.statements) {
    if (ts.isFunctionDeclaration(st) && exported(st)) {
      out.push(value(exportName(st, st.name?.text), st.type?.getText(sf)));
    } else if (ts.isClassDeclaration(st) && exported(st)) {
      out.push({ ...value(exportName(st, st.name?.text)), errorClass: errorClass(st) });
    } else if (ts.isVariableStatement(st) && exported(st)) {
      const constList = (st.declarationList.flags & ts.NodeFlags.Const) !== 0;
      for (const d of st.declarationList.declarations) {
        let init = d.initializer;
        while (init && ts.isParenthesizedExpression(init)) init = init.expression;
        const fn = constList && ts.isIdentifier(d.name) && !d.type && init
          && (ts.isArrowFunction(init) || ts.isFunctionExpression(init)) ? init : undefined;
        for (const name of boundNames(d.name)) out.push(value(name, fn?.type?.getText(sf)));
      }
    } else if (ts.isExportAssignment(st)) {
      // `export default <expr>` (and `export = <expr>`): a value, whatever it is.
      out.push(value('default'));
    } else if (ts.isEnumDeclaration(st) || ts.isModuleDeclaration(st) || ts.isImportEqualsDeclaration(st)) {
      const typeOnly = ts.isImportEqualsDeclaration(st) && st.isTypeOnly;
      if (exported(st) && !typeOnly && ts.isIdentifier(st.name)) out.push(value(st.name.text));
    } else if (ts.isExportDeclaration(st) && !st.isTypeOnly) {
      if (!st.exportClause) {
        throw new Error(`the resolver re-exports a whole module (${st.getText(sf)}): the gate cannot derive the names it `
          + 'adds, so it cannot know which return a key. List them in an `export { ... }` instead.');
      }
      if (ts.isNamespaceExport(st.exportClause)) {
        out.push(value(st.exportClause.name.text));
        continue;
      }
      for (const el of st.exportClause.elements) {
        if (el.isTypeOnly) continue;
        if (!st.moduleSpecifier && typeLocals.has((el.propertyName ?? el.name).text)) continue;
        out.push(value(el.name.text));
      }
    }
  }
  return out;
}

/** The resolver's key-returning exports: every exported value binding but the pinned `NON_KEY_RESOLVER_EXPORTS`. */
export function keyExportsOf(exports: readonly ResolverExport[]): Set<string> {
  return new Set(exports.map((e) => e.name).filter((name) => !NON_KEY_RESOLVER_EXPORTS.includes(name)));
}

/**
 * Why a pinned `NON_KEY_RESOLVER_EXPORTS` name can no longer be trusted to
 * return no key: it is not exported, or ANY declaration of it is neither a
 * function with a declared non-key return type nor an error class.
 */
export function nonKeyPinProblems(exports: readonly ResolverExport[]): string[] {
  const problems: string[] = [];
  for (const name of NON_KEY_RESOLVER_EXPORTS) {
    const declared = exports.filter((e) => e.name === name);
    if (declared.length === 0) problems.push(`${name}: pinned as a non-key export but not exported`);
    for (const e of declared) {
      if (e.errorClass) continue;
      if (!e.returnType) {
        problems.push(`${name}: pinned as a non-key export but is not a function declaration or a const function with a declared return type`);
      } else if (/\bstring\b|ResolvedKey/.test(e.returnType)) {
        problems.push(`${name}: pinned as a non-key export but its return type (${e.returnType}) can carry a key`);
      }
    }
  }
  return problems;
}

const RESOLVER_FILE = canonicalModuleFile(RESOLVER_MODULE);
if (!RESOLVER_FILE) throw new Error(`${RESOLVER_MODULE} does not resolve: the gate cannot derive the key-returning exports`);
const RESOLVER_EXPORTS = resolverValueExports(readFileSync(RESOLVER_FILE, 'utf8'));
/**
 * Every name a key comes out of: derived from the resolver module's exports
 * at run time, so a new key-returning export selects its callers without an
 * edit here (lessons-learned #18). `resolveApiKey` and `resolveByokOrPlatformKey`
 * today; the suite asserts both are in it.
 */
const KEY_EXPORTS: ReadonlySet<string> = keyExportsOf(RESOLVER_EXPORTS);

/** The script kind Next.js's compiler would give a route file, by extension. */
function scriptKindFor(fileName: string): ts.ScriptKind {
  switch (path.extname(fileName)) {
    case '.tsx': return ts.ScriptKind.TSX;
    case '.jsx': return ts.ScriptKind.JSX;
    case '.js':
    case '.mjs': return ts.ScriptKind.JS;
    default: return ts.ScriptKind.TS;
  }
}

interface Bound {
  sf: ts.SourceFile;
  checker: ts.TypeChecker;
  /** The real path the source's module specifiers resolve against. */
  containingFile: string;
}

/**
 * Parse AND bind one file as its own program, with no lib and no module
 * resolution, so the checker can answer "which declaration does this name
 * resolve to" exactly as the compiler would — scopes, hoisting, parameters,
 * catch bindings and destructuring included — without loading the app.
 */
function bind(fileName: string, source: string): Bound {
  const virtual = `/virtual/route${path.extname(fileName) || '.ts'}`;
  const sf = ts.createSourceFile(virtual, source, ts.ScriptTarget.Latest, true, scriptKindFor(fileName));
  const host: ts.CompilerHost = {
    getSourceFile: (name) => (name === virtual ? sf : undefined),
    writeFile: () => undefined,
    getDefaultLibFileName: () => '/virtual/lib.d.ts',
    useCaseSensitiveFileNames: () => true,
    getCanonicalFileName: (f) => f,
    getCurrentDirectory: () => '/virtual',
    getNewLine: () => '\n',
    fileExists: (name) => name === virtual,
    readFile: () => undefined,
  };
  const program = ts.createProgram({
    rootNames: [virtual],
    options: { noLib: true, noResolve: true, allowJs: true, jsx: ts.JsxEmit.Preserve, types: [] },
    host,
  });
  return {
    sf: program.getSourceFile(virtual) ?? sf,
    checker: program.getTypeChecker(),
    containingFile: path.isAbsolute(fileName) ? fileName : path.join(SYNTHETIC_DIR, fileName),
  };
}

/**
 * Does `specifier`, written in `b`'s file, name the module `moduleName` names?
 * Decided by tsc's module resolution against the file's real location, so any
 * spelling of the same module — alias, relative, extensioned, `/index` — is
 * that module, and a specifier that resolves elsewhere (or nowhere) is not.
 */
function namesModule(b: Bound, specifier: string, moduleName: string): boolean {
  if (specifier === moduleName) return true;
  const target = canonicalModuleFile(moduleName);
  return !!target && resolveModuleFile(specifier, b.containingFile) === target;
}

/** `importedLocalNames(..., ANY_MODULE, ...)`: a named import of the export from any specifier at all. */
const ANY_MODULE = null;

/**
 * Local names this module binds to `name` exported from `moduleName` (any
 * spelling of it — see `namesModule`; `ANY_MODULE` for every specifier),
 * minus top-level redeclarations.
 */
function importedLocalNames(b: Bound, moduleName: string | typeof ANY_MODULE, name: string): Set<string> {
  const { sf } = b;
  const out = new Set<string>();
  for (const statement of sf.statements) {
    if (!ts.isImportDeclaration(statement)) continue;
    if (!ts.isStringLiteral(statement.moduleSpecifier)) continue;
    if (moduleName !== ANY_MODULE && !namesModule(b, statement.moduleSpecifier.text, moduleName)) continue;
    if (statement.importClause?.isTypeOnly) continue;
    const bindings = statement.importClause?.namedBindings;
    if (!bindings || !ts.isNamedImports(bindings)) continue;
    for (const spec of bindings.elements) {
      if (spec.isTypeOnly) continue;
      if ((spec.propertyName?.text ?? spec.name.text) === name) out.add(spec.name.text);
    }
  }
  // A top-level declaration of the same local name shadows the import. tsc
  // rejects it (TS2440), but the binder still resolves uses to the import, so
  // the checker alone would not see it.
  for (const statement of sf.statements) {
    if (ts.isFunctionDeclaration(statement) && statement.name) out.delete(statement.name.text);
    if (ts.isClassDeclaration(statement) && statement.name) out.delete(statement.name.text);
    if (ts.isVariableStatement(statement)) {
      for (const decl of statement.declarationList.declarations) {
        if (ts.isIdentifier(decl.name)) out.delete(decl.name.text);
      }
    }
  }
  return out;
}

/**
 * Does `id` resolve — per the binder — to the import of `exportName` from
 * `moduleName`? A same-named declaration in any enclosing scope resolves to
 * that declaration instead, and is rejected.
 */
function resolvesToImport(b: Bound, id: ts.Identifier, moduleName: string, exportName: string): boolean {
  if (!importedLocalNames(b, moduleName, exportName).has(id.text)) return false;
  const declarations = b.checker.getSymbolAtLocation(id)?.declarations ?? [];
  if (declarations.length !== 1) return false;
  const spec = declarations[0];
  if (!ts.isImportSpecifier(spec) || spec.isTypeOnly) return false;
  const decl = spec.parent.parent.parent;
  return ts.isImportDeclaration(decl)
    && !decl.importClause?.isTypeOnly
    && ts.isStringLiteral(decl.moduleSpecifier)
    && namesModule(b, decl.moduleSpecifier.text, moduleName)
    && (spec.propertyName ?? spec.name).text === exportName;
}

function calleeIs(b: Bound, call: ts.CallExpression, moduleName: string, exportName: string): boolean {
  return ts.isIdentifier(call.expression) && resolvesToImport(b, call.expression, moduleName, exportName);
}

const isConst = (list: ts.VariableDeclarationList): boolean =>
  (list.flags & ts.NodeFlags.Const) !== 0;

function unwrapAwait(expr: ts.Expression | undefined): ts.Expression | undefined {
  let e = expr;
  while (e && ts.isParenthesizedExpression(e)) e = e.expression;
  return e && ts.isAwaitExpression(e) ? e.expression : undefined;
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
 * `<mid>.userId` (parentheses and `!` stripped) -> `mid`; anything else ->
 * undefined. The user argument of both `verifyProviderJobOwner` and the key
 * export must have this shape, and the SAME `<mid>` (and a bundled-step
 * exemption's key call, with `<ctx>` its `execute` step's third parameter).
 */
function authenticatedUserBase(expr: ts.Expression | undefined): string | undefined {
  let e = expr;
  while (e && (ts.isParenthesizedExpression(e) || ts.isNonNullExpression(e))) e = e.expression;
  if (
    e && ts.isPropertyAccessExpression(e)
    && ts.isIdentifier(e.expression)
    && e.name.text === 'userId'
  ) {
    return e.expression.text;
  }
  return undefined;
}

/** Is this identifier a NAME position (a property name, a label) rather than a reference to a binding? */
function isNamePosition(id: ts.Identifier): boolean {
  const p = id.parent;
  if (ts.isPropertyAccessExpression(p) && p.name === id) return true;
  if (
    (ts.isPropertyAssignment(p) || ts.isMethodDeclaration(p) || ts.isPropertyDeclaration(p)
      || ts.isPropertySignature(p) || ts.isMethodSignature(p) || ts.isGetAccessorDeclaration(p)
      || ts.isSetAccessorDeclaration(p) || ts.isEnumMember(p) || ts.isJsxAttribute(p))
    && p.name === id
  ) {
    return true;
  }
  if (ts.isBindingElement(p) && p.propertyName === id) return true;
  if (ts.isQualifiedName(p) && p.right === id) return true;
  if (ts.isImportSpecifier(p) || ts.isImportClause(p) || ts.isNamespaceImport(p)) return true;
  if (ts.isLabeledStatement(p) || ts.isBreakOrContinueStatement(p)) return true;
  if (ts.isExportSpecifier(p) || ts.isMetaProperty(p)) return true;
  // An intrinsic JSX tag (`<div>`) is a string, not a binding.
  if ((ts.isJsxOpeningElement(p) || ts.isJsxClosingElement(p) || ts.isJsxSelfClosingElement(p))
    && p.tagName === id && /^[a-z]/.test(id.text)) return true;
  return false;
}

/** Is this identifier the name a declaration introduces (not a use of one)? */
function isDeclarationName(id: ts.Identifier): boolean {
  const p = id.parent as ts.Node & { name?: ts.Node };
  if (p.name !== id) return false;
  return ts.isVariableDeclaration(p) || ts.isParameter(p) || ts.isBindingElement(p)
    || ts.isFunctionDeclaration(p) || ts.isFunctionExpression(p) || ts.isClassDeclaration(p)
    || ts.isClassExpression(p) || ts.isEnumDeclaration(p) || ts.isModuleDeclaration(p)
    || ts.isTypeAliasDeclaration(p) || ts.isInterfaceDeclaration(p) || ts.isTypeParameterDeclaration(p);
}

function forEachDescendant(node: ts.Node, fn: (n: ts.Node) => void): void {
  ts.forEachChild(node, (child) => {
    fn(child);
    forEachDescendant(child, fn);
  });
}

const lineOf = (sf: ts.SourceFile, node: ts.Node): string =>
  `line ${sf.getLineAndCharacterOfPosition(node.getStart(sf)).line + 1}`;

interface HandlerInputs {
  /** `const <name> = searchParams.get('jobId')` — the polled id. */
  polled: Set<string>;
  /** Every other way the handler reads the request, by line. */
  problems: string[];
}

/**
 * The whitelist of the ways caller input may ENTER a selected handler. See
 * the docblock: the request only through `withApiMiddleware(request, ...)` and
 * the one `new URL(request.url)`; the URL only through the one
 * `searchParams.get('jobId')`; the middleware result only through
 * `.error`/`.userId`/`.authContext`.
 */
function handlerInputs(b: Bound, fn: ts.FunctionLikeDeclaration, body: ts.Block): HandlerInputs {
  const { sf } = b;
  const problems: string[] = [];
  const polled = new Set<string>();

  if (fn.parameters.length > 1) {
    problems.push(`${lineOf(sf, fn.parameters[1])}: the handler takes a second argument (route params)`);
  }
  const reqParam = fn.parameters[0];
  const req = reqParam && ts.isIdentifier(reqParam.name) ? reqParam.name.text : undefined;
  if (reqParam && !req) problems.push(`${lineOf(sf, reqParam)}: the request parameter is destructured`);
  // `arguments` is the request (`arguments[0]`) and the route params
  // (`arguments[1]`) under a name the rules below never look for. Reported
  // anywhere in the handler — body or parameter defaults, and inside a nested
  // function too (an arrow's `arguments` IS the handler's).
  forEachDescendant(fn, (n) => {
    if (ts.isIdentifier(n) && n.text === 'arguments' && !isNamePosition(n)) {
      problems.push(`${lineOf(sf, n)}: reads arguments (the request and the route params, unnamed)`);
    }
  });

  let urlDecl: ts.VariableDeclaration | undefined;
  let sp: string | undefined;
  for (const st of body.statements) {
    if (!ts.isVariableStatement(st) || !isConst(st.declarationList) || urlDecl) continue;
    for (const d of st.declarationList.declarations) {
      const init = d.initializer;
      if (
        req && ts.isObjectBindingPattern(d.name) && d.name.elements.length === 1
        && init && ts.isNewExpression(init) && ts.isIdentifier(init.expression) && init.expression.text === 'URL'
        && init.arguments?.length === 1
      ) {
        const el = d.name.elements[0];
        const key = el.propertyName ?? el.name;
        const arg = init.arguments[0];
        if (
          !el.dotDotDotToken && !el.initializer && ts.isIdentifier(el.name)
          && ts.isIdentifier(key) && key.text === 'searchParams'
          && ts.isPropertyAccessExpression(arg) && ts.isIdentifier(arg.expression)
          && arg.expression.text === req && arg.name.text === 'url'
        ) {
          urlDecl = d;
          sp = el.name.text;
        }
      }
    }
  }

  const sanctionedGets = new Set<ts.Node>();
  const mids = new Set<string>();
  for (const st of body.statements) {
    if (!ts.isVariableStatement(st) || !isConst(st.declarationList)) continue;
    for (const d of st.declarationList.declarations) {
      if (!ts.isIdentifier(d.name)) continue;
      const init = d.initializer;
      if (
        sp && init && ts.isCallExpression(init)
        && ts.isPropertyAccessExpression(init.expression)
        && ts.isIdentifier(init.expression.expression) && init.expression.expression.text === sp
        && init.expression.name.text === 'get'
        && init.arguments.length === 1 && ts.isStringLiteral(init.arguments[0])
        && init.arguments[0].text === 'jobId'
      ) {
        polled.add(d.name.text);
        sanctionedGets.add(init);
      }
      const call = unwrapAwait(init);
      if (call && ts.isCallExpression(call) && calleeIs(b, call, MIDDLEWARE_MODULE, MIDDLEWARE)) mids.add(d.name.text);
    }
  }
  if (sanctionedGets.size > 1) {
    problems.push(`${lineOf(sf, body)}: the handler reads jobId more than once; one const must carry the polled id`);
  }

  forEachDescendant(body, (n) => {
    if (!ts.isIdentifier(n) || isNamePosition(n) || isDeclarationName(n)) return;
    const p = n.parent;
    if (req && n.text === req) {
      const viaMiddleware = ts.isCallExpression(p) && p.arguments[0] === n
        && calleeIs(b, p, MIDDLEWARE_MODULE, MIDDLEWARE);
      const viaUrl = !!urlDecl && ts.isPropertyAccessExpression(p) && p.expression === n
        && p.name.text === 'url' && p.parent === urlDecl.initializer;
      if (!viaMiddleware && !viaUrl) {
        problems.push(`${lineOf(sf, n)}: reads the request outside withApiMiddleware(${req}) and new URL(${req}.url)`);
      }
      return;
    }
    if (sp && n.text === sp) {
      if (!(ts.isPropertyAccessExpression(p) && p.expression === n && sanctionedGets.has(p.parent))) {
        problems.push(`${lineOf(sf, n)}: reads ${sp} other than the one const ... = ${sp}.get('jobId')`);
      }
      return;
    }
    if (mids.has(n.text)) {
      if (!(ts.isPropertyAccessExpression(p) && p.expression === n && MIDDLEWARE_FIELDS.has(p.name.text))) {
        problems.push(`${lineOf(sf, n)}: reads ${n.text} other than .error/.userId/.authContext`);
      }
    }
  });

  return { polled, problems };
}

/**
 * Index of the first top-level statement of `body` at which the ownership
 * refusal has fully happened (the `if` after the `const`), or -1. Only a
 * check whose user argument is `<user>.userId` counts, where `<user>` is the
 * `const` result of `withApiMiddleware(...)` declared earlier in the same body
 * — the caller the middleware authenticated, and the same user the guarded
 * key-export call resolves for — and whose third argument is the polled id.
 */
function guardIndex(b: Bound, body: ts.Block, polled: Set<string>, user: string): number {
  const authenticated = new Set<string>();
  const verdicts = new Set<string>();
  for (let i = 0; i < body.statements.length; i++) {
    const statement = body.statements[i];
    if (ts.isVariableStatement(statement) && isConst(statement.declarationList)) {
      for (const decl of statement.declarationList.declarations) {
        const call = unwrapAwait(decl.initializer);
        if (!ts.isIdentifier(decl.name) || !call || !ts.isCallExpression(call)) continue;
        if (calleeIs(b, call, MIDDLEWARE_MODULE, MIDDLEWARE)) {
          authenticated.add(decl.name.text);
          continue;
        }
        if (
          calleeIs(b, call, OWNERSHIP_MODULE, VERIFY)
          && call.arguments.length === 3
          && authenticatedUserBase(call.arguments[0]) === user
          && authenticated.has(user)
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

function enclosingFunction(node: ts.Node): ts.FunctionLikeDeclaration | undefined {
  for (let n: ts.Node | undefined = node.parent; n; n = n.parent) {
    if (ts.isFunctionLike(n)) return n as ts.FunctionLikeDeclaration;
  }
  return undefined;
}

function topLevelIndex(body: ts.Block, node: ts.Node): number {
  let n: ts.Node = node;
  while (n.parent && n.parent !== body) n = n.parent;
  return body.statements.indexOf(n as ts.Statement);
}

/** Is `node` the callee of a call, directly or as `<x>.<node>(...)`? */
function isCallee(node: ts.Node): boolean {
  const p = node.parent;
  if (ts.isCallExpression(p) && p.expression === node) return true;
  return ts.isPropertyAccessExpression(p) && p.name === node
    && ts.isCallExpression(p.parent) && p.parent.expression === p;
}

/**
 * Is this dynamic import of the resolver followable — awaited straight into an
 * object pattern (alone, or as one element of `await Promise.all([...])`) whose
 * every key is spelled out and none is a key export (`KEY_EXPORTS`)? `capabilities/route.ts`
 * lazily imports `listConfiguredProviders` this way. Anything else (a module
 * object kept in a variable, a rest element, a computed key) is untraceable.
 */
function destructuresWithoutResolve(importCall: ts.CallExpression, keys: ReadonlySet<string>): boolean {
  let pattern: ts.BindingName | undefined;
  const awaited = importCall.parent;
  if (ts.isAwaitExpression(awaited) && ts.isVariableDeclaration(awaited.parent)) {
    pattern = awaited.parent.name;
  } else if (ts.isArrayLiteralExpression(awaited)) {
    const index = awaited.elements.indexOf(importCall);
    const all = awaited.parent;
    if (
      ts.isCallExpression(all) && all.arguments[0] === awaited
      && ts.isPropertyAccessExpression(all.expression) && ts.isIdentifier(all.expression.expression)
      && all.expression.expression.text === 'Promise' && all.expression.name.text === 'all'
      && ts.isAwaitExpression(all.parent) && ts.isVariableDeclaration(all.parent.parent)
      && ts.isArrayBindingPattern(all.parent.parent.name)
    ) {
      const element = all.parent.parent.name.elements[index];
      if (element && ts.isBindingElement(element) && !element.dotDotDotToken) pattern = element.name;
    }
  }
  return !!pattern && ts.isObjectBindingPattern(pattern) && pattern.elements.every((el) => {
    const key = el.propertyName ?? el.name;
    return !el.dotDotDotToken && ts.isIdentifier(key) && !keys.has(key.text);
  });
}

export interface StatusRouteAnalysis {
  /** Executable calls of a key export — `resolveApiKey(...)`, `resolveByokOrPlatformKey(...)` (comments and strings are not calls). */
  keyResolutions: number;
  /** Each key resolution with no ownership refusal ahead of it, by line. */
  unguarded: string[];
  /** References to the resolver the gate cannot follow (an alias, a namespace, a dynamic import). */
  untraceable: string[];
  /** Ways a key-resolving handler reads the request other than the polled jobId. */
  foreignInputs: string[];
}

/** Local names bound by a named import of ANY key export (`KEY_EXPORTS`), from ANY specifier. */
function importedKeyNames(b: Bound, keys: ReadonlySet<string>): Set<string> {
  const out = new Set<string>();
  for (const name of keys) for (const local of importedLocalNames(b, ANY_MODULE, name)) out.add(local);
  return out;
}

/**
 * The MODULES a key-resolving route may take values from. Request headers
 * and cookies reach a handler through a module as well as through its
 * parameter — `next/headers` is one, under any spelling tsc resolves
 * (`next/headers.js`, a relative path into node_modules), and a dynamic
 * `import()` or `require()` can name it, or anything else, at run time. So
 * this is a whitelist of modules, not a list of the ones known to read the
 * request (#9736: the set of ways is unbounded):
 *
 * - a runtime static import must be `next/server` or resolve to the app's own
 *   source under `web/src` (whose request reads, if any, are the helper-module
 *   limit stated in the docblock);
 * - no `import x = require(...)`, no `import(...)` and no `require` reference
 *   at all — the gate cannot see what such a module is.
 */
function moduleInputProblems(b: Bound): string[] {
  const { sf } = b;
  const problems: string[] = [];
  for (const statement of sf.statements) {
    if (ts.isImportEqualsDeclaration(statement) && !statement.isTypeOnly
      && ts.isExternalModuleReference(statement.moduleReference)) {
      problems.push(`${lineOf(sf, statement)}: an import-equals require (a module the gate cannot vet)`);
    }
    if (!ts.isImportDeclaration(statement) || !ts.isStringLiteral(statement.moduleSpecifier)) continue;
    if (statement.importClause?.isTypeOnly) continue;
    const specifier = statement.moduleSpecifier.text;
    if (namesModule(b, specifier, NEXT_SERVER_MODULE)) continue;
    if (isAppSourceFile(resolveModuleFile(specifier, b.containingFile))) continue;
    problems.push(`${lineOf(sf, statement)}: imports '${specifier}', which is neither ${NEXT_SERVER_MODULE} nor app source `
      + 'under src/ (next/headers and other modules can read request headers and cookies)');
  }
  forEachDescendant(sf, (n) => {
    if (ts.isCallExpression(n) && n.expression.kind === ts.SyntaxKind.ImportKeyword) {
      problems.push(`${lineOf(sf, n)}: a dynamic import() (a module the gate cannot vet)`);
    }
    if (ts.isIdentifier(n) && n.text === 'require' && !isDeclarationName(n)
      && !(ts.isPropertyAssignment(n.parent) && n.parent.name === n)) {
      problems.push(`${lineOf(sf, n)}: a require reference (a module the gate cannot vet)`);
    }
  });
  return problems;
}

/**
 * The GLOBALS a key-resolving route may read, and how. A module can be
 * fetched at run time with no import at all — `process.getBuiltinModule(
 * 'module').createRequire(import.meta.url)('next/headers')`, through
 * `globalThis`, `eval`, `Function`, `Reflect`, or `(0).constructor.constructor(
 * 'return process')()` — so, like the module rule, this is a whitelist of the
 * ways in, not a list of the known escapes (#9736):
 *
 * - an identifier that resolves to no declaration in the file (a global) must
 *   be one of these, used only in the way listed: `'value'` any use; `'new'`
 *   only as `new X(...)`; a member list only as `X.<member>(...)`;
 * - no identifier, property name or string anywhere in the file is
 *   `constructor`, `prototype` or `__proto__` (the path from ANY value to
 *   `Function`, and so to every global);
 * - an element access takes a string or number LITERAL, so a computed name
 *   (`x['con' + 'structor']`) cannot rebuild one.
 *
 * `arguments` and `require` have rules of their own and are not repeated here.
 */
const ALLOWED_GLOBALS: Readonly<Record<string, 'value' | 'new' | readonly string[]>> = {
  undefined: 'value',
  NaN: 'value',
  Infinity: 'value',
  JSON: 'value',
  Math: 'value',
  Number: 'value',
  String: 'value',
  Boolean: 'value',
  URL: 'new',
  Error: 'new',
  // Object.getPrototypeOf / getOwnPropertyDescriptor reach Function: members are listed.
  Object: ['keys', 'values', 'entries'],
};
const FUNCTION_PATH_NAMES = new Set(['constructor', 'prototype', '__proto__']);

/** Is `n` in a TYPE position (erased, so it reads nothing at run time)? */
function isTypePosition(n: ts.Node): boolean {
  if (ts.isExpressionWithTypeArguments(n) && ts.isHeritageClause(n.parent)
    && n.parent.token === ts.SyntaxKind.ExtendsKeyword && ts.isClassLike(n.parent.parent)) return false;
  return ts.isTypeNode(n) || ts.isInterfaceDeclaration(n) || ts.isTypeAliasDeclaration(n)
    || ts.isImportDeclaration(n) || ts.isExportDeclaration(n);
}

function globalInputProblems(b: Bound): string[] {
  const { sf, checker } = b;
  const problems: string[] = [];
  const declaredHere = (s: ts.Symbol | undefined) => !!s?.declarations?.some((d) => d.getSourceFile() === sf);
  const visit = (n: ts.Node): void => {
    if (isTypePosition(n)) return;
    if ((ts.isIdentifier(n) || ts.isStringLiteralLike(n)) && FUNCTION_PATH_NAMES.has(n.text)) {
      problems.push(`${lineOf(sf, n)}: names '${n.text}', the path from any value to Function and so to every global`);
    }
    if (ts.isElementAccessExpression(n)) {
      const arg = n.argumentExpression;
      if (!ts.isStringLiteralLike(arg) && !ts.isNumericLiteral(arg)) {
        problems.push(`${lineOf(sf, n)}: an element access by a computed name (only a string or number literal is readable)`);
      }
    }
    if (ts.isIdentifier(n) && !isNamePosition(n) && n.text !== 'arguments' && n.text !== 'require') {
      const symbol = ts.isShorthandPropertyAssignment(n.parent) && n.parent.name === n
        ? checker.getShorthandAssignmentValueSymbol(n.parent)
        : checker.getSymbolAtLocation(n);
      if (!declaredHere(symbol)) {
        const allowed = hasOwn(ALLOWED_GLOBALS, n.text) ? ALLOWED_GLOBALS[n.text] : undefined;
        const p = n.parent;
        const ok = allowed === 'value'
          || (allowed === 'new' && ts.isNewExpression(p) && p.expression === n)
          || (Array.isArray(allowed) && ts.isPropertyAccessExpression(p) && p.expression === n
            && allowed.includes(p.name.text) && ts.isCallExpression(p.parent) && p.parent.expression === p);
        if (!ok) {
          problems.push(`${lineOf(sf, n)}: reads the global '${n.text}'${allowed ? ' in a way not allowed' : ''} `
            + '(a global can fetch a module or the request at run time; see ALLOWED_GLOBALS)');
        }
      }
    }
    ts.forEachChild(n, visit);
  };
  visit(sf);
  return problems;
}

/**
 * `keys` is the key-export set to select by: `KEY_EXPORTS`, derived from the
 * real resolver, except where a probe derives it from an EDITED resolver source.
 */
export function analyseStatusRoute(
  source: string,
  fileName = 'route.ts',
  keys: ReadonlySet<string> = KEY_EXPORTS,
): StatusRouteAnalysis {
  const b = bind(fileName, source);
  const { sf } = b;
  // A named import of any key export under ANY local name, from ANY
  // specifier: the name is what gets called, and over-counting only makes the
  // gate stricter. (A specifier that does not resolve to the resolver — an
  // unrelated module, or a relative path in a copy of the tree — still counts.)
  const resolveNames = importedKeyNames(b, keys);
  const out: StatusRouteAnalysis = { keyResolutions: 0, unguarded: [], untraceable: [], foreignInputs: [] };
  out.foreignInputs.push(...moduleInputProblems(b), ...globalInputProblems(b));
  const inputs = new Map<ts.FunctionLikeDeclaration, HandlerInputs>();

  for (const statement of sf.statements) {
    // `import keys = require('...')`: a module object, like a namespace import.
    if (
      ts.isImportEqualsDeclaration(statement) && !statement.isTypeOnly
      && ts.isExternalModuleReference(statement.moduleReference)
      && ts.isStringLiteral(statement.moduleReference.expression)
      && namesModule(b, statement.moduleReference.expression.text, RESOLVER_MODULE)
    ) {
      out.untraceable.push(`${lineOf(sf, statement)}: an import-equals of ${RESOLVER_MODULE}`);
    }
    if (!ts.isImportDeclaration(statement) || !ts.isStringLiteral(statement.moduleSpecifier)) continue;
    const clause = statement.importClause;
    if (namesModule(b, statement.moduleSpecifier.text, RESOLVER_MODULE) && clause && !clause.isTypeOnly
      && (clause.name || (clause.namedBindings && ts.isNamespaceImport(clause.namedBindings)))) {
      out.untraceable.push(`${lineOf(sf, statement)}: a default or namespace import of ${RESOLVER_MODULE}`);
    }
  }

  const isResolveName = (text: string) => keys.has(text) || resolveNames.has(text);

  const visit = (node: ts.Node): void => {
    // `import('@/lib/keys/resolver')` / `require(...)`: a resolver the gate cannot follow.
    if (
      ts.isCallExpression(node)
      && (node.expression.kind === ts.SyntaxKind.ImportKeyword
        || (ts.isIdentifier(node.expression) && node.expression.text === 'require'))
      && node.arguments.length > 0 && ts.isStringLiteralLike(node.arguments[0])
      && namesModule(b, node.arguments[0].text, RESOLVER_MODULE)
      && !destructuresWithoutResolve(node, keys)
    ) {
      out.untraceable.push(`${lineOf(sf, node)}: a dynamic import of ${RESOLVER_MODULE}`);
    }
    // A key export (`resolveApiKey`, `resolveByokOrPlatformKey`, ...) named
    // anywhere it is not being CALLED — `const rk = resolveApiKey`,
    // `{ resolveApiKey: rk } = keys`, `keys['resolveApiKey']`: an alias whose
    // calls this gate would not count.
    if (ts.isIdentifier(node) && isResolveName(node.text) && !isCallee(node) && !isDeclarationName(node)) {
      const p = node.parent;
      // Only an import specifier, or the KEY of an object member, names it
      // without reading it. A property read (`keys.resolveApiKey`), a
      // destructuring key, a shorthand `{ resolveApiKey }`, a value
      // `{ x: resolveApiKey }` and an export all hand the function on.
      const memberKey = (ts.isPropertyAssignment(p) || ts.isPropertyDeclaration(p) || ts.isMethodDeclaration(p)
        || ts.isPropertySignature(p) || ts.isMethodSignature(p)) && p.name === node;
      if (!ts.isImportSpecifier(p) && !memberKey) {
        out.untraceable.push(`${lineOf(sf, node)}: ${node.text} referenced without being called`);
      }
    }
    if (ts.isElementAccessExpression(node) && ts.isStringLiteralLike(node.argumentExpression)
      && keys.has(node.argumentExpression.text)) {
      out.untraceable.push(`${lineOf(sf, node)}: ${node.argumentExpression.text} read by element access`);
    }
    if (ts.isCallExpression(node)) {
      const callee = node.expression;
      // Any call spelled as a key export — through the resolved import, an
      // alias of it, or a namespace (`keys.resolveApiKey`) — is a key
      // resolution. Over-counting only makes the gate stricter.
      const isResolve = (ts.isIdentifier(callee) && isResolveName(callee.text))
        || (ts.isPropertyAccessExpression(callee) && keys.has(callee.name.text));
      if (isResolve) {
        out.keyResolutions += 1;
        const fn = enclosingFunction(node);
        const body = fn?.body && ts.isBlock(fn.body) ? fn.body : undefined;
        // The handler's OWN body: a key resolved in a nested function is
        // reported, because the guard and the inputs are read per body.
        const nested = !!fn && !!enclosingFunction(fn);
        let guarded = false;
        if (fn && body && !nested) {
          let handler = inputs.get(fn);
          if (!handler) {
            handler = handlerInputs(b, fn, body);
            inputs.set(fn, handler);
          }
          // The key is resolved for THIS user; the refusal must be for the same
          // one. A call whose user is not `<mid>.userId` has no guard by design.
          const user = authenticatedUserBase(node.arguments[0]);
          const guard = user ? guardIndex(b, body, handler.polled, user) : -1;
          guarded = guard >= 0 && guard < topLevelIndex(body, node);
        }
        if (!guarded) out.unguarded.push(lineOf(sf, node));
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
  for (const handler of inputs.values()) out.foreignInputs.push(...handler.problems);
  out.foreignInputs = [...new Set(out.foreignInputs)];
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
  const b = bind(fileName, source);
  const out: PostRouteAnalysis = { handlers: 0, binding: 0 };
  const visit = (node: ts.Node): void => {
    if (ts.isCallExpression(node) && calleeIs(b, node, HANDLER_MODULE, HANDLER)) {
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
  visit(b.sf);
  return out;
}

// ---------------------------------------------------------------------------
// Exemptions: routes that resolve a key but poll no job the caller names.
// Each carries a reason AND a property re-checked on every run.
// ---------------------------------------------------------------------------

type ExemptionKind = 'charged-new-operation' | 'bundled-step-of-charged-generation' | 'qstash-signed-callback';

interface Exemption {
  kind: ExemptionKind;
  reason: string;
}

/**
 * Keyed by path under `src/app`, `/`-separated. Adding an entry is a security
 * decision: say why the route cannot read another user's job, and pick the
 * kind whose property the gate re-checks.
 */
export const KEY_RESOLVING_EXEMPTIONS: Readonly<Record<string, Exemption>> = {
  'api/chat/route.ts': {
    kind: 'charged-new-operation',
    reason: 'Resolves the Anthropic key to meter a NEW chat turn the caller starts and pays for; it reads no provider job id.',
  },
  'api/game/decompose/route.ts': {
    kind: 'charged-new-operation',
    reason: 'Billing-only resolution (deduct up front, refund on failure) for a new decomposition; it reads no provider job id.',
  },
  'api/generate/sprite/route.ts': {
    kind: 'bundled-step-of-charged-generation',
    reason: 'Resolves the remove.bg key (resolveByokOrPlatformKey) inside the execute step of a NEW sprite generation '
      + 'that createGenerationHandler has already charged for, for the caller it authenticated; it polls no job (#9734).',
  },
  'api/generate/voice/batch/route.ts': {
    kind: 'charged-new-operation',
    reason: 'Resolves the ElevenLabs key for a new, synchronous, token-charged batch the caller submits; nothing is polled.',
  },
  'api/webhooks/generation-complete/route.ts': {
    kind: 'qstash-signed-callback',
    reason: 'The durable QStash callback has no signed-in caller: the user and job come from a payload signed with the '
      + 'QStash keys, which only our own generate route publishes, and the signature is verified before the key is resolved.',
  },
};

/**
 * Status routes the poller dials that resolve NO key themselves, pinned so
 * adding one is a decision rather than a silent exemption. `music/status`
 * answers a static terminal state (ElevenLabs music is synchronous; see its
 * docblock).
 */
const STATUS_ROUTES_RESOLVING_NO_KEY = ['api/generate/music/status/route.ts'];

/** Calls spelled as a key export (or `<x>.<key export>`, or an imported alias of one) in a parsed file. */
function resolveCalls(b: Bound, keys: ReadonlySet<string>): ts.CallExpression[] {
  const { sf } = b;
  const names = importedKeyNames(b, keys);
  const out: ts.CallExpression[] = [];
  const visit = (node: ts.Node): void => {
    if (ts.isCallExpression(node)) {
      const c = node.expression;
      if ((ts.isIdentifier(c) && (keys.has(c.text) || names.has(c.text)))
        || (ts.isPropertyAccessExpression(c) && keys.has(c.name.text))) {
        out.push(node);
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
  return out;
}

/** Every `<x>.get('jobId')` in the file: a route that reads one polls a job and needs the ownership check. */
function jobIdReads(sf: ts.SourceFile): string[] {
  const out: string[] = [];
  forEachDescendant(sf, (n) => {
    if (
      ts.isCallExpression(n) && ts.isPropertyAccessExpression(n.expression) && n.expression.name.text === 'get'
      && n.arguments.length === 1 && ts.isStringLiteralLike(n.arguments[0]) && n.arguments[0].text === 'jobId'
    ) {
      out.push(`${lineOf(sf, n)}: reads a jobId, so it polls a job and needs the ownership check`);
    }
  });
  return out;
}

/**
 * Is `fn` the `execute` member of the object literal passed as the first
 * argument to `createGenerationHandler` — the factory resolved by binding to
 * its real import (a same-named local factory charges nothing)?
 */
function isExecuteOfGenerationHandler(b: Bound, fn: ts.FunctionLikeDeclaration): boolean {
  let member: ts.Node = fn;
  if (!ts.isMethodDeclaration(fn)) {
    if (!ts.isPropertyAssignment(fn.parent) || fn.parent.initializer !== fn) return false;
    member = fn.parent;
  }
  const name = (member as ts.PropertyAssignment | ts.MethodDeclaration).name;
  if (!ts.isIdentifier(name) || name.text !== 'execute') return false;
  const config = member.parent;
  if (!ts.isObjectLiteralExpression(config)) return false;
  const factory = config.parent;
  return ts.isCallExpression(factory) && factory.arguments[0] === config && calleeIs(b, factory, HANDLER_MODULE, HANDLER);
}

/** The property an exemption's kind promises, re-checked against the source. */
export function exemptionProblems(
  kind: ExemptionKind,
  source: string,
  fileName = 'route.ts',
  keys: ReadonlySet<string> = KEY_EXPORTS,
): string[] {
  const b = bind(fileName, source);
  const { sf } = b;
  const problems: string[] = [];
  const calls = resolveCalls(b, keys);
  if (calls.length === 0) problems.push('resolves no key: the exemption is stale');

  if (kind === 'charged-new-operation') {
    // A status poll is the zero-cost STATUS_CHECK_OPERATION pair, the one the
    // resolver waives its checks for. A charged new operation is neither.
    for (const call of calls) {
      const [, , cost, operation] = call.arguments;
      const free = !cost || (ts.isNumericLiteral(cost) && Number(cost.text) === 0);
      const statusCheck = !operation
        || (ts.isIdentifier(operation) && operation.text === STATUS_CHECK_CONST)
        || (ts.isPropertyAccessExpression(operation) && operation.name.text === STATUS_CHECK_CONST)
        || (ts.isStringLiteralLike(operation) && operation.text === STATUS_CHECK_LITERAL);
      if (free || statusCheck) {
        problems.push(`${lineOf(sf, call)}: a zero-cost or status-check key resolution is a poll, not a charged new operation`);
      }
    }
    problems.push(...jobIdReads(sf));
  } else if (kind === 'bundled-step-of-charged-generation') {
    // Each resolution runs in the `execute` step of a createGenerationHandler
    // config — which runs only after the handler has resolved and charged the
    // primary generation's key — in that function itself (not a nested one), for
    // `<ctx>.userId`, where `<ctx>` is execute's third parameter: the user the
    // handler authenticated, not a value the request names.
    for (const call of calls) {
      const fn = enclosingFunction(call);
      if (!fn || !isExecuteOfGenerationHandler(b, fn)) {
        problems.push(`${lineOf(sf, call)}: not in the execute step of a ${HANDLER}({...}) config, so nothing charged precedes it`);
        continue;
      }
      const ctxParam = fn.parameters[2];
      const ctx = ctxParam && ts.isIdentifier(ctxParam.name) ? ctxParam.name.text : undefined;
      if (!ctx || authenticatedUserBase(call.arguments[0]) !== ctx) {
        problems.push(`${lineOf(sf, call)}: the key is not resolved for <ctx>.userId (execute's third parameter)`);
      }
    }
    problems.push(...jobIdReads(sf));
  } else {
    // Each resolution follows, in its own body, `const <v> = await
    // verifyQstashSignature(...)` and `if (!<v>) return ...`.
    for (const call of calls) {
      const fn = enclosingFunction(call);
      const body = fn?.body && ts.isBlock(fn.body) ? fn.body : undefined;
      const at = body ? topLevelIndex(body, call) : -1;
      let verified: string | undefined;
      let refused = false;
      for (let i = 0; body && i < at; i++) {
        const st = body.statements[i];
        if (ts.isVariableStatement(st) && isConst(st.declarationList)) {
          for (const d of st.declarationList.declarations) {
            const c = unwrapAwait(d.initializer);
            if (ts.isIdentifier(d.name) && c && ts.isCallExpression(c) && calleeIs(b, c, QSTASH_MODULE, QSTASH_VERIFY)) {
              verified = d.name.text;
            }
          }
        }
        if (verified && ts.isIfStatement(st) && !st.elseStatement && returnsValue(st.thenStatement)) {
          let e = st.expression;
          while (ts.isParenthesizedExpression(e)) e = e.expression;
          if (ts.isPrefixUnaryExpression(e) && e.operator === ts.SyntaxKind.ExclamationToken
            && ts.isIdentifier(e.operand) && e.operand.text === verified) {
            refused = true;
          }
        }
      }
      if (!refused) {
        problems.push(`${lineOf(sf, call)}: no ${QSTASH_VERIFY} refusal ahead of the key resolution in the same body`);
      }
    }
  }
  return problems;
}

// ---------------------------------------------------------------------------
// The walk and the audit.
// ---------------------------------------------------------------------------

/** The route files Next.js would serve from `dir`, in any spelling it routes. */
function routeFilesIn(dir: string): string[] {
  return readdirSync(dir)
    .filter((entry) => ROUTE_FILE.test(entry) && statSync(path.join(dir, entry)).isFile())
    .map((entry) => path.join(dir, entry));
}

/** Every route file under `root`, at any depth and any spelling. */
export function walkRouteFiles(root: string, out: string[] = []): string[] {
  out.push(...routeFilesIn(root));
  for (const entry of readdirSync(root)) {
    const full = path.join(root, entry);
    if (entry === '__tests__' || entry === 'node_modules' || !statSync(full).isDirectory()) continue;
    walkRouteFiles(full, out);
  }
  return out;
}

const hasOwn = (obj: object, key: string): boolean => Object.prototype.hasOwnProperty.call(obj, key);

const relTo = (root: string, file: string): string => path.relative(root, file).split(path.sep).join('/');

/** The URL a route file under `src/app` serves (route groups `(x)` are not URL segments). */
export function urlOf(rel: string): string {
  const segments = path.posix.dirname(rel).split('/').filter((s) => s && !/^\(.*\)$/.test(s));
  return `/${segments.join('/')}`;
}

/**
 * The status endpoints the poller dials (`STATUS_ENDPOINTS`) that no walked
 * route serves. Source-derived, so it shrinks and grows with the map rather
 * than with a hand-kept count (lessons-learned #18).
 */
export function unwalkedStatusEndpoints(rels: readonly string[], endpoints: readonly string[]): string[] {
  const walked = new Set(rels.map(urlOf));
  return endpoints.filter((endpoint) => !walked.has(endpoint));
}

/**
 * The POST route that issues the ids a key-resolving route polls: the route
 * file(s) in the NEAREST ancestor directory that call `createGenerationHandler`
 * (`generate/model/status/route.ts` and `generate/model/status/[jobId]/route.ts`
 * both find `generate/model/route.ts`). Every handler there must bind.
 */
function postBindingProblems(appRoot: string, file: string): string[] {
  for (let dir = path.dirname(path.dirname(file)); dir.startsWith(appRoot); dir = path.dirname(dir)) {
    const posts = routeFilesIn(dir).map((f) => analysePostRoute(readFileSync(f, 'utf8'), f));
    const handlers = posts.reduce((n, p) => n + p.handlers, 0);
    if (handlers === 0) {
      if (dir === appRoot) break;
      continue;
    }
    const binding = posts.reduce((n, p) => n + p.binding, 0);
    return binding === handlers
      ? []
      : [`${relTo(appRoot, dir)}/route.*: ${handlers - binding} handler(s) set neither jobIdForOwnership nor asyncJob.providerJobId`];
  }
  return [`no ${HANDLER}({...}) POST route in any directory above it binds the job ids it hands out`];
}

export interface RouteAudit {
  rel: string;
  file: string;
  source: string;
  analysis: StatusRouteAnalysis;
  exemption?: Exemption;
  problems: string[];
}

/** Every route under `appRoot` that resolves a provider key, and what is wrong with each. */
export function auditKeyResolvingRoutes(
  appRoot: string,
  exemptions: Readonly<Record<string, Exemption>> = KEY_RESOLVING_EXEMPTIONS,
  keys: ReadonlySet<string> = KEY_EXPORTS,
): RouteAudit[] {
  const out: RouteAudit[] = [];
  for (const file of walkRouteFiles(appRoot)) {
    const source = readFileSync(file, 'utf8');
    const analysis = analyseStatusRoute(source, file, keys);
    if (analysis.keyResolutions === 0 && analysis.untraceable.length === 0) continue;
    const rel = relTo(appRoot, file);
    const exemption = hasOwn(exemptions, rel) ? exemptions[rel] : undefined;
    const problems = analysis.untraceable.map((w) => `${w} (the gate cannot follow it)`);
    if (exemption) {
      problems.push(...exemptionProblems(exemption.kind, source, file, keys).map((p) => `exemption (${exemption.kind}): ${p}`));
    } else {
      problems.push(...analysis.unguarded.map((w) => `${w}: a provider key is resolved without an ownership refusal ahead of it`));
      problems.push(...analysis.foreignInputs);
      problems.push(...postBindingProblems(appRoot, file));
    }
    out.push({ rel, file, source, analysis, exemption, problems });
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
const HANDLER_OPEN = /^(async function GET_impl\(request: NextRequest\) \{)$/m;
const PROVIDER_CALL = /\bclient\.(\w+)\(jobId\)/;
const POLLED_ID = /^([ \t]*)const jobId = searchParams\.get\('jobId'\);$/m;

/** Every way in which `audit` is not clean, flattened for one assertion. */
const problemsOf = (audits: RouteAudit[]): string[] => audits.flatMap((a) => a.problems.map((p) => `${a.rel} ${p}`));

/**
 * The placeholder names the synthetic fixtures below use (`p`, `op`,
 * `refuse`, ...), bound by an import from app source so the global rule
 * (`globalInputProblems`) reads them as bindings, not globals.
 */
const FIXTURE_BINDINGS = "import { p, op, refuse, client, flag, meta } from '@/lib/generate/jobOwnershipResponse';\n";

describe('job-id ownership coverage (#10262)', () => {
  const allRels = walkRouteFiles(APP_ROOT).map((f) => relTo(APP_ROOT, f));
  const audits = auditKeyResolvingRoutes(APP_ROOT);
  const guarded = audits.filter((a) => !a.exemption);
  const endpoints: readonly string[] = Object.values(STATUS_ENDPOINTS);
  const statusRels = allRels.filter((rel) => endpoints.includes(urlOf(rel)));

  it('walks a route for EVERY endpoint the poller dials (source-derived floor)', () => {
    // The floor is the map in src/lib/generation/statusEndpoints.ts, not a
    // count: a route renamed or moved out of the walk is NAMED here instead of
    // silently shrinking the set every later check runs over.
    expect(endpoints.length).toBeGreaterThan(0);
    expect(unwalkedStatusEndpoints(allRels, endpoints)).toEqual([]);
    expect(statusRels.length).toBe(endpoints.length);
  });

  it('SELECTS every status endpoint route but the pinned no-key set, by the property (it resolves a key)', () => {
    const selected = new Set(audits.map((a) => a.rel));
    const resolvingNone = statusRels.filter((rel) => !selected.has(rel)).sort();
    expect(resolvingNone).toEqual(STATUS_ROUTES_RESOLVING_NO_KEY);
    // None of them is waved through by an exemption: they are polls.
    expect(statusRels.filter((rel) => hasOwn(KEY_RESOLVING_EXEMPTIONS, rel))).toEqual([]);
    // Vacuity floor: the guarded set is at least the key-resolving status routes.
    expect(guarded.length).toBeGreaterThanOrEqual(endpoints.length - STATUS_ROUTES_RESOLVING_NO_KEY.length);
  });

  it('every exemption is a route that still resolves a key and still has its stated property', () => {
    const selected = new Map(audits.map((a) => [a.rel, a]));
    for (const [rel, exemption] of Object.entries(KEY_RESOLVING_EXEMPTIONS)) {
      expect(exemption.reason.length, rel).toBeGreaterThan(20);
      expect(allRels, `${rel} is exempt but is not a route file`).toContain(rel);
      expect(selected.has(rel), `${rel} is exempt but resolves no key: drop the exemption`).toBe(true);
      expect(selected.get(rel)?.problems, rel).toEqual([]);
    }
  });

  it('every key-resolving route refuses a non-owner before the key, reads only the polled id, and binds its POST', () => {
    const problems = problemsOf(audits);
    expect(
      problems,
      `${problems.length} problem(s). A route that resolves a provider key must, in the same function body and `
      + 'before the call: `const ownership = await verifyProviderJobOwner(mid.userId!, provider, jobId);` + '
      + "`if (ownership !== 'owner') return jobOwnershipRefusal(ownership);`, where `mid` is this body's "
      + '`await withApiMiddleware(...)`, `jobId` is its one `searchParams.get(\'jobId\')`, and the call resolves '
      + 'the key for the same `mid.userId!` — or be in KEY_RESOLVING_EXEMPTIONS with a reason. A key is any '
      + 'export of @/lib/keys/resolver but the pinned NON_KEY_RESOLVER_EXPORTS (resolveApiKey, '
      + 'resolveByokOrPlatformKey, ...). Such a route also reads nothing else from the outside: it imports '
      + 'only next/server and app source under web/src (no bare package such as zod, no next/headers; no '
      + 'import(), require, module.require or import =), and reads only the globals in ALLOWED_GLOBALS '
      + '(new URL, Object.keys/values/entries, JSON, Math, ... — never process, globalThis, eval or Function), '
      + 'with no constructor/prototype/__proto__ and no computed element access — move anything else into an '
      + 'app helper under src/lib. See src/lib/generate/jobOwnership.ts and .claude/skills/generate-route/SKILL.md Step 4.',
    ).toEqual([]);
  });

  // -------------------------------------------------------------------------
  // The gate can REPORT. Mutations run against the REAL sources, and each
  // asserts it applied before its result is trusted.
  // -------------------------------------------------------------------------

  const guardedStatus = guarded.filter((a) => statusRels.includes(a.rel));

  it('names the endpoint when any ONE real status route drops out of the walk', () => {
    expect(statusRels.length).toBeGreaterThan(0);
    for (const rel of statusRels) {
      expect(unwalkedStatusEndpoints(allRels.filter((x) => x !== rel), endpoints), rel).toEqual([urlOf(rel)]);
    }
  });

  it('reports each real status route with its refusal DELETED', () => {
    expect(guardedStatus.length).toBeGreaterThan(0);
    for (const r of guardedStatus) {
      const mutated = mutate(r.source, GUARD_IF, '');
      expect(analyseStatusRoute(mutated, r.file).unguarded, r.rel).not.toEqual([]);
    }
  });

  it('reports each real status route with its check COMMENTED OUT', () => {
    for (const r of guardedStatus) {
      let mutated = mutate(r.source, GUARD_IF, '  // if (ownership !== \'owner\') return jobOwnershipRefusal(ownership);');
      mutated = mutate(mutated, GUARD_CONST, '$1// $2');
      expect(analyseStatusRoute(mutated, r.file).unguarded, r.rel).not.toEqual([]);
    }
  });

  it("reports each real status route whose refusal tests the MISS ('not_owner') instead of the hit", () => {
    // The fail-open shape for a three-state verdict: 'unverifiable' (a failed
    // lookup) would sail past this to the platform key.
    for (const r of guardedStatus) {
      const mutated = mutate(r.source, /ownership !== 'owner'/, "ownership === 'not_owner'");
      expect(analyseStatusRoute(mutated, r.file).unguarded, r.rel).not.toEqual([]);
    }
  });

  it('reports each real status route whose check runs on something other than the polled jobId', () => {
    for (const r of guardedStatus) {
      const mutated = mutate(r.source, /(verifyProviderJobOwner\([^)]*), jobId\)/, '$1, otherId)');
      expect(analyseStatusRoute(mutated, r.file).unguarded, r.rel).not.toEqual([]);
    }
  });

  it('reports each real status route whose check runs against a CALLER-CHOSEN user', () => {
    // The check would then answer 'owner' for whoever the caller names, and the
    // key would be resolved behind it. Exactly one occurrence per route, so the
    // mutation is the whole difference.
    for (const r of guardedStatus) {
      expect(r.source.match(/verifyProviderJobOwner\(mid\.userId!, /g), r.rel).toHaveLength(1);
      const mutated = mutate(
        r.source,
        /verifyProviderJobOwner\(mid\.userId!, /,
        "verifyProviderJobOwner(searchParams.get('userId')!, ",
      );
      expect(analyseStatusRoute(mutated, r.file).unguarded, r.rel).not.toEqual([]);
    }
  });

  it('reports each real status route whose check and key resolution name DIFFERENT users', () => {
    // Each half alone: the check for the authenticated user but the key for a
    // caller-chosen one, so the refusal guards a different principal.
    for (const r of guardedStatus) {
      const mutated = mutate(
        r.source,
        /(resolveApiKey\(\s*)mid\.userId!/,
        "$1searchParams.get('userId')!",
      );
      expect(analyseStatusRoute(mutated, r.file).unguarded, r.rel).not.toEqual([]);
    }
  });

  it('reports each real status route whose user does not come from withApiMiddleware', () => {
    for (const r of guardedStatus) {
      const mutated = mutate(
        r.source,
        /const mid = await withApiMiddleware\(/,
        'const mid = await parseCallerFromQuery(',
      );
      expect(analyseStatusRoute(mutated, r.file).unguarded, r.rel).not.toEqual([]);
    }
  });

  it('reports each real status route with verifyProviderJobOwner or withApiMiddleware SHADOWED inside the handler', () => {
    // Each compiles; tsc only rejects a TOP-LEVEL redeclaration (TS2440). The
    // callee must resolve to the import, per the binder, in every scope.
    const shadows = [
      "const verifyProviderJobOwner = async (..._a: unknown[]) => 'owner' as const;",
      "async function verifyProviderJobOwner(..._a: unknown[]) { return 'owner' as const; }",
      "const withApiMiddleware = async (..._a: unknown[]) => ({ userId: 'x', error: undefined } as never);",
      "function withApiMiddleware(..._a: unknown[]): never { throw new Error('x'); }",
    ];
    for (const r of guardedStatus) {
      for (const shadow of shadows) {
        const mutated = mutate(r.source, HANDLER_OPEN, `$1\n  ${shadow}`);
        expect(analyseStatusRoute(mutated, r.file).unguarded, `${r.rel}: ${shadow}`).not.toEqual([]);
      }
    }
  });

  it('reports each real status route that sends the provider a value other than the polled id', () => {
    // The checked id must be the one the provider is sent. Each spelling of
    // "read a second caller-chosen id" must leave the whitelist.
    for (const r of guardedStatus) {
      expect(r.source.match(new RegExp(PROVIDER_CALL.source, 'g')), r.rel).toHaveLength(1);
      const variants = [
        mutate(r.source, PROVIDER_CALL, "client.$1(searchParams.get('predictionId') ?? jobId)"),
        mutate(
          mutate(r.source, PROVIDER_CALL, 'client.$1(predictionId)'),
          POLLED_ID,
          "$&\n$1const predictionId = searchParams.get('predictionId') || jobId;",
        ),
        mutate(r.source, PROVIDER_CALL, "client.$1(request.nextUrl.searchParams.get('id') ?? jobId)"),
        mutate(r.source, PROVIDER_CALL, 'client.$1((await request.json()).id)'),
        mutate(r.source, PROVIDER_CALL, 'client.$1(mid.body?.id ?? jobId)'),
        mutate(r.source, HANDLER_OPEN, 'async function GET_impl(request: NextRequest, ctx: { params: Promise<{ id: string }> }) {'),
      ];
      for (const mutated of variants) {
        expect(analyseStatusRoute(mutated, r.file).foreignInputs, r.rel).not.toEqual([]);
      }
    }
  });

  it('reports each real status route that reads the request through `arguments`', () => {
    // `arguments[0]` is the request and `arguments[1]` the route params, under a
    // name no other rule looks for. Each variant feeds the provider call, and
    // the unmutated route is clean, so the report comes from the mutation.
    for (const r of guardedStatus) {
      expect(analyseStatusRoute(r.source, r.file).foreignInputs, r.rel).toEqual([]);
      expect(r.source.match(/\barguments\b/g), r.rel).toBeNull();
      const variants = [
        mutate(
          mutate(r.source, POLLED_ID, "$&\n$1const other = new URL(arguments[0].url).searchParams.get('taskId') ?? undefined;"),
          PROVIDER_CALL,
          'client.$1(other ?? jobId)',
        ),
        mutate(
          mutate(r.source, POLLED_ID, '$&\n$1const ctx = arguments[1] as { params: Promise<{ id: string }> };'),
          PROVIDER_CALL,
          'client.$1((await ctx.params).id)',
        ),
      ];
      for (const mutated of variants) {
        expect(mutated.match(/\barguments\[/g), r.rel).toHaveLength(1);
        expect(analyseStatusRoute(mutated, r.file).foreignInputs.join('\n'), r.rel).toMatch(/reads arguments/);
      }
    }
  });

  it('reports each real status route that reads request headers or cookies through a MODULE, in every spelling', () => {
    // next/headers needs no handler argument: headers() and cookies() read the
    // request from anywhere. Each variant feeds the provider a header or
    // cookie, and each is pinned to the rule that must report it, so a variant
    // caught by the wrong rule cannot read as coverage (lessons-learned #19).
    const headersFile = resolveModuleFile('next/headers', path.join(SYNTHETIC_DIR, 'route.ts'));
    expect(headersFile).toBeTruthy();
    // The `.js` spelling is the same module to tsc — the premise of the variant.
    expect(resolveModuleFile('next/headers.js', path.join(SYNTHETIC_DIR, 'route.ts'))).toBe(headersFile);
    const IMPORT_RULE = (spec: string) => new RegExp(`imports '${spec.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}', which is neither`);
    for (const r of guardedStatus) {
      expect(analyseStatusRoute(r.source, r.file).foreignInputs, r.rel).toEqual([]);
      expect(r.source.match(/\brequire\b|\bimport\(/g), r.rel).toBeNull();
      const feed = (lines: string, read: string, prepend = '') => prepend + mutate(
        mutate(r.source, POLLED_ID, `$&\n${lines.split('\n').map((l) => `$1${l}`).join('\n')}\n$1const other = ${read} ?? jobId;`),
        PROVIDER_CALL,
        'client.$1(other)',
      );
      const intoNodeModules = path.relative(path.dirname(r.file), headersFile!.replace(/\.d\.ts$/, '')).split(path.sep).join('/');
      const variants: Array<[string, string, RegExp]> = [
        ['static', feed('', "(await headers()).get('x-poll-id')", "import { headers } from 'next/headers';\n"), IMPORT_RULE('next/headers')],
        ['static .js', feed('', "(await headers()).get('x-poll-id')", "import { headers } from 'next/headers.js';\n"), IMPORT_RULE('next/headers.js')],
        ['static, a path into node_modules', feed('', "(await headers()).get('x-poll-id')", `import { headers } from '${intoNodeModules}';\n`), IMPORT_RULE(intoNodeModules)],
        ['dynamic import()', feed("const { headers } = await import('next/headers');", "(await headers()).get('x-poll-id')"), /a dynamic import\(\)/],
        ['require', feed("const nh = require('next/headers');", "(await nh.cookies()).get('poll')?.value"), /a require reference/],
        ['module.require', feed("const nh = module.require('next/headers');", "(await nh.cookies()).get('poll')?.value"), /a require reference/],
        ['createRequire, aliased', feed("const nh = cr(import.meta.url)('next/headers');", "(await nh.headers()).get('x-poll-id')",
          "import { createRequire as cr } from 'node:module';\n"), IMPORT_RULE('node:module')],
        ['import =', feed('', "(await nh.headers()).get('x-poll-id')", "import nh = require('next/headers');\n"), /an import-equals require/],
      ];
      for (const [name, mutated, rule] of variants) {
        expect(mutated, `${r.rel} ${name}`).toContain('client.');
        expect(mutated.match(/const other = /g), `${r.rel} ${name}`).toHaveLength(1);
        const analysis = analyseStatusRoute(mutated, r.file);
        // Still a guarded key resolution: only the module rule stands in the way.
        expect(analysis.unguarded, `${r.rel} ${name}`).toEqual([]);
        expect(analysis.foreignInputs.join('\n'), `${r.rel} ${name}`).toMatch(rule);
      }
    }
  });

  it('reports each real status route that fetches a module at run time through a GLOBAL, in every spelling', () => {
    // No import, no import(), no require: the module is reached through a
    // global. Each variant feeds the provider a request header, and each is
    // pinned to the global rule — and asserted NOT to be caught by the module
    // rule — so a variant caught by the wrong rule cannot read as coverage
    // (lessons-learned #19).
    const MODULE_RULE = /imports '|a dynamic import\(\)|a require reference|an import-equals require/;
    const FETCH = ".getBuiltinModule('module').createRequire(import.meta.url)('next/headers')";
    for (const r of guardedStatus) {
      expect(analyseStatusRoute(r.source, r.file).foreignInputs, r.rel).toEqual([]);
      const feed = (lines: string) => mutate(
        mutate(r.source, POLLED_ID, `$&\n${lines.split('\n').map((l) => `$1${l}`).join('\n')}\n$1const other = (await nh.headers()).get('x-poll-id') ?? jobId;`),
        PROVIDER_CALL,
        'client.$1(other)',
      );
      const variants: Array<[string, string, RegExp]> = [
        ['process.getBuiltinModule', feed(`const nh = process${FETCH};`), /reads the global 'process'/],
        ['globalThis', feed(`const nh = globalThis.process${FETCH};`), /reads the global 'globalThis'/],
        ['a shorthand property', feed(`const box = { process };\nconst nh = box.process${FETCH};`), /reads the global 'process'/],
        ['global', feed(`const nh = global.process${FETCH};`), /reads the global 'global'/],
        ['the Function constructor chain', feed(`const nh = (0).constructor.constructor('return process')()${FETCH};`),
          /names 'constructor'/],
        ['a computed member name', feed(`const k = 'con' + 'structor';\nconst nh = (0)[k][k]('return process')()${FETCH};`),
          /an element access by a computed name/],
        ['eval', feed(`const nh = eval('process')${FETCH};`), /reads the global 'eval'/],
        ['Function', feed(`const nh = Function('return process')()${FETCH};`), /reads the global 'Function'/],
        ['an Object member off the list', feed("const F = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(Object.getPrototypeOf(jobId)), 'cons' + 'tructor')!.value;\n"
          + `const nh = F('return process')()${FETCH};`), /reads the global 'Object' in a way not allowed/],
      ];
      for (const [name, mutated, rule] of variants) {
        expect(mutated, `${r.rel} ${name}`).toContain('client.');
        expect(mutated.match(/const other = /g), `${r.rel} ${name}`).toHaveLength(1);
        const analysis = analyseStatusRoute(mutated, r.file);
        // Still a guarded key resolution: only the global rule stands in the way.
        expect(analysis.unguarded, `${r.rel} ${name}`).toEqual([]);
        expect(analysis.untraceable, `${r.rel} ${name}`).toEqual([]);
        const report = analysis.foreignInputs.join('\n');
        expect(report, `${r.rel} ${name}`).toMatch(rule);
        expect(report, `${r.rel} ${name}`).not.toMatch(MODULE_RULE);
      }
    }
    // ...and the allowed uses stay clean: new URL, Object.values, JSON, a
    // literal index, and a type-position global.
    const model = guardedStatus.find((a) => a.rel === 'api/generate/model/status/route.ts');
    expect(model).toBeTruthy();
    const allowed = mutate(model!.source, POLLED_ID,
      "$&\n$1const shape: typeof globalThis | undefined = undefined;\n$1void [Object.values({ a: 1 })[0], JSON.stringify(shape), Number('1')];");
    expect(analyseStatusRoute(allowed, model!.file).foreignInputs).toEqual([]);
  });

  it('SELECTS each real status route that takes its key from ANY key-returning resolver export', () => {
    // resolveByokOrPlatformKey hands back the BYOK key or else the PLATFORM key
    // with no tier, balance or charge in front of it — a status route built on
    // it needs the same refusal. Swapped in for resolveApiKey everywhere, the
    // route is still followed into the guard check (clean with the refusal,
    // reported without it).
    expect(KEY_EXPORTS.has(RESOLVE_BYOK)).toBe(true);
    for (const r of guardedStatus) {
      const swapped = mutate(r.source, /\bresolveApiKey\b/, RESOLVE_BYOK);
      expect(swapped.match(/\bresolveApiKey\b/g), r.rel).toBeNull();
      const clean = analyseStatusRoute(swapped, r.file);
      expect(clean.keyResolutions, r.rel).toBeGreaterThan(0);
      expect(clean.unguarded, r.rel).toEqual([]);
      const open = analyseStatusRoute(mutate(swapped, GUARD_IF, ''), r.file);
      expect(open.keyResolutions, r.rel).toBeGreaterThan(0);
      expect(open.unguarded, r.rel).not.toEqual([]);
    }
  });

  it('derives the key-returning exports from the resolver module, and pins the ones that return no key', () => {
    // Both key sources the routes use today are in the derived set; the class
    // the routes also import from the resolver is not.
    expect([...KEY_EXPORTS].sort()).toEqual(expect.arrayContaining([RESOLVE, RESOLVE_BYOK]));
    expect(KEY_EXPORTS.has('ApiKeyError')).toBe(false);
    // Every pinned non-key export is still a function declaring a non-key
    // return type, or an error class — so the pin cannot hide a key source.
    expect(nonKeyPinProblems(RESOLVER_EXPORTS)).toEqual([]);
    for (const name of NON_KEY_RESOLVER_EXPORTS) {
      expect(RESOLVER_EXPORTS.some((e) => e.name === name), `${name} is exported`).toBe(true);
      expect(KEY_EXPORTS.has(name), `${name} is pinned as a non-key export`).toBe(false);
    }
    // A NEW export is a key source until someone pins it otherwise, WHATEVER
    // its initializer — derived, not restated (lessons-learned #18). Each
    // spelling is appended ALONE, asserted applied (absent before, the source
    // grew), then asserted derived.
    const source = readFileSync(RESOLVER_FILE!, 'utf8');
    const before = keyExportsOf(resolverValueExports(source));
    const spellings: Array<[string, string]> = [
      ['resolveSecondKey', 'export async function resolveSecondKey(u: string): Promise<string> { return u; }'],
      ['resolveThirdKey', 'export const resolveThirdKey = async (u: string) => u;'],
      ['resolveFourthKey', 'function resolveFourthKey(u: string) { return u; }\nexport { resolveFourthKey };'],
      ['resolveListedKey', 'export { getPlatformKey as resolveListedKey };'],
      ['resolvePlatformKey', 'export const resolvePlatformKey = getPlatformKey;'],
      ['resolveMemoKey', 'export const resolveMemoKey = memoize(async (u: string) => u);'],
      ['resolveCheckedKey', 'export const resolveCheckedKey = (async (u: string) => u) satisfies (u: string) => Promise<string>;'],
      ['resolveCastKey', 'export const resolveCastKey = getPlatformKey as (p: Provider) => Promise<string>;'],
      ['resolveLetKey', 'export let resolveLetKey = getPlatformKey;'],
      ['resolveVarKey', 'export var resolveVarKey = getPlatformKey;'],
      ['resolveFromTable', 'export const { resolveFromTable } = keyTable;'],
      ['default', 'export default async function (u: string) { return u; }'],
      ['default', 'export default async function resolveNamedDefault(u: string) { return u; }'],
      ['default', 'export default getPlatformKey;'],
      ['keyModule', "export * as keyModule from './platformKeys';"],
      ['KeyBox', 'export class KeyBox { static get(u: string) { return u; } }'],
      ['KeyMaker', 'export class KeyMaker { make(u: string) { return u; } }'],
    ];
    for (const [name, line] of spellings) {
      const added = `${source}\n${line}\n`;
      expect(added.length, line).toBeGreaterThan(source.length);
      expect(before.has(name), `${name} is not a resolver export before the probe`).toBe(false);
      expect(keyExportsOf(resolverValueExports(added)).has(name), line).toBe(true);
    }
    // ...and a type has no value, so it is not counted.
    for (const line of ['export interface KeyShape { key: string }', 'export type KeyAlias = string;',
      'type KeyLocal = string;\nexport { KeyLocal };']) {
      const derived = keyExportsOf(resolverValueExports(`${source}\n${line}\n`));
      expect([...derived].sort(), line).toEqual([...before].sort());
    }
    // A whole-module re-export adds names the source never spells: refuse to derive.
    expect(() => resolverValueExports(`${source}\nexport * from './platformKeys';\n`)).toThrow(/re-exports a whole module/);
  });

  it('re-checks each NON-KEY pin in every declaration, so an alias, a cast or a key-carrying class cannot keep it', () => {
    const clean = [
      'export class ApiKeyError extends Error {\n  constructor(public code: string, message: string) { super(message); }\n}',
      'export async function storeProviderKey(u: string): Promise<void> { void u; }',
      'export const deleteProviderKey = async (u: string): Promise<void> => { void u; };',
      'export async function listConfiguredProviders(u: string): Promise<Provider[]> { return [u as Provider]; }',
    ].join('\n');
    expect(nonKeyPinProblems(resolverValueExports(clean))).toEqual([]);
    const variants: Array<[string, RegExp, string]> = [
      ['a const alias', /^export async function storeProviderKey\(.*$/m, 'export const storeProviderKey = resolveApiKey;'],
      ['a key return type', /Promise<void> \{ void u; \}$/m, 'Promise<string> { return u; }'],
      ['a cast', /^export const deleteProviderKey = .*$/m,
        'export const deleteProviderKey = (async (): Promise<void> => {}) as unknown as (u: string) => Promise<string>;'],
      ['a let', /^export const deleteProviderKey/m, 'export let deleteProviderKey'],
      ['a static member', /^export class ApiKeyError extends Error \{$/m,
        'export class ApiKeyError extends Error {\n  static key(u: string) { return u; }'],
      ['a constructor that returns', /\{ super\(message\); \}/, '{ super(message); return { key: message }; }'],
      ['a non-Error base', /extends Error/, 'extends KeyHolder'],
      ['an unexported pin', /^export async function listConfiguredProviders/m, 'async function listConfiguredProviders'],
    ];
    for (const [name, find, replace] of variants) {
      const mutated = mutate(clean, find, replace);
      expect(nonKeyPinProblems(resolverValueExports(mutated)), name).not.toEqual([]);
    }
  });

  it('SELECTS a route at a path the poller never dials whose key comes from a resolver export that is NOT a function literal', () => {
    // End to end: the resolver gains `export const resolvePlatformKey =
    // getPlatformKey;` (a const alias), and the model status route, refusal
    // deleted, takes its key from it at a path off the STATUS_ENDPOINTS map —
    // so only the selection rule stands between it and a green gate.
    const root = mkdtempSync(path.join(tmpdir(), 'job-ownership-alias-export-'));
    try {
      const model = guarded.find((a) => a.rel === 'api/generate/model/status/route.ts');
      expect(model).toBeTruthy();
      const write = (rel: string, source: string) => {
        mkdirSync(path.join(root, path.dirname(rel)), { recursive: true });
        writeFileSync(path.join(root, rel), source);
      };
      write('api/generate/model/route.ts', readFileSync(path.join(APP_ROOT, 'api/generate/model/route.ts'), 'utf8'));
      const previewRel = 'api/generate/model/preview/route.ts';
      expect(endpoints).not.toContain(urlOf(previewRel));
      write(previewRel, mutate(
        mutate(
          mutate(model!.source, GUARD_IF, ''),
          /resolveApiKey\(\s*mid\.userId!,\s*DB_PROVIDER\.model3d,[^)]*\)/,
          'resolvePlatformKey(DB_PROVIDER.model3d)',
        ),
        /^import \{ resolveApiKey, ApiKeyError \} from '@\/lib\/keys\/resolver';$/m,
        "import { resolvePlatformKey, ApiKeyError } from '@/lib/keys/resolver';",
      ));
      const resolver = readFileSync(RESOLVER_FILE!, 'utf8');
      const edited = `${resolver}\nexport const resolvePlatformKey = getPlatformKey;\n`;
      expect(edited.length).toBeGreaterThan(resolver.length);
      const keys = keyExportsOf(resolverValueExports(edited));
      expect(keys.has('resolvePlatformKey')).toBe(true);

      // Against the real resolver (no such export) nothing is selected: the
      // red below comes from deriving the edited one.
      expect(auditKeyResolvingRoutes(root, {}).map((a) => a.rel)).toEqual([]);
      const found = auditKeyResolvingRoutes(root, {}, keys);
      expect(found.map((a) => a.rel)).toEqual([previewRel]);
      expect(found[0].analysis.keyResolutions).toBeGreaterThan(0);
      expect(found[0].problems.join('\n')).toMatch(/without an ownership refusal/);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('SELECTS each real status route whose resolveApiKey is an ALIAS from another spelling of the resolver module', () => {
    // The import specifier is not the module: a relative path and a `.ts`
    // extension (allowImportingTsExtensions) name the same file as
    // '@/lib/keys/resolver'. With its refusal deleted, every spelling is
    // selected and reported; with it intact, every spelling is clean — so the
    // alias is followed into the guard check, not merely counted.
    const RESOLVER_IMPORT = /^import \{ resolveApiKey(, [^}]*)? \} from '@\/lib\/keys\/resolver';$/m;
    for (const r of guardedStatus) {
      const relative = path.relative(path.dirname(r.file), path.join(WEB_ROOT, 'src', 'lib', 'keys', 'resolver'))
        .split(path.sep).join('/');
      expect(relative.startsWith('../'), r.rel).toBe(true);
      for (const specifier of [relative, `${relative}.ts`, '@/lib/keys/resolver.ts', 'unrelated-module']) {
        const aliased = mutate(
          mutate(r.source, RESOLVER_IMPORT, `import { resolveApiKey as resolveKey$1 } from '${specifier}';`),
          /\bresolveApiKey\(/,
          'resolveKey(',
        );
        // No call is still spelled `resolveApiKey`, so only the alias can select it.
        expect(aliased.match(/\bresolveApiKey\(/g), `${r.rel} ${specifier}`).toBeNull();
        expect(aliased, `${r.rel} ${specifier}`).toContain(`import { resolveApiKey as resolveKey`);
        const clean = analyseStatusRoute(aliased, r.file);
        expect(clean.keyResolutions, `${r.rel} ${specifier}`).toBeGreaterThan(0);
        expect(clean.unguarded, `${r.rel} ${specifier}`).toEqual([]);
        expect(clean.untraceable, `${r.rel} ${specifier}`).toEqual([]);
        const unguardedRoute = analyseStatusRoute(mutate(aliased, GUARD_IF, ''), r.file);
        expect(unguardedRoute.keyResolutions, `${r.rel} ${specifier}`).toBeGreaterThan(0);
        expect(unguardedRoute.unguarded, `${r.rel} ${specifier}`).not.toEqual([]);
      }
    }
  });

  it('accepts each real status route whose guard callees are imported through another spelling of the REAL module, and no other', () => {
    // Module identity is tsc's resolution, not the specifier text: a relative
    // or extensioned path to jobOwnership.ts is the real check; a look-alike
    // module (`jobOwnershipResponse`) exporting the same name is not.
    const OWNERSHIP_IMPORT = /^import \{ verifyProviderJobOwner \} from '@\/lib\/generate\/jobOwnership';$/m;
    for (const r of guardedStatus) {
      const relative = path.relative(path.dirname(r.file), path.join(WEB_ROOT, 'src', 'lib', 'generate', 'jobOwnership'))
        .split(path.sep).join('/');
      for (const specifier of [relative, '@/lib/generate/jobOwnership.ts']) {
        const respelled = mutate(r.source, OWNERSHIP_IMPORT, `import { verifyProviderJobOwner } from '${specifier}';`);
        expect(analyseStatusRoute(respelled, r.file).unguarded, `${r.rel} ${specifier}`).toEqual([]);
      }
      for (const specifier of ['@/lib/generate/jobOwnershipResponse', `${relative}Response`, './jobOwnership']) {
        const lookalike = mutate(r.source, OWNERSHIP_IMPORT, `import { verifyProviderJobOwner } from '${specifier}';`);
        expect(analyseStatusRoute(lookalike, r.file).unguarded, `${r.rel} ${specifier}`).not.toEqual([]);
      }
    }
  });

  it('reports each real POST route with its binding removed', () => {
    for (const r of guardedStatus) {
      const postDir = path.dirname(path.dirname(r.file));
      const postFiles = routeFilesIn(postDir);
      expect(postFiles.length, r.rel).toBeGreaterThan(0);
      for (const postFile of postFiles) {
        const source = readFileSync(postFile, 'utf8');
        const mutated = mutate(source, /\b(jobIdForOwnership|providerJobId):/, '$1Removed:');
        const post = analysePostRoute(mutated, postFile);
        expect(post.handlers, r.rel).toBeGreaterThan(0);
        expect(post.binding, r.rel).toBeLessThan(post.handlers);
      }
    }
  });

  it('reports each exemption whose stated property is broken', () => {
    const byKind = (kind: ExemptionKind) => audits.filter((a) => a.exemption?.kind === kind);
    expect(byKind('charged-new-operation').length).toBeGreaterThan(0);
    expect(byKind('qstash-signed-callback').length).toBeGreaterThan(0);
    for (const a of byKind('charged-new-operation')) {
      // Turned into a zero-cost status check: a poll in disguise.
      const asPoll = mutate(a.source, /(resolveApiKey\(\s*[^,]+,\s*[^,]+,\s*)[^,]+,\s*[^,)]+/, '$10, STATUS_CHECK_OPERATION');
      expect(exemptionProblems('charged-new-operation', asPoll, a.file), a.rel).not.toEqual([]);
    }
    for (const a of byKind('qstash-signed-callback')) {
      const unsigned = mutate(a.source, /^([ \t]*)(if \(!verified\) \{)$/m, '$1if (false) {');
      expect(exemptionProblems('qstash-signed-callback', unsigned, a.file), a.rel).not.toEqual([]);
    }
    const bundled = byKind('bundled-step-of-charged-generation');
    expect(bundled.map((a) => a.rel)).toEqual(['api/generate/sprite/route.ts']);
    for (const a of bundled) {
      expect(exemptionProblems('bundled-step-of-charged-generation', a.source, a.file), a.rel).toEqual([]);
      const KEY_CALL = /\bresolveByokOrPlatformKey\(ctx\.userId, /;
      // Each break is pinned to the message of the rule that must report it.
      const breaks: Array<[string, string, RegExp]> = [
        ['the key resolved for a caller-chosen user', mutate(a.source, KEY_CALL, 'resolveByokOrPlatformKey(params.userId, '),
          /not resolved for <ctx>\.userId/],
        ['the key resolved in a nested function', mutate(a.source, /\(await (resolveByokOrPlatformKey\(ctx\.userId, '[^']+'\))\)/,
          '(await (async () => $1)())'), /not in the execute step/],
        ['the step renamed out of execute', mutate(a.source, /^(\s*)execute: async \(/m, '$1run: async ('),
          /not in the execute step/],
        ['the factory imported from a look-alike module',
          mutate(a.source, /from '@\/lib\/api\/createGenerationHandler';/, "from './createGenerationHandler';"),
          /not in the execute step/],
        ['a jobId read', mutate(a.source, KEY_CALL, "resolveByokOrPlatformKey(ctx.userId, new URL('x:').searchParams.get('jobId') ?? "),
          /reads a jobId/],
      ];
      for (const [name, mutated, rule] of breaks) {
        expect(exemptionProblems('bundled-step-of-charged-generation', mutated, a.file).join('\n'), `${a.rel} ${name}`).toMatch(rule);
      }
    }
  });

  it('SELECTS a route at a path the poller never dials that takes its key from resolveByokOrPlatformKey', () => {
    // Off the STATUS_ENDPOINTS map, so neither floor can name it: only the
    // selection rule stands between it and a green gate. The model status
    // route with its refusal deleted and its key taken from the uncharged
    // BYOK-or-platform lookup, at a preview path.
    const root = mkdtempSync(path.join(tmpdir(), 'job-ownership-byok-'));
    try {
      const model = guardedStatus.find((a) => a.rel === 'api/generate/model/status/route.ts');
      expect(model).toBeTruthy();
      const write = (rel: string, source: string) => {
        mkdirSync(path.join(root, path.dirname(rel)), { recursive: true });
        writeFileSync(path.join(root, rel), source);
      };
      write('api/generate/model/route.ts', readFileSync(path.join(APP_ROOT, 'api/generate/model/route.ts'), 'utf8'));
      const previewRel = 'api/generate/model/preview/route.ts';
      expect(endpoints).not.toContain(urlOf(previewRel));
      const byok = mutate(
        mutate(
          mutate(model!.source, GUARD_IF, ''),
          /resolveApiKey\(\s*mid\.userId!,\s*DB_PROVIDER\.model3d,[^)]*\)/,
          'resolveByokOrPlatformKey(mid.userId!, DB_PROVIDER.model3d)',
        ),
        /^import \{ resolveApiKey, ApiKeyError \} from '@\/lib\/keys\/resolver';$/m,
        "import { resolveByokOrPlatformKey, ApiKeyError } from '@/lib/keys/resolver';",
      );
      expect(byok.match(/\bresolveApiKey\(/g)).toBeNull();
      write(previewRel, byok);
      // The same route WITH its refusal is clean, so the report below comes from the deletion.
      write('api/generate/model/guarded/route.ts', mutate(model!.source, /\bresolveApiKey\b/, RESOLVE_BYOK));

      const found = auditKeyResolvingRoutes(root, {});
      const byRel = new Map(found.map((a) => [a.rel, a.problems]));
      expect([...byRel.keys()].sort()).toEqual(['api/generate/model/guarded/route.ts', previewRel]);
      expect(byRel.get(previewRel)?.join('\n')).toMatch(/without an ownership refusal/);
      expect(byRel.get('api/generate/model/guarded/route.ts')).toEqual([]);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('SELECTS a key-resolving route at ANY path — status/[jobId], poll/, outside generate/ — and reports it unguarded', () => {
    const root = mkdtempSync(path.join(tmpdir(), 'job-ownership-walk-'));
    try {
      const model = guardedStatus.find((a) => a.rel === 'api/generate/model/status/route.ts');
      const texture = guardedStatus.find((a) => a.rel === 'api/generate/texture/status/route.ts');
      expect(model && texture).toBeTruthy();
      const write = (rel: string, source: string) => {
        mkdirSync(path.join(root, path.dirname(rel)), { recursive: true });
        writeFileSync(path.join(root, rel), source);
      };
      const realPost = (rel: string) => readFileSync(path.join(APP_ROOT, rel), 'utf8');
      write('api/generate/model/route.ts', realPost('api/generate/model/route.ts'));
      write('api/generate/texture/route.ts', realPost('api/generate/texture/route.ts'));
      // Unguarded, at a REST-style path and at a non-`status` name.
      write('api/generate/model/status/[jobId]/route.ts', mutate(model!.source, GUARD_IF, ''));
      write('api/generate/texture/poll/route.js', mutate(texture!.source, GUARD_IF, ''));
      // Guarded, but nothing above it issues and binds the ids it polls.
      write('api/other/check/route.ts', model!.source);
      // Guarded, at a nested path, with its POST two levels up: clean.
      write('api/generate/texture/status/[jobId]/route.ts', texture!.source);
      // Not route files: never selected.
      write('api/generate/model/status/route.test.ts', mutate(model!.source, GUARD_IF, ''));
      write('api/generate/model/status/route.ts.bak', mutate(model!.source, GUARD_IF, ''));

      const found = auditKeyResolvingRoutes(root, {});
      const byRel = new Map(found.map((a) => [a.rel, a.problems]));
      expect([...byRel.keys()].sort()).toEqual([
        'api/generate/model/status/[jobId]/route.ts',
        'api/generate/texture/poll/route.js',
        'api/generate/texture/status/[jobId]/route.ts',
        'api/other/check/route.ts',
      ]);
      expect(byRel.get('api/generate/model/status/[jobId]/route.ts')?.join('\n')).toMatch(/without an ownership refusal/);
      expect(byRel.get('api/generate/texture/poll/route.js')?.join('\n')).toMatch(/without an ownership refusal/);
      expect(byRel.get('api/other/check/route.ts')?.join('\n')).toMatch(/POST route in any directory above it/);
      expect(byRel.get('api/generate/texture/status/[jobId]/route.ts')).toEqual([]);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('SELECTS a route at a path the poller never dials whose resolveApiKey is an alias from a non-canonical specifier', () => {
    // Off the STATUS_ENDPOINTS map, so neither floor can name it: only the
    // selection rule stands between it and a green gate. One spelling is a
    // relative path out of the copy to the real resolver file; the other is
    // the probe's own spelling, which in a copy of the tree
    // resolves NOWHERE and is still selected, because a named import of
    // resolveApiKey counts whatever its specifier.
    const root = mkdtempSync(path.join(tmpdir(), 'job-ownership-alias-'));
    try {
      const model = guardedStatus.find((a) => a.rel === 'api/generate/model/status/route.ts');
      expect(model).toBeTruthy();
      const write = (rel: string, source: string) => {
        mkdirSync(path.join(root, path.dirname(rel)), { recursive: true });
        writeFileSync(path.join(root, rel), source);
      };
      for (const post of ['api/generate/model/route.ts', 'api/generate/texture/route.ts']) {
        write(post, readFileSync(path.join(APP_ROOT, post), 'utf8'));
      }
      const RESOLVER_IMPORT = "import { resolveApiKey, ApiKeyError } from '@/lib/keys/resolver';";
      const aliasedFrom = (specifier: string) => mutate(
        mutate(mutate(model!.source, GUARD_IF, ''), /^import \{ resolveApiKey, ApiKeyError \} from '@\/lib\/keys\/resolver';$/m,
          `import { resolveApiKey as resolveKey, ApiKeyError } from '${specifier}';`),
        /\bresolveApiKey\(/,
        'resolveKey(',
      );
      expect(model!.source).toContain(RESOLVER_IMPORT);
      const pollRel = 'api/generate/texture/poll/route.ts';
      const checkRel = 'api/generate/model/check/route.ts';
      const realResolver = path.relative(path.join(root, path.dirname(checkRel)), path.join(WEB_ROOT, 'src', 'lib', 'keys', 'resolver'))
        .split(path.sep).join('/');
      expect(resolveModuleFile(realResolver, path.join(root, checkRel))).toBe(canonicalModuleFile(RESOLVER_MODULE));
      write(pollRel, aliasedFrom('../../../../../lib/keys/resolver'));
      write(checkRel, aliasedFrom(`${realResolver}.ts`));
      for (const rel of [pollRel, checkRel]) expect(endpoints, rel).not.toContain(urlOf(rel));

      const found = auditKeyResolvingRoutes(root, {});
      const byRel = new Map(found.map((a) => [a.rel, a.problems]));
      expect([...byRel.keys()].sort()).toEqual([checkRel, pollRel]);
      expect(byRel.get(pollRel)?.join('\n')).toMatch(/without an ownership refusal/);
      expect(byRel.get(checkRel)?.join('\n')).toMatch(/without an ownership refusal/);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('walks every route-file spelling Next.js serves, and nothing else', () => {
    const root = mkdtempSync(path.join(tmpdir(), 'job-ownership-spell-'));
    try {
      const spellings = ['ts', 'tsx', 'js', 'jsx', 'mjs'];
      for (const ext of spellings) {
        mkdirSync(path.join(root, ext, 'deep', '[id]'), { recursive: true });
        writeFileSync(path.join(root, ext, 'deep', '[id]', `route.${ext}`), '');
      }
      mkdirSync(path.join(root, 'decoy', '__tests__'), { recursive: true });
      writeFileSync(path.join(root, 'decoy', 'route.test.ts'), '');
      writeFileSync(path.join(root, 'decoy', 'route.ts.bak'), '');
      writeFileSync(path.join(root, 'decoy', '__tests__', 'route.ts'), '');
      expect(walkRouteFiles(root).map((f) => relTo(root, f)).sort()).toEqual(
        spellings.map((ext) => `${ext}/deep/[id]/route.${ext}`).sort(),
      );
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('parses a .tsx / .jsx status route as JSX, so markup cannot fake the check', () => {
    const imports = "import { resolveApiKey } from '@/lib/keys/resolver';\n"
      + "import { verifyProviderJobOwner } from '@/lib/generate/jobOwnership';\n"
      + "import { withApiMiddleware } from '@/lib/api/middleware';\n"
      + FIXTURE_BINDINGS;
    const head = '  const mid = await withApiMiddleware(request, {});\n'
      + '  const { searchParams } = new URL(request.url);\n'
      + "  const jobId = searchParams.get('jobId');\n";
    const guard = '  const ownership = await verifyProviderJobOwner(mid.userId!, p, jobId);\n'
      + "  if (ownership !== 'owner') return refuse(ownership);\n";
    const call = '  await resolveApiKey(mid.userId!, p, 0, op);\n';
    const fn = (body: string) => `${imports}async function GET_impl(request) {\n${body}}\n`;
    // The check written as JSX TEXT inside an element: in a .tsx/.jsx file it
    // is prose, not a statement, so the key resolution below is unguarded.
    // Parsed as plain TS, `<p>` reads as a type assertion that fails, and the
    // parser recovers by treating the text as the real `const` + `if` — so a
    // gate that ignores the extension would call this route guarded.
    const markupOnly = fn(`${head}  const help = <p>\n${guard}  </p>;\n${call}`);

    for (const fileName of ['route.tsx', 'route.jsx']) {
      expect(analyseStatusRoute(fn(head + guard + call), fileName), fileName)
        .toEqual({ keyResolutions: 1, unguarded: [], untraceable: [], foreignInputs: [] });
      expect(analyseStatusRoute(markupOnly, fileName).unguarded, fileName).toHaveLength(1);
    }
    // Proof the fixture can tell the two parses apart (lessons-learned #11): as
    // a .ts file the text does not compile, and the parser's error recovery
    // reads the guard as code. That misreading is what a hardcoded
    // ScriptKind.TS would apply to the JSX spellings above.
    expect(analyseStatusRoute(markupOnly, 'route.ts').unguarded).toEqual([]);
  });

  it('reports the shapes a text match would accept', () => {
    const imports = "import { resolveApiKey } from '@/lib/keys/resolver';\n"
      + "import { verifyProviderJobOwner } from '@/lib/generate/jobOwnership';\n"
      + "import { withApiMiddleware } from '@/lib/api/middleware';\n"
      + FIXTURE_BINDINGS;
    const auth = '  const mid = await withApiMiddleware(request, {});\n';
    const head = `${auth}  const { searchParams } = new URL(request.url);\n  const jobId = searchParams.get('jobId');\n`;
    const guard = '  const ownership = await verifyProviderJobOwner(mid.userId!, p, jobId);\n'
      + "  if (ownership !== 'owner') return refuse(ownership);\n";
    const call = '  await resolveApiKey(mid.userId!, p, 0, op);\n  return client.status(jobId);\n';
    const fn = (body: string, params = 'request: Request') => `${imports}async function GET_impl(${params}) {\n${body}}\n`;
    const unguarded = (src: string) => analyseStatusRoute(src).unguarded;
    const foreign = (src: string) => analyseStatusRoute(src).foreignInputs;

    // The accepted shape, so the analyser is not simply reporting everything.
    expect(analyseStatusRoute(fn(head + guard + call)))
      .toEqual({ keyResolutions: 1, unguarded: [], untraceable: [], foreignInputs: [] });
    // `!` and parentheses are not part of the identity of the user argument.
    expect(unguarded(fn(head + guard.replace('mid.userId!', '(mid.userId)') + call))).toEqual([]);

    // Guard AFTER the call.
    expect(unguarded(fn(head + call + guard))).toHaveLength(1);
    // Guard inside a branch the call does not share.
    expect(unguarded(fn(`${head}  if (flag) {\n${guard}  }\n${call}`))).toHaveLength(1);
    // `if` that does not return.
    expect(unguarded(fn(head
      + '  const ownership = await verifyProviderJobOwner(mid.userId!, p, jobId);\n'
      + "  if (ownership !== 'owner') console.warn(ownership);\n" + call))).toHaveLength(1);
    // `let` verdict (reassignable between check and use).
    expect(unguarded(fn(head + guard.replace('const ownership', 'let ownership') + call))).toHaveLength(1);
    // Truthiness of the verdict: every state is a non-empty string, so this refuses nothing.
    expect(unguarded(fn(head
      + '  const ownership = await verifyProviderJobOwner(mid.userId!, p, jobId);\n'
      + '  if (!ownership) return refuse(ownership);\n' + call))).toHaveLength(1);
    // The key resolved inside a nested function the guard's body does not own.
    expect(unguarded(fn(head + guard + '  const go = async () => resolveApiKey(mid.userId!, p, 0, op);\n'
      + '  return go();\n'))).toHaveLength(1);
    // ... even a nested function that is complete on its own: the OUTER body
    // can read a second caller-chosen id the inner whitelist never sees.
    const inner = (head + guard + call.replace('client.status(jobId)', 'client.status(decoy)'))
      .split('\n').filter(Boolean).map((l) => `  ${l}`).join('\n');
    expect(unguarded(fn("  const decoy = request.headers.get('x-id');\n"
      + `  const go = async (request: Request) => {\n${inner}\n  };\n  return go(request);\n`))).toHaveLength(1);

    // THE USER ARGUMENT. Ownership checked against a caller-chosen user.
    expect(unguarded(fn(head + guard.replace('mid.userId!', "searchParams.get('userId')!") + call))).toHaveLength(1);
    // ... against a plain identifier (whose value the gate cannot see).
    expect(unguarded(fn(head + guard.replace('mid.userId!', 'userId') + call))).toHaveLength(1);
    // The check for the authenticated user, the key for a caller-chosen one.
    expect(unguarded(fn(head + guard
      + call.replace('mid.userId!', "searchParams.get('userId')!")))).toHaveLength(1);
    // Two authenticated results: the check and the key must name the SAME one.
    expect(unguarded(fn(head + '  const other = await withApiMiddleware(request, {});\n'
      + guard.replace('mid.userId!', 'other.userId!') + call))).toHaveLength(1);
    // `<x>.userId` where `<x>` is not withApiMiddleware's result.
    const unauth = head.replace('withApiMiddleware(request, {})', 'readCallerFromQuery(request)');
    expect(unguarded(fn(unauth + guard + call))).toHaveLength(1);
    // ... nor withApiMiddleware imported from somewhere else.
    expect(unguarded(fn(head + guard + call).replace("from '@/lib/api/middleware'", "from './local'")))
      .toHaveLength(1);
    // ... nor a property other than `userId` of the authenticated result.
    expect(unguarded(fn(head + guard.replace('mid.userId!', 'mid.ownerId!')
      + call.replace('mid.userId!', 'mid.ownerId!')))).toHaveLength(1);
    // The check in a comment only (every line of it).
    const commented = guard.split('\n').filter(Boolean).map((l) => `  // ${l.trim()}`).join('\n');
    expect(unguarded(fn(`${head}${commented}\n${call}`))).toHaveLength(1);

    // SHADOWS — the callee must resolve to the import in EVERY scope, not only at top level.
    // A top-level redeclaration (tsc: TS2440; the binder still resolves to the import).
    expect(unguarded(`const verifyProviderJobOwner = async () => 'owner';\n${fn(head + guard + call)}`))
      .toHaveLength(1);
    // An in-body const, ahead of the check.
    expect(unguarded(fn("  const verifyProviderJobOwner = async (..._a: unknown[]) => 'owner' as const;\n"
      + head + guard + call))).toHaveLength(1);
    // An in-body function declaration, hoisted, even when declared AFTER the call.
    expect(unguarded(fn(`${head}${guard}${call}`
      + "  async function verifyProviderJobOwner(..._a: unknown[]) { return 'owner' as const; }\n")))
      .toHaveLength(1);
    // A parameter of the handler.
    expect(unguarded(fn(head + guard + call, 'request: Request, verifyProviderJobOwner = async () => \'owner\'')))
      .toHaveLength(1);
    // A destructured local, and a local withApiMiddleware that trusts the query string.
    expect(unguarded(fn("  const { verifyProviderJobOwner } = { verifyProviderJobOwner: async () => 'owner' };\n"
      + head + guard + call))).toHaveLength(1);
    expect(unguarded(fn('  const withApiMiddleware = async (r: Request) => ({ userId: new URL(r.url).searchParams.get(\'u\') });\n'
      + head + guard + call))).toHaveLength(1);
    // A shadow in a block that does NOT enclose the call leaves the import in force.
    expect(unguarded(fn("  { const verifyProviderJobOwner = 1; void verifyProviderJobOwner; }\n"
      + head + guard + call))).toEqual([]);
    // The name imported from somewhere else.
    expect(unguarded(fn(head + guard + call).replace("from '@/lib/generate/jobOwnership'", "from './local'")))
      .toHaveLength(1);

    // THE POLLED ID is the only caller input.
    expect(foreign(fn(head + guard + call.replace('client.status(jobId)', "client.status(searchParams.get('predictionId') ?? jobId)"))))
      .not.toEqual([]);
    expect(foreign(fn(head + "  const predictionId = searchParams.get('predictionId') || jobId;\n" + guard
      + call.replace('client.status(jobId)', 'client.status(predictionId)')))).not.toEqual([]);
    expect(foreign(fn(head + guard + call.replace('client.status(jobId)', 'client.status(request.headers.get(\'x-id\'))'))))
      .not.toEqual([]);
    expect(foreign(fn(head + guard + call.replace('client.status(jobId)', 'client.status(mid.body.id)'))))
      .not.toEqual([]);
    expect(foreign(fn(head + '  const r = request;\n' + guard + call))).not.toEqual([]);
    expect(foreign(fn(head + "  const again = searchParams.get('jobId');\n" + guard + call))).not.toEqual([]);
    expect(foreign(fn(head + guard + call, 'request: Request, { params }: { params: { id: string } }'))).not.toEqual([]);
    expect(foreign(`import { headers } from 'next/headers';\n${fn(head + guard + call)}`)).not.toEqual([]);
    // MODULES: any spelling of next/headers, any other package, any dynamic
    // import or require — and not next/server (any spelling), a type-only
    // import, or the app's own source.
    for (const src of [
      `import { headers } from 'next/headers.js';\n${fn(head + guard + call)}`,
      `import { cookies } from 'next';\n${fn(head + guard + call)}`,
      `import 'some-package';\n${fn(head + guard + call)}`,
      `import { local } from './not-a-module';\n${fn(head + guard + call)}`,
      fn(`${head}  const { headers } = await import('next/headers');\n${guard}${call}`),
      fn(`${head}  const h = await import(name);\n${guard}${call}`),
      fn(`${head}  const nh = require('next/headers');\n${guard}${call}`),
      fn(`${head}  const r = require;\n${guard}${call}`),
      `import nh = require('next/headers');\n${fn(head + guard + call)}`,
    ]) {
      expect(foreign(src), src).not.toEqual([]);
    }
    for (const src of [
      `import { NextResponse } from 'next/server.js';\n${fn(head + guard + call)}`,
      `import type { cookies } from 'next/headers';\n${fn(head + guard + call)}`,
      `import { DB_PROVIDER } from '@/lib/config/providers';\n${fn(head + guard + call)}`,
      fn(`${head}  const opts = { require: true };\n${guard}${call}`),
    ]) {
      expect(foreign(src), src).toEqual([]);
    }
    // ... and the polled id must come from that one `new URL(request.url)`.
    expect(unguarded(fn(head.replace("searchParams.get('jobId')", "cache.get('jobId')") + guard + call)))
      .toHaveLength(1);

    // RESOLUTIONS the gate must count or refuse to follow.
    expect(analyseStatusRoute(
      "import { resolveApiKey as rk } from '@/lib/keys/resolver';\nasync function g() {\n  await rk(u);\n}\n",
    )).toMatchObject({ keyResolutions: 1, unguarded: ['line 3'] });
    expect(analyseStatusRoute('async function g() {\n  await keys.resolveApiKey(u);\n}\n').keyResolutions)
      .toBe(1);
    expect(analyseStatusRoute(
      "import { resolveApiKey } from '@/lib/keys/resolver';\nconst rk = resolveApiKey;\nasync function g() {\n  await rk(u);\n}\n",
    ).untraceable).toHaveLength(1);
    expect(analyseStatusRoute(
      "import * as keys from '@/lib/keys/resolver';\nconst { resolveApiKey: rk } = keys;\n",
    ).untraceable.length).toBeGreaterThan(0);
    expect(analyseStatusRoute(
      "async function g() {\n  const m = await import('@/lib/keys/resolver');\n  return m['resolveApiKey'];\n}\n",
    ).untraceable.length).toBeGreaterThan(0);
    // A lazy import destructured into named keys (capabilities/route.ts) is
    // followable — unless one of the keys is the resolver, or a rest element.
    const lazy = (keys: string) => 'async function g() {\n  const [{ a }, ' + keys + "] = await Promise.all([\n"
      + "    import('./a'),\n    import('@/lib/keys/resolver'),\n  ]);\n}\n";
    // (Not a key resolution, so the file is not selected; were it selected,
    // its dynamic imports would be reported as module inputs.)
    expect(analyseStatusRoute(lazy('{ listConfiguredProviders }'))).toMatchObject(
      { keyResolutions: 0, unguarded: [], untraceable: [] },
    );
    expect(analyseStatusRoute(lazy('{ resolveApiKey: rk }')).untraceable).not.toEqual([]);
    expect(analyseStatusRoute(lazy('{ ...resolver }')).untraceable).not.toEqual([]);
    expect(analyseStatusRoute(lazy('resolver')).untraceable).not.toEqual([]);
  });

  it('identifies the resolver by the IMPORTED NAME under any specifier, and the resolver MODULE by resolution', () => {
    // Every canonical module the gate compares against resolves to a real file
    // — otherwise module identity would silently fall back to spelling alone.
    for (const moduleName of [RESOLVER_MODULE, OWNERSHIP_MODULE, MIDDLEWARE_MODULE, HANDLER_MODULE, QSTASH_MODULE]) {
      const file = canonicalModuleFile(moduleName);
      expect(file, moduleName).toBeTruthy();
      expect(statSync(file!).isFile(), moduleName).toBe(true);
    }
    // Analysed as if it lived at a path the poller never dials, so the
    // relative spellings resolve against src/app/api/generate/texture/poll/.
    const at = path.join(APP_ROOT, 'api', 'generate', 'texture', 'poll', 'route.ts');
    const call = (name: string) => `async function GET_impl(request: Request) {\n  await ${name}(u, p, 0, op);\n}\n`;
    for (const specifier of ['../../../../../lib/keys/resolver', '../../../../../lib/keys/resolver.ts',
      '@/lib/keys/resolver.ts', './not-the-resolver']) {
      expect(analyseStatusRoute(`import { resolveApiKey as resolveKey } from '${specifier}';\n${call('resolveKey')}`, at), specifier)
        .toMatchObject({ keyResolutions: 1, unguarded: ['line 3'] });
    }
    // The module object, through any spelling tsc resolves to the resolver.
    for (const src of [
      "import * as keys from '../../../../../lib/keys/resolver';\nexport const f = keys;\n",
      "import keys from '@/lib/keys/resolver.ts';\nexport const f = keys;\n",
      "import keys = require('../../../../../lib/keys/resolver');\nexport const f = keys;\n",
      "export async function g() {\n  const m = await import('@/lib/keys/resolver.ts');\n  return m;\n}\n",
    ]) {
      expect(analyseStatusRoute(src, at).untraceable, src).toHaveLength(1);
    }
    expect(analyseStatusRoute("const m = require('../../../../../lib/keys/resolver');\nmodule.exports = m;\n",
      at.replace(/\.ts$/, '.js')).untraceable).toHaveLength(1);
    // ... and NOT a module object of some other module: resolution, not "every namespace import".
    expect(analyseStatusRoute("import * as keys from '../../../../../lib/keys/encryption';\nexport const f = keys;\n", at))
      .toEqual({ keyResolutions: 0, unguarded: [], untraceable: [], foreignInputs: [] });
    // An exemption's re-check counts the alias too, so it is not called stale.
    expect(exemptionProblems('charged-new-operation',
      `import { resolveApiKey as rk } from './not-the-resolver';\nasync function f() {\n  await rk(u, p, 5, 'chat');\n}\n`, at))
      .toEqual([]);
  });

  it('reports `arguments` anywhere in a key-resolving handler, and not a property named arguments', () => {
    const imports = "import { resolveApiKey } from '@/lib/keys/resolver';\n"
      + "import { verifyProviderJobOwner } from '@/lib/generate/jobOwnership';\n"
      + "import { withApiMiddleware } from '@/lib/api/middleware';\n"
      + FIXTURE_BINDINGS;
    const head = '  const mid = await withApiMiddleware(request, {});\n'
      + '  const { searchParams } = new URL(request.url);\n'
      + "  const jobId = searchParams.get('jobId');\n"
      + '  const ownership = await verifyProviderJobOwner(mid.userId!, p, jobId);\n'
      + "  if (ownership !== 'owner') return refuse(ownership);\n";
    const tail = '  await resolveApiKey(mid.userId!, p, 0, op);\n  return client.status(jobId);\n';
    const fn = (body: string, params = 'request: Request') => `${imports}async function GET_impl(${params}) {\n${body}}\n`;
    const foreign = (src: string) => analyseStatusRoute(src).foreignInputs;

    expect(foreign(fn(head + tail))).toEqual([]);
    expect(foreign(fn(`${head}  const fnMeta = meta.arguments;\n${tail}`))).toEqual([]);
    for (const src of [
      fn(`${head}  const other = new URL(arguments[0].url).searchParams.get('taskId');\n${tail}`),
      fn(`${head}  const { params } = arguments[1];\n${tail}`),
      fn(`${head}  const all = [...arguments];\n${tail}`),
      fn(`${head}  const read = () => arguments[1];\n${tail}`),
      fn(head + tail, 'request: Request = arguments[1]'),
    ]) {
      expect(foreign(src).join('\n'), src).toMatch(/reads arguments/);
    }
  });

  it('reads both POST binding spellings, rejects an explicit undefined, and resolves the factory by binding', () => {
    const imp = "import { createGenerationHandler } from '@/lib/api/createGenerationHandler';\n";
    expect(analysePostRoute(`${imp}createGenerationHandler({ jobIdForOwnership: (r) => r.jobId });`))
      .toEqual({ handlers: 1, binding: 1 });
    expect(analysePostRoute(`${imp}createGenerationHandler({ asyncJob: { providerJobId: (r) => r.jobId } });`))
      .toEqual({ handlers: 1, binding: 1 });
    expect(analysePostRoute(`${imp}createGenerationHandler({ asyncJob: { type: 'sprite' } });`))
      .toEqual({ handlers: 1, binding: 0 });
    expect(analysePostRoute(`${imp}createGenerationHandler({ jobIdForOwnership: undefined });`))
      .toEqual({ handlers: 1, binding: 0 });
    // A local factory of the same name binds nothing real.
    expect(analysePostRoute(`${imp}function f(createGenerationHandler: (c: object) => void) {\n`
      + '  createGenerationHandler({ jobIdForOwnership: (r) => r.jobId });\n}\n'))
      .toEqual({ handlers: 0, binding: 0 });
  });
});
