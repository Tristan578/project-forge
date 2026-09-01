/**
 * The exact PostHog origins this deployment talks to, and the single source of
 * truth for both `posthog.init()` and the Content-Security-Policy.
 *
 * There are TWO of them, which is the whole reason this module exists.
 * posthog-js sends ingest traffic to `api_host`, but every bundle it loads
 * lazily — the session recorder, surveys, exception autocapture, web vitals,
 * and the remote-config script that decides whether any of those load at all —
 * is fetched from a separate ASSETS host. `requestRouter.endpointFor('assets',
 * …)` derives that host from `api_host` (`us` → `us-assets.i.posthog.com`)
 * whenever `config.asset_host` is unset, so admitting only the ingest origin in
 * `script-src` blocks every one of those bundles. Nothing surfaces it: the
 * blocked load is a CSP violation in the console and an analytics feature that
 * simply never reports — the same silent failure #9047 was filed for.
 *
 * `initPostHog` sets BOTH hosts explicitly from these constants, so the pair
 * below is the library's whole request surface as a stated contract rather than
 * a standing bet on its internal region derivation. Changing one host without
 * the other is what this module exists to make impossible.
 *
 * Lives under `security/` rather than `analytics/` because `csp.ts` is imported
 * by `next.config.ts` through a RELATIVE path (the `@/` alias is not resolved
 * there), and a shared constant has to be reachable from both sides.
 */

/** Ingest: `/e/`, `/decide/`, `/flags/`. Set as posthog-js `api_host`. */
export const POSTHOG_API_ORIGIN = 'https://us.i.posthog.com';

/** Lazily-loaded bundles and remote config. Set as posthog-js `asset_host`. */
export const POSTHOG_ASSET_ORIGIN = 'https://us-assets.i.posthog.com';

/** Every PostHog origin the browser may contact, for CSP source lists. */
export const POSTHOG_ORIGINS = [POSTHOG_API_ORIGIN, POSTHOG_ASSET_ORIGIN] as const;
