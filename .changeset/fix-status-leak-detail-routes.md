---
"web": patch
---

Stop the marketplace asset detail (`/api/marketplace/assets/[id]`) and community game detail (`/api/community/games/[id]`) endpoints from leaking non-public records. Both detail routes fetched by `id` with no status constraint, so draft/pending/rejected/removed assets and processing/unpublished/removed games were exposed to anyone who knew (or guessed) an id — diverging from the list routes, which already filter to `status = 'published'`. The detail queries now apply the same `status = 'published'` filter and return 404 for anything else, so a record's existence is not disclosed.
