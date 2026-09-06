/**
 * @vitest-environment node
 *
 * RuleTester coverage for `spawnforge/no-raw-response-in-catch` (#9736).
 *
 * This file replaces a hand-rolled regex detector that a review board defeated
 * with eleven ordinary shapes in one sitting. Every one of those eleven is an
 * `invalid` case below, named with the shape it represents, so the claim "this
 * is caught now" is checkable rather than asserted.
 *
 * The regex detector is deleted rather than kept alongside this. A weaker
 * second gate over the same property is not defence in depth — it is a green
 * check that reads as coverage while proving nothing (lessons-learned #11).
 */
import { RuleTester } from 'eslint';
import tsParser from '@typescript-eslint/parser';
import { describe, it } from 'vitest';

import rule from '../../../../eslint-rules/no-raw-response-in-catch.mjs';

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

/** Matches the options the flat config passes in `web/eslint.config.mjs`. */
const OPTIONS = [
  {
    clientSafeErrors: ['ApiKeyError', 'PromptRejectedError'],
    responseHelpers: ['apiError', 'createErrorResponse', 'redactedJson'],
  },
];

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
            return createErrorResponse(500, 'Please try again.');
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
  ],

  invalid: [
    // ---------------------------------------------------------------------
    // The eleven shapes the review board used to walk through the old
    // regex detector. Each is the natural way a developer writes it.
    // ---------------------------------------------------------------------
    {
      name: 'bypass 1/11 — err.toString()',
      code: `
        export async function GET() {
          try {
            return NextResponse.json(await load());
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
            return NextResponse.json(await load());
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
            return NextResponse.json(await load());
          } catch (err) {
            if (err instanceof ApiKeyError) {
              return apiError(402, err.message, err.code);
            }
            return apiError(500, err.message);
          }
        }
      `,
      options: OPTIONS,
      // Precisely the board's blocker: the old detector exempted the
      // fall-through because it sat within 400 characters of the narrowing
      // `if`. The exemption here is scoped to the narrowed BRANCH, so the
      // first return is clean and the second is reported.
      errors: [{ messageId: 'catchValueInResponseHelper' }],
    },
    {
      name: 'bypass 4/11 — const { message } = err',
      code: `
        export async function GET() {
          try {
            return NextResponse.json(await load());
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
            return NextResponse.json(await load());
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
            return NextResponse.json(await load());
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
      name: 'bypass 7/11 — a header set on the response after construction',
      code: `
        export async function GET() {
          try {
            return NextResponse.json(await load());
          } catch (err) {
            const res = NextResponse.json({ error: 'Failed' }, { status: 500 });
            res.headers.set('X-Upstream-Error', err.message);
            return res;
          }
        }
      `,
      options: OPTIONS,
      errors: [{ messageId: 'rawResponseInCatch' }],
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
          return NextResponse.json({ error: message }, { status: 500 });
        }
      `,
      options: OPTIONS,
      // The response is outside the catch, so rule 1 cannot see it. Rule 2
      // closes the door the value walked through.
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
          return NextResponse.json({ error: parts.join(' ') }, { status: 500 });
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
            return NextResponse.json(await load());
          } catch (err) {
            return new Response(String(err), { status: 500 });
          }
        }
      `,
      options: OPTIONS,
      errors: [{ messageId: 'rawResponseInCatch' }],
    },

    // ---------------------------------------------------------------------
    // The original defect shape, and two more the board named.
    // ---------------------------------------------------------------------
    {
      name: 'the original #9736 shape — err.message in a raw 500 body',
      code: `
        export async function GET() {
          try {
            return NextResponse.json(await load());
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
      name: 'Object.assign onto an outer body object',
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
      errors: [{ messageId: 'catchValueEscapes', data: { name: 'Object' } }],
    },
    {
      name: 'JSON.stringify(err) through the sanctioned helper is still upstream text',
      code: `
        export async function GET() {
          try {
            return NextResponse.json(await load());
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
            return NextResponse.json(await load());
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
            return NextResponse.json(await load());
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
  ],
});
