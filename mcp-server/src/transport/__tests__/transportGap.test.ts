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
 * Nothing here is restated. Every subject is DERIVED at run time
 * (lessons-learned #18):
 *  - the compiler options come from the real `mcp-server/tsconfig.json`;
 *  - the cast sites are found by parsing the real `http.ts`;
 *  - the "un-cast" program is the real `http.ts` with those casts removed,
 *    served to the compiler through a host override, so a change to how
 *    `http.ts` connects is a change to what this test compiles;
 *  - the gap itself (which optional members disagree) is read through the
 *    type checker: every property of each cast's target and source type,
 *    INHERITED ones included, with each member's declared type resolved
 *    (so a type alias that carries `| undefined` counts).
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
 *    unexpected diagnostic and each cast that produced none.
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
 * and `http.ts` text (served through the same host override), so the shapes
 * that broke an earlier, syntactic derivation stay covered: the members on a
 * base class (M4a), the members on a base interface (M4b), and alias-typed
 * accessors.
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

function loadConfig(): ts.ParsedCommandLine {
  const parsed = ts.getParsedCommandLineOfConfigFile(TSCONFIG, undefined, {
    ...ts.sys,
    onUnRecoverableConfigFileDiagnostic: (d) => {
      throw new Error(ts.flattenDiagnosticMessageText(d.messageText, '\n'));
    },
  });
  if (!parsed) throw new Error(`could not parse ${TSCONFIG}`);
  return parsed;
}

/** Local name `Transport` is imported under in http.ts (follows an alias). */
function transportLocalName(sf: ts.SourceFile): string | undefined {
  for (const stmt of sf.statements) {
    if (!ts.isImportDeclaration(stmt)) continue;
    const bindings = stmt.importClause?.namedBindings;
    if (!bindings || !ts.isNamedImports(bindings)) continue;
    for (const el of bindings.elements) {
      if ((el.propertyName ?? el.name).text === TARGET_INTERFACE) return el.name.text;
    }
  }
  return undefined;
}

/** Every `<expr> as Transport` in the file, in source order. */
function findCasts(sf: ts.SourceFile): ts.AsExpression[] {
  const local = transportLocalName(sf);
  const casts: ts.AsExpression[] = [];
  if (!local) return casts;
  const visit = (node: ts.Node): void => {
    if (
      ts.isAsExpression(node) &&
      ts.isTypeReferenceNode(node.type) &&
      ts.isIdentifier(node.type.typeName) &&
      node.type.typeName.text === local
    ) {
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

const describeRecord = (r: DiagnosticRecord): string =>
  `  ${HTTP_REL}:${r.line} TS${r.code}: ${r.text.split('\n').join('\n      ')}`;

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
 * Whether each typed declaration of a property admits `undefined` in its
 * DECLARED type (not the read type, which exactOptionalPropertyTypes widens
 * for every optional member). Resolved through the checker, so aliases count.
 * `undefined` when no declaration carries a type the checker can read.
 */
function declaredTypesAdmitUndefined(checker: ts.TypeChecker, prop: ts.Symbol): boolean[] | undefined {
  const answers: boolean[] = [];
  for (const decl of prop.declarations ?? []) {
    if (ts.isMethodSignature(decl) || ts.isMethodDeclaration(decl)) {
      answers.push(false); // a method's declared type is a function type
      continue;
    }
    const node =
      ts.isPropertySignature(decl) || ts.isPropertyDeclaration(decl) || ts.isGetAccessorDeclaration(decl)
        ? decl.type
        : ts.isSetAccessorDeclaration(decl)
          ? decl.parameters[0]?.type
          : undefined;
    if (node) answers.push(includesUndefined(checker.getTypeFromTypeNode(node)));
  }
  return answers.length > 0 ? answers : undefined;
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
    const targetAdmits = declaredTypesAdmitUndefined(checker, targetProp);
    if (!targetAdmits || targetAdmits.some(Boolean)) continue;
    const sourceProp = checker.getPropertyOfType(source, targetProp.getName());
    const sourceAdmits = sourceProp && declaredTypesAdmitUndefined(checker, sourceProp);
    if (sourceAdmits?.some(Boolean)) gap.push(targetProp.getName());
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
    const operand = checker.getTypeAtLocation(cast.expression);
    const source = checker.getNonNullableType(operand);
    const sourceDecl = source.getSymbol()?.declarations?.find(ts.isClassDeclaration);
    if (!sourceDecl?.getSourceFile().isDeclarationFile) {
      throw new Error(
        `${where}: each \`as ${TARGET_INTERFACE}\` cast must apply directly to an SDK StreamableHTTPServerTransport ` +
          `value (a class declared in the SDK's .d.ts); this operand has type '${checker.typeToString(operand)}'.`,
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
  if (stripped === baseSf.text || findCasts(ts.createSourceFile(HTTP_TS, stripped, ts.ScriptTarget.Latest, true)).length > 0) {
    throw new Error(`stripping the casts did not change ${HTTP_REL}; the test cannot measure anything`);
  }
  const uncast = compile(config, new Map([...overrides, [HTTP_TS, stripped]]), baseline);
  const uncastSf = httpSourceFile(uncast);
  if (uncastSf.text !== stripped) throw new Error(`the un-cast program did not compile the stripped ${HTTP_REL}`);
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
    const start = d.start;
    const owner =
      start === undefined ? -1 : castStatements.findIndex((s) => start >= s.getStart(uncastSf) && start < s.end);
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
      `  diagnostics that are not a TS2375/TS2379 at a cast site:\n` +
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
    expect(result.diagnostics.map((d) => d.line)).toEqual(result.casts.map((c) => c.line));
  }, 60_000);
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

function findDeclaration(sf: ts.SourceFile, name: string): ts.ClassDeclaration | ts.InterfaceDeclaration {
  const decl = sf.statements.find(
    (s): s is ts.ClassDeclaration | ts.InterfaceDeclaration =>
      (ts.isClassDeclaration(s) || ts.isInterfaceDeclaration(s)) && s.name?.text === name,
  );
  if (!decl) throw new Error(`overlay: no class or interface ${name} in ${sf.fileName}`);
  return decl;
}

const membersOf = (decl: ts.ClassDeclaration | ts.InterfaceDeclaration): readonly Member[] => decl.members;

function syntacticallyAdmitsUndefined(node: ts.TypeNode | undefined): boolean {
  if (!node) return false;
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
  if (!decl.name || decl.typeParameters || decl.heritageClauses?.some((h) => h.token === ts.SyntaxKind.ExtendsKeyword)) {
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
  const after = findDeclaration(parse(fileName, out), name);
  if (membersOf(after).some(pick) || !out.includes(`${name} extends ${baseName}`)) {
    throw new Error(`overlay: hoisting ${name}'s members did not apply`);
  }
  return out;
}

/** Retypes each `| undefined` accessor of `name` through a type alias. */
function aliasAccessorTypes(fileName: string, text: string, name: string): string {
  const sf = parse(fileName, text);
  const decl = findDeclaration(sf, name);
  const edits: Edit[] = [];
  const aliases: string[] = [];
  for (const m of membersOf(decl)) {
    const node = ts.isGetAccessorDeclaration(m)
      ? m.type
      : ts.isSetAccessorDeclaration(m)
        ? m.parameters[0]?.type
        : undefined;
    if (!node || !syntacticallyAdmitsUndefined(node)) continue;
    const alias = `${name}Alias${aliases.length}`;
    aliases.push(`type ${alias} = ${node.getText(sf)};`);
    edits.push({ start: node.getStart(sf), end: node.end, text: alias });
  }
  if (aliases.length === 0) throw new Error(`overlay: no \`| undefined\` accessors on ${name}`);
  edits.push({ start: decl.getStart(sf), end: decl.getStart(sf), text: `${aliases.join('\n')}\n` });
  const out = applyEdits(text, edits);
  const after = findDeclaration(parse(fileName, out), name);
  if (membersOf(after).some((m) => ts.isGetAccessorDeclaration(m) && syntacticallyAdmitsUndefined(m.type))) {
    throw new Error(`overlay: aliasing ${name}'s accessor types did not apply`);
  }
  return out;
}

/** Widens each strict optional property of `name` to `| undefined`: the SDK fixing the gap. */
function widenOptionals(fileName: string, text: string, name: string): string {
  const sf = parse(fileName, text);
  const edits: Edit[] = [];
  for (const m of membersOf(findDeclaration(sf, name))) {
    if (!ts.isPropertySignature(m) || !m.questionToken || !m.type || syntacticallyAdmitsUndefined(m.type)) continue;
    edits.push({ start: m.type.getStart(sf), end: m.type.end, text: `(${m.type.getText(sf)}) | undefined` });
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

/** The first argument-position cast, rewritten as `const x: Transport = ... as Transport; connect(x)`. */
function assignmentForm(text: string): string {
  const sf = parse(HTTP_TS, text);
  const local = transportLocalName(sf);
  const cast = findCasts(sf).find((c) => ts.isCallExpression(c.parent) && c.parent.arguments.includes(c));
  if (!local || !cast) throw new Error('overlay: no argument-position cast in http.ts');
  const stmt = enclosingStatement(cast);
  const start = stmt.getStart(sf);
  const call = text.slice(start, cast.getStart(sf)) + 'castForGapTest' + text.slice(cast.end, stmt.end);
  return applyEdits(text, [
    {
      start,
      end: stmt.end,
      text: `const castForGapTest: ${local} = ${cast.getText(sf)};\n${indentOf(text, start)}${call}`,
    },
  ]);
}

/**
 * Adds an `as Transport` cast that tsc does not need, on the line after the
 * first cast's statement. Returns the new text and that (1-based) line.
 */
function extraUnneededCast(text: string): { text: string; line: number } {
  const sf = parse(HTTP_TS, text);
  const local = transportLocalName(sf);
  const cast = findCasts(sf)[0];
  if (!local || !cast) throw new Error('overlay: no cast in http.ts');
  const stmt = enclosingStatement(cast);
  const extra = `\n${indentOf(text, stmt.getStart(sf))}void (${cast.expression.getText(sf)} as ${local});`;
  const out = applyEdits(text, [{ start: stmt.end, end: stmt.end, text: extra }]);
  const line = lineOf(sf, stmt.end) + 1;
  const added = findCasts(parse(HTTP_TS, out)).filter((c) => lineOf(c.getSourceFile(), c.getStart()) === line);
  if (added.length !== 1) throw new Error(`overlay: expected exactly one cast on line ${line}`);
  return { text: out, line };
}

/** `x as Transport` -> `x as unknown as Transport` on the first cast. */
function doubleCast(text: string): string {
  const cast = findCasts(parse(HTTP_TS, text))[0];
  if (!cast) throw new Error('overlay: no cast in http.ts');
  return applyEdits(text, [{ start: cast.expression.end, end: cast.expression.end, text: ' as unknown' }]);
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
  const sourceClass = (): string => {
    const file = sdkSource();
    const cls = parse(file, read(file)).statements.find(
      (s): s is ts.ClassDeclaration =>
        ts.isClassDeclaration(s) && s.members.some((m) => ts.isGetAccessorDeclaration(m)),
    );
    if (!cls?.name) throw new Error(`no accessor-bearing class in ${file}`);
    return cls.name.text;
  };
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

  it('a cast moved into an assignment (TS2375 instead of TS2379) still passes', () => {
    const result = checkGap(config, { overrides: new Map([[HTTP_TS, assignmentForm(read(HTTP_TS))]]) });
    expect(result.diagnostics.map((d) => d.code).sort()).toEqual([2375, 2379]);
  }, 60_000);

  it('an unneeded extra cast -> RED naming the cast line that produced no error', () => {
    const overlay = extraUnneededCast(read(HTTP_TS));
    const message = messageOf(() => checkGap(config, { overrides: new Map([[HTTP_TS, overlay.text]]) }));
    expect(message).toContain(`cast(s) at ${HTTP_REL}:${overlay.line} produced 0 exactOptional error(s) when removed`);
    expect(message).toContain('the cast is not needed for the #10278 gap');
  }, 60_000);

  it('`as unknown as Transport` -> RED naming the line and the operand type', () => {
    const line = real().casts[0]!.line;
    const message = messageOf(() => checkGap(config, { overrides: new Map([[HTTP_TS, doubleCast(read(HTTP_TS))]]) }));
    expect(message).toContain(`${HTTP_REL}:${line} `);
    expect(message).toContain('must apply directly to an SDK StreamableHTTPServerTransport value');
    expect(message).toContain("this operand has type 'unknown'");
  }, 60_000);
});
