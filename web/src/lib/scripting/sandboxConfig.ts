/**
 * Script isolation mode (#8700) — the single source of truth for which
 * transport runs user-authored game scripts in the editor.
 *
 * | mode               | what runs the script                                             |
 * |--------------------|------------------------------------------------------------------|
 * | `revoke` (default) | a same-origin module Worker; `revokeNetworkGlobals()` is the     |
 * |                    | primary control (enumerate-and-revoke, today's behaviour)        |
 * | `sandboxed-origin` | the same worker code, booted as a `blob:` Worker inside an       |
 * |                    | `allow-scripts`-only (null-origin) iframe whose own CSP is       |
 * |                    | `connect-src 'none'` — see `sandboxOrigin.ts`                     |
 * | `ast`              | reserved for an AST interpreter (Option B). NOT IMPLEMENTED:     |
 * |                    | resolves to `sandboxed-origin` with a visible notice             |
 *
 * ## Why the flag is read HERE, and only as a literal member expression
 *
 * Next.js inlines `process.env.NEXT_PUBLIC_*` at build time ONLY when it is
 * written as a fully-qualified member expression. An aliased read
 * (`const env = process.env; env.NEXT_PUBLIC_...`) or an injected env object
 * reaches the browser's `process` shim, whose `env` is `{}` — so the flag would
 * silently read `undefined` in every production build. That failure is invisible
 * to vitest (which has a real `process.env`), so
 * `__tests__/sandboxConfig.test.ts` pins the SOURCE SHAPE of this function.
 *
 * The flag is resolved on the main thread (`useScriptRunner`), never inside
 * `scriptWorker.ts`: the worker bundle has no `process.env` at all.
 *
 * Exact-string opt-in. Any value other than the literal strings
 * `'sandboxed-origin'` or `'ast'` — unset, empty, `'TRUE'`, `'1'`, a typo —
 * yields `'revoke'`, so a misconfiguration can never change behaviour silently.
 */

export type ScriptIsolationMode = 'revoke' | 'sandboxed-origin' | 'ast';

/** The two transports that exist today. `ast` has no transport of its own yet. */
export type ScriptTransport = 'revoke' | 'sandboxed-origin';

export const DEFAULT_SCRIPT_ISOLATION_MODE: ScriptIsolationMode = 'revoke';

/** Parse a raw flag value. Exported for the flag-parse table; callers use {@link getScriptIsolationMode}. */
export function parseScriptIsolationMode(raw: string | undefined): ScriptIsolationMode {
  if (raw === 'sandboxed-origin') return 'sandboxed-origin';
  if (raw === 'ast') return 'ast';
  return DEFAULT_SCRIPT_ISOLATION_MODE;
}

/**
 * The configured mode. Reads `NEXT_PUBLIC_SCRIPT_ISOLATION` as a literal member
 * expression — do not alias it, destructure it, or pass `process.env` in.
 */
export function getScriptIsolationMode(): ScriptIsolationMode {
  return parseScriptIsolationMode(process.env.NEXT_PUBLIC_SCRIPT_ISOLATION);
}

export interface ResolvedScriptTransport {
  transport: ScriptTransport;
  /**
   * Set when the requested mode could not be honoured as asked. Shown to the
   * game creator in the script console, so it is plain language: no flag name,
   * no mode name, no issue number. The technical account is {@link noticeDetail}.
   */
  notice?: string;
  /** The developer-facing account of {@link notice}, for the browser devtools only. Set whenever `notice` is. */
  noticeDetail?: string;
}

/** The script-console text for `ast`. Exported so the creator-facing wording is tested, not restated. */
export const AST_FALLBACK_NOTICE =
  "Advanced script isolation isn't available yet, so your scripts are running in the standard sandbox. " +
  'Your game is not affected.';

/**
 * Map a mode onto a transport that exists.
 *
 * `ast` resolves UP to `sandboxed-origin`, never down to `revoke`: an operator
 * who opted into a stronger boundary must not silently get the weaker one. The
 * notice says so, so the fallback is visible rather than implied — in plain
 * words to the creator, and with the mode and issue in the devtools detail.
 */
export function resolveScriptTransport(mode: ScriptIsolationMode): ResolvedScriptTransport {
  switch (mode) {
    case 'sandboxed-origin':
      return { transport: 'sandboxed-origin' };
    case 'ast':
      return {
        transport: 'sandboxed-origin',
        notice: AST_FALLBACK_NOTICE,
        noticeDetail:
          "NEXT_PUBLIC_SCRIPT_ISOLATION='ast' is not implemented yet (#8700 Option B); " +
          'running scripts in the sandboxed-origin transport instead.',
      };
    case 'revoke':
    default:
      return { transport: 'revoke' };
  }
}
