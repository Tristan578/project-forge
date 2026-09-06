/**
 * @vitest-environment node
 *
 * No route may return text derived from a caught error to the caller.
 *
 * WHY (#9736). The provider clients under `lib/generate/` fold the upstream
 * **response body** verbatim into the thrown error, and fourteen routes
 * returned that error's `message` in their 500 body. On the platform path the
 * credential in play is the PLATFORM's, so a provider that echoes key material
 * in an auth-failure body handed a platform secret to any signed-in user.
 *
 * `redactSecrets` runs inside `createErrorResponse` as a net, but a net is not
 * the guarantee: it can only remove shapes it knows and values this process
 * holds, and upstream text carries plenty that is sensitive without being a
 * credential (internal hostnames, SQL, another tenant's identifiers). The
 * guarantee is that the text never leaves in the first place, and THIS is what
 * enforces it — for the next route someone writes, not just for the fourteen.
 *
 * The rule: inside a `catch`, a value derived from the caught binding may go to
 * Sentry and to the server log, and must not go into the response body. Send a
 * fixed message instead.
 *
 * NARROWED DOMAIN ERRORS ARE EXEMPT, because their messages are ours, written
 * for the user, and never carry upstream text — but only where the code has
 * actually narrowed to one with `instanceof`.
 */
import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

// __dirname is web/src/app/api/__tests__ — the API tree is its parent.
const API_DIR = join(__dirname, '..');

/**
 * Error classes whose `message` is safe to return. Each is OURS: the text is
 * authored in this repo for the user, and no upstream response body reaches it.
 * Adding an entry means asserting exactly that.
 */
const CLIENT_SAFE_ERRORS = [
  // lib/keys/resolver.ts — "You have no Meshy key configured", etc.
  'ApiKeyError',
  // lib/game-creation/decomposer.ts — our own safety-filter reason, written
  // for the user. Typed rather than prefix-matched so an upstream error that
  // happened to start "Prompt rejected:" could not claim the exemption.
  'PromptRejectedError',
];

/**
 * Waivers. Each MUST carry a reason and a ticket. The staleness check below
 * fails when a waiver stops being needed, so this list cannot rot.
 */
const ALLOWED_RAW_EGRESS: Record<string, string> = {
  // Empty, and that is the point: #9736 converted every site. A new entry here
  // is a deliberate decision to hand upstream text to a caller.
};

function routeFiles(dir: string, found: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      if (entry === '__tests__' || entry === 'node_modules') continue;
      routeFiles(full, found);
    } else if (entry === 'route.ts') {
      found.push(full);
    }
  }
  return found;
}

/** The identifiers a `catch (x)` can bind, as this codebase writes them. */
const CATCH_BINDING = /catch\s*\(\s*(\w+)\s*\)/g;

/**
 * Lines that build a response body. `createErrorResponse` is included: it
 * redacts, but redaction is the net, not permission to pass upstream text.
 */
const RESPONSE_CONSTRUCTOR = /(NextResponse|Response)\s*\.\s*json\s*\(|createErrorResponse\s*\(|apiError\s*\(/;

/** The body of the `catch` starting at `openBraceIndex`, by brace matching. */
function catchBlockBody(source: string, openBraceIndex: number): string {
  let depth = 0;
  for (let i = openBraceIndex; i < source.length; i += 1) {
    if (source[i] === '{') depth += 1;
    else if (source[i] === '}') {
      depth -= 1;
      if (depth === 0) return source.slice(openBraceIndex, i + 1);
    }
  }
  return source.slice(openBraceIndex);
}

/**
 * Find every place a caught error's text reaches a response body.
 *
 * Taint-follows-assignment, because the shape that actually shipped puts the
 * text through a local first:
 *
 *     const message = err instanceof Error ? err.message : 'Provider error';
 *     return NextResponse.json({ error: message }, { status: 500 });
 *
 * A detector that only looked at the response line for the catch binding saw
 * `message` and passed — which is the very failure this file exists to prevent,
 * so the indirection is followed rather than assumed away.
 */
function rawEgressSites(source: string): string[] {
  const violations: string[] = [];

  for (const match of source.matchAll(CATCH_BINDING)) {
    const binding = match[1];
    const braceIndex = source.indexOf('{', match.index! + match[0].length);
    if (braceIndex === -1) continue;

    const block = catchBlockBody(source, braceIndex);
    // Line numbers stay relative to the whole file so the message is actionable.
    const blockStartLine = source.slice(0, braceIndex).split('\n').length;
    const lines = block.split('\n');

    // Anything carrying text out of the caught error, transitively.
    const tainted = new Set<string>([binding]);
    // What counts as carrying the error's TEXT out. Deliberately narrow: an
    // interpolation of a data property (`${err.limit}` — a number formatted
    // into a fixed sentence in `/api/projects`) is not the error's text, and
    // treating it as one makes the gate cry wolf until someone waives it.
    const derivedFrom = (name: string) =>
      new RegExp(
        [
          `\\b${name}\\s*\\.\\s*(message|stack)\\b`,
          `\\bString\\s*\\(\\s*${name}\\s*\\)`,
          `\\$\\{\\s*${name}\\s*\\}`,
          `\\$\\{\\s*${name}\\s*\\.\\s*(message|stack)\\b`,
          `\\b${name}\\s*\\+(?!\\+)`,
        ].join('|'),
      );

    // Two passes so an assignment below its use still taints (early `return`s
    // and hoisted helpers make source order unreliable).
    for (let pass = 0; pass < 2; pass += 1) {
      for (const line of lines) {
        const decl = line.match(/\b(?:const|let|var)\s+(\w+)\s*=(.*)$/);
        if (!decl) continue;
        const [, name, rhs] = decl;
        if ([...tainted].some((t) => derivedFrom(t).test(rhs) || new RegExp(`\\b${t}\\b`).test(rhs))) {
          tainted.add(name);
        }
      }
    }

    // Match the WHOLE response-construction call, arguments included, by
    // balancing parentheses. A line-oriented scan missed
    //
    //     return NextResponse.json(
    //       { error: 'Failed', details: err.message },
    //       { status: 500 },
    //     );
    //
    // because the constructor and the leak sit on different lines — and that
    // wrapped form is the house style once a call grows. A detector defeated by
    // running prettier is not a gate.
    const constructorGlobal = new RegExp(RESPONSE_CONSTRUCTOR.source, 'g');
    for (const call of block.matchAll(constructorGlobal)) {
      const openParen = block.indexOf('(', call.index! + call[0].length - 1);
      if (openParen === -1) continue;

      let depth = 0;
      let end = block.length;
      for (let i = openParen; i < block.length; i += 1) {
        if (block[i] === '(') depth += 1;
        else if (block[i] === ')') {
          depth -= 1;
          if (depth === 0) { end = i + 1; break; }
        }
      }
      const callText = block.slice(openParen, end);
      const callLine = blockStartLine + block.slice(0, call.index!).split('\n').length - 1;

      for (const name of tainted) {
        const reaches =
          derivedFrom(name).test(callText) ||
          // A tainted local passed straight through: `{ error: message }`.
          // `(?!\s*[.:])` keeps two non-leaks off the list: a PROPERTY read
          // (`err.limit` is a number formatted into a fixed sentence), and an
          // object KEY that merely shares the name (`{ message: 'Failed…' }`).
          // Shorthand (`{ message }`) is still caught, because there the
          // identifier is the value.
          // `(?!\s*\.)` keeps a PROPERTY read off the list: `err.limit` is a
          // number this codebase deliberately formats into a fixed sentence
          // (`/api/projects`), and only `.message`/`.stack` carry the error's
          // own text — those are covered by `derivedFrom` above.
          (name !== binding && new RegExp(`\\b${name}\\b(?!\\s*[.:])`).test(callText));
        if (!reaches) continue;

        // Exempt when narrowed to a client-safe domain error, whose message is
        // ours. The guard is the enclosing `if`, just before the call.
        const preceding = block.slice(Math.max(0, call.index! - 400), call.index!);
        const narrowed = CLIENT_SAFE_ERRORS.some((cls) =>
          new RegExp(`${binding}\\s+instanceof\\s+${cls}\\b`).test(preceding),
        );
        if (narrowed) continue;

        violations.push(`line ${callLine}: ${callText.replace(/\s+/g, ' ').trim().slice(0, 120)}`);
        break;
      }
    }
  }

  return violations;
}

describe('no route returns text derived from a caught error', () => {
  const files = routeFiles(API_DIR);

  // A scan that matches nothing passes vacuously and reads as coverage
  // (lesson 9). The API tree has well over a hundred routes; if this ever sees
  // a handful, the walk broke rather than the tree shrinking.
  it('found the route tree', () => {
    expect(files.length).toBeGreaterThan(50);
  });

  it('no route hands a caught error to the client', () => {
    const offenders: string[] = [];

    for (const file of files) {
      const relative = file.slice(file.indexOf(join('src', 'app', 'api'))).replace(/\\/g, '/');
      const sites = rawEgressSites(readFileSync(file, 'utf8'));
      if (sites.length === 0) continue;
      if (relative in ALLOWED_RAW_EGRESS) continue;
      offenders.push(`${relative}\n    ${sites.join('\n    ')}`);
    }

    expect(
      offenders,
      `These routes return text derived from a caught error. Upstream text can carry a credential, an internal hostname or another tenant's data (#9736).\nSend a fixed message and give the detail to captureException instead.\n\n${offenders.join('\n\n')}\n`,
    ).toEqual([]);
  });

  it('every waiver is still needed', () => {
    for (const [relative, reason] of Object.entries(ALLOWED_RAW_EGRESS)) {
      expect(reason.length, `${relative} needs a reason`).toBeGreaterThan(20);
      const full = join(API_DIR, relative.replace('src/app/api/', ''));
      const sites = rawEgressSites(readFileSync(full, 'utf8'));
      expect(
        sites.length,
        `${relative} is waived but no longer returns a caught error — delete the waiver`,
      ).toBeGreaterThan(0);
    }
  });

  // The detector is itself code, and a detector that cannot fire is the failure
  // mode this whole file exists to prevent (lesson 11).
  it('the detector fires on the shape it is looking for', () => {
    const violating = `
      export async function GET() {
        try { await work(); } catch (err) {
          const message = err instanceof Error ? err.message : 'Provider error';
          return NextResponse.json({ error: message }, { status: 500 });
        }
      }`;
    // The message is bound first, so the response line must still be caught
    // via the binding it came from — check the direct form too.
    const direct = `
      try { await work(); } catch (err) {
        return NextResponse.json({ error: err.message }, { status: 500 });
      }`;
    expect(rawEgressSites(direct)).not.toEqual([]);
    expect(rawEgressSites(`${violating}\n${direct}`)).not.toEqual([]);
  });

  it('the detector does not fire on a narrowed domain error', () => {
    const safe = `
      try { await work(); } catch (err) {
        if (err instanceof ApiKeyError) {
          return NextResponse.json({ error: err.message, code: err.code }, { status: 402 });
        }
        throw err;
      }`;
    expect(rawEgressSites(safe)).toEqual([]);
  });

  it('the detector does not fire on a fixed message', () => {
    const safe = `
      try { await work(); } catch (err) {
        captureException(err, { route: '/api/x' });
        return NextResponse.json({ error: 'Generation failed' }, { status: 500 });
      }`;
    expect(rawEgressSites(safe)).toEqual([]);
  });
});
