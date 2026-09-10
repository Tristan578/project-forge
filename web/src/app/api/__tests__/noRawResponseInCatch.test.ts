/**
 * @vitest-environment node
 *
 * RuleTester coverage for `spawnforge/no-raw-response-in-catch` (#9736).
 *
 * Two review boards defeated two earlier designs. Every shape either board
 * walked through is an `invalid` case below, named with the shape it
 * represents, so "this is caught now" is checkable rather than asserted.
 *
 * EVERY invalid case here was also verified BY HAND: the same source was
 * written to a file under the linted glob and run through `npx eslint`, not
 * only through RuleTester. A RuleTester case pins the rule's behaviour against
 * options this file chooses; only the CLI proves the flat config wires those
 * options to the files that build responses.
 *
 * Each case is written so the line under test is the ONLY thing that can
 * report. The previous suite's header-channel case built its response with a
 * raw `NextResponse.json` on the preceding line, so deleting the header line
 * left the case passing — a named check incapable of failing for the reason it
 * claimed (lessons-learned #11). Where a case needs a response constructed
 * first, it uses a SANCTIONED constructor, which reports nothing on its own.
 */
import { RuleTester } from 'eslint';
import tsParser from '@typescript-eslint/parser';
import { describe, it } from 'vitest';

import rule from '../../../../eslint-rules/no-raw-response-in-catch.mjs';
import {
  REDACTING_RESPONSE_HELPERS,
  RULE_OPTIONS,
} from '../../../../eslint-rules/no-raw-response-in-catch.options.mjs';

// RuleTester emits one `it()` per case. Wiring vitest's hooks in makes each
// bypass shape a separately-named test rather than one opaque assertion.
RuleTester.describe = describe;
RuleTester.it = it;

const ruleTester = new RuleTester({
  languageOptions: {
    parser: tsParser,
    ecmaVersion: 2022,
    sourceType: 'module',
  },
});

/**
 * THE SHIPPED OPTIONS, imported rather than retyped.
 *
 * This used to be a hand-written copy under a comment claiming it matched the
 * flat config. It did not: the config passed thirteen `responseHelpers` and this
 * declared three, so nothing pinned that the rule accepts a sanctioned
 * constructor for the other ten, and an edit to `REDACTING_RESPONSE_HELPERS`
 * could not fail any test here. A citation a reviewer follows and finds false is
 * the defect class this same change corrected twice elsewhere.
 */
const OPTIONS = [RULE_OPTIONS];

/**
 * The rule interpolates the FIRST THREE sanctioned names into its message
 * (`helperList` in the rule: `[...responseHelpers].slice(0, 3)`) so the sentence
 * stays readable while the allowlist grows. Derived from the same source, so it
 * cannot drift — the previous hardcoded copy happened to be right about these
 * three and wrong about the other ten.
 */
const HELPER_LIST = REDACTING_RESPONSE_HELPERS.slice(0, 3).join(', ');

ruleTester.run('no-raw-response-in-catch', rule, {
  valid: [
    {
      name: 'success-path response construction is untouched',
      code: `
        export async function GET() {
          const data = await load();
          return NextResponse.json({ data });
        }
      `,
      options: OPTIONS,
    },
    {
      name: 'catch responds through the redacting constructor with a fixed message',
      code: `
        export async function GET() {
          try {
            return NextResponse.json(await load());
          } catch (err) {
            captureException(err, { route: '/api/x' });
            return createErrorResponse(500, 'Could not read the status. Please try again.');
          }
        }
      `,
      options: OPTIONS,
    },
    {
      name: 'catch responds through redactedJson, preserving a bespoke envelope',
      code: `
        export async function GET() {
          try {
            return NextResponse.json(await load());
          } catch (err) {
            console.error('load failed', err);
            return redactedJson({ error: 'load_failed', message: 'Please try again.' }, { status: 500 });
          }
        }
      `,
      options: OPTIONS,
    },
    {
      // The shorthand constructors are ten of the thirteen sanctioned names and
      // not one of them was exercised, because the suite passed a three-name
      // copy of the list. `badRequest` stands for the group; the shared
      // `RULE_OPTIONS` import is what makes an edit to the list reach here.
      name: 'catch responds through a SHORTHAND redacting constructor',
      code: `
        export async function GET() {
          try {
            return NextResponse.json(await load());
          } catch (err) {
            console.error('load failed', err);
            return badRequest('That request could not be read. Check the fields and try again.');
          }
        }
      `,
      options: OPTIONS,
    },
    {
      name: 'a narrowed client-safe error may return its own message',
      code: `
        export async function GET() {
          try {
            return NextResponse.json(await load());
          } catch (err) {
            if (err instanceof ApiKeyError) {
              return apiError(402, err.message, err.code);
            }
            throw err;
          }
        }
      `,
      options: OPTIONS,
    },
    {
      name: 'the same narrowing written as a ternary also exempts',
      code: `
        export async function GET() {
          try {
            return NextResponse.json(await load());
          } catch (err) {
            return err instanceof ApiKeyError
              ? apiError(402, err.message)
              : createErrorResponse(500, 'Please try again.');
          }
        }
      `,
      options: OPTIONS,
    },
    {
      name: 'narrowing by the else of a negated instanceof also exempts',
      code: `
        export async function GET() {
          try {
            return NextResponse.json(await load());
          } catch (err) {
            if (!(err instanceof PromptRejectedError)) {
              throw err;
            } else {
              return apiError(400, err.message);
            }
          }
        }
      `,
      options: OPTIONS,
    },
    {
      name: 'narrowing by early return is recognised, not only the explicit branch',
      code: `
        export async function GET() {
          try {
            return NextResponse.json(await load());
          } catch (err) {
            if (!(err instanceof PromptRejectedError)) throw err;
            return apiError(400, err.message);
          }
        }
      `,
      options: OPTIONS,
    },
    {
      name: 'telemetry sinks inside a catch are not escapes',
      code: `
        export async function GET() {
          try {
            return NextResponse.json(await load());
          } catch (err) {
            console.error('decompose failed', err);
            Sentry.captureException(err);
            captureException(err, { route: '/api/x' });
            logger.error({ err }, 'failed');
            reqLog.warn('failed', { error: err instanceof Error ? err.message : String(err) });
            return createErrorResponse(500, 'Please try again.');
          }
        }
      `,
      options: OPTIONS,
    },
    {
      name: 'a rejection handler whose whole body is a telemetry sink is not a return escape',
      // `.catch((err) => sampledCaptureException('x', err))` returns the sink's
      // result, which carries nothing. Reporting it would have made every
      // fire-and-forget error report in the repo a lint error.
      code: `
        export async function GET() {
          redisSet(key, value).catch((err) => sampledCaptureException('cache.set', err));
          return NextResponse.json({ ok: true });
        }
      `,
      options: OPTIONS,
    },
    {
      name: 'a type-guard call in a condition is a branch decision, not an egress',
      code: `
        export async function GET() {
          try {
            return NextResponse.json(await load());
          } catch (err) {
            if (isClerk404(err)) return createErrorResponse(404, 'Not found');
            if (!isMissingEmail(err)) captureException(err);
            return createErrorResponse(500, 'Please try again.');
          }
        }
      `,
      options: OPTIONS,
    },
    {
      name: 'rethrowing a wrapped error is not an egress',
      code: `
        export async function GET() {
          try {
            return NextResponse.json(await load());
          } catch (err) {
            throw new Error('load failed: ' + String(err));
          }
        }
      `,
      options: OPTIONS,
    },
    {
      name: 'a property KEY spelled like the catch binding is not a reference to it',
      // `catch (error) { ... { error: 'Failed' } ... }` is the single most
      // common shape in this codebase. Counting the key as a read reported 57
      // routes that leak nothing, which is how a rule teaches people to
      // disable it.
      code: `
        export async function POST() {
          try {
            return NextResponse.json(await load());
          } catch (error) {
            captureException(error);
            return redactedJson({ error: 'Failed to perform bulk moderation' }, { status: 500 });
          }
        }
      `,
      options: OPTIONS,
    },
    {
      name: 'a non-computed member spelled like the catch binding is not a reference either',
      code: `
        export async function POST() {
          const mid = await middleware();
          try {
            return NextResponse.json(await load());
          } catch (error) {
            captureException(error);
            return redactedJson({ ok: false, detail: mid.error }, { status: 500 });
          }
        }
      `,
      options: OPTIONS,
    },
    {
      name: 'a local accumulator declared inside the catch is not an escape',
      code: `
        export async function GET() {
          try {
            return NextResponse.json(await load());
          } catch (err) {
            const parts: string[] = [];
            parts.push(String(err));
            console.error(parts.join(' '));
            return createErrorResponse(500, 'Please try again.');
          }
        }
      `,
      options: OPTIONS,
    },
    {
      name: 'a header set on a locally-built response is quiet while the response stays local',
      // The report belongs on the `return`, not on the header set: a response
      // that never leaves the catch cannot reach a client. The invalid twin of
      // this case (bypass 7/11) adds the `return` and nothing else.
      code: `
        export async function GET() {
          try {
            return NextResponse.json(await load());
          } catch (err) {
            const res = createErrorResponse(500, 'Please try again.');
            res.headers.set('X-Upstream-Detail', String(err));
            console.error(res);
            return createErrorResponse(500, 'Please try again.');
          }
        }
      `,
      options: OPTIONS,
    },
  ],

  invalid: [
    // ---------------------------------------------------------------------
    // Board pass 1: the eleven shapes that walked through the regex detector.
    // ---------------------------------------------------------------------
    {
      name: 'bypass 1/11 — err.toString()',
      code: `
        export async function GET() {
          try {
            return await load();
          } catch (err) {
            return NextResponse.json({ error: err.toString() }, { status: 500 });
          }
        }
      `,
      options: OPTIONS,
      errors: [{ messageId: 'rawResponseInCatch' }],
    },
    {
      name: 'bypass 2/11 — err.response.data (the provider body on another property)',
      code: `
        export async function GET() {
          try {
            return await load();
          } catch (err) {
            return NextResponse.json({ error: err.response.data }, { status: 500 });
          }
        }
      `,
      options: OPTIONS,
      errors: [{ messageId: 'rawResponseInCatch' }],
    },
    {
      name: 'bypass 3/11 — an if statement instead of a ternary, leaking in the fall-through',
      code: `
        export async function GET() {
          try {
            return await load();
          } catch (err) {
            if (err instanceof ApiKeyError) {
              return apiError(402, err.message, err.code);
            }
            return apiError(500, err.message);
          }
        }
      `,
      options: OPTIONS,
      // Precisely the first board's blocker: the old detector exempted the
      // fall-through because it sat within 400 characters of the narrowing
      // `if`. The exemption is scoped to the narrowed BRANCH, so the first
      // return is clean and the second is reported.
      errors: [{ messageId: 'catchValueInResponseHelper' }],
    },
    {
      name: 'bypass 4/11 — const { message } = err',
      code: `
        export async function GET() {
          try {
            return await load();
          } catch (err) {
            const { message } = err as Error;
            return createErrorResponse(500, message);
          }
        }
      `,
      options: OPTIONS,
      errors: [{ messageId: 'catchValueInResponseHelper' }],
    },
    {
      name: 'bypass 5/11 — NextResponse.json(buildBody(err)), the body one helper call away',
      code: `
        export async function GET() {
          try {
            return await load();
          } catch (err) {
            return NextResponse.json(buildBody(err), { status: 500 });
          }
        }
      `,
      options: OPTIONS,
      errors: [{ messageId: 'rawResponseInCatch' }],
    },
    {
      name: 'bypass 6/11 — new NextResponse(JSON.stringify(...)), already house style',
      code: `
        export async function GET() {
          try {
            return await load();
          } catch (err) {
            return new NextResponse(JSON.stringify({ error: err.message }), {
              status: 500,
              headers: { 'Content-Type': 'application/json' },
            });
          }
        }
      `,
      options: OPTIONS,
      errors: [{ messageId: 'rawResponseInCatch' }],
    },
    {
      name: 'bypass 7/11 — a header set on a SANCTIONED response, then returned',
      // Rewritten. The previous version of this case built the response with a
      // raw `NextResponse.json` on the line above, so its single expected error
      // came from the site ban: deleting the header line left it green. Here
      // the constructor is sanctioned and reports nothing, so the case can only
      // pass because the header value crosses out on the `return`.
      code: `
        export async function GET() {
          try {
            return await load();
          } catch (err) {
            const res = createErrorResponse(500, 'Upstream failed. Please try again.');
            res.headers.set('X-Upstream-Detail', err instanceof Error ? err.message : String(err));
            return res;
          }
        }
      `,
      options: OPTIONS,
      errors: [{ messageId: 'catchValueReturned' }],
    },
    {
      name: 'bypass 8/11 — assignment to an outer let, responded to after the try/catch',
      code: `
        export async function GET() {
          let message = 'Generation failed';
          try {
            await load();
          } catch (err) {
            message = err instanceof Error ? err.message : String(err);
          }
          return createErrorResponse(500, message);
        }
      `,
      options: OPTIONS,
      // The response is outside the catch, so the site ban cannot see it. The
      // escape check closes the door the value walked through.
      errors: [{ messageId: 'catchValueEscapes', data: { name: 'message' } }],
    },
    {
      name: 'bypass 9/11 — parts.push(err.message) into an outer array, joined later',
      code: `
        export async function GET() {
          const parts: string[] = ['Generation failed'];
          try {
            await load();
          } catch (err) {
            parts.push(err.message);
          }
          return createErrorResponse(500, parts.join(' '));
        }
      `,
      options: OPTIONS,
      errors: [{ messageId: 'catchValueEscapes', data: { name: 'parts' } }],
    },
    {
      name: 'bypass 10/11 — a promise .catch((e) => ...) callback',
      code: `
        export async function GET() {
          return load().catch((e) => NextResponse.json({ error: e.message }, { status: 500 }));
        }
      `,
      options: OPTIONS,
      errors: [{ messageId: 'rawResponseInCatch' }],
    },
    {
      name: 'bypass 11/11 — a plain new Response with the error as the body',
      code: `
        export async function GET() {
          try {
            return await load();
          } catch (err) {
            return new Response(String(err), { status: 500 });
          }
        }
      `,
      options: OPTIONS,
      errors: [{ messageId: 'rawResponseInCatch' }],
    },
    {
      // The other side of the shorthand case above: the allowlist is a LIST, not
      // a shape. A helper that merely looks like one of the sanctioned names is
      // still an escape, and without this the valid case only proves the rule is
      // permissive somewhere.
      name: 'a helper that is NOT on the allowlist is still an escape',
      code: `
        export async function GET() {
          try {
            return await load();
          } catch (err) {
            return teapot({ detail: err.message }, { status: 500 });
          }
        }
      `,
      options: OPTIONS,
      errors: [{ messageId: 'catchValueToUnknownSink' }],
    },

    // ---------------------------------------------------------------------
    // Board pass 2: the sinks the SITE-ENUMERATING rule left open. Every one
    // of these was reproduced lint-clean against the previous rule.
    // ---------------------------------------------------------------------
    {
      name: 'pass-2 — escape by the RETURN VALUE of a .catch callback with an expression body',
      // The single most idiomatic spelling of the defect: the response is built
      // at the CALL SITE, outside every catch, so a site ban can never see it.
      code: `
        export async function GET(u: string) {
          const detail = await fetch(u).catch((e) => (e instanceof Error ? e.message : String(e)));
          return redactedJson({ error: 'Upstream failed', detail }, { status: 502 });
        }
      `,
      options: OPTIONS,
      errors: [{ messageId: 'catchValueReturned' }],
    },
    {
      name: 'pass-2 — escape by returning a result object from a nested helper',
      code: `
        async function attempt() {
          try {
            return { ok: true, data: await load() };
          } catch (e) {
            return { ok: false, detail: String(e) };
          }
        }
      `,
      options: OPTIONS,
      errors: [{ messageId: 'catchValueReturned' }],
    },
    {
      name: 'pass-2 — escape by returning from an inline async IIFE',
      code: `
        export async function GET() {
          const body = await (async () => {
            try { return await load(); } catch (e) { return { error: e.message }; }
          })();
          return redactedJson(body, { status: 500 });
        }
      `,
      options: OPTIONS,
      errors: [{ messageId: 'catchValueReturned' }],
    },
    {
      name: 'pass-2 — a redirect URL is a client-visible egress channel',
      code: `
        export async function GET(req: Request) {
          try {
            return await load();
          } catch (err) {
            return NextResponse.redirect(new URL('/e?d=' + encodeURIComponent(err.message), req.url));
          }
        }
      `,
      options: OPTIONS,
      errors: [{ messageId: 'rawResponseInCatch', data: { name: 'NextResponse.redirect', helpers: HELPER_LIST } }],
    },
    {
      name: 'pass-2 — Response.redirect too',
      code: `
        export async function GET() {
          try {
            return await load();
          } catch (err) {
            return Response.redirect('https://x/e?m=' + err.message, 302);
          }
        }
      `,
      options: OPTIONS,
      errors: [{ messageId: 'rawResponseInCatch', data: { name: 'Response.redirect', helpers: HELPER_LIST } }],
    },
    {
      name: 'pass-2 — a computed member defeats a !computed check',
      code: `
        export async function GET() {
          try {
            return await load();
          } catch (err) {
            return NextResponse['json']({ error: err.message }, { status: 500 });
          }
        }
      `,
      options: OPTIONS,
      errors: [{ messageId: 'rawResponseInCatch', data: { name: 'NextResponse.json', helpers: HELPER_LIST } }],
    },
    {
      name: 'pass-2 — a RENAMED import defeats an identifier-name match',
      // This one disabled the rule for a whole file with no other signal.
      code: `
        import { NextResponse as NR } from 'next/server';
        export async function GET() {
          try {
            return await load();
          } catch (e) {
            return NR.json({ error: e.message }, { status: 500 });
          }
        }
      `,
      options: OPTIONS,
      errors: [{ messageId: 'rawResponseInCatch', data: { name: 'NR.json', helpers: HELPER_LIST } }],
    },
    {
      name: 'pass-2 — the two-argument .then(onFulfilled, onRejected)',
      code: `
        export async function GET() {
          return load().then(
            (d) => NextResponse.json(d),
            (err) => NextResponse.json({ error: err.message }, { status: 500 }),
          );
        }
      `,
      options: OPTIONS,
      errors: [{ messageId: 'rawResponseInCatch' }],
    },
    {
      name: 'pass-2 — a destructuring ASSIGNMENT into an outer binding',
      code: `
        export async function GET() {
          let message = 'Failed';
          try {
            await load();
          } catch (err) {
            ({ message } = err as Error);
          }
          return createErrorResponse(500, message);
        }
      `,
      options: OPTIONS,
      errors: [{ messageId: 'catchValueEscapes', data: { name: 'message' } }],
    },
    {
      name: 'pass-2 — an array destructuring assignment into an outer binding',
      code: `
        export async function GET() {
          let message = 'Failed';
          try {
            await load();
          } catch (err) {
            [message] = [String(err)];
          }
          return createErrorResponse(500, message);
        }
      `,
      options: OPTIONS,
      errors: [{ messageId: 'catchValueEscapes', data: { name: 'message' } }],
    },
    {
      name: 'pass-2 — the SECOND name of a destructured catch param is tracked',
      // The single-property form was caught and the two-property form was not,
      // so the rule LOOKED like it handled destructured catch parameters.
      code: `
        export async function GET() {
          try {
            return await load();
          } catch ({ name, message }) {
            return createErrorResponse(500, message);
          }
        }
      `,
      options: OPTIONS,
      errors: [{ messageId: 'catchValueInResponseHelper' }],
    },
    {
      name: 'pass-2 — a for-of binding launders the value (its declarator has a null init)',
      code: `
        export async function GET() {
          try {
            return await load();
          } catch (err) {
            for (const line of String(err).split('\\n')) {
              return createErrorResponse(500, line);
            }
            return createErrorResponse(500, 'Please try again.');
          }
        }
      `,
      options: OPTIONS,
      errors: [{ messageId: 'catchValueInResponseHelper' }],
    },
    {
      name: 'pass-2 — a function parameter launders the value',
      code: `
        export async function GET() {
          const send = (m: string) => createErrorResponse(500, m);
          try {
            return await load();
          } catch (err) {
            return send(err.message);
          }
        }
      `,
      options: OPTIONS,
      errors: [{ messageId: 'catchValueToUnknownSink', data: { name: 'send' } }],
    },
    {
      name: 'pass-2 — the DB store-and-forward idiom, whose receiver is rooted in a call',
      // `rootIdentifier()` returned null the moment the chain reached a
      // CallExpression, which made the escape check inert for every
      // `getDb().update(x).set(...)` in the repo.
      code: `
        export async function POST() {
          try {
            await load();
          } catch (err) {
            await getDb().update(generationJobs).set({ errorMessage: err.message });
            return createErrorResponse(500, 'Please try again.');
          }
        }
      `,
      options: OPTIONS,
      errors: [{ messageId: 'catchValueEscapes' }],
    },
    {
      name: 'pass-2 — a stream sink, which no mutator list contained',
      code: `
        export function GET() {
          const stream = new ReadableStream({
            start(controller) {
              try {
                work();
              } catch (err) {
                controller.enqueue(new TextEncoder().encode(err.message));
              }
            },
          });
          return new Response(stream);
        }
      `,
      options: OPTIONS,
      errors: [{ messageId: 'catchValueEscapes', data: { name: 'controller' } }],
    },
    {
      name: 'pass-2 — Object.defineProperty on an outer body',
      code: `
        export async function GET() {
          const body: Record<string, unknown> = { error: 'Failed' };
          try {
            await load();
          } catch (err) {
            Object.defineProperty(body, 'detail', { value: err.message });
          }
          return redactedJson(body, { status: 500 });
        }
      `,
      options: OPTIONS,
      errors: [{ messageId: 'catchValueEscapes', data: { name: 'body' } }],
    },
    {
      name: 'pass-2 — Reflect.set on an outer body',
      code: `
        export async function GET() {
          const body: Record<string, unknown> = { error: 'Failed' };
          try {
            await load();
          } catch (err) {
            Reflect.set(body, 'detail', err.message);
          }
          return redactedJson(body, { status: 500 });
        }
      `,
      options: OPTIONS,
      errors: [{ messageId: 'catchValueEscapes', data: { name: 'body' } }],
    },
    {
      name: 'pass-2 — the instanceof exemption does not extend to err.cause',
      // The exemption's justification is that the MESSAGE is ours. It used to
      // cover the whole narrowed branch, so raw upstream text reached THROUGH
      // the client-safe error and inherited it.
      code: `
        export async function GET() {
          try {
            return await load();
          } catch (err) {
            if (err instanceof ApiKeyError) {
              return apiError(402, err.cause.body);
            }
            throw err;
          }
        }
      `,
      options: OPTIONS,
      errors: [{ messageId: 'catchValueInResponseHelper' }],
    },
    {
      name: 'pass-2 — nor does it extend to the narrowed error passed WHOLE',
      code: `
        export async function GET() {
          try {
            return await load();
          } catch (err) {
            if (err instanceof ApiKeyError) {
              return apiError(402, err);
            }
            throw err;
          }
        }
      `,
      options: OPTIONS,
      errors: [{ messageId: 'catchValueInResponseHelper' }],
    },
    {
      name: 'pass-2 — an ordinary helper call is a store-and-forward channel',
      code: `
        export async function POST() {
          try {
            await load();
          } catch (err) {
            await recordFailure(jobId, err);
            return createErrorResponse(500, 'Please try again.');
          }
        }
      `,
      options: OPTIONS,
      errors: [{ messageId: 'catchValueToUnknownSink', data: { name: 'recordFailure' } }],
    },
    {
      name: 'pass-2 — a bindingless catch may not build a raw response either',
      // `catch { ... }` has nothing to track, so the taint model is silent —
      // this is the case the site ban is still here for.
      code: `
        export async function POST(req: Request) {
          try {
            return await req.json();
          } catch {
            return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
          }
        }
      `,
      options: OPTIONS,
      errors: [{ messageId: 'rawResponseInCatch' }],
    },

    // ---------------------------------------------------------------------
    // The original defect shape, and two more the first board named.
    // ---------------------------------------------------------------------
    {
      name: 'the original #9736 shape — err.message in a raw 500 body',
      code: `
        export async function GET() {
          try {
            return await load();
          } catch (err) {
            return NextResponse.json(
              { error: err instanceof Error ? err.message : 'Unknown error' },
              { status: 500 },
            );
          }
        }
      `,
      options: OPTIONS,
      errors: [{ messageId: 'rawResponseInCatch' }],
    },
    {
      name: 'Object.assign onto an outer body object names the body, not Object',
      code: `
        export async function GET() {
          const body: Record<string, unknown> = { error: 'Failed' };
          try {
            await load();
          } catch (err) {
            Object.assign(body, { details: err.message });
          }
          return createErrorResponse(500, 'Failed', { details: body });
        }
      `,
      options: OPTIONS,
      errors: [{ messageId: 'catchValueEscapes', data: { name: 'body' } }],
    },
    {
      name: 'JSON.stringify(err) through the sanctioned helper is still upstream text',
      code: `
        export async function GET() {
          try {
            return await load();
          } catch (err) {
            return createErrorResponse(500, JSON.stringify(err));
          }
        }
      `,
      options: OPTIONS,
      errors: [{ messageId: 'catchValueInResponseHelper' }],
    },
    {
      name: 'but a property VALUE reading the catch binding still reports',
      code: `
        export async function POST() {
          try {
            return await load();
          } catch (error) {
            return redactedJson({ error: error.message }, { status: 500 });
          }
        }
      `,
      options: OPTIONS,
      errors: [{ messageId: 'catchValueInResponseHelper' }],
    },
    {
      name: 'a catch nested inside a catch is scanned too',
      code: `
        export async function GET() {
          try {
            return await load();
          } catch (outer) {
            try {
              return createErrorResponse(500, 'Please try again.');
            } catch (inner) {
              return NextResponse.json({ error: inner.message }, { status: 500 });
            }
          }
        }
      `,
      options: OPTIONS,
      errors: [{ messageId: 'rawResponseInCatch' }],
    },

    // -----------------------------------------------------------------------
    // PASS 3. Every one of these was reproduced LINT-CLEAN against the shipped
    // rule by the review board, and every one is a one-line edit away from a
    // shape the suite already pinned. They are the evidence that a hand-written
    // dataflow rule cannot make this property certain — which is why the
    // guarantee now lives in `withEgressGuard`, and this rule is early feedback.
    // -----------------------------------------------------------------------
    {
      name: 'pass 3 — aliasing an outer Map into a catch-local const (const sink = cache)',
      code: `
        const cache = new Map<string, string>();
        export async function GET() {
          try {
            await load();
          } catch (err) {
            const sink = cache;
            sink.set('last', err.message);
          }
          return createErrorResponse(500, 'Please try again.');
        }
      `,
      options: OPTIONS,
      // Named for the binding it REACHES, not the alias: `cache` is what
      // outlives the request.
      errors: [{ messageId: 'catchValueEscapes', data: { name: 'cache' } }],
    },
    {
      name: 'pass 3 — aliasing the header bag of a locally-built response, then returning it',
      code: `
        export async function GET() {
          try {
            return await load();
          } catch (err) {
            const res = createErrorResponse(502, 'Upstream failed');
            const headers = res.headers;
            headers.set('X-Upstream-Detail', err.message);
            return res;
          }
        }
      `,
      options: OPTIONS,
      // The write taints what the alias resolves to, so the `return res`
      // reports. Nothing else on these lines can.
      errors: [{ messageId: 'catchValueReturned' }],
    },
    {
      name: 'pass 3 — aliasing the cookie jar of a locally-built response',
      code: `
        export async function GET() {
          try {
            return await load();
          } catch (err) {
            const res = createErrorResponse(502, 'Upstream failed');
            const jar = res.cookies;
            jar.set('lastError', err.message);
            return res;
          }
        }
      `,
      options: OPTIONS,
      errors: [{ messageId: 'catchValueReturned' }],
    },
    {
      name: 'pass 3 — a LOCAL alias of the raw constructor (const R = NextResponse)',
      code: `
        export async function GET() {
          const raw = await readUpstream();
          try {
            return await load();
          } catch {
            const R = NextResponse;
            return R.json({ error: 'failed', detail: raw }, { status: 502 });
          }
        }
      `,
      options: OPTIONS,
      errors: [{ messageId: 'rawResponseInCatch' }],
    },
    {
      name: 'pass 3 — a namespace import of the raw constructor (srv.NextResponse.json)',
      code: `
        import * as srv from 'next/server';
        export async function GET() {
          const raw = await readUpstream();
          try {
            return await load();
          } catch {
            return srv.NextResponse.json({ raw }, { status: 502 });
          }
        }
      `,
      options: OPTIONS,
      errors: [{ messageId: 'rawResponseInCatch' }],
    },
    {
      name: 'pass 3 — a `typeof err` read no longer suppresses the SITE ban',
      code: `
        export async function GET() {
          const raw = await readUpstream();
          try {
            return await load();
          } catch (err) {
            return NextResponse.json({ kind: typeof err, detail: raw }, { status: 502 });
          }
        }
      `,
      options: OPTIONS,
      errors: [{ messageId: 'rawResponseInCatch' }],
    },
    {
      name: 'pass 3 — a tagged template, this repo\'s documented DB-write idiom',
      code: `
        export async function GET() {
          try {
            return await load();
          } catch (err) {
            const sql = getNeonSql();
            await sql\`UPDATE jobs SET error = \${err.message}\`;
            return createErrorResponse(500, 'Please try again.');
          }
        }
      `,
      options: OPTIONS,
      errors: [{ messageId: 'catchValueToUnknownSink' }],
    },
    {
      name: 'pass 3 — a HOISTED function declaration launders the caught error',
      code: `
        export async function GET() {
          try {
            return await load();
          } catch (err) {
            function detail() {
              return err instanceof Error ? err.message : String(err);
            }
            return createErrorResponse(500, detail());
          }
        }
      `,
      options: OPTIONS,
      errors: [{ messageId: 'catchValueInResponseHelper' }],
    },
    {
      name: 'pass 3 — `yield` is a fifth way out of the scope',
      code: `
        export async function* stream() {
          try {
            yield await load();
          } catch (err) {
            yield String(err);
          }
        }
      `,
      options: OPTIONS,
      errors: [{ messageId: 'catchValueReturned' }],
    },
  ],
});
