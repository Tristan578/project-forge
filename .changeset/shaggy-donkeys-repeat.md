---
"web": patch
---

Make the crawl policy actually block what it says it blocks, and make the docs
site's crawler surfaces reachable.

A robots.txt `Disallow` value is a plain prefix match, not a path-segment match,
so `Disallow: /admin/` never matches the canonical URL `/admin` — only things
beneath it. Every private entry in the web app's `robots.ts` carried a trailing
slash, which left `/dev` (the auth-bypass route), `/settings`, `/health` and
`/api-docs` crawlable at exactly the URL each entry was written to block.
Dropping the slash matches both the bare path and its subtree. `/api/` keeps its
slash deliberately: there is no bare `/api` page to miss.

The docs deployment now publishes a robots.txt of its own, declaring the two
surfaces reachable without a session (`/` and `/mcp`) and the auth-gated ones
that are not. Both it and the existing sitemap read a single shared `DOCS_URL`,
so a robots.txt advertising a sitemap at one origin while the sitemap declares
its URLs at another is no longer possible.

That robots.txt was unreachable as written: the docs proxy gates every path its
matcher covers, and neither `/robots.txt` nor `/sitemap.xml` was listed as
public, so a crawler fetching either received a redirect to sign-in — the same
defect class already fixed on the web app. Both are public now, and the four
bare `X(.*)` public-route patterns are tightened to an exact path plus an
explicit `/(.*)` subtree, so a future sibling that merely shares a name prefix
(`/sign-internal`, `/mcpadmin`) cannot become public by spelling.
