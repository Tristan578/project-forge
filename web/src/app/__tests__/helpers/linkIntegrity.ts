/**
 * Static internal-link checker.
 *
 * Walks a source tree for internal link targets and resolves each one against
 * the Next.js App Router route files that actually exist on disk. Backs the
 * link-integrity suites in `web` and `apps/docs` (#9046), which shipped four
 * CTAs — including the buy-tokens and BYOK exits of a non-dismissible modal —
 * pointing at routes that had never existed.
 *
 * This file is a TEST HELPER, not app code: it lives under `__tests__/` so it
 * is never bundled and never counted for coverage.
 *
 * ---------------------------------------------------------------------------
 * SCOPE — what this catches, and what it cannot
 * ---------------------------------------------------------------------------
 * CATCHES:
 *   - `href="/foo"` / `href={'/foo'}` / `href: '/foo'` in .ts/.tsx sources
 *   - `router.push('/foo')`, `router.replace('/foo')`
 *   - `redirect('/foo')`, `permanentRedirect('/foo')`
 *   - `window.location.href = '/foo'`, `location.assign|replace('/foo')` — a
 *     full-page navigation is still a link, and EditorErrorBoundary uses one.
 *   - `export const X_HREF|X_ROUTE|X_PATH|X_URL = '/foo'` — a route constant
 *     hoisted into a module. Without this the checker goes BLIND exactly when a
 *     codebase does the right thing and stops hand-writing hrefs: replacing
 *     `href="/settings/billing"` with `href={SETTINGS_BILLING_HREF}` removed
 *     the literal from every call site, so #9046's own four fixed links became
 *     the only links in the tree this gate could not see. Anchoring on the
 *     DECLARATION keeps them checked.
 *   - Template literals whose every interpolation fills a WHOLE path segment,
 *     e.g. `` `/editor/${id}` `` — checked against `[id]`-style dynamic routes.
 *     This is what makes the docs `` `/mcp/${category}` `` bug visible.
 *   - Query strings and hashes, which are stripped before resolution, so
 *     `/settings?tab=keys` is checked as `/settings`.
 *
 * CANNOT CATCH (deliberately skipped, never a failure):
 *   - Links assembled from variables or helper calls with no literal prefix —
 *     `router.push(dest)`, `href={buildUrl(x)}`. Nothing static to resolve.
 *   - Template literals where an interpolation is glued to other characters
 *     inside a segment, e.g. `` `/settings${qs ? `?${qs}` : ''}` `` — the
 *     interpolation may expand to a query string, another segment, or nothing,
 *     so its resolved path is genuinely unknown. Reported as `skipped`.
 *   - External URLs, protocol-relative `//host`, `#anchor`, `mailto:`, `tel:`.
 *   - Whether a route is REACHABLE once resolved. A route can exist and still
 *     bounce an anonymous visitor to sign-in (that is the `/dashboard` case in
 *     #9046). This checks existence only; auth-gating is a separate concern.
 *   - Rewrites and redirects declared in `next.config.ts` or the app's Vercel
 *     config (`web/vercel.ts`, `apps/docs/vercel.json`). A
 *     link rescued by a rewrite would be reported dead here. Neither app
 *     declares any today; if one is added, teach `isKnownRedirect` about it.
 *   - Runtime-only correctness: `/settings?tab=keys` resolves because
 *     `/settings` exists, NOT because `keys` is a real tab. That specific trap
 *     is covered by an assertion in TokenDepletedModal.test.tsx instead.
 *
 * A dynamic-segment interpolation is assumed to expand to exactly ONE segment.
 * Where that assumption could be wrong the checker retries in a lenient mode
 * that lets a placeholder span multiple segments, and skips rather than fails
 * when the lenient match succeeds — it will not fail on a link it cannot prove
 * dead.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { basename, extname, join, relative, sep } from 'node:path';

/** File names Next.js treats as a routable endpoint. */
const ROUTE_BASENAMES = new Set([
  'page.tsx',
  'page.ts',
  'page.jsx',
  'page.js',
  'route.ts',
  'route.tsx',
  'route.js',
]);

const SOURCE_EXTENSIONS = new Set(['.ts', '.tsx', '.js', '.jsx']);
const SKIPPED_DIRS = new Set(['node_modules', '.next', 'dist', 'build', 'coverage']);

/**
 * Stand-in for an interpolated path segment; matches any single real segment.
 *
 * Written as `\0` ESCAPES, never as literal NUL bytes. A raw 0x00 in the source
 * makes git classify this file as binary, so it renders as "Binary file not
 * shown" in a PR and cannot be diffed, reviewed or three-way merged — a poor
 * property for the file holding this checker's entire logic. The runtime value
 * is identical either way.
 */
const DYNAMIC = '\0dynamic\0';

export interface FoundLink {
  /** The literal text between the quotes, interpolations included. */
  raw: string;
  /** Source file, relative to the scanned root, with `/` separators. */
  file: string;
  /** 1-indexed line number of the opening quote. */
  line: number;
}

export interface LinkReport {
  dead: Array<FoundLink & { path: string }>;
  resolved: Array<FoundLink & { path: string }>;
  skipped: Array<FoundLink & { reason: string }>;
}

/* -------------------------------------------------------------------------- */
/* Filesystem walking                                                          */
/* -------------------------------------------------------------------------- */

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    if (SKIPPED_DIRS.has(entry)) continue;
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      walk(full, out);
    } else if (SOURCE_EXTENSIONS.has(extname(entry))) {
      out.push(full);
    }
  }
  return out;
}

function isTestFile(file: string): boolean {
  const normalised = file.split(sep).join('/');
  return (
    normalised.includes('/__tests__/') ||
    normalised.includes('/__mocks__/') ||
    /\.(test|spec)\.[jt]sx?$/.test(normalised)
  );
}

/**
 * Every route the App Router serves, as an array of path segments.
 * Route groups — `(marketing)` — are structural and contribute no URL segment.
 */
export function collectRoutes(appDir: string): string[][] {
  return walk(appDir)
    .filter((file) => ROUTE_BASENAMES.has(basename(file)))
    .map((file) => {
      const segments = relative(appDir, file).split(sep);
      segments.pop(); // drop the page.tsx / route.ts file name
      return segments.filter((s) => !(s.startsWith('(') && s.endsWith(')')));
    });
}

/* -------------------------------------------------------------------------- */
/* Link extraction                                                             */
/* -------------------------------------------------------------------------- */

/**
 * Matches the code that PRECEDES a link literal, up to and including its
 * opening quote. The literal itself is then read by `readStringLiteral`, which
 * understands escapes and nested template interpolation — a single regex cannot,
 * which is how `` `/settings${qs ? `?${qs}` : ''}` `` gets truncated into a
 * bogus path by the naive version of this check.
 */
const LINK_ANCHOR =
  /(?:\bhref\s*=\s*\{?\s*|\bhref\s*:\s*|\b(?:router|nav)\.(?:push|replace)\s*\(\s*|\b(?:redirect|permanentRedirect)\s*\(\s*|\blocation\s*\.\s*href\s*=\s*|\blocation\s*\.\s*(?:assign|replace)\s*\(\s*|\bexport\s+const\s+[A-Z][A-Z0-9_]*(?:HREF|ROUTE|PATH|URL)\s*(?::\s*string\s*)?=\s*)(['"`])/g;

/**
 * Read a string/template literal starting at its opening quote.
 * Returns the raw inner text (interpolations preserved verbatim) and the index
 * of the closing quote, or null if the literal is unterminated.
 */
export function readStringLiteral(
  source: string,
  open: number,
): { text: string; end: number } | null {
  const quote = source[open];
  let i = open + 1;
  let text = '';
  let depth = 0; // nesting depth inside `${ ... }`

  while (i < source.length) {
    const ch = source[i];

    if (ch === '\\') {
      text += ch + (source[i + 1] ?? '');
      i += 2;
      continue;
    }

    if (quote === '`' && depth === 0 && ch === '$' && source[i + 1] === '{') {
      depth += 1;
      text += '${';
      i += 2;
      continue;
    }

    if (depth > 0) {
      if (ch === '{') {
        depth += 1;
      } else if (ch === '}') {
        depth -= 1;
      } else if (ch === '`' || ch === "'" || ch === '"') {
        // A string inside the interpolation — consume it wholesale so its
        // quotes cannot be mistaken for the end of the outer literal.
        const nested = readStringLiteral(source, i);
        if (!nested) return null;
        text += source.slice(i, nested.end + 1);
        i = nested.end + 1;
        continue;
      }
      text += ch;
      i += 1;
      continue;
    }

    if (ch === quote) return { text, end: i };
    // A plain quoted string never spans lines; bail rather than run away.
    if (ch === '\n' && quote !== '`') return null;

    text += ch;
    i += 1;
  }

  return null;
}

/** Extract every internal link literal from one source file's text. */
export function extractLinksFromSource(source: string, file: string): FoundLink[] {
  const links: FoundLink[] = [];
  LINK_ANCHOR.lastIndex = 0;
  let match: RegExpExecArray | null;

  while ((match = LINK_ANCHOR.exec(source))) {
    const quoteIndex = match.index + match[0].length - 1;
    const literal = readStringLiteral(source, quoteIndex);
    if (!literal) continue;
    LINK_ANCHOR.lastIndex = literal.end;

    const raw = literal.text;
    // Internal, root-relative only. `//host` is protocol-relative (external).
    if (!raw.startsWith('/') || raw.startsWith('//')) continue;

    links.push({
      raw,
      file,
      line: source.slice(0, quoteIndex).split('\n').length,
    });
  }

  return links;
}

/** Extract every internal link literal from a source tree, tests excluded. */
export function collectLinks(srcDir: string): FoundLink[] {
  return walk(srcDir)
    .filter((file) => !isTestFile(file))
    .flatMap((file) =>
      extractLinksFromSource(
        readFileSync(file, 'utf8'),
        relative(srcDir, file).split(sep).join('/'),
      ),
    );
}

/* -------------------------------------------------------------------------- */
/* Resolution                                                                  */
/* -------------------------------------------------------------------------- */

/**
 * Split a link literal into path segments, replacing whole-segment
 * interpolations with the DYNAMIC placeholder.
 *
 * Returns null when the link cannot be resolved statically — an interpolation
 * that does not fill an entire segment could expand to anything, including a
 * query string, so guessing would produce false failures.
 */
export function toProbeSegments(raw: string): string[] | null {
  // Cut the query/hash at the first `?` or `#` that is not inside `${ }`.
  let depth = 0;
  let pathPart = raw;
  for (let i = 0; i < raw.length; i += 1) {
    const ch = raw[i];
    if (ch === '$' && raw[i + 1] === '{') {
      depth += 1;
      i += 1;
    } else if (depth > 0 && ch === '{') {
      depth += 1;
    } else if (depth > 0 && ch === '}') {
      depth -= 1;
    } else if (depth === 0 && (ch === '?' || ch === '#')) {
      pathPart = raw.slice(0, i);
      break;
    }
  }

  // Split on `/` at interpolation depth 0.
  const segments: string[] = [];
  let current = '';
  depth = 0;
  for (let i = 0; i < pathPart.length; i += 1) {
    const ch = pathPart[i];
    if (ch === '$' && pathPart[i + 1] === '{') {
      depth += 1;
      current += '${';
      i += 1;
      continue;
    }
    if (depth > 0) {
      if (ch === '{') depth += 1;
      else if (ch === '}') depth -= 1;
      current += ch;
      continue;
    }
    if (ch === '/') {
      segments.push(current);
      current = '';
      continue;
    }
    current += ch;
  }
  segments.push(current);

  // Leading '' from the root slash; trailing '' from a trailing slash.
  const meaningful = segments.slice(1).filter((s, idx, arr) => !(s === '' && idx === arr.length - 1));

  const probe: string[] = [];
  for (const segment of meaningful) {
    if (!segment.includes('${')) {
      probe.push(segment);
      continue;
    }
    // Resolvable only when the segment IS exactly one interpolation.
    if (!segment.startsWith('${') || !segment.endsWith('}')) return null;
    let d = 0;
    let closesAtEnd = false;
    for (let i = 0; i < segment.length; i += 1) {
      if (segment[i] === '{') d += 1;
      else if (segment[i] === '}') {
        d -= 1;
        if (d === 0) {
          closesAtEnd = i === segment.length - 1;
          break;
        }
      }
    }
    if (!closesAtEnd) return null;
    probe.push(DYNAMIC);
  }

  return probe;
}

/**
 * Match probe segments against one route's segments.
 * In `lenient` mode a DYNAMIC placeholder may span more than one segment, which
 * is used only to decide "cannot prove dead", never to pass a real link.
 */
export function matchesRoute(
  probe: readonly string[],
  route: readonly string[],
  lenient = false,
): boolean {
  if (route.length === 0) return probe.length === 0;

  const [head, ...rest] = route;

  // Optional catch-all `[[...slug]]` is terminal and matches zero or more.
  if (head.startsWith('[[...')) return rest.length === 0;
  // Required catch-all `[...slug]` is terminal and matches one or more.
  if (head.startsWith('[...')) return rest.length === 0 && probe.length >= 1;

  if (probe.length === 0) return false;

  // The normal case: one link segment is consumed by one route segment.
  if (head.startsWith('[') || probe[0] === head) {
    if (matchesRoute(probe.slice(1), rest, lenient)) return true;
  }

  // Lenient only: let a placeholder stand in for several real segments, so a
  // link whose interpolation might expand to `a/b` is not declared dead.
  if (lenient && probe[0] === DYNAMIC) {
    for (let take = 1; take <= route.length; take += 1) {
      if (matchesRoute(probe.slice(1), route.slice(take), lenient)) return true;
    }
  }

  return false;
}

/** Resolve every collected link against the route table. */
export function checkLinks(links: readonly FoundLink[], routes: readonly string[][]): LinkReport {
  const report: LinkReport = { dead: [], resolved: [], skipped: [] };

  for (const link of links) {
    const probe = toProbeSegments(link.raw);
    if (!probe) {
      report.skipped.push({
        ...link,
        reason: 'interpolation does not fill a whole path segment',
      });
      continue;
    }

    const path = '/' + probe.map((s) => (s === DYNAMIC ? '<dynamic>' : s)).join('/');

    if (routes.some((route) => matchesRoute(probe, route))) {
      report.resolved.push({ ...link, path });
      continue;
    }

    // Could a placeholder standing for several segments rescue it? Then the
    // link is unproven, not dead.
    if (
      probe.includes(DYNAMIC) &&
      routes.some((route) => matchesRoute(probe, route, true))
    ) {
      report.skipped.push({ ...link, reason: 'interpolation may span multiple segments' });
      continue;
    }

    report.dead.push({ ...link, path });
  }

  return report;
}

/** Human-readable failure text listing each dead link and where it lives. */
export function formatDeadLinks(dead: readonly (FoundLink & { path: string })[]): string {
  return dead
    .map((d) => `  ${d.raw}  ->  ${d.path} (no route)\n    at ${d.file}:${d.line}`)
    .join('\n');
}
