/**
 * The "Last updated" line each legal page renders.
 *
 * One source for the page and for the E2E spec that checks it
 * (e2e/tests/public-pages.spec.ts), so editing a policy's date cannot leave
 * the spec asserting the old one (lessons-learned #18). Plain strings with no
 * imports, so the Playwright runner can load this without React or Next.
 */
export const TERMS_LAST_UPDATED = 'February 27, 2026';
export const PRIVACY_LAST_UPDATED = 'November 4, 2026 (draft, pending legal review)';
