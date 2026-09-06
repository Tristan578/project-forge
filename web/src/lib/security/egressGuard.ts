import { NextResponse } from 'next/server';
import { redactSecretsAll } from '@/lib/security/redactSecrets';

/**
 * `withEgressGuard` — the single runtime chokepoint every API response passes
 * through on its way to a client (#9736).
 *
 * WHY THIS EXISTS, AND WHY THE LINT RULE IS NOT THE ANSWER.
 *
 * Three adversarial review passes were run against a static ESLint rule that
 * tried to prove "the caught error never reaches a client". Each pass closed
 * the shapes the previous one found, and each next pass found more — by the
 * third, the bypasses were one-liners:
 *
 *     const sink = cache; sink.set('last', err.message);   // aliasing
 *     const R = NextResponse; return R.json({ detail });    // local alias
 *     function detail() { return String(err); }             // hoisted decl
 *     sql`UPDATE jobs SET error = ${err.message}`           // tagged template
 *
 * The rule's escape check compares NAME scope against reachability, so one
 * `const` defeats it; and the rule's own message ("keep the error inside the
 * catch") nudges an author toward exactly that alias. A hand-written dataflow
 * analysis over an open-ended language cannot make this property certain. That
 * is not a bug in the rule — it is the wrong primitive for a guarantee.
 *
 * So the guarantee moved to runtime, onto the one path every byte takes. The
 * property is no longer "no author writes one of these shapes"; it is:
 *
 *     HOWEVER the response was assembled — helper, alias, hoisted function,
 *     tagged template, stream, cookie, header, redirect, a shape nobody has
 *     thought of — it is redacted by this function before it is returned.
 *
 * Unlike the lint rule, that does not depend on anyone having predicted the
 * attack. `spawnforge/no-raw-response-in-catch` is KEPT, but demoted to what it
 * actually is: early feedback at author time for the common shapes.
 *
 * WHAT IT DOES, in order:
 *  1. awaits the handler's `Response`;
 *  2. redacts every response HEADER value, including `Set-Cookie` and
 *     `Location` — that closes the header, cookie and redirect channels
 *     structurally, with no dataflow analysis at all;
 *  3. redacts the BODY: JSON bodies are parsed, redacted and re-serialised;
 *     other textual bodies are redacted as text;
 *  4. returns a new `NextResponse` carrying the same status, statusText and
 *     (redacted) headers.
 *
 * STREAMING — the deliberate choice, stated precisely rather than implied.
 * A `Response` gives no way to ask "is this body already complete?", so
 * buffering everything would either stall an SSE stream until it ended or hang
 * forever on an open one, and `/api/chat` streams `text/event-stream` as its
 * core product path. The rule is therefore:
 *
 *   - status >= 400  -> ALWAYS buffered and redacted, whatever the content
 *     type. Error responses in this codebase are never streamed, and this is
 *     the direction that fails closed: the leak class this guard exists for
 *     lives entirely on the error path.
 *   - status < 400   -> buffered and redacted when the content type is textual
 *     (JSON, `text/*` other than `text/event-stream`, XML, JavaScript,
 *     form-encoded, or absent); otherwise the body streams through untouched
 *     with its headers still redacted.
 *
 * The cost of that choice is named in KNOWN GAPS below. It is a real gap, not
 * a covered case.
 *
 * NEVER THROWS. A guard that throws converts a handled error into an unhandled
 * one — the exact failure this whole change exists to avoid. Every step of the
 * guard's own work is wrapped, and any failure inside it yields a fixed 500
 * carrying no upstream text.
 *
 * KNOWN GAPS — each is a property this function structurally cannot provide.
 * They are listed so a reader does not infer coverage from silence.
 *
 *  - A 2xx STREAMING body is not redacted (see above). Its headers are.
 *  - An UNCAUGHT THROW from the handler is re-thrown, not converted. Next.js
 *    renders its own error response for that, and this guard never sees it.
 *    Swallowing it here would silence `instrumentation.onRequestError` and
 *    Sentry, which is a worse trade; Next's production error response carries
 *    a digest, not the error text.
 *  - REDACTION IS A NET, NOT A LICENCE. `redactSecrets` removes this process's
 *    environment values and a list of documented credential shapes. It cannot
 *    recognise an internal hostname, a SQL fragment, or another tenant's
 *    identifier. Routes must still return fixed strings on the error path;
 *    this function is what catches what nobody predicted, not permission to
 *    stop trying.
 *  - It covers ROUTE HANDLERS. `proxy.ts` (Next middleware) and any response
 *    produced by the framework itself are outside it.
 *  - Enforcement that every route is wrapped is a SHAPE check, not a runtime
 *    one: `src/app/api/__tests__/egressGuardCoverage.test.ts` walks every
 *    `src/app/**\/route.ts` and names any exported HTTP method that is not
 *    `withEgressGuard(...)`. A route that forgets the wrapper is named by that
 *    test — which is tractable in a way the dataflow rule never was.
 */

/** HTTP methods Next.js App Router recognises as route handler exports. */
export const HTTP_METHOD_EXPORTS = [
  'GET',
  'POST',
  'PUT',
  'PATCH',
  'DELETE',
  'HEAD',
  'OPTIONS',
] as const;

/**
 * Statuses for which the fetch spec forbids a body. Constructing a `Response`
 * with one throws, so the guard must pass `null` for these.
 */
const NULL_BODY_STATUSES = new Set([101, 103, 204, 205, 304]);

/**
 * Content types whose bodies are safe to buffer and rewrite as text. Anything
 * not matched here streams through on a success status (see the header).
 * `text/event-stream` is excluded explicitly because it starts with `text/`.
 */
function isTextualContentType(contentType: string): boolean {
  const ct = contentType.toLowerCase();
  if (ct.includes('event-stream')) return false;
  if (ct === '') return true;
  return (
    ct.startsWith('text/') ||
    ct.includes('json') ||
    ct.includes('xml') ||
    ct.includes('javascript') ||
    ct.includes('urlencoded')
  );
}

function isJsonContentType(contentType: string): boolean {
  return contentType.toLowerCase().includes('json');
}

/** The response returned when the guard's OWN work fails. Carries no detail. */
function guardFailureResponse(): NextResponse {
  return new NextResponse(JSON.stringify({ error: 'Internal server error' }), {
    status: 500,
    headers: { 'content-type': 'application/json' },
  });
}

interface HeaderPlan {
  /** Ordinary header entries, `set-cookie` excluded. */
  entries: [string, string][];
  /** `Set-Cookie` values, kept separate so multiple cookies are not merged. */
  cookies: string[];
}

function readHeaders(headers: Headers): HeaderPlan {
  const entries: [string, string][] = [];
  // `getSetCookie` is the only way to read multiple Set-Cookie headers without
  // them being folded into one comma-joined string. It exists in undici and in
  // the edge runtime; the fallback keeps the merged value rather than dropping
  // the header, because dropping a Set-Cookie would silently log a user out.
  const hasGetSetCookie = typeof headers.getSetCookie === 'function';
  const cookies = hasGetSetCookie ? [...headers.getSetCookie()] : [];
  headers.forEach((value, key) => {
    if (hasGetSetCookie && key.toLowerCase() === 'set-cookie') return;
    entries.push([key, value]);
  });
  return { entries, cookies };
}

function buildHeaders(plan: HeaderPlan, values: string[], cookies: string[], bodyRewritten: boolean): Headers {
  const out = new Headers();
  plan.entries.forEach(([key], index) => {
    if (bodyRewritten && key.toLowerCase() === 'content-length') return;
    out.set(key, values[index] ?? '');
  });
  for (const cookie of cookies) out.append('set-cookie', cookie);
  return out;
}

/**
 * Redact a buffered body. JSON is parsed so nested string leaves are reached
 * individually and the envelope shape is preserved byte-for-byte when nothing
 * matches; a body that claims to be JSON and is not falls back to text.
 */
function redactBodyPair(text: string, json: boolean): [unknown, boolean] {
  if (!json) return [text, false];
  try {
    return [JSON.parse(text) as unknown, true];
  } catch {
    return [text, false];
  }
}

async function guardResponse(res: Response): Promise<Response> {
  const status = res.status;
  const contentType = res.headers.get('content-type') ?? '';
  const buffered = status >= 400 || isTextualContentType(contentType);
  const nullBody = NULL_BODY_STATUSES.has(status) || res.body === null;

  const plan = readHeaders(res.headers);

  let bodyValue: unknown = null;
  let parsedAsJson = false;
  let streamBody: ReadableStream<Uint8Array> | null = null;

  if (nullBody) {
    // nothing to read
  } else if (buffered) {
    const text = await res.text();
    [bodyValue, parsedAsJson] = redactBodyPair(text, isJsonContentType(contentType));
  } else {
    streamBody = res.body;
  }

  // ONE environment derivation for the whole response. `redactSecrets` memoises
  // its environment list behind a fingerprint that enumerates `process.env`, so
  // calling it once per header value would pay that enumeration N times; this
  // pays it once. Body and headers are redacted as separate roots so wrapping
  // them in a carrier object does not consume one of `redactSecrets`'s eight
  // depth levels.
  //
  // `percentAware` is set because a redirect `Location` and a `Set-Cookie`
  // value are URL-encoded by the time they are headers, and percent-encoding
  // destroys the word boundary every credential shape is anchored on — the
  // secret in `?e=invalid%20key%20sk-ant-AAA` was passing through verbatim
  // until this was set. The same applies to an encoded URL inside a JSON body.
  const [cleanBody, cleanHeaderValues, cleanCookies] = redactSecretsAll(
    [bodyValue, plan.entries.map(([, value]) => value), plan.cookies],
    { percentAware: true },
  ) as [unknown, string[], string[]];

  const bodyRewritten = !nullBody && buffered;
  const headers = buildHeaders(plan, cleanHeaderValues, cleanCookies, bodyRewritten);

  let outBody: BodyInit | null = null;
  if (nullBody) {
    outBody = null;
  } else if (buffered) {
    outBody = parsedAsJson
      ? JSON.stringify(cleanBody)
      : typeof cleanBody === 'string'
        ? cleanBody
        : '';
  } else {
    outBody = streamBody;
  }

  return new NextResponse(outBody, {
    status,
    statusText: res.statusText,
    headers,
  });
}

/**
 * Wrap a Next.js App Router route handler so every response it returns leaves
 * through one redaction chokepoint. See the module header for the full
 * contract, the streaming decision, and the gaps this cannot cover.
 *
 * Usage — the shape the coverage test enforces:
 *
 *     async function handleGET(request: NextRequest) { ... }
 *     export const GET = withEgressGuard(handleGET);
 */
export function withEgressGuard<A extends unknown[], R extends Response>(
  handler: (...args: A) => R | Promise<R>,
): (...args: A) => Promise<Response> {
  return async (...args: A): Promise<Response> => {
    // A throw from the HANDLER is deliberately not caught here — see KNOWN GAPS.
    const res = await handler(...args);
    try {
      return await guardResponse(res);
    } catch {
      return guardFailureResponse();
    }
  };
}
