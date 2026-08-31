/**
 * Canonical hrefs for the /settings tabs.
 *
 * /settings is a SINGLE route whose sections are tabs, selected by a `?tab=`
 * query param that `SettingsPage` reads at mount and validates against its tab
 * ids. There are no nested `/settings/<section>` routes — `web/src/app/settings/`
 * contains only `page.tsx` and `error.tsx`. Four call sites had invented some
 * anyway (`/settings/billing` x3, `/settings/api-keys`), all of which 404'd
 * (#9046), and two of them were the buy-tokens and BYOK exits of the
 * deliberately non-dismissible TokenDepletedModal.
 *
 * These constants exist so the tab slugs live in one place. The API-keys slug in
 * particular is a trap: the tab id is `keys`, while its LABEL is "API Keys".
 * Because SettingsPage silently falls back to the Profile tab for an
 * unrecognised `?tab=` value, `?tab=api-keys` does not error — it renders the
 * wrong tab and looks like it worked. Import from here instead of hand-writing
 * the query string.
 */

/** Billing tab — plan, payment method, token packs. */
export const SETTINGS_BILLING_HREF = '/settings?tab=billing';

/** API Keys tab (BYOK). Note the slug is `keys`, not `api-keys`. */
export const SETTINGS_KEYS_HREF = '/settings?tab=keys';
