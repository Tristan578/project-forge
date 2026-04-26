---
"spawnforge": patch
---

fix(seo): filter for status='published' in /play/[userId]/[slug] generateMetadata

The standalone `generateMetadata` query on `/play/[userId]/[slug]/page.tsx` did not filter for `status = 'published'`, so a request for an unpublished/draft game with a known slug returned the draft's title and description in the HTML `<title>` and `<meta>` tags even though the page body itself was correctly gated. Consolidated `generateMetadata` and the page-level `getGameData` into a single `React.cache`-memoized helper that always filters on published status.
