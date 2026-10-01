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
 *  - the gap itself (which optional members disagree) is read off the SDK
 *    `.d.ts` declarations the compiler actually resolved for each cast's
 *    source and target types.
 *
 * Direction of each failure:
 *  - the SDK fixes the gap -> the derived gap set is empty and the un-cast
 *    program compiles clean -> RED, telling you to delete the casts and this
 *    test (the issue's "Done when");
 *  - someone removes or rewrites the casts -> no cast sites found -> RED
 *    (and the real `tsc --noEmit` gate is red too);
 *  - the casts stop being what makes `http.ts` compile -> the baseline or
 *    the error-site comparison goes RED.
 */

const MCP_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const HTTP_TS = path.join(MCP_ROOT, 'src', 'transport', 'http.ts');
const TSCONFIG = path.join(MCP_ROOT, 'tsconfig.json');

/** The SDK interface the casts target: the one fixed name, from the issue. */
const TARGET_INTERFACE = 'Transport';

/** TS2379: argument not assignable "with 'exactOptionalPropertyTypes: true'". */
const TS_EXACT_OPTIONAL_ARGUMENT = 2379;

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

/** The source text with every cast replaced by its bare operand. */
function stripCasts(sf: ts.SourceFile, casts: ts.AsExpression[]): string {
  let text = sf.text;
  for (const cast of [...casts].sort((a, b) => b.getStart(sf) - a.getStart(sf))) {
    text = text.slice(0, cast.getStart(sf)) + cast.expression.getText(sf) + text.slice(cast.end);
  }
  return text;
}

function compile(
  config: ts.ParsedCommandLine,
  cache: Map<string, ts.SourceFile>,
  httpOverride?: string,
  oldProgram?: ts.Program,
): ts.Program {
  const { options, fileNames } = config;
  const host = ts.createCompilerHost(options, true);
  const base = host.getSourceFile.bind(host);
  host.getSourceFile = (fileName, languageVersion, onError, shouldCreate) => {
    const isHttp = path.resolve(fileName) === HTTP_TS;
    if (isHttp && httpOverride !== undefined) {
      return ts.createSourceFile(fileName, httpOverride, languageVersion, true);
    }
    const hit = cache.get(fileName);
    if (hit) return hit;
    const sf = base(fileName, languageVersion, onError, shouldCreate);
    if (sf && !isHttp) cache.set(fileName, sf);
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

function unwrap(node: ts.TypeNode): ts.TypeNode {
  return ts.isParenthesizedTypeNode(node) ? unwrap(node.type) : node;
}

function admitsUndefined(node: ts.TypeNode | undefined): boolean {
  if (!node) return false;
  const t = unwrap(node);
  if (t.kind === ts.SyntaxKind.UndefinedKeyword) return true;
  return ts.isUnionTypeNode(t) && t.types.some((m) => unwrap(m).kind === ts.SyntaxKind.UndefinedKeyword);
}

function memberName(m: ts.ClassElement | ts.TypeElement): string | undefined {
  return m.name && (ts.isIdentifier(m.name) || ts.isStringLiteral(m.name)) ? m.name.text : undefined;
}

/**
 * Optional members the target interface declares WITHOUT `| undefined` while
 * the source class declares them WITH it, read off the SDK `.d.ts` nodes.
 */
function deriveGap(target: ts.InterfaceDeclaration, source: ts.ClassDeclaration): string[] {
  const strictOptional = new Set<string>();
  for (const m of target.members) {
    const name = memberName(m);
    if (name && ts.isPropertySignature(m) && m.questionToken && !admitsUndefined(m.type)) {
      strictOptional.add(name);
    }
  }
  const gap = new Set<string>();
  for (const m of source.members) {
    const name = memberName(m);
    if (!name || !strictOptional.has(name)) continue;
    const typeNode =
      ts.isGetAccessorDeclaration(m) || ts.isPropertyDeclaration(m)
        ? m.type
        : ts.isSetAccessorDeclaration(m)
          ? m.parameters[0]?.type
          : undefined;
    if (admitsUndefined(typeNode)) gap.add(name);
  }
  return [...gap].sort();
}

function declarationOf<T extends ts.Declaration>(
  type: ts.Type,
  guard: (d: ts.Declaration) => d is T,
): T {
  const decl = (type.aliasSymbol ?? type.getSymbol())?.declarations?.find(guard);
  if (!decl) throw new Error(`no matching declaration for ${type.getSymbol()?.getName() ?? '<anonymous>'}`);
  return decl;
}

const fileNames = (config: ts.ParsedCommandLine): string[] => config.fileNames.map((f) => path.resolve(f));

const lineOf = (sf: ts.SourceFile, pos: number): number => sf.getLineAndCharacterOfPosition(pos).line;

describe('mcp SDK Transport gap (#10278)', () => {
  it('http.ts still needs its `as Transport` casts; when this fails because the gap closed, delete the casts and this test', () => {
    const config = loadConfig();
    // The gap only exists under this flag; if it is ever turned off the casts
    // are dead weight for a different reason, and that should be noticed too.
    expect(fileNames(config), 'tsconfig must include http.ts').toContain(HTTP_TS);
    expect(config.options.exactOptionalPropertyTypes, 'mcp-server/tsconfig.json premise').toBe(true);

    const cache = new Map<string, ts.SourceFile>();

    // 1. Baseline: the real http.ts, casts and all, compiles clean.
    const baseline = compile(config, cache);
    const baseSf = httpSourceFile(baseline);
    expect(
      ts.getPreEmitDiagnostics(baseline, baseSf).map((d) => ts.flattenDiagnosticMessageText(d.messageText, '\n')),
      'the real http.ts must compile clean under the real tsconfig',
    ).toEqual([]);

    // 2. The workaround, derived from http.ts.
    const casts = findCasts(baseSf);
    expect(
      casts.length,
      `no \`as ${TARGET_INTERFACE}\` casts found in http.ts; if they were removed because the SDK fixed the gap, delete this test too`,
    ).toBeGreaterThan(0);
    const castLines = casts.map((c) => lineOf(baseSf, c.getStart(baseSf)));

    // 3. The gap, derived from the SDK .d.ts the compiler resolved for each cast.
    const checker = baseline.getTypeChecker();
    const gapByLine = new Map<number, string[]>();
    casts.forEach((cast, i) => {
      const target = declarationOf(checker.getTypeFromTypeNode(cast.type), ts.isInterfaceDeclaration);
      const source = declarationOf(
        checker.getNonNullableType(checker.getTypeAtLocation(cast.expression)),
        ts.isClassDeclaration,
      );
      expect(target.getSourceFile().isDeclarationFile, 'cast target must be an SDK declaration').toBe(true);
      expect(source.getSourceFile().isDeclarationFile, 'cast source must be an SDK declaration').toBe(true);
      const gap = deriveGap(target, source);
      expect(
        gap.length,
        'the SDK .d.ts no longer disagrees with itself, so the gap is closed: drop the casts in http.ts and delete this test (#10278)',
      ).toBeGreaterThan(0);
      gapByLine.set(castLines[i]!, gap);
    });

    // 4. Remove the workaround from the real source and recompile.
    const stripped = stripCasts(baseSf, casts);
    // Lessons-learned #19: prove the mutation applied before trusting the result.
    expect(stripped).not.toBe(baseSf.text);
    expect(findCasts(ts.createSourceFile(HTTP_TS, stripped, ts.ScriptTarget.Latest, true))).toHaveLength(0);

    const uncast = compile(config, cache, stripped, baseline);
    const uncastSf = httpSourceFile(uncast);
    expect(uncastSf.text).toBe(stripped);
    const diagnostics = ts.getPreEmitDiagnostics(uncast, uncastSf);
    expect(
      diagnostics.length,
      'http.ts compiles without its casts, so the gap is closed: drop the casts in http.ts and delete this test (#10278)',
    ).toBeGreaterThan(0);

    // Every error is the exactOptionalPropertyTypes mismatch, one per former
    // cast site, naming a member from that site's derived gap. Nothing else broke.
    expect(diagnostics.map((d) => d.code)).toEqual(casts.map(() => TS_EXACT_OPTIONAL_ARGUMENT));
    const errorLines = diagnostics.map((d) => lineOf(uncastSf, d.start ?? -1));
    expect([...errorLines].sort((a, b) => a - b)).toEqual([...castLines].sort((a, b) => a - b));
    diagnostics.forEach((d, i) => {
      const message = ts.flattenDiagnosticMessageText(d.messageText, '\n');
      const gap = gapByLine.get(errorLines[i]!) ?? [];
      expect(
        gap.some((member) => message.includes(`'${member}'`)),
        `diagnostic should name a derived gap member (${gap.join(', ')}): ${message}`,
      ).toBe(true);
    });
  }, 60_000);
});
