import { describe, it, expect } from 'vitest';
import ts from 'typescript';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

/**
 * Pins the SDK type gap behind the `as Transport` casts in `http.ts` (#10278).
 *
 * `@modelcontextprotocol/sdk` declares `Transport.onclose?: () => void` (no
 * `| undefined`) while `StreamableHTTPServerTransport`'s own `onclose`
 * accessor is typed `(() => void) | undefined`, so under
 * `exactOptionalPropertyTypes` the SDK's transport is not assignable to the
 * SDK's own `Transport` interface without a cast. At 1.30.0 the same split
 * covers `onerror`, `onmessage` and `sessionId` too: widening only the three
 * callbacks still leaves `sessionId?: string` against the class's
 * `get sessionId(): string | undefined`, and the casts are still required.
 * That is why the gap is derived below rather than spelled as `'onclose'`.
 *
 * Nothing in the main check is restated. Every subject is DERIVED at run time
 * (lessons-learned #18):
 *  - the compiler options come from the real `mcp-server/tsconfig.json`;
 *  - the cast sites are found by parsing the real `http.ts`;
 *  - the "un-cast" program is the real `http.ts` with those casts removed,
 *    served to the compiler through a host override, so a change to how
 *    `http.ts` connects is a change to what this test compiles;
 *  - the gap itself (which optional members disagree) is read through the
 *    type checker: every property of each cast's target and source type,
 *    INHERITED ones included, with each member's declared type resolved
 *    (so a type alias that carries `| undefined` counts) from the declaration
 *    tsc reads it from (an accessor pair's getter; a merged property's first
 *    declaration).
 *
 * The un-cast compile is the ORACLE. The derivation explains the errors; it
 * never decides whether the gap is closed:
 *  - the un-cast program compiles clean -> RED "drop the casts and delete this
 *    test" (the issue's "Done when"). This is the only path that says so;
 *  - the un-cast program still reports the exactOptionalPropertyTypes error
 *    but the derivation finds no disagreeing member -> RED "derivation
 *    broken": fix this test, do NOT drop the casts;
 *  - the un-cast program reports anything other than one exactOptional error
 *    (TS2375 assignment or TS2379 argument) per cast site -> RED, listing each
 *    unexpected diagnostic and each cast that produced none;
 *  - an error that names none of the derived members -> RED.
 *
 * Explaining the errors is not enough on its own: a constant `['onclose']` or
 * a derivation that reports every strict optional member of `Transport` can
 * both explain them. So the main test also asks the un-cast compile whether
 * the derived set IS the gap, by widening members in the SDK's own `.d.ts`:
 *  - completeness: widening ONLY the derived members makes the un-cast program
 *    compile clean;
 *  - minimality: for each derived member, widening all the OTHERS still leaves
 *    one exactOptional error at each cast, and that error names the member.
 *
 * What removing or rewriting the casts does (measured):
 *  - deleting a cast makes the real `http.ts` fail to compile, so step 1 (the
 *    baseline must compile clean) goes RED, as does the real `tsc --noEmit`;
 *  - replacing every cast with something tsc accepts that is not an
 *    `as Transport` (e.g. a `@ts-expect-error`) leaves no cast sites -> RED;
 *  - a cast that does not apply directly to the SDK transport value
 *    (`x as unknown as Transport`) -> RED, naming the line and operand type.
 *
 * The second `describe` drives the same check against overlaid SDK `.d.ts`
 * and `http.ts` text (served through the same host override, which also serves
 * overlay-only modules that do not exist on disk), so the shapes that broke an
 * earlier, syntactic derivation stay covered: the members on a base class
 * (M4a), the members on a base interface (M4b), and alias-typed accessors. It
 * also drives EVERY failure branch of `checkGap` to its message, including the
 * ones the real sources never reach: a baseline that does not compile, no
 * casts found, and each way through both step-3 guards. For the cast target:
 * a project-local interface (the `.d.ts` half), a class declared in a `.d.ts`
 * (the interface-kind filter), and an intersection alias (no type symbol at
 * all). For the operand: a project-local subclass (the `.d.ts` half), a value
 * already typed as the SDK interface (the class-kind filter), and a nullable
 * operand and `as unknown` (no type symbol). Then compiler options that are
 * themselves an error, a cast nested in another cast's operand, a statement
 * whose casts produce fewer or more errors than it has casts, a
 * non-exactOptional error inside a cast statement, an error outside every
 * cast statement, and a derived member that is only a substring of the
 * property the error names.
 *
 * The third `describe` drives the helpers directly (`findCasts`,
 * `statementAt`, `deriveGap`, `widenOptionals` and the overlay builders), on
 * small fixtures that put every clause of every guard in reach. It also checks
 * deriveGap's accessor-pair and merged-declaration rule against tsc's own
 * verdict, shape by shape.
 *
 * Mutated alone, every clause turns at least one case RED except these (the
 * PR's sweep tables give each one's measurement):
 *  - the `declarations?.` links in step 3: unreachable, because no compiling
 *    cast's target or operand has a symbol without declarations;
 *  - three mutants that cannot change a result. `d.start ?? -1` -> `d.start!`
 *    in step 5 (`undefined >= n` is false too). `s.getStart()` -> `s.pos` as
 *    a statement's lower bound in step 5: only leading trivia lies between
 *    them, a TS2375/TS2379 always starts at a token, and any other diagnostic
 *    is unexpected whichever statement holds it. Deleting the minimality
 *    check that the remaining error names the member: the narrowed checkGap
 *    run's own step 6 already requires the error to name a derived member,
 *    and with every other member widened the derivation is that member alone;
 *  - the completeness match in the main test, made vacuous: it can only fail
 *    for a derived set whose widening does not close the gap, and the real
 *    derivation's does. It is load-bearing all the same: with deriveGap returning `['onclose']`,
 *    it is what turns the main test RED (the deriveGap fixture cases go RED
 *    as well);
 *  - three caches that only affect speed.
 */

const MCP_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const HTTP_TS = path.join(MCP_ROOT, 'src', 'transport', 'http.ts');
const TSCONFIG = path.join(MCP_ROOT, 'tsconfig.json');
const HTTP_REL = path.relative(MCP_ROOT, HTTP_TS).split(path.sep).join('/');

/** The SDK interface the casts target: the one fixed name, from the issue. */
const TARGET_INTERFACE = 'Transport';

/**
 * The two exactOptionalPropertyTypes assignability errors: TS2375 for an
 * assignment or initializer, TS2379 for a call argument. Either is the gap.
 */
const TS_EXACT_OPTIONAL = new Set<number>([2375, 2379]);

const GUIDANCE =
  `Each \`as ${TARGET_INTERFACE}\` cast in ${HTTP_REL} must exist only to bridge the SDK ` +
  `exactOptionalPropertyTypes gap (#10278): removing it must produce exactly one TS2375 ` +
  `(assignment) or TS2379 (argument) error at that site, and nothing else.`;

/** Heads the list of un-cast diagnostics that are not the gap at a cast site. */
const UNEXPECTED_HEADER = 'diagnostics that are not a TS2375/TS2379 at a cast site:';

function loadConfig(file = TSCONFIG): ts.ParsedCommandLine {
  // TypeScript reports an unreadable config through this callback and then
  // returns undefined, so the one throw below carries the reason.
  let reason = '';
  const parsed = ts.getParsedCommandLineOfConfigFile(file, undefined, {
    ...ts.sys,
    onUnRecoverableConfigFileDiagnostic: (d) => {
      reason = ts.flattenDiagnosticMessageText(d.messageText, '\n');
    },
  });
  if (!parsed) throw new Error(`could not parse ${file}: ${reason}`);
  return parsed;
}

/**
 * The named import that binds `exported` (matched by its EXPORTED name, so an
 * alias is followed), with the local name it is bound to.
 */
function importBinding(sf: ts.SourceFile, exported: string): { local: string; decl: ts.ImportDeclaration } | undefined {
  for (const stmt of sf.statements) {
    // Only an import declaration has an importClause, so no kind check is needed.
    const bindings = (stmt as Partial<ts.ImportDeclaration>).importClause?.namedBindings;
    if (!bindings || !ts.isNamedImports(bindings)) continue;
    for (const el of bindings.elements) {
      if ((el.propertyName ?? el.name).text === exported) return { local: el.name.text, decl: stmt as ts.ImportDeclaration };
    }
  }
  return undefined;
}

/** Local name `Transport` is imported under in http.ts (follows an alias). */
const transportLocalName = (sf: ts.SourceFile): string | undefined => importBinding(sf, TARGET_INTERFACE)?.local;

/**
 * Every `<expr> as Transport` in the file, in source order. A file that does
 * not import `Transport` has none: no type name's text equals `undefined`.
 */
function findCasts(sf: ts.SourceFile): ts.AsExpression[] {
  const local = transportLocalName(sf);
  const casts: ts.AsExpression[] = [];
  const visit = (node: ts.Node): void => {
    if (ts.isAsExpression(node) && ts.isTypeReferenceNode(node.type) && node.type.typeName.getText(sf) === local) {
      casts.push(node);
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
  return casts;
}

/**
 * The source text with every cast replaced by its bare operand, plus where
 * each operand starts in the new text (casts in source order).
 */
function stripCasts(sf: ts.SourceFile, casts: ts.AsExpression[]): { text: string; operandStarts: number[] } {
  let text = sf.text;
  for (const cast of [...casts].sort((a, b) => b.getStart(sf) - a.getStart(sf))) {
    text = text.slice(0, cast.getStart(sf)) + cast.expression.getText(sf) + text.slice(cast.end);
  }
  let removed = 0;
  const operandStarts = casts.map((cast) => {
    const start = cast.getStart(sf) - removed;
    removed += cast.end - cast.getStart(sf) - cast.expression.getText(sf).length;
    return start;
  });
  return { text, operandStarts };
}

/** Parsed SourceFiles of everything not overridden, shared across programs. */
const SOURCE_CACHE = new Map<string, ts.SourceFile>();

function compile(
  config: ts.ParsedCommandLine,
  overrides: ReadonlyMap<string, string>,
  oldProgram?: ts.Program,
): ts.Program {
  const { options, fileNames } = config;
  const host = ts.createCompilerHost(options, true);
  const base = host.getSourceFile.bind(host);
  const baseExists = host.fileExists.bind(host);
  // An overlay may add a module that does not exist on disk. Module resolution
  // only asks whether it exists; getSourceFile below serves its text.
  host.fileExists = (fileName) => overrides.has(path.resolve(fileName)) || baseExists(fileName);
  host.getSourceFile = (fileName, languageVersion, onError, shouldCreate) => {
    const override = overrides.get(path.resolve(fileName));
    if (override !== undefined) return ts.createSourceFile(fileName, override, languageVersion, true);
    const hit = SOURCE_CACHE.get(fileName);
    if (hit) return hit;
    const sf = base(fileName, languageVersion, onError, shouldCreate);
    if (sf) SOURCE_CACHE.set(fileName, sf);
    return sf;
  };
  // The whole project, exactly as `tsc --noEmit` builds it: http.ts alone
  // lacks the ambient node types another root file pulls in.
  return ts.createProgram({ rootNames: fileNames, options, host, ...(oldProgram ? { oldProgram } : {}) });
}

function httpSourceFile(program: ts.Program): ts.SourceFile {
  const sf = program.getSourceFiles().find((f) => path.resolve(f.fileName) === HTTP_TS);
  if (!sf) throw new Error(`${HTTP_TS} is not in the program`);
  return sf;
}

/** 1-based, as editors and tsc print it. */
const lineOf = (sf: ts.SourceFile, pos: number): number => sf.getLineAndCharacterOfPosition(pos).line + 1;

interface DiagnosticRecord {
  code: number;
  line: number;
  text: string;
}

function recordOf(sf: ts.SourceFile, d: ts.Diagnostic): DiagnosticRecord {
  return {
    code: d.code,
    line: d.start === undefined ? 0 : lineOf(sf, d.start),
    text: ts.flattenDiagnosticMessageText(d.messageText, '\n'),
  };
}

/** An options or global diagnostic has no position (line 0), so no line is printed for it. */
const describeRecord = (r: DiagnosticRecord): string =>
  `  ${r.line === 0 ? `${HTTP_REL} (no position)` : `${HTTP_REL}:${r.line}`} TS${r.code}: ${r.text.split('\n').join('\n      ')}`;

/** The innermost statement (direct child of a block-like container) holding `pos`. */
function statementAt(sf: ts.SourceFile, pos: number): ts.Node {
  let found: ts.Node = sf;
  const visit = (node: ts.Node): void => {
    if (pos < node.getStart(sf) || pos >= node.end) return;
    const parent = node.parent;
    if (
      ts.isBlock(parent) ||
      ts.isSourceFile(parent) ||
      ts.isModuleBlock(parent) ||
      ts.isCaseClause(parent) ||
      ts.isDefaultClause(parent)
    ) {
      found = node;
    }
    ts.forEachChild(node, visit);
  };
  ts.forEachChild(sf, visit);
  return found;
}

function includesUndefined(t: ts.Type): boolean {
  const isUndefined = (m: ts.Type): boolean => (m.flags & ts.TypeFlags.Undefined) !== 0;
  return t.isUnion() ? t.types.some(isUndefined) : isUndefined(t);
}

/**
 * Whether a property's DECLARED type admits `undefined` (not its read type,
 * which exactOptionalPropertyTypes widens for every optional member), taken
 * from the one declaration tsc reads the type from:
 *  - an accessor pair: the getter's return type, or the setter's parameter
 *    type when there is no typed getter. The SDK declares `set onclose`
 *    before `get onclose`, and a pair whose two halves disagree is judged by
 *    the getter alone;
 *  - anything else: the FIRST declaration. Under exactOptionalPropertyTypes
 *    tsc accepts `x?: T` merged with a later `x?: T | undefined` (no TS2717)
 *    and reads `T` from the first.
 * Resolved through the checker, so aliases count. `undefined` when that
 * declaration carries no type the checker can read.
 */
function declaredTypeAdmitsUndefined(checker: ts.TypeChecker, prop: ts.Symbol): boolean | undefined {
  const decls = prop.declarations ?? [];
  const first = decls[0];
  // A method's declared type is a function type.
  if (first && (ts.isMethodSignature(first) || ts.isMethodDeclaration(first))) return false;
  const node =
    decls.find(ts.isGetAccessorDeclaration)?.type ??
    decls.find(ts.isSetAccessorDeclaration)?.parameters[0]?.type ??
    (first && (ts.isPropertySignature(first) || ts.isPropertyDeclaration(first)) ? first.type : undefined);
  return node ? includesUndefined(checker.getTypeFromTypeNode(node)) : undefined;
}

/**
 * Optional members the target type declares WITHOUT `| undefined` while the
 * source type declares them WITH it: the members exactOptionalPropertyTypes
 * refuses. Every property of each type is visited, inherited ones included.
 */
function deriveGap(checker: ts.TypeChecker, target: ts.Type, source: ts.Type): string[] {
  const gap: string[] = [];
  for (const targetProp of checker.getPropertiesOfType(target)) {
    if ((targetProp.flags & ts.SymbolFlags.Optional) === 0) continue;
    // No readable type, or one that already admits undefined: not the gap.
    if (declaredTypeAdmitsUndefined(checker, targetProp) !== false) continue;
    const sourceProp = checker.getPropertyOfType(source, targetProp.getName());
    if (sourceProp && declaredTypeAdmitsUndefined(checker, sourceProp)) gap.push(targetProp.getName());
  }
  return gap.sort();
}

type DeriveGap = typeof deriveGap;

interface CastSite {
  line: number;
  gap: string[];
  targetFile: string;
  sourceFile: string;
}

interface GapResult {
  casts: CastSite[];
  diagnostics: DiagnosticRecord[];
}

interface CheckOptions {
  /** Absolute path -> replacement text, served through the compiler host. */
  overrides?: ReadonlyMap<string, string>;
  /** Swappable only so the oracle's "derivation broken" branch can be driven. */
  derive?: DeriveGap;
}

/**
 * Runs the whole check and returns what it derived, or throws an Error whose
 * message says what failed and what to do about it.
 */
function checkGap(
  config: ts.ParsedCommandLine,
  { overrides = new Map<string, string>(), derive = deriveGap }: CheckOptions = {},
): GapResult {
  // 1. Baseline: http.ts, casts and all, compiles clean.
  const baseline = compile(config, overrides);
  const baseSf = httpSourceFile(baseline);
  const baseErrors = ts.getPreEmitDiagnostics(baseline, baseSf).map((d) => recordOf(baseSf, d));
  if (baseErrors.length > 0) {
    throw new Error(
      `${HTTP_REL} must compile clean under the real tsconfig before its casts can be tested:\n` +
        baseErrors.map(describeRecord).join('\n'),
    );
  }

  // 2. The workaround, derived from http.ts.
  const casts = findCasts(baseSf);
  if (casts.length === 0) {
    throw new Error(
      `no \`as ${TARGET_INTERFACE}\` casts found in ${HTTP_REL}. If they were removed because the SDK fixed ` +
        'the gap, delete this test too (#10278).',
    );
  }
  const castLines = casts.map((c) => lineOf(baseSf, c.getStart(baseSf)));

  // 3. Each cast must take the SDK transport value straight to the SDK interface.
  const checker = baseline.getTypeChecker();
  const types = casts.map((cast, i) => {
    const where = `${HTTP_REL}:${castLines[i]} \`${cast.getText(baseSf)}\``;
    const target = checker.getTypeFromTypeNode(cast.type);
    const targetDecl = target.getSymbol()?.declarations?.find(ts.isInterfaceDeclaration);
    if (!targetDecl?.getSourceFile().isDeclarationFile) {
      throw new Error(
        `${where}: the cast target must be the SDK's \`${TARGET_INTERFACE}\` interface; ` +
          `found '${checker.typeToString(target)}'.`,
      );
    }
    // The operand's flow type: a nullable operand is a union with no class
    // symbol, and removing its cast would report the null, not the gap.
    const source = checker.getTypeAtLocation(cast.expression);
    const sourceDecl = source.getSymbol()?.declarations?.find(ts.isClassDeclaration);
    if (!sourceDecl?.getSourceFile().isDeclarationFile) {
      throw new Error(
        `${where}: each \`as ${TARGET_INTERFACE}\` cast must apply directly to an SDK StreamableHTTPServerTransport ` +
          `value (a class declared in the SDK's .d.ts); this operand has type '${checker.typeToString(source)}'.`,
      );
    }
    return {
      target,
      source,
      targetFile: targetDecl.getSourceFile().fileName,
      sourceFile: sourceDecl.getSourceFile().fileName,
    };
  });

  // 4. Remove the workaround and recompile. This compile is the oracle.
  const { text: stripped, operandStarts } = stripCasts(baseSf, casts);
  // Lessons-learned #19: prove the mutation applied before trusting the result.
  // (Unchanged text would still hold every cast, so this one test covers it.)
  if (findCasts(ts.createSourceFile(HTTP_TS, stripped, ts.ScriptTarget.Latest, true)).length > 0) {
    throw new Error(
      `stripping the casts left an \`as ${TARGET_INTERFACE}\` cast in ${HTTP_REL} (is a cast nested inside another ` +
        `cast's operand?); the test cannot measure anything`,
    );
  }
  // compile() serves the override before anything else, so the un-cast program
  // holds `stripped`; if it ever did not, every overlay case below goes RED.
  const uncast = compile(config, new Map([...overrides, [HTTP_TS, stripped]]), baseline);
  const uncastSf = httpSourceFile(uncast);
  const diagnostics = ts.getPreEmitDiagnostics(uncast, uncastSf);
  const records = diagnostics.map((d) => recordOf(uncastSf, d));
  if (records.length === 0) {
    throw new Error(
      `${HTTP_REL} compiles without its casts, so the SDK gap is closed: drop the \`as ${TARGET_INTERFACE}\` casts ` +
        `(lines ${castLines.join(', ')}) and delete this test (#10278).`,
    );
  }

  // 5. Exactly one exactOptional error per cast site, and nothing else.
  const castStatements = operandStarts.map((pos) => statementAt(uncastSf, pos));
  const matched: number[][] = casts.map(() => []);
  const unexpected: DiagnosticRecord[] = [];
  diagnostics.forEach((d, di) => {
    // A diagnostic with no position (-1) lies inside no statement.
    const start = d.start ?? -1;
    const owner = castStatements.findIndex((s) => start >= s.getStart(uncastSf) && start < s.end);
    if (owner === -1 || !TS_EXACT_OPTIONAL.has(d.code)) unexpected.push(records[di]!);
    else matched[owner]!.push(di);
  });
  // Casts sharing one statement share its errors, so compare counts per statement.
  const problems: string[] = [];
  const seen = new Set<ts.Node>();
  for (const stmt of castStatements) {
    if (seen.has(stmt)) continue;
    seen.add(stmt);
    const owners = castStatements.flatMap((s, j) => (s === stmt ? [j] : []));
    const found = owners.reduce((n, j) => n + matched[j]!.length, 0);
    if (found !== owners.length) {
      const at = owners.map((j) => `${HTTP_REL}:${castLines[j]}`).join(', ');
      const hint =
        found === 0
          ? `the cast is not needed for the #10278 gap; remove it`
          : found < owners.length
            ? 'one of these casts is not needed for the #10278 gap'
            : 'more errors than casts at this statement';
      problems.push(
        `  cast(s) at ${at} produced ${found} exactOptional error(s) when removed, expected ${owners.length}: ${hint}`,
      );
    }
  }
  if (unexpected.length > 0) {
    problems.push(
      `  ${UNEXPECTED_HEADER}\n` +
        unexpected.map((r) => `  ${describeRecord(r)}`).join('\n'),
    );
  }
  if (problems.length > 0) {
    throw new Error(
      `removing the casts did not produce exactly the #10278 errors.\n${GUIDANCE}\n${problems.join('\n')}\n` +
        `All diagnostics of the un-cast program:\n${records.map(describeRecord).join('\n')}`,
    );
  }

  // 6. Explain each error with the derived gap. An empty derivation while tsc
  //    still errors is a broken derivation, never a closed gap.
  const sites: CastSite[] = casts.map((_, i) => {
    const { target, source, targetFile, sourceFile } = types[i]!;
    const gap = derive(checker, target, source);
    if (gap.length === 0) {
      throw new Error(
        `derivation broken: tsc still reports the exactOptionalPropertyTypes error for ${HTTP_REL}:${castLines[i]} ` +
          `without its cast, but no optional member of '${checker.typeToString(target)}' was found disagreeing with ` +
          `'${checker.typeToString(source)}'. Fix deriveGap in this test; do NOT drop the casts.\n` +
          matched[i]!.map((di) => describeRecord(records[di]!)).join('\n'),
      );
    }
    return { line: castLines[i]!, gap, targetFile, sourceFile };
  });
  sites.forEach((site, i) => {
    for (const di of matched[i]!) {
      const r = records[di]!;
      if (!site.gap.some((member) => r.text.includes(`'${member}'`))) {
        throw new Error(
          `the error for the cast at ${HTTP_REL}:${site.line} names none of the derived gap members ` +
            `(${site.gap.join(', ')}):\n${describeRecord(r)}`,
        );
      }
    }
  });
  return { casts: sites, diagnostics: records };
}

describe('mcp SDK Transport gap (#10278)', () => {
  it('http.ts still needs its `as Transport` casts; when this fails because the gap closed, delete the casts and this test', () => {
    const config = loadConfig();
    expect(
      config.fileNames.map((f) => path.resolve(f)),
      `mcp-server/tsconfig.json must include ${HTTP_REL}`,
    ).toContain(HTTP_TS);
    expect(
      config.options.exactOptionalPropertyTypes,
      'mcp-server/tsconfig.json must keep exactOptionalPropertyTypes: true; the #10278 casts only exist because of it. ' +
        'If you turned it off on purpose, drop the casts and this test.',
    ).toBe(true);

    const result = checkGap(config);
    expect(result.casts.length).toBeGreaterThan(0);
    const lines = read(HTTP_TS).split(/\r?\n/);
    for (const site of result.casts) {
      expect(site.gap.length, `derived gap at ${HTTP_REL}:${site.line}`).toBeGreaterThan(0);
      // Reported lines are 1-based, as an editor shows them.
      expect(lines[site.line - 1], `${HTTP_REL}:${site.line} should hold the cast`).toContain(`as ${TARGET_INTERFACE}`);
    }
    // checkGap already matched exactly one exactOptional error to each cast by
    // STATEMENT; a line comparison here would reject a formatter-wrapped cast
    // (TS2375 lands on the declared name, a line above the cast) that tsc accepts.
    expect(result.diagnostics.length, 'one exactOptional error per cast statement').toBe(result.casts.length);

    // Anchor the derived gap to the oracle (lessons-learned #11/#18). The checks
    // above only ask deriveGap to EXPLAIN the errors, which a constant or an
    // over-wide derivation can do; these ask the un-cast compile whether the
    // derived set is the gap. Both casts take the same SDK value to the same SDK
    // interface, so they share one gap; widening that gap in the SDK's .d.ts is
    // the SDK fixing it.
    const [first] = result.casts;
    for (const site of result.casts) {
      expect(
        [site.gap, site.targetFile],
        `${HTTP_REL}:${site.line} must share the gap of ${HTTP_REL}:${first!.line}`,
      ).toEqual([first!.gap, first!.targetFile]);
    }
    const gap = first!.gap;
    const targetFile = path.resolve(first!.targetFile);
    const sdk = read(targetFile);
    // Widening nothing is the real SDK. Minimality takes that branch when the
    // gap has one member, so pin it here although today's gap has four.
    const widening = (members: string[]): Map<string, string> =>
      members.length === 0
        ? new Map()
        : new Map([[targetFile, widenOptionals(targetFile, sdk, TARGET_INTERFACE, new Set(members))]]);
    expect(widening([]).size, 'widening no members must leave the SDK as it is').toBe(0);

    // (a) Completeness: widening ONLY the derived members closes the gap, so the
    //     un-cast program compiles clean (the oracle's "drop the casts" path).
    let completeness: string;
    try {
      checkGap(config, { overrides: widening(gap) });
      completeness = 'the un-cast program still reports errors';
    } catch (e) {
      completeness = e instanceof Error ? e.message : String(e);
    }
    expect(
      completeness,
      `completeness: widening only the derived gap (${gap.join(', ')}) must make the un-cast ${HTTP_REL} compile clean`,
    ).toMatch(/compiles without its casts, so the SDK gap is closed/);

    // (b) Minimality: every derived member is needed. Widening all the others
    //     still leaves one exactOptional error at each cast, naming that member.
    for (const member of gap) {
      const rest = gap.filter((m) => m !== member);
      let narrowed: GapResult;
      try {
        narrowed = checkGap(config, { overrides: widening(rest) });
      } catch (e) {
        throw new Error(
          `minimality: with every derived member but '${member}' widened, the un-cast ${HTTP_REL} no longer ` +
            `reports exactly one exactOptional error per cast, so '${member}' is not part of the gap:\n` +
            (e instanceof Error ? e.message : String(e)),
        );
      }
      expect(narrowed.diagnostics.length, `minimality: '${member}' alone must still fail each cast`).toBe(
        result.casts.length,
      );
      for (const d of narrowed.diagnostics) {
        expect(TS_EXACT_OPTIONAL.has(d.code), `minimality: '${member}' error code TS${d.code}`).toBe(true);
        expect(d.text, `minimality: the remaining error must name '${member}'`).toContain(`'${member}'`);
      }
    }
  }, 120_000);
});

// ---------------------------------------------------------------------------
// Overlays: the same check against rewritten SDK / http.ts text.
// ---------------------------------------------------------------------------

interface Edit {
  start: number;
  end: number;
  text: string;
}

/** Applies the edits; throws if there were none or the text did not change (#19). */
function applyEdits(text: string, edits: Edit[]): string {
  if (edits.length === 0) throw new Error('overlay made no edits');
  let out = text;
  for (const e of [...edits].sort((a, b) => b.start - a.start)) out = out.slice(0, e.start) + e.text + out.slice(e.end);
  if (out === text) throw new Error('overlay left the text unchanged');
  return out;
}

function parse(fileName: string, text: string): ts.SourceFile {
  return ts.createSourceFile(fileName, text, ts.ScriptTarget.Latest, true);
}

type Member = ts.ClassElement | ts.TypeElement;
type NamedDeclaration = (ts.ClassDeclaration | ts.InterfaceDeclaration) & { readonly name: ts.Identifier };

function findDeclaration(sf: ts.SourceFile, name: string): NamedDeclaration {
  const decl = sf.statements.find(
    (s): s is NamedDeclaration => (ts.isClassDeclaration(s) || ts.isInterfaceDeclaration(s)) && s.name?.text === name,
  );
  if (!decl) throw new Error(`overlay: no class or interface ${name} in ${sf.fileName}`);
  return decl;
}

const membersOf = (decl: ts.ClassDeclaration | ts.InterfaceDeclaration): readonly Member[] => decl.members;

function syntacticallyAdmitsUndefined(node: ts.TypeNode): boolean {
  const t = ts.isParenthesizedTypeNode(node) ? node.type : node;
  if (t.kind === ts.SyntaxKind.UndefinedKeyword) return true;
  return ts.isUnionTypeNode(t) && t.types.some((m) => m.kind === ts.SyntaxKind.UndefinedKeyword);
}

/**
 * Moves the picked members of `name` onto a new base declaration that `name`
 * then extends: the inherited-member shape a body-only walk cannot see.
 */
function hoistToBase(fileName: string, text: string, name: string, pick: (m: Member) => boolean): string {
  const sf = parse(fileName, text);
  const decl = findDeclaration(sf, name);
  if (decl.typeParameters || decl.heritageClauses?.some((h) => h.token === ts.SyntaxKind.ExtendsKeyword)) {
    throw new Error(`overlay: ${name} already has type parameters or an extends clause`);
  }
  const members = membersOf(decl).filter(pick);
  if (members.length === 0) throw new Error(`overlay: no members of ${name} matched`);
  const baseName = `${name}HoistedBase`;
  const keyword = ts.isClassDeclaration(decl) ? 'declare class' : 'interface';
  const body = members.map((m) => `    ${m.getText(sf)}`).join('\n');
  const out = applyEdits(text, [
    { start: decl.getStart(sf), end: decl.getStart(sf), text: `${keyword} ${baseName} {\n${body}\n}\n` },
    { start: decl.name.end, end: decl.name.end, text: ` extends ${baseName}` },
    ...members.map((m) => ({ start: m.getFullStart(), end: m.end, text: '' })),
  ]);
  assertHoisted(fileName, out, name, baseName, pick);
  return out;
}

/**
 * #19: throws unless `name` in `text` holds none of the picked members and
 * extends `baseName`. The hoistToBase cases pass only if the edits did both,
 * so this is driven directly on texts where one half did not happen.
 */
function assertHoisted(fileName: string, text: string, name: string, baseName: string, pick: (m: Member) => boolean): void {
  const sf = parse(fileName, text);
  const decl = findDeclaration(sf, name);
  const extendsBase = decl.heritageClauses?.some(
    (h) => h.token === ts.SyntaxKind.ExtendsKeyword && h.types.some((t) => t.expression.getText(sf) === baseName),
  );
  if (membersOf(decl).some(pick) || !extendsBase) {
    throw new Error(`overlay: hoisting ${name}'s members did not apply`);
  }
}

/** The declared type of a get accessor, or of a set accessor's parameter. */
function accessorTypeNode(m: Member): ts.TypeNode | undefined {
  if (ts.isGetAccessorDeclaration(m)) return m.type;
  if (ts.isSetAccessorDeclaration(m)) return m.parameters[0]?.type;
  return undefined;
}

const admitsUndefinedAccessor = (m: Member): boolean => {
  const node = accessorTypeNode(m);
  return node !== undefined && syntacticallyAdmitsUndefined(node);
};

/**
 * #19: throws if any accessor of `name` in `text` is still typed `| undefined`.
 * Driven directly on a text where the retyping did not happen.
 */
function assertAccessorsAliased(fileName: string, text: string, name: string): void {
  if (membersOf(findDeclaration(parse(fileName, text), name)).some(admitsUndefinedAccessor)) {
    throw new Error(`overlay: aliasing ${name}'s accessor types did not apply`);
  }
}

/** Retypes each `| undefined` accessor of `name` through a type alias. */
function aliasAccessorTypes(fileName: string, text: string, name: string): string {
  const sf = parse(fileName, text);
  const decl = findDeclaration(sf, name);
  const edits: Edit[] = [];
  const aliases: string[] = [];
  for (const m of membersOf(decl)) {
    const node = accessorTypeNode(m);
    if (!node || !syntacticallyAdmitsUndefined(node)) continue;
    const alias = `${name}Alias${aliases.length}`;
    aliases.push(`type ${alias} = ${node.getText(sf)};`);
    edits.push({ start: node.getStart(sf), end: node.end, text: alias });
  }
  if (aliases.length === 0) throw new Error(`overlay: no \`| undefined\` accessors on ${name}`);
  edits.push({ start: decl.getStart(sf), end: decl.getStart(sf), text: `${aliases.join('\n')}\n` });
  const out = applyEdits(text, edits);
  assertAccessorsAliased(fileName, out, name);
  return out;
}

/**
 * Widens strict optional properties of `name` to `| undefined`: the SDK fixing the gap.
 * With `only`, widens exactly those members and throws unless every one of them was
 * found and widened (lessons-learned #19: a partial edit must not read as a result).
 */
function widenOptionals(fileName: string, text: string, name: string, only?: ReadonlySet<string>): string {
  const sf = parse(fileName, text);
  const edits: Edit[] = [];
  const widened: string[] = [];
  for (const m of membersOf(findDeclaration(sf, name))) {
    if (!ts.isPropertySignature(m) || !m.questionToken || !m.type || syntacticallyAdmitsUndefined(m.type)) continue;
    const member = m.name.getText(sf);
    if (only && !only.has(member)) continue;
    widened.push(member);
    edits.push({ start: m.type.getStart(sf), end: m.type.end, text: `(${m.type.getText(sf)}) | undefined` });
  }
  if (only) {
    const missing = [...only].filter((member) => !widened.includes(member));
    if (missing.length > 0) {
      throw new Error(
        `overlay: ${missing.join(', ')} not found as strict optional properties declared directly on ${name} ` +
          `in ${fileName}, so they cannot be widened there`,
      );
    }
  }
  return applyEdits(text, edits);
}

function enclosingStatement(node: ts.Node): ts.Node {
  let n = node;
  while (!ts.isBlock(n.parent) && !ts.isSourceFile(n.parent)) n = n.parent;
  return n;
}

function indentOf(text: string, pos: number): string {
  return text.slice(text.lastIndexOf('\n', pos - 1) + 1, pos);
}

const HOISTED = 'castForGapTest';

/** The first `as Transport` cast passed as a call argument, its call, and the local `Transport` name. */
function argumentCast(sf: ts.SourceFile): { cast: ts.AsExpression; call: ts.CallExpression; local: string } {
  const cast = findCasts(sf).find((c) => ts.isCallExpression(c.parent));
  if (!cast) throw new Error(`overlay: no argument-position \`as ${TARGET_INTERFACE}\` cast in ${sf.fileName}`);
  return { cast, call: cast.parent as ts.CallExpression, local: cast.type.getText(sf) };
}

/**
 * The first argument-position cast, rewritten as `const x: Transport = ... as Transport; connect(x)`.
 * `wrapped` breaks the declaration after `=`, the way a formatter wraps a long line, so the
 * TS2375 lands on the declared name one line above the cast. `annotated: false` drops the
 * `: Transport` annotation, so without the cast nothing checks the declaration and the error
 * moves to the call. Returns the new text and the (1-based) line of the call.
 */
function assignmentForm(
  text: string,
  { wrapped = false, annotated = true }: { wrapped?: boolean; annotated?: boolean } = {},
): { text: string; callLine: number } {
  const sf = parse(HTTP_TS, text);
  const { cast, local } = argumentCast(sf);
  const stmt = enclosingStatement(cast);
  const start = stmt.getStart(sf);
  const call = text.slice(start, cast.getStart(sf)) + HOISTED + text.slice(cast.end, stmt.end);
  const out = applyEdits(text, [
    {
      start,
      end: stmt.end,
      text:
        `const ${HOISTED}${annotated ? `: ${local}` : ''} =${wrapped ? `\n${indentOf(text, start)}  ` : ' '}` +
        `${cast.getText(sf)};\n${indentOf(text, start)}${call}`,
    },
  ]);
  const outSf = parse(HTTP_TS, out);
  const uses: number[] = [];
  const visit = (node: ts.Node): void => {
    if (ts.isIdentifier(node) && node.text === HOISTED && ts.isCallExpression(node.parent)) {
      uses.push(lineOf(outSf, node.getStart(outSf)));
    }
    ts.forEachChild(node, visit);
  };
  visit(outSf);
  if (uses.length !== 1) throw new Error(`overlay: expected exactly one call passing ${HOISTED}, found ${uses.length}`);
  return { text: out, callLine: uses[0]! };
}

interface CastContext {
  /** The first argument-position cast's operand text. */
  operand: string;
  /** The local name `Transport` is imported under. */
  local: string;
  /** The callee that cast is passed to, e.g. `server.connect`. */
  callee: string;
}

/**
 * Inserts the statement `build` returns on the line after the first argument-position
 * cast's statement, and throws unless that line then holds exactly `casts` casts (#19).
 * Returns the new text and that (1-based) line.
 */
function insertAfterCast(
  text: string,
  build: (c: CastContext) => string,
  casts = 1,
): { text: string; line: number } {
  const sf = parse(HTTP_TS, text);
  const { cast, call, local } = argumentCast(sf);
  const stmt = enclosingStatement(cast);
  const statement = build({ operand: cast.expression.getText(sf), local, callee: call.expression.getText(sf) });
  const out = applyEdits(text, [{ start: stmt.end, end: stmt.end, text: `\n${indentOf(text, stmt.getStart(sf))}${statement}` }]);
  const line = lineOf(sf, stmt.end) + 1;
  const outSf = parse(HTTP_TS, out);
  const added = findCasts(outSf).filter((c) => lineOf(outSf, c.getStart(outSf)) === line).length;
  if (added !== casts) throw new Error(`overlay: expected ${casts} cast(s) on line ${line}, found ${added}`);
  return { text: out, line };
}

/**
 * Adds `void (<expr>);` after the first cast's statement, where `<expr>` is `wrap`
 * applied to a fresh cast of the same operand. By default the bare cast, which tsc
 * does not need.
 */
const extraCast = (
  text: string,
  wrap: (cast: string, local: string) => string = (cast) => cast,
): { text: string; line: number } =>
  insertAfterCast(text, ({ operand, local }) => `void (${wrap(`${operand} as ${local}`, local)});`);

/** A project-local module next to http.ts that exists only in an overlay (compile() serves it). */
const LOCAL_MODULE = path.join(path.dirname(HTTP_TS), 'gapTestLocal.ts');
const LOCAL_SPECIFIER = './gapTestLocal.js';
const LOCAL_CLASS = 'GapTestLocalTransport';

const specifierOf = (decl: ts.ImportDeclaration): string => (decl.moduleSpecifier as ts.StringLiteral).text;

/**
 * The same overlay-only module as a declaration file, so what it declares is
 * from a `.d.ts` (the same specifier resolves to it when no `.ts` exists).
 */
const LOCAL_DECLARATION_MODULE = path.join(path.dirname(HTTP_TS), 'gapTestLocal.d.ts');
const LOCAL_DECLARED_CLASS = 'GapTestDeclaredTransport';

type LocalTargetKind = 'interface' | 'alias' | 'declaredClass';

/** What the overlay-only module declares as `Transport`, and which file it is. */
const LOCAL_TARGETS: Record<LocalTargetKind, { module: string; declaration: string }> = {
  interface: { module: LOCAL_MODULE, declaration: `export interface ${TARGET_INTERFACE} extends GapTestSdkTransport {}` },
  alias: {
    module: LOCAL_MODULE,
    declaration: `export type ${TARGET_INTERFACE} = GapTestSdkTransport & { readonly gapTestBrand?: never };`,
  },
  declaredClass: {
    module: LOCAL_DECLARATION_MODULE,
    declaration:
      'declare const GapTestTransportBase: new () => GapTestSdkTransport;\n' +
      `export declare class ${LOCAL_DECLARED_CLASS} extends GapTestTransportBase {}\n` +
      `export { ${LOCAL_DECLARED_CLASS} as ${TARGET_INTERFACE} };`,
  },
};

/**
 * Points http.ts's `Transport` import at the overlay-only local module, which
 * re-exports the SDK module but declares its own `Transport`:
 *  - `interface`: an `interface Transport extends <the SDK's Transport>` in a
 *    `.ts` (an interface, but not from a `.d.ts`);
 *  - `alias`: a `type Transport = <the SDK's Transport> & {...}` in a `.ts` (an
 *    intersection: a target with no type symbol at all);
 *  - `declaredClass`: a class whose instances carry the SDK's `Transport` members,
 *    declared in a `.d.ts` and exported as `Transport` (from a `.d.ts`, but a
 *    class, not an interface).
 * Each is a cast target tsc accepts, and passes to `connect`, that is not the
 * SDK's interface. Returns both overrides.
 */
function localTransportTarget(httpText: string, kind: LocalTargetKind): Map<string, string> {
  const sf = parse(HTTP_TS, httpText);
  const binding = importBinding(sf, TARGET_INTERFACE);
  if (!binding) throw new Error(`overlay: ${sf.fileName} does not import \`${TARGET_INTERFACE}\``);
  const specifier = binding.decl.moduleSpecifier;
  const sdkSpecifier = specifierOf(binding.decl);
  const { module, declaration } = LOCAL_TARGETS[kind];
  return new Map([
    [HTTP_TS, applyEdits(httpText, [{ start: specifier.getStart(sf), end: specifier.end, text: `'${LOCAL_SPECIFIER}'` }])],
    [
      module,
      `import type { ${TARGET_INTERFACE} as GapTestSdkTransport } from '${sdkSpecifier}';\n` +
        `export * from '${sdkSpecifier}';\n${declaration}\n`,
    ],
  ]);
}

/**
 * Declares `class GapTestLocalTransport extends <the SDK class>` in the overlay-only
 * local module and uses it for every reference to the SDK class in http.ts (the
 * annotations and the `new`s), so each cast's operand is a project-local subclass:
 * a value tsc accepts at the cast that is not declared in the SDK's `.d.ts`.
 */
function localSubclassSource(httpText: string, sdkClass: string): Map<string, string> {
  const sf = parse(HTTP_TS, httpText);
  const binding = importBinding(sf, sdkClass);
  if (!binding) throw new Error(`overlay: ${sf.fileName} does not import \`${sdkClass}\``);
  const at = binding.decl.getStart(sf);
  const edits: Edit[] = [{ start: at, end: at, text: `import { ${LOCAL_CLASS} } from '${LOCAL_SPECIFIER}';\n` }];
  const visit = (node: ts.Node): void => {
    if (ts.isIdentifier(node) && node.text === binding.local && !ts.isImportSpecifier(node.parent)) {
      edits.push({ start: node.getStart(sf), end: node.end, text: LOCAL_CLASS });
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
  return new Map([
    [HTTP_TS, applyEdits(httpText, edits)],
    [
      LOCAL_MODULE,
      `import { ${sdkClass} } from '${specifierOf(binding.decl)}';\nexport class ${LOCAL_CLASS} extends ${sdkClass} {}\n`,
    ],
  ]);
}

/** Every `as Transport` rewritten through a local alias: casts tsc accepts that findCasts cannot see. */
function castsThroughAlias(text: string): string {
  const sf = parse(HTTP_TS, text);
  const { local } = argumentCast(sf);
  return applyEdits(text, [
    ...findCasts(sf).map((c) => ({ start: c.type.getStart(sf), end: c.type.end, text: 'GapTestTransport' })),
    { start: text.length, end: text.length, text: `\ntype GapTestTransport = ${local};\n` },
  ]);
}

/** The part of a checkGap message under `header`, up to the full diagnostic listing. */
function sectionOf(message: string, header: string): string {
  const at = message.indexOf(header);
  if (at === -1) return '';
  const end = message.indexOf('All diagnostics of the un-cast program', at);
  return message.slice(at + header.length, end === -1 ? undefined : end);
}

/** `x as Transport` -> `x as unknown as Transport` on the first cast. */
function doubleCast(text: string): string {
  const cast = findCasts(parse(HTTP_TS, text))[0];
  if (!cast) throw new Error('overlay: no cast in http.ts');
  return applyEdits(text, [{ start: cast.expression.end, end: cast.expression.end, text: ' as unknown' }]);
}

/** The first class in an SDK `.d.ts` that declares a get accessor: the transport class. */
function accessorClassName(file: string, text: string): string {
  const cls = parse(file, text)
    .statements.filter(ts.isClassDeclaration)
    .find((s) => s.members.some(ts.isGetAccessorDeclaration));
  if (!cls?.name) throw new Error(`overlay: no named class with a get accessor in ${file}`);
  return cls.name.text;
}

function read(file: string): string {
  const text = ts.sys.readFile(file);
  if (text === undefined) throw new Error(`cannot read ${file}`);
  return text;
}

function messageOf(run: () => unknown): string {
  try {
    run();
  } catch (e) {
    return e instanceof Error ? e.message : String(e);
  }
  throw new Error('expected the check to fail, and it passed');
}

describe('Transport gap check against overlaid sources (#10278)', () => {
  const config = loadConfig();
  let realCache: GapResult | undefined;
  const real = (): GapResult => (realCache ??= checkGap(config));
  const sdkTarget = (): string => path.resolve(real().casts[0]!.targetFile);
  const sdkSource = (): string => path.resolve(real().casts[0]!.sourceFile);
  const sourceClass = (): string => accessorClassName(sdkSource(), read(sdkSource()));
  const firstLine = (): number => real().casts[0]!.line;
  const failWith = (overrides: Map<string, string>): string => messageOf(() => checkGap(config, { overrides }));
  const expectStillOpen = (overrides: Map<string, string>): void => {
    const result = checkGap(config, { overrides });
    expect(result.casts.map((c) => [c.line, c.gap])).toEqual(real().casts.map((c) => [c.line, c.gap]));
  };

  it('M4a: the SDK moves the accessors onto a base class -> the gap is still derived', () => {
    const file = sdkSource();
    const isAccessor = (m: Member): boolean => ts.isGetAccessorDeclaration(m) || ts.isSetAccessorDeclaration(m);
    expectStillOpen(new Map([[file, hoistToBase(file, read(file), sourceClass(), isAccessor)]]));
  }, 60_000);

  it('M4b: the SDK moves the Transport members onto a base interface -> the gap is still derived', () => {
    const file = sdkTarget();
    const isOptional = (m: Member): boolean => ts.isPropertySignature(m) && m.questionToken !== undefined;
    expectStillOpen(new Map([[file, hoistToBase(file, read(file), TARGET_INTERFACE, isOptional)]]));
  }, 60_000);

  it('the SDK types its accessors through an alias -> the gap is still derived', () => {
    const file = sdkSource();
    expectStillOpen(new Map([[file, aliasAccessorTypes(file, read(file), sourceClass())]]));
  }, 60_000);

  // Step 1.
  it('http.ts that does not compile with its casts (one cast deleted) -> RED before anything is stripped', () => {
    const line = firstLine();
    const sf = parse(HTTP_TS, read(HTTP_TS));
    const message = failWith(new Map([[HTTP_TS, stripCasts(sf, findCasts(sf).slice(0, 1)).text]]));
    expect(message).toContain(`${HTTP_REL} must compile clean under the real tsconfig before its casts can be tested:`);
    expect(message).toContain(`${HTTP_REL}:${line} TS2379: `);
  }, 60_000);

  // Step 2.
  it('casts tsc accepts that are not `as Transport` (through an alias) -> RED "no casts found", not "gap closed"', () => {
    const message = failWith(new Map([[HTTP_TS, castsThroughAlias(read(HTTP_TS))]]));
    expect(message).toContain(`no \`as ${TARGET_INTERFACE}\` casts found in ${HTTP_REL}.`);
    expect(message).not.toMatch(/gap is closed/);
  }, 60_000);

  // Step 3, target guard: `target.getSymbol()?.declarations?.find(ts.isInterfaceDeclaration)`,
  // then `!targetDecl?.getSourceFile().isDeclarationFile`. One case per way through it:
  //  - a project-local interface has an interface declaration, not in a `.d.ts`:
  //    only the `.d.ts` half rejects it;
  //  - a class declared in a `.d.ts` has a declaration in a `.d.ts`, not an
  //    interface: only the `.find(ts.isInterfaceDeclaration)` kind filter rejects it;
  //  - an intersection alias has no type symbol: the `getSymbol()?.` link leaves
  //    no declaration at all, before any kind filter or file check runs.
  it('a cast to a project-local `Transport` interface (not the SDK interface) -> RED naming the line', () => {
    const message = failWith(localTransportTarget(read(HTTP_TS), 'interface'));
    expect(message).toContain(`${HTTP_REL}:${firstLine()} `);
    expect(message).toContain(`the cast target must be the SDK's \`${TARGET_INTERFACE}\` interface; found 'Transport'`);
  }, 60_000);

  it('a cast to a `Transport` that is a class declared in a `.d.ts` (not an interface) -> RED naming the line, cast and class', () => {
    const overrides = localTransportTarget(read(HTTP_TS), 'declaredClass');
    const http = parse(HTTP_TS, overrides.get(HTTP_TS)!);
    const cast = findCasts(http)[0]!;
    const message = failWith(overrides);
    expect(message).toContain(
      `${HTTP_REL}:${lineOf(http, cast.getStart(http))} \`${cast.getText(http)}\`: ` +
        `the cast target must be the SDK's \`${TARGET_INTERFACE}\` interface; found '${LOCAL_DECLARED_CLASS}'.`,
    );
  }, 60_000);

  it('a cast to a project-local `Transport` intersection alias (no type symbol at all) -> RED naming the line', () => {
    const message = failWith(localTransportTarget(read(HTTP_TS), 'alias'));
    expect(message).toContain(`${HTTP_REL}:${firstLine()} `);
    expect(message).toContain(`the cast target must be the SDK's \`${TARGET_INTERFACE}\` interface; found 'Transport'`);
  }, 60_000);

  // Step 3, operand guard: `source.getSymbol()?.declarations?.find(ts.isClassDeclaration)`,
  // then `!sourceDecl?.getSourceFile().isDeclarationFile`. One case per way through it:
  //  - a project-local subclass has a class declaration, not in a `.d.ts`: only
  //    the `.d.ts` half rejects it;
  //  - a value already typed as the SDK's `Transport` has a declaration in the
  //    SDK's `.d.ts`, not a class: only the `.find(ts.isClassDeclaration)` kind
  //    filter rejects it;
  //  - a nullable operand (a union) and `as unknown` have no type symbol: the
  //    `getSymbol()?.` link leaves no declaration at all.
  it('a cast whose operand is a project-local subclass of the SDK transport -> RED naming the line and type', () => {
    const overrides = localSubclassSource(read(HTTP_TS), sourceClass());
    // The added import shifts every line, so read the first cast's line off the overlay.
    const http = parse(HTTP_TS, overrides.get(HTTP_TS)!);
    const message = failWith(overrides);
    expect(message).toContain(`${HTTP_REL}:${lineOf(http, findCasts(http)[0]!.getStart(http))} `);
    expect(message).toContain(
      `must apply directly to an SDK StreamableHTTPServerTransport value (a class declared in the SDK's .d.ts)`,
    );
    expect(message).toContain(`this operand has type '${LOCAL_CLASS}'`);
  }, 60_000);

  it('a cast whose operand is already typed as the SDK `Transport` interface (not a class) -> RED naming the line, cast and type', () => {
    const value = 'gapTestSdkValue';
    const overlay = insertAfterCast(read(HTTP_TS), ({ local }) => `let ${value}!: ${local}; void (${value} as ${local});`);
    const message = failWith(new Map([[HTTP_TS, overlay.text]]));
    expect(message).toContain(
      `${HTTP_REL}:${overlay.line} \`${value} as ${TARGET_INTERFACE}\`: each \`as ${TARGET_INTERFACE}\` cast must apply ` +
        `directly to an SDK StreamableHTTPServerTransport value (a class declared in the SDK's .d.ts); ` +
        `this operand has type '${TARGET_INTERFACE}'.`,
    );
  }, 60_000);

  it('a cast whose operand may be null -> RED at the operand guard, naming the line and the nullable type', () => {
    const overlay = insertAfterCast(read(HTTP_TS), ({ operand, local }) => `void ([${operand}, null][0] as ${local});`);
    const message = failWith(new Map([[HTTP_TS, overlay.text]]));
    expect(message).toContain(`${HTTP_REL}:${overlay.line} `);
    expect(message).toContain(`this operand has type '${sourceClass()} | null'`);
  }, 60_000);

  it('`as unknown as Transport` -> RED naming the line and the operand type', () => {
    const message = failWith(new Map([[HTTP_TS, doubleCast(read(HTTP_TS))]]));
    expect(message).toContain(`${HTTP_REL}:${firstLine()} `);
    expect(message).toContain('must apply directly to an SDK StreamableHTTPServerTransport value');
    expect(message).toContain("this operand has type 'unknown'");
  }, 60_000);

  // Step 4: stripCasts replaces each cast by its operand's ORIGINAL text, so a
  // cast inside another cast's operand survives the strip.
  it("a cast nested inside another cast's operand -> RED: the strip left a cast", () => {
    const overlay = insertAfterCast(
      read(HTTP_TS),
      ({ operand, local }) => `void (((gapT: ${local}) => ${operand})(${operand} as ${local}) as ${local});`,
      2,
    );
    const message = failWith(new Map([[HTTP_TS, overlay.text]]));
    expect(message).toContain(`stripping the casts left an \`as ${TARGET_INTERFACE}\` cast in ${HTTP_REL}`);
  }, 60_000);

  it('the SDK fixes the gap -> RED with "drop the casts", decided by the un-cast compile', () => {
    const file = sdkTarget();
    const overrides = new Map([[file, widenOptionals(file, read(file), TARGET_INTERFACE)]]);
    expect(messageOf(() => checkGap(config, { overrides }))).toMatch(
      /compiles without its casts, so the SDK gap is closed: drop the `as Transport` casts/,
    );
  }, 60_000);

  it('an empty derivation while tsc still errors -> "derivation broken", never "drop the casts"', () => {
    const message = messageOf(() => checkGap(config, { derive: () => [] }));
    expect(message).toMatch(/^derivation broken: tsc still reports/);
    expect(message).not.toMatch(/gap is closed|drop the `as/);
  }, 60_000);

  it('a derived gap the error does not name -> RED "names none of the derived gap members", with line and code', () => {
    const message = messageOf(() => checkGap(config, { derive: () => ['notAGapMember'] }));
    const line = firstLine();
    expect(message).toContain(`the error for the cast at ${HTTP_REL}:${line} names none of the derived gap members`);
    expect(message).toContain('(notAGapMember)');
    // The offending diagnostic, as describeRecord prints it: file:line TScode.
    const named = real().diagnostics.filter((d) => message.includes(`${HTTP_REL}:${d.line} TS${d.code}: `));
    expect(named.length, 'the message must quote the unexplained diagnostic with its line and TS code').toBe(1);
    expect(TS_EXACT_OPTIONAL.has(named[0]!.code)).toBe(true);
  }, 60_000);

  // Step 6 matches a member by its QUOTED name, as tsc prints a property. A
  // derived name that is only a substring of the property the error names is
  // in the error text, but names no member.
  it('a derived member that is only a substring of the property the error names -> RED "names none of the derived gap members"', () => {
    const text = real().diagnostics[0]!.text;
    const property = /property '([^']+)'/.exec(text)?.[1];
    expect(property, `the un-cast error names a property: ${text}`).toBeDefined();
    const partial = property!.slice(1);
    // The case is only meaningful if the bare substring IS in the text and the quoted one is not.
    expect([partial.length > 0, text.includes(partial), text.includes(`'${partial}'`)]).toEqual([true, true, false]);
    const message = messageOf(() => checkGap(config, { derive: () => [partial] }));
    expect(message).toContain(
      `the error for the cast at ${HTTP_REL}:${firstLine()} names none of the derived gap members (${partial}):`,
    );
  }, 60_000);

  it('a cast moved into an assignment (TS2375 instead of TS2379) still passes', () => {
    const result = checkGap(config, { overrides: new Map([[HTTP_TS, assignmentForm(read(HTTP_TS)).text]]) });
    expect(result.diagnostics.map((d) => d.code).sort()).toEqual([2375, 2379]);
  }, 60_000);

  it('a formatter-wrapped assignment (TS2375 a line above the cast) still passes', () => {
    const overlay = assignmentForm(read(HTTP_TS), { wrapped: true });
    const result = checkGap(config, { overrides: new Map([[HTTP_TS, overlay.text]]) });
    expect(result.diagnostics.map((d) => d.code).sort()).toEqual([2375, 2379]);
    const assignment = result.diagnostics.find((d) => d.code === 2375)!;
    expect(result.casts.some((c) => c.line === assignment.line + 1)).toBe(true);
  }, 60_000);

  // Step 5, the three per-statement hints: 0 errors, fewer than casts, more than casts.
  it('an unneeded extra cast -> RED naming the cast line that produced no error', () => {
    const overlay = extraCast(read(HTTP_TS));
    const message = failWith(new Map([[HTTP_TS, overlay.text]]));
    expect(message).toContain(`cast(s) at ${HTTP_REL}:${overlay.line} produced 0 exactOptional error(s) when removed`);
    expect(message).toContain('the cast is not needed for the #10278 gap');
  }, 60_000);

  it('two casts in one statement, one of them unneeded -> RED once for the statement: fewer errors than casts', () => {
    const overlay = insertAfterCast(
      read(HTTP_TS),
      ({ operand, local, callee }) => `void [${callee}(${operand} as ${local}), ${operand} as ${local}];`,
      2,
    );
    const message = failWith(new Map([[HTTP_TS, overlay.text]]));
    const at = `${HTTP_REL}:${overlay.line}`;
    const problem =
      `cast(s) at ${at}, ${at} produced 1 exactOptional error(s) when removed, expected 2: ` +
      'one of these casts is not needed for the #10278 gap';
    expect(message).toContain(problem);
    // The statement is reported once, not once per cast it holds.
    expect(message.split(`cast(s) at ${at}`).length - 1, 'one problem line per statement').toBe(1);
  }, 60_000);

  it('one cast whose removal breaks two calls in its statement -> RED: more errors than casts', () => {
    const overlay = insertAfterCast(
      read(HTTP_TS),
      ({ operand, local, callee }) => `for (const gapT of [${operand} as ${local}]) void [${callee}(gapT), ${callee}(gapT)];`,
    );
    const message = failWith(new Map([[HTTP_TS, overlay.text]]));
    expect(message).toContain(
      `cast(s) at ${HTTP_REL}:${overlay.line} produced 2 exactOptional error(s) when removed, expected 1: ` +
        'more errors than casts at this statement',
    );
  }, 60_000);

  // Pins step 5's classification: a diagnostic INSIDE a cast statement counts
  // as the gap only if it is a TS2375/TS2379. `(x as Transport) satisfies
  // Transport` compiles; without the cast tsc reports TS1360 at that statement.
  // Counted as the gap, it would satisfy the one-error-per-cast rule and the
  // check would pass. (The unexpected listing itself is pinned by the next case.)
  it('a non-exactOptional error at a cast site (TS1360) is not counted as the gap -> RED', () => {
    const overlay = extraCast(read(HTTP_TS), (cast, local) => `(${cast}) satisfies ${local}`);
    const message = failWith(new Map([[HTTP_TS, overlay.text]]));
    expect(message).toContain(`cast(s) at ${HTTP_REL}:${overlay.line} produced 0 exactOptional error(s) when removed`);
    expect(message).toContain(`${HTTP_REL}:${overlay.line} TS1360: `);
  }, 60_000);

  // Pins step 5's report of diagnostics outside every cast statement: hoisting
  // the cast into an unannotated const moves the error to the call that uses it.
  it('an error outside every cast statement -> RED, listed with its line and code', () => {
    const overlay = assignmentForm(read(HTTP_TS), { annotated: false });
    const message = failWith(new Map([[HTTP_TS, overlay.text]]));
    const listed = sectionOf(message, UNEXPECTED_HEADER);
    expect(listed, 'the message must list the unexpected diagnostics under their header').toContain(
      `${HTTP_REL}:${overlay.callLine} TS2379: `,
    );
  }, 60_000);

  // recordOf/describeRecord: an options diagnostic has no position. Turning off
  // strictNullChecks under exactOptionalPropertyTypes is TS5052.
  it('compiler options that are themselves an error -> RED at step 1, listed with no position', () => {
    const options = { ...config.options, strictNullChecks: false };
    const failure = messageOf(() => checkGap({ ...config, options }));
    expect(failure).toContain(`${HTTP_REL} must compile clean under the real tsconfig before its casts can be tested:`);
    expect(failure).toContain(`${HTTP_REL} (no position) TS5052: `);
  }, 60_000);

  it('a tsconfig whose program does not hold http.ts -> RED naming the file', () => {
    expect(messageOf(() => checkGap({ ...config, fileNames: [] }))).toContain(`${HTTP_TS} is not in the program`);
  }, 60_000);
});

// ---------------------------------------------------------------------------
// The helpers, driven directly on fixtures that reach every guard and clause.
// ---------------------------------------------------------------------------

/** A file that exists only in memory, compiled with no lib: enough for the checker. */
const VIRTUAL = path.join(MCP_ROOT, 'src', '__gapTestVirtual__.ts');

function virtualProgram(text: string): ts.Program {
  const options: ts.CompilerOptions = { strict: true, exactOptionalPropertyTypes: true, noLib: true, types: [] };
  return compile({ options, fileNames: [VIRTUAL], errors: [] }, new Map([[VIRTUAL, text]]));
}

/**
 * One member per deriveGap decision. IN the gap: sig (method signature vs a
 * getter), getterOnly, setterOnly, declProp (a property declaration), bareUndef
 * (a bare `undefined`), aliased (through a type alias), baseMethod/baseProp
 * (inherited from a CLASS the interface extends: a method and a property
 * declaration on the target side), mixedPair (a get/set pair whose getter
 * admits undefined and whose setter does not), setterFirst (the same pair with
 * the setter declared first, as the SDK orders its pairs), untypedGetter (a
 * pair whose getter has no type, so the setter's type is read) and
 * mergedFirstStrict (two merged target declarations, the first strict). NOT in
 * it: req (required), untyped (target has no type), mapped (from a mapped
 * type: the target property has no declaration at all), already (target admits
 * undefined), missing (not on the source), strictSrc (source does not admit
 * undefined), untypedSrc and noParamSetter (source has no readable type),
 * reversePair (a pair whose getter is strict and whose setter admits undefined)
 * and mergedFirstAdmits (two merged target declarations, the first admitting
 * undefined). The pair and merge shapes are checked against tsc's own verdict
 * in PAIR_AND_MERGE_SHAPES below.
 */
const DERIVE_FIXTURE = [
  'declare class TargetBase {',
  '  baseMethod?(): void;',
  '  baseProp?: string;',
  '}',
  "type TargetMapped = { [K in 'mapped']?: string };",
  'interface Target extends TargetBase, TargetMapped {',
  '  req: string;',
  '  untyped?;',
  '  already?: string | undefined;',
  '  missing?: string;',
  '  strictSrc?: string;',
  '  untypedSrc?: string;',
  '  noParamSetter?: string;',
  '  sig?(): void;',
  '  getterOnly?: string;',
  '  setterOnly?: string;',
  '  declProp?: string;',
  '  bareUndef?: string;',
  '  aliased?: string;',
  '  mixedPair?: string;',
  '  reversePair?: string;',
  '  setterFirst?: string;',
  '  untypedGetter?: string;',
  '  mergedFirstStrict?: string;',
  '  mergedFirstAdmits?: string | undefined;',
  '}',
  'interface Target {',
  '  mergedFirstStrict?: string | undefined;',
  '  mergedFirstAdmits?: string;',
  '}',
  'type MaybeString = string | undefined;',
  'declare class Source {',
  '  baseMethod: (() => void) | undefined;',
  '  baseProp: string | undefined;',
  '  req: string | undefined;',
  '  untyped: string | undefined;',
  '  mapped: string | undefined;',
  '  already: string | undefined;',
  '  strictSrc: string;',
  '  untypedSrc;',
  '  set noParamSetter();',
  '  get sig(): (() => void) | undefined;',
  '  get getterOnly(): string | undefined;',
  '  set setterOnly(v: string | undefined);',
  '  declProp: string | undefined;',
  '  get bareUndef(): undefined;',
  '  get aliased(): MaybeString;',
  '  get mixedPair(): string | undefined;',
  '  set mixedPair(v: string);',
  '  get reversePair(): string;',
  '  set reversePair(v: string | undefined);',
  '  set setterFirst(v: string);',
  '  get setterFirst(): string | undefined;',
  '  get untypedGetter();',
  '  set untypedGetter(v: string | undefined);',
  '  mergedFirstStrict: string | undefined;',
  '  mergedFirstAdmits: string | undefined;',
  '}',
  '',
].join('\n');

/**
 * DERIVE_FIXTURE's accessor-pair and merged-declaration members, each alone as
 * `m`, with whether tsc refuses `const t: Target = s` (TS2375). The test asserts
 * tsc's verdict first, then that deriveGap agrees with it, so the rule in
 * declaredTypeAdmitsUndefined is checked against the compiler, not restated.
 */
const PAIR_AND_MERGE_SHAPES: Array<[label: string, target: string, source: string, refused: boolean]> = [
  ['mixedPair', 'interface Target { m?: string }', 'get m(): string | undefined; set m(v: string);', true],
  ['reversePair', 'interface Target { m?: string }', 'get m(): string; set m(v: string | undefined);', false],
  ['setterFirst', 'interface Target { m?: string }', 'set m(v: string); get m(): string | undefined;', true],
  ['untypedGetter', 'interface Target { m?: string }', 'get m(); set m(v: string | undefined);', true],
  [
    'mergedFirstStrict',
    'interface Target { m?: string }\ninterface Target { m?: string | undefined }',
    'm: string | undefined;',
    true,
  ],
  [
    'mergedFirstAdmits',
    'interface Target { m?: string | undefined }\ninterface Target { m?: string }',
    'm: string | undefined;',
    false,
  ],
];

const WIDEN_FIXTURE = [
  'interface W {',
  '  req: string;',
  '  opt?: string;',
  '  other?: number;',
  '  union?: string | undefined;',
  '  paren?: (undefined);',
  '  bare?: undefined;',
  '  untyped?;',
  '  m?(): void;',
  '}',
].join('\n');

/** The SDK-import shapes importBinding must step over, then casts findCasts must and must not count. */
const CASTS_FIXTURE = [
  "import 'gap-side-effect';",
  "import D from 'gap-default';",
  "import * as ns from 'gap-namespace';",
  "import { createServer } from 'node:http';",
  "import type { Transport as SdkT } from 'sdk';",
  'declare const x: unknown;',
  'const a = x as SdkT;',
  'const b: SdkT = x as SdkT;',
  'const c = x as unknown;',
  'const d = x as ns.SdkT;',
  'const e = x as D;',
  'const f = (x as SdkT) as unknown;',
  'void createServer;',
].join('\n');

/** Casts in each kind of statement container statementAt knows, plus two it must look through. */
const STATEMENTS_FIXTURE = [
  'void (a as T);',
  'namespace N { void (b as T); }',
  'switch (0 as number) { case 0: void (c as T); break; default: void (d as T); }',
  'function f() { void 0; void (e as T); }',
  'for (const x of [g as T]) void x;',
  'void [() => { void 0; }, k as T];',
].join('\n');

const CALLS_FIXTURE = [
  "import type { Transport } from 'sdk';",
  'declare const s: { connect(t: Transport): void; log(m: string): void };',
  'declare const x: Transport;',
  'function f() {',
  '  void (x as Transport);',
  '  s.connect(x as Transport);',
  "  s.log('castForGapTest');",
  '}',
].join('\n');

const TOP_LEVEL_CALL_FIXTURE = [
  "import type { Transport } from 'sdk';",
  'declare const s: { connect(t: Transport): void };',
  'declare const x: Transport;',
  's.connect(x as Transport);',
].join('\n');

describe('Transport gap check helpers reach every guard (#10278)', () => {
  it('importBinding/findCasts: steps over default, namespace and side-effect imports, follows the alias, counts only `as <local Transport>`', () => {
    const sf = parse('casts.ts', CASTS_FIXTURE);
    expect(transportLocalName(sf)).toBe('SdkT');
    expect(findCasts(sf).map((c) => [lineOf(sf, c.getStart(sf)), c.getText(sf)])).toEqual([
      [7, 'x as SdkT'],
      [8, 'x as SdkT'],
      [12, 'x as SdkT'],
    ]);
    // A file that does not import the SDK's Transport has no casts to it.
    expect(findCasts(parse('none.ts', 'declare const x: unknown;\nconst a = x as Transport;'))).toEqual([]);
  });

  it('statementAt: the innermost statement in a block, source file, namespace, case or default clause', () => {
    const sf = parse('statements.ts', STATEMENTS_FIXTURE);
    const at: Record<string, string> = {};
    const visit = (node: ts.Node): void => {
      if (ts.isAsExpression(node) && node.type.getText(sf) === 'T') {
        at[node.expression.getText(sf)] = statementAt(sf, node.expression.getStart(sf)).getText(sf);
      }
      ts.forEachChild(node, visit);
    };
    visit(sf);
    expect(at).toEqual({
      a: 'void (a as T);',
      b: 'void (b as T);',
      c: 'void (c as T);',
      d: 'void (d as T);',
      e: 'void (e as T);',
      g: 'for (const x of [g as T]) void x;',
      k: 'void [() => { void 0; }, k as T];',
    });
  });

  it('deriveGap: exactly the optional members the target declares strict and the source declares with undefined', () => {
    const program = virtualProgram(DERIVE_FIXTURE);
    const sf = program.getSourceFile(VIRTUAL)!;
    const checker = program.getTypeChecker();
    const typeOf = (name: string): ts.Type =>
      checker.getDeclaredTypeOfSymbol(checker.getSymbolAtLocation(findDeclaration(sf, name).name)!);
    // The fixture's claim, checked: a mapped-type member carries no declaration.
    expect(checker.getPropertyOfType(typeOf('Target'), 'mapped')?.declarations).toBeUndefined();
    expect(deriveGap(checker, typeOf('Target'), typeOf('Source'))).toEqual([
      'aliased',
      'bareUndef',
      'baseMethod',
      'baseProp',
      'declProp',
      'getterOnly',
      'mergedFirstStrict',
      'mixedPair',
      'setterFirst',
      'setterOnly',
      'sig',
      'untypedGetter',
    ]);
  }, 60_000);

  it.each(PAIR_AND_MERGE_SHAPES)(
    'deriveGap agrees with tsc on the %s shape',
    (_label, target, source, refused) => {
      const program = virtualProgram(`${target}\ndeclare class Source { ${source} }\ndeclare const s: Source;\nconst t: Target = s;\n`);
      const sf = program.getSourceFile(VIRTUAL)!;
      const checker = program.getTypeChecker();
      const typeOf = (name: string): ts.Type =>
        checker.getDeclaredTypeOfSymbol(checker.getSymbolAtLocation(findDeclaration(sf, name).name)!);
      const codes = ts.getPreEmitDiagnostics(program, sf).map((d) => d.code);
      expect(codes.includes(2375), `tsc ${refused ? 'refuses' : 'accepts'} the assignment`).toBe(refused);
      expect(deriveGap(checker, typeOf('Target'), typeOf('Source'))).toEqual(refused ? ['m'] : []);
    },
    60_000,
  );

  it('syntacticallyAdmitsUndefined: bare, in a union, through parentheses', () => {
    const typeNode = (t: string): ts.TypeNode =>
      (parse('t.ts', `type X = ${t};`).statements[0] as ts.TypeAliasDeclaration).type;
    const cases: Array<[string, boolean]> = [
      ['string', false],
      ['(string)', false],
      ['string | null', false],
      ['undefined', true],
      ['string | undefined', true],
      ['(undefined)', true],
      ['(string | undefined)', true],
    ];
    expect(cases.map(([t]) => syntacticallyAdmitsUndefined(typeNode(t)))).toEqual(
      cases.map(([, admits]) => admits),
    );
  });

  it('widenOptionals: widens exactly the strict optional property signatures, or exactly `only`', () => {
    const widened = (opt: boolean, other: boolean): string =>
      [
        'interface W {',
        '  req: string;',
        opt ? '  opt?: (string) | undefined;' : '  opt?: string;',
        other ? '  other?: (number) | undefined;' : '  other?: number;',
        '  union?: string | undefined;',
        '  paren?: (undefined);',
        '  bare?: undefined;',
        '  untyped?;',
        '  m?(): void;',
        '}',
      ].join('\n');
    expect(widened(false, false), 'the fixture builder must reproduce the fixture').toBe(WIDEN_FIXTURE);
    expect(widenOptionals('w.ts', WIDEN_FIXTURE, 'W')).toBe(widened(true, true));
    expect(widenOptionals('w.ts', WIDEN_FIXTURE, 'W', new Set(['opt']))).toBe(widened(true, false));
  });

  it('widenOptionals: `only` naming members it cannot widen -> throws naming each', () => {
    expect(messageOf(() => widenOptionals('w.ts', WIDEN_FIXTURE, 'W', new Set(['opt', 'req', 'nope'])))).toContain(
      'overlay: req, nope not found as strict optional properties declared directly on W',
    );
  });

  it('hoistToBase: moves the picked members onto a base the declaration extends (an implements clause is fine)', () => {
    const text = 'declare class C implements I {\n  a?: string;\n  b: number;\n}';
    const isOptional = (m: Member): boolean => ts.isPropertyDeclaration(m) && m.questionToken !== undefined;
    expect(hoistToBase('h.ts', text, 'C', isOptional)).toBe(
      'declare class CHoistedBase {\n    a?: string;\n}\ndeclare class C extends CHoistedBase implements I {\n  b: number;\n}',
    );
  });

  it('aliasAccessorTypes: retypes exactly the `| undefined` get and set accessors; untyped ones are left alone', () => {
    const text = [
      'declare class A {',
      '  get typed(): string | undefined;',
      '  set typed(v: string | undefined);',
      '  get plain(): string;',
      '  get untyped();',
      '  set noParam();',
      '}',
    ].join('\n');
    expect(aliasAccessorTypes('a.ts', text, 'A')).toBe(
      [
        'type AAlias0 = string | undefined;',
        'type AAlias1 = string | undefined;',
        'declare class A {',
        '  get typed(): AAlias0;',
        '  set typed(v: AAlias1);',
        '  get plain(): string;',
        '  get untyped();',
        '  set noParam();',
        '}',
      ].join('\n'),
    );
  });

  it('findDeclaration: finds a class or an interface by name', () => {
    const sf = parse('d.ts', 'declare class K {}\ninterface I {}');
    expect([findDeclaration(sf, 'K').getText(sf), findDeclaration(sf, 'I').getText(sf)]).toEqual([
      'declare class K {}',
      'interface I {}',
    ]);
  });

  it('assignmentForm: hoists the first ARGUMENT-position cast in its block; a string is not a use', () => {
    const { text, callLine } = assignmentForm(CALLS_FIXTURE);
    expect(text).toBe(
      [
        "import type { Transport } from 'sdk';",
        'declare const s: { connect(t: Transport): void; log(m: string): void };',
        'declare const x: Transport;',
        'function f() {',
        '  void (x as Transport);',
        '  const castForGapTest: Transport = x as Transport;',
        '  s.connect(castForGapTest);',
        "  s.log('castForGapTest');",
        '}',
      ].join('\n'),
    );
    expect(callLine).toBe(7);
  });

  it('extraCast: inserts after a top-level statement', () => {
    expect(extraCast(TOP_LEVEL_CALL_FIXTURE)).toEqual({
      text: `${TOP_LEVEL_CALL_FIXTURE}\nvoid (x as Transport);`,
      line: 5,
    });
  });

  it('localTransportTarget: points the Transport import at a local module declaring an interface, an alias, or a class in a .d.ts', () => {
    const http = TOP_LEVEL_CALL_FIXTURE.replace("from 'sdk'", `from '${LOCAL_SPECIFIER}'`);
    const header = "import type { Transport as GapTestSdkTransport } from 'sdk';\nexport * from 'sdk';\n";
    expect([...localTransportTarget(TOP_LEVEL_CALL_FIXTURE, 'interface')]).toEqual([
      [HTTP_TS, http],
      [LOCAL_MODULE, `${header}export interface Transport extends GapTestSdkTransport {}\n`],
    ]);
    expect([...localTransportTarget(TOP_LEVEL_CALL_FIXTURE, 'alias')]).toEqual([
      [HTTP_TS, http],
      [LOCAL_MODULE, `${header}export type Transport = GapTestSdkTransport & { readonly gapTestBrand?: never };\n`],
    ]);
    expect([...localTransportTarget(TOP_LEVEL_CALL_FIXTURE, 'declaredClass')]).toEqual([
      [HTTP_TS, http],
      [
        path.join(path.dirname(HTTP_TS), 'gapTestLocal.d.ts'),
        `${header}declare const GapTestTransportBase: new () => GapTestSdkTransport;\n` +
          'export declare class GapTestDeclaredTransport extends GapTestTransportBase {}\n' +
          'export { GapTestDeclaredTransport as Transport };\n',
      ],
    ]);
  });

  it('localSubclassSource: renames every reference to the class, but not its import or a string', () => {
    const text = [
      "import { Sdk } from 'sdk';",
      'declare const s: { connect(t: Sdk): void };',
      'const t: Sdk = new Sdk();',
      's.connect(t);',
      "const label = 'Sdk';",
    ].join('\n');
    expect([...localSubclassSource(text, 'Sdk')]).toEqual([
      [
        HTTP_TS,
        [
          `import { ${LOCAL_CLASS} } from '${LOCAL_SPECIFIER}';`,
          "import { Sdk } from 'sdk';",
          `declare const s: { connect(t: ${LOCAL_CLASS}): void };`,
          `const t: ${LOCAL_CLASS} = new ${LOCAL_CLASS}();`,
          's.connect(t);',
          "const label = 'Sdk';",
        ].join('\n'),
      ],
      [LOCAL_MODULE, `import { Sdk } from 'sdk';\nexport class ${LOCAL_CLASS} extends Sdk {}\n`],
    ]);
  });

  it('accessorClassName: the first class declaring a get accessor', () => {
    expect(accessorClassName('c.ts', 'declare class Plain { x: number; }\ndeclare class Acc { get y(): number; }')).toBe(
      'Acc',
    );
  });

  it('sectionOf: the text under a header, up to the full listing; empty without the header', () => {
    expect(sectionOf('H body All diagnostics of the un-cast program: rest', 'H')).toBe(' body ');
    expect(sectionOf('H tail', 'H')).toBe(' tail');
    expect(sectionOf('no header here', 'H')).toBe('');
  });

  // Every helper throw, driven to its message.
  const throws: Array<[string, () => unknown, string]> = [
    ['applyEdits with no edits', () => applyEdits('abc', []), 'overlay made no edits'],
    [
      'applyEdits that changes nothing',
      () => applyEdits('abc', [{ start: 0, end: 1, text: 'a' }]),
      'overlay left the text unchanged',
    ],
    ['findDeclaration of a missing name', () => findDeclaration(parse('d.ts', 'interface A {}'), 'B'), 'no class or interface B'],
    [
      'hoistToBase on a generic declaration',
      () => hoistToBase('h.ts', 'interface G<T> { a?: T; }', 'G', () => true),
      'overlay: G already has type parameters or an extends clause',
    ],
    [
      'hoistToBase on a declaration that already extends',
      () => hoistToBase('h.ts', 'interface E extends X { a?: string; }', 'E', () => true),
      'overlay: E already has type parameters or an extends clause',
    ],
    [
      'hoistToBase picking nothing',
      () => hoistToBase('h.ts', 'interface P { b: number; }', 'P', () => false),
      'overlay: no members of P matched',
    ],
    [
      'assertHoisted where a picked member is still on the declaration',
      () => assertHoisted('h.ts', 'interface B {}\ninterface C extends B { a?: string; }', 'C', 'B', ts.isPropertySignature),
      "overlay: hoisting C's members did not apply",
    ],
    [
      'assertHoisted where the declaration has no heritage clause',
      () => assertHoisted('h.ts', 'interface C {}', 'C', 'B', () => false),
      "overlay: hoisting C's members did not apply",
    ],
    [
      'assertHoisted where the declaration extends something else',
      () => assertHoisted('h.ts', 'interface C extends D {}', 'C', 'B', () => false),
      "overlay: hoisting C's members did not apply",
    ],
    [
      'assertHoisted where the class implements the base instead of extending it',
      () => assertHoisted('h.ts', 'declare class C implements B {}', 'C', 'B', () => false),
      "overlay: hoisting C's members did not apply",
    ],
    [
      'assertAccessorsAliased where a get accessor is still typed `| undefined`',
      () => assertAccessorsAliased('a.ts', 'declare class A {\n  get g(): string | undefined;\n}', 'A'),
      "overlay: aliasing A's accessor types did not apply",
    ],
    [
      'assertAccessorsAliased where a set accessor is still typed `| undefined`',
      () => assertAccessorsAliased('a.ts', 'declare class A {\n  set s(v: string | undefined);\n}', 'A'),
      "overlay: aliasing A's accessor types did not apply",
    ],
    [
      'aliasAccessorTypes with no `| undefined` accessor',
      () => aliasAccessorTypes('a.ts', 'declare class B { get plain(): string; }', 'B'),
      'overlay: no `| undefined` accessors on B',
    ],
    [
      'argumentCast with only a non-argument cast',
      () => assignmentForm("import type { Transport } from 'sdk';\ndeclare const x: Transport;\nvoid (x as Transport);"),
      'overlay: no argument-position `as Transport` cast',
    ],
    [
      'assignmentForm where the hoisted name is already passed to a call',
      () => assignmentForm(`${TOP_LEVEL_CALL_FIXTURE}\ndeclare const castForGapTest: Transport;\ns.connect(castForGapTest);`),
      'overlay: expected exactly one call passing castForGapTest, found 2',
    ],
    [
      'insertAfterCast whose statement holds the wrong number of casts',
      () => extraCast(TOP_LEVEL_CALL_FIXTURE, () => 'x'),
      'overlay: expected 1 cast(s) on line 5, found 0',
    ],
    [
      'localTransportTarget without a Transport import',
      () => localTransportTarget('const y = 1;', 'interface'),
      'does not import `Transport`',
    ],
    [
      'localSubclassSource without an import of the class',
      () => localSubclassSource('const y = 1;', 'SomeSdkClass'),
      'does not import `SomeSdkClass`',
    ],
    ['doubleCast without a cast', () => doubleCast('const y = 1;'), 'overlay: no cast in http.ts'],
    [
      'accessorClassName without an accessor-bearing class',
      () => accessorClassName('c.ts', 'declare class Plain { x: number; }'),
      'overlay: no named class with a get accessor in c.ts',
    ],
    [
      'accessorClassName whose accessor-bearing class has no name',
      () => accessorClassName('c.ts', 'export default class { get y() { return 1; } }'),
      'overlay: no named class with a get accessor in c.ts',
    ],
    ['read of a missing file', () => read(path.join(MCP_ROOT, '__gapTestMissing__.ts')), 'cannot read '],
    [
      'loadConfig of a missing tsconfig, with the reason TypeScript gives',
      () => loadConfig(path.join(MCP_ROOT, '__gapTestMissing__.json')),
      "__gapTestMissing__.json: Cannot read file '",
    ],
    ['messageOf a run that passes', () => messageOf(() => 1), 'expected the check to fail, and it passed'],
  ];
  it.each(throws)('%s -> throws', (_name, run, expected) => {
    expect(messageOf(run)).toContain(expected);
  });
});
