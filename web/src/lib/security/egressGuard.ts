import { NextResponse } from 'next/server';
import { captureException } from '@/lib/monitoring/sentry-server';
import {
  createRedactionPass,
  REDACTION_PLACEHOLDER,
  type RedactionPass,
} from '@/lib/security/redactSecrets';

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
 * REDACTION ONLY REWRITES A RESPONSE THAT ACTUALLY CONTAINS A MATCH.
 *
 * This is the load-bearing sentence, and the first version of this guard did not
 * have it. That version parsed, walked and re-serialised EVERY response, which
 * cost a JSON round-trip on bodies nothing was wrong with — pretty-printing
 * destroyed on the `/api/user/export-data` attachment, integer-like keys
 * reordered, integers past 2^53 rounded, `1e400` turned into `null`, `-0` into
 * `0` — and, far worse, it carried `redactSecrets`' depth bound onto the success
 * path, where it replaced any sub-tree past eight levels with a placeholder
 * STRING. Tilemap tiles, skeleton bones and animation keyframes all sit at or
 * past that depth, so published games came back undeserialisable and the editor
 * wrote the truncated scene back to the database. See `MAX_REDACTION_NODES` in
 * `redactSecrets.ts` for that whole story; the bound is now on node count, not
 * depth, and it FAILS CLOSED rather than truncating.
 *
 * So the order of work here is:
 *
 *  1. derive the environment secret list ONCE, as a `RedactionPass`;
 *  2. SCAN the raw text of the body, every header value, every `Set-Cookie` and
 *     the reason phrase — one linear pass each, no `JSON.parse`, no tree walk;
 *  3. NO MATCH (the overwhelmingly common case): return the handler's own
 *     `Response`, untouched. Same object, same bytes, same headers, same
 *     `statusText`. Nothing is re-serialised, so nothing can be lost;
 *  4. MATCH: parse, redact and re-serialise only the part that matched. A body
 *     with a secret in it is being rewritten by definition; a JSON round-trip on
 *     THAT body is a cost worth paying, and it is the only body that pays it.
 *
 * THE PROPERTY THE FAST PATH RESTS ON, stated as the composition this function
 * actually performs — `hasCandidate(serialisedBody)` at step 2, and
 * `redactValue(JSON.parse(serialisedBody))` at step 4:
 *
 *     JSON.stringify(pass.redactValue(V)) !== JSON.stringify(V)
 *       =>  pass.hasCandidate(JSON.stringify(V))
 *
 * i.e. IF THE PARSED LEAVES (or keys) WOULD BE REDACTED, THE SCAN SAYS
 * CANDIDATE. Only then can "no match" justify returning the handler's own
 * bytes.
 *
 * The previous version of this paragraph said the scan and the rewrite "read
 * the same environment list and the same shape alternation off one context",
 * which asserts identical CONFIGURATION — a property adjacent to the one above,
 * and one that stayed true while the real property was false. The scan reads
 * the SERIALISED body and the rewrite reads the PARSED leaves, so a JSON escape
 * between the word boundary and a credential hid it from the scan entirely:
 * `{"error":"… Unauthorized\nmsy_… is not valid"}` scanned clean and shipped
 * verbatim, and every env secret containing a quote, a backslash or a newline
 * was invisible on the wire. That is lessons-learned #1, and it survived four
 * review boards. `redactSecrets.ts`'s `textHasCandidate` now scans a
 * JSON-unescaped view alongside the raw text so the two agree by construction,
 * and `redactSecrets.test.ts` pins the composition above over a corpus of
 * escaped forms rather than one example.
 *
 * It remains a strict OVER-approximation, so the fast path can be wrong only in
 * the safe direction: it may buffer and rewrite a body that turns out to need
 * nothing.
 *
 * AND THE SECOND HALF, which a SIXTH board found missing. Teaching the scan to
 * see JSON escapes fixed the direction above and opened its mirror image: the
 * REWRITE had not learned the same trick. `redactString` was `redactLiteral` +
 * `redactPercentEncoded`, so percent-encoding had a scan and an index-mapped
 * rewrite while JSON escaping had a scan only. Every text-mode path here — the
 * malformed-JSON fallback in `redactBufferedBody`, a non-JSON buffered body, a
 * header value, a `Set-Cookie`, the reason phrase — set `hasCandidate`, left the
 * fast path, rewrote NOTHING and emitted the credential. Detect-then-emit is
 * worse than never detecting: the response pays the slow path and leaks anyway,
 * and the guard reports success. `redactJsonEscaped` closes it at the source,
 * off the SAME decoder the scan uses.
 *
 * THAT FIX IS NOT TRUSTED ON ITS OWN. Both failures were an agreement between
 * two halves quietly going false, so this function now RE-SCANS WHAT IT IS ABOUT
 * TO EMIT and fails closed when the answer is still "candidate":
 *
 *   - an envelope value (header, `Set-Cookie`, `statusText`) that the rewrite
 *     could not clear is replaced wholesale with the placeholder;
 *   - a BODY that the rewrite could not clear is not emitted at all — the
 *     response becomes the fixed 500.
 *
 * Both report through `reportGuardFailure`. A value that was detected and could
 * not be rewritten never leaves this function, and the disagreement is loud
 * rather than a silent pass. Note what is asserted: not "the rewrite changed
 * something" (adjacent, and true of a rewrite that removed one of two
 * credentials) but "the output no longer matches" (the property).
 *
 * WHAT IT DOES, in order:
 *  1. awaits the handler's `Response`;
 *  2. redacts every response HEADER value, including `Set-Cookie` and
 *     `Location` — that closes the header, cookie and redirect channels
 *     structurally, with no dataflow analysis at all;
 *  3. redacts the reason phrase (`statusText`), which is transmitted on the
 *     wire under HTTP/1.1 and is otherwise a fourth client-visible channel;
 *  4. redacts the BODY: JSON bodies are parsed, redacted and re-serialised;
 *     other textual bodies are redacted as text;
 *  5. returns a new `NextResponse` carrying the same status, statusText and
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
 *     (JSON, `text/*` other than `text/event-stream`, XML, JavaScript, or
 *     form-encoded); otherwise the body streams through untouched with its
 *     headers still redacted.
 *
 * The cost of that choice is named in KNOWN GAPS below. It is a real gap, not
 * a covered case.
 *
 * NEVER THROWS, AND NEVER SILENT. A guard that throws converts a handled error
 * into an unhandled one — the exact failure this whole change exists to avoid.
 * Every step of the guard's own work is wrapped, and any failure inside it
 * yields a fixed 500 carrying no upstream text. That includes
 * `RedactionBudgetExceededError`: failing closed on a pathological body is the
 * point, and it is the reason the redactor throws instead of returning something
 * truncated. Every one of those paths reports through `reportGuardFailure`
 * first, because a control that turns good responses into 500s with no signal is
 * indistinguishable from an application bug and can run for weeks.
 *
 * KNOWN GAPS — each is a property this function structurally cannot provide.
 * They are listed so a reader does not infer coverage from silence.
 *
 *  - A 2xx STREAMING body is not redacted (see above). Its headers are.
 *  - A 2xx body with NO `Content-Type` is treated as non-textual and streams
 *    through unredacted. Its headers are still redacted. The previous rule
 *    treated an absent type as textual, which buffered and UTF-8-decoded binary
 *    bodies and replaced every byte >= 0x80 with U+FFFD — corrupting a download
 *    to gain redaction of something no route actually emits. Any status >= 400
 *    is still buffered whatever the type.
 *  - `SELF_ISSUED_SHAPES` (a `forge_` API key) is applied on status >= 400 only.
 *    `POST /api/keys/api-key` returns the newly-minted key in its 200 body for
 *    the one-time display that is the point of creating one; redacting it there
 *    would break the API Keys UI. See that constant in `redactSecrets.ts`.
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
 *  - It covers ROUTE HANDLERS. Named explicitly, because "framework-generated"
 *    is not a description of them: `src/app/sitemap.ts`, `src/app/robots.ts`
 *    and the four `opengraph-image.tsx` files (root, `community`, `pricing`,
 *    `play/[userId]/[slug]`) are FIRST-PARTY response producers that the
 *    framework merely invokes. They are not wrapped. `sitemap.ts` and the
 *    `play` OG image read the database, so they are on a data path, not a
 *    static one; neither renders error text today, which is why this is a named
 *    line rather than a fix. `egressGuardCoverage.test.ts` pins that set, so a
 *    NEW one is reported rather than joining the gap silently.
 *  - `proxy.ts` (Next middleware) is outside it, as is any response the
 *    framework itself produces.
 *  - ONE DECODING ORDER IS NOT COVERED: percent-decoding BEFORE JSON-unescaping,
 *    i.e. `%5Cn` decoding to a backslash that then reads as an escape. The scan
 *    and the rewrite look at raw, percent-decoded, unescaped and
 *    unescaped-then-percent-decoded — four spellings, the same four on both
 *    sides — and neither looks at that fifth one. It is named as a gap rather
 *    than a disagreement precisely because both halves miss it identically, so
 *    the fail-closed check above will not fire on it. No channel here writes
 *    that shape today (a percent-encoded backslash inside JSON that a client
 *    then decodes twice), which is why it is a line here and not a fix.
 *  - The fail-closed check protects what this function EMITS. A `Set-Cookie`
 *    replaced by the placeholder is a broken cookie, and a body replaced by the
 *    fixed 500 is a lost response — both are deliberate, both are reported, and
 *    neither is a silent degradation.
 *  - Enforcement that every route is wrapped is a SHAPE check, not a runtime
 *    one: `src/app/api/__tests__/egressGuardCoverage.test.ts` walks every
 *    `src/app/**\/route.{ts,tsx,js,jsx,mjs}` — all five spellings the App
 *    Router accepts — and names any exported HTTP method that is not
 *    `withEgressGuard(...)` imported from this module. A route that forgets the
 *    wrapper is named by that test, which is tractable in a way the dataflow
 *    rule never was.
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
 *
 * `text/event-stream` is excluded explicitly because it starts with `text/`.
 * That exclusion is what keeps `/api/chat` streaming, and the value it tests
 * for is the PROVIDER's, not ours: `ai` writes
 * `"content-type": "text/event-stream"` from `UI_MESSAGE_STREAM_HEADERS`, which
 * both `toUIMessageStreamResponse` (what the chat route calls) and
 * `createUIMessageStreamResponse` use.
 *
 * A citation is not a gate, and `web/package.json` pins `"ai": "^7.0.11"` — a
 * caret range, so a minor bump can change that header with no diff here, and
 * every test that appeared to cover it set the value in a hand-written MOCK,
 * which pins the belief rather than the contract (lessons-learned #14). If the
 * header changed, this would return true, the guard would `await clone.text()`
 * on an open SSE stream, and `/api/chat` would stall until the model finished —
 * with nothing failing. So `egressGuard.test.ts` now calls the REAL
 * `createUIMessageStreamResponse` and asserts its actual `content-type` against
 * this function. Exported for exactly that.
 *
 * An ABSENT content type is NOT textual. See KNOWN GAPS.
 */
export function isTextualContentType(contentType: string): boolean {
  const ct = contentType.toLowerCase();
  if (ct === '') return false;
  if (ct.includes('event-stream')) return false;
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

/**
 * Report a failure of the GUARD ITSELF, and never become one.
 *
 * Every path that produces `guardFailureResponse()` comes through here, because
 * the alternative — a bare `catch { return guardFailureResponse(); }` — is a
 * control that converts a handler's real response into a fixed 500 with no
 * signal anywhere. In production that is indistinguishable from an application
 * error, so a guard defect (a `clone()` that throws, a bug in the walk, a
 * `RedactionBudgetExceededError` on a body nobody expected to be pathological)
 * could run for weeks with user reports as the only symptom. This file argues
 * exactly that rule forty lines above for the handler-throw case: swallowing an
 * error to keep instrumentation quiet is the worse trade.
 *
 * `captureException` no-ops without `SENTRY_DSN`, so `console.error` runs
 * unconditionally as well — the local and preview signal, where a DSN often is
 * not set and where a guard defect is most likely to be introduced.
 *
 * THE WHOLE BODY IS WRAPPED. Reporting sits on the failure path of a function
 * whose contract is "never throws"; a throw from Sentry or from a console that
 * has been replaced would turn a fail-closed 500 into an unhandled rejection —
 * the failure this module exists to prevent, reintroduced by the code that
 * reports it. Nothing derived from the response is passed: `detail` carries only
 * values this file computed.
 */
function reportGuardFailure(reason: string, error: unknown, detail?: Record<string, unknown>): void {
  try {
    // eslint-disable-next-line no-console -- the only signal when SENTRY_DSN is unset.
    console.error(`[egressGuard] ${reason}`, detail ?? {});
    captureException(error instanceof Error ? error : new Error(reason), {
      egressGuardReason: reason,
      ...detail,
    });
  } catch {
    // A reporter that throws must not defeat the guard it is reporting on.
  }
}

/**
 * Redact one envelope value (a header, a `Set-Cookie`, the reason phrase) and
 * VERIFY THE RESULT, because "detected" and "rewritten" are two claims and this
 * module has shipped the first without the second.
 *
 * The scan said this value carries a credential. If the rewrite hands back
 * something the scan STILL flags, the value is detected-but-unrewritable and
 * must not go out — so it is replaced wholesale with the placeholder and the
 * disagreement is reported loudly. Silently emitting it is the worst available
 * outcome: the response pays the slow path and leaks anyway, and the guard
 * reports success.
 *
 * This is deliberately a re-scan of the OUTPUT rather than a `clean !== value`
 * comparison. "Changed" is adjacent to the property; "no longer matches" is the
 * property (lessons-learned #1). A rewrite that removed one of two credentials
 * would satisfy the first and fail the second.
 */
function cleanEnvelopeValue(value: string, pass: RedactionPass, channel: string): string {
  const clean = pass.redactText(value);
  if (!pass.hasCandidate(clean)) return clean;
  reportGuardFailure(
    'a credential was detected in an envelope value that redaction did not remove',
    new Error('egress guard: detected-but-unrewritable envelope value'),
    { channel },
  );
  return REDACTION_PLACEHOLDER;
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

/**
 * `content-length` is the one header that must be DROPPED rather than carried:
 * redaction changes the body's byte length by construction (`[REDACTED]` is
 * rarely the width of the secret it replaces), and a stale length truncates or
 * hangs the response. It is dropped ONLY when the body was actually rewritten —
 * on the fast path and on a streamed body the original length is still correct
 * and must be preserved.
 */
function buildHeaders(
  plan: HeaderPlan,
  values: string[],
  cookies: string[],
  bodyRewritten: boolean,
): Headers {
  const out = new Headers();
  plan.entries.forEach(([key], index) => {
    if (bodyRewritten && key.toLowerCase() === 'content-length') return;
    out.set(key, values[index] ?? '');
  });
  for (const cookie of cookies) out.append('set-cookie', cookie);
  return out;
}

/**
 * A body copy to read, leaving the handler's own `Response` intact so the fast
 * path can return that object itself. `clone()` is spec-required on `Response`;
 * a null return means this object is not a real one (a test double, an exotic
 * shim), in which case the caller reads the original and rebuilds.
 */
function tryClone(res: Response): Response | null {
  try {
    return typeof res.clone === 'function' ? res.clone() : null;
  } catch {
    return null;
  }
}

/**
 * Redact a buffered body that the scan says contains a match. JSON is parsed so
 * nested string leaves are reached individually; a body that claims to be JSON
 * and is not falls back to text.
 *
 * Propagates `RedactionBudgetExceededError` deliberately — see the header. Any
 * other parse failure means "not actually JSON", which is a text body.
 */
function redactBufferedBody(text: string, json: boolean, pass: RedactionPass): string {
  if (json) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(text);
    } catch {
      return pass.redactText(text);
    }
    return JSON.stringify(pass.redactValue(parsed)) ?? '';
  }
  return pass.redactText(text);
}

async function guardResponse(res: Response): Promise<Response> {
  const status = res.status;
  const contentType = res.headers.get('content-type') ?? '';
  const nullBody = NULL_BODY_STATUSES.has(status) || res.body === null;
  const buffered = !nullBody && (status >= 400 || isTextualContentType(contentType));

  // ONE environment derivation for the whole response — the scan and every
  // rewrite below share it. `redactSecrets` memoises its environment list behind
  // a fingerprint that enumerates `process.env`, so a call per header value
  // would pay that enumeration N times; this pays it once.
  //
  // `percentAware` is set because a redirect `Location` and a `Set-Cookie` value
  // are URL-encoded by the time they are headers, and percent-encoding destroys
  // the word boundary every credential shape is anchored on — the secret in
  // `?e=invalid%20key%20sk-ant-AAA` was passing through verbatim until this was
  // set. The same applies to an encoded URL inside a JSON body.
  const pass = createRedactionPass({
    percentAware: true,
    includeSelfIssuedShapes: status >= 400,
  });

  const plan = readHeaders(res.headers);
  const headerValues = plan.entries.map(([, value]) => value);
  const statusText = res.statusText;

  const envelopeTouched =
    headerValues.some((value) => pass.hasCandidate(value))
    || plan.cookies.some((value) => pass.hasCandidate(value))
    || (statusText !== '' && pass.hasCandidate(statusText));

  // Read from a CLONE where one is available, so the original response object is
  // still returnable below.
  let text: string | null = null;
  let originalIntact = true;
  if (buffered) {
    const clone = tryClone(res);
    originalIntact = clone !== null;
    text = await (clone ?? res).text();
  }
  const bodyTouched = text !== null && pass.hasCandidate(text);

  // THE FAST PATH. Nothing in this response would be rewritten, so nothing is.
  if (!envelopeTouched && !bodyTouched) {
    if (originalIntact) return res;
    // Only reachable for a Response that cannot be cloned, whose body we
    // therefore had to consume. Rebuild it from the bytes we read — same text,
    // same header values, same reason phrase, and `content-length` preserved
    // because the body did not change.
    return new NextResponse(text, {
      status,
      statusText,
      headers: buildHeaders(plan, headerValues, plan.cookies, false),
    });
  }

  const cleanHeaderValues = envelopeTouched
    ? headerValues.map((value, index) => cleanEnvelopeValue(value, pass, plan.entries[index][0]))
    : headerValues;
  const cleanCookies = envelopeTouched
    ? plan.cookies.map((value) => cleanEnvelopeValue(value, pass, 'set-cookie'))
    : plan.cookies;
  const cleanStatusText = envelopeTouched
    ? cleanEnvelopeValue(statusText, pass, 'statusText')
    : statusText;

  let outBody: BodyInit | null = null;
  let bodyRewritten = false;
  if (nullBody) {
    outBody = null;
  } else if (!buffered) {
    outBody = res.body;
  } else if (!bodyTouched) {
    // A header matched but the body did not: the body keeps its ORIGINAL bytes.
    outBody = text;
  } else {
    const json = isJsonContentType(contentType);
    const cleaned = redactBufferedBody(text as string, json, pass);
    // THE BOUNDARY ASSERTION for the body. See `cleanEnvelopeValue` for why this
    // re-scans the output instead of asking whether the rewrite changed
    // anything. A body the scan still flags cannot be emitted at ANY status, so
    // this is the one place the guard turns a readable response into its fixed
    // 500 on purpose rather than on an exception.
    if (pass.hasCandidate(cleaned)) {
      reportGuardFailure(
        'a credential was detected in a response body that redaction did not remove',
        new Error('egress guard: detected-but-unrewritable body'),
        { status, json, bytes: cleaned.length },
      );
      return guardFailureResponse();
    }
    outBody = cleaned;
    bodyRewritten = true;
  }

  return new NextResponse(outBody, {
    status,
    statusText: cleanStatusText,
    headers: buildHeaders(plan, cleanHeaderValues, cleanCookies, bodyRewritten),
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
    } catch (error) {
      // Includes `RedactionBudgetExceededError`: a body too large to redact
      // safely becomes a fixed 500, never a truncated body served as if it were
      // the real one.
      //
      // REPORTED, never silent. A guard defect turning good responses into 500s
      // is invisible from the outside; see `reportGuardFailure`.
      reportGuardFailure('the guard itself failed; response replaced with a fixed 500', error);
      return guardFailureResponse();
    }
  };
}
