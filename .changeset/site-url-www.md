---
"web": patch
---

The site URL now falls back to https://www.spawnforge.ai instead of https://spawnforge.ai. Production redirects the apex host to www, so canonicals, sitemap entries and the robots sitemap line were pointing at a URL that redirects, which Search Console reports as an alternate or duplicate page. The nine marketing files that each declared their own copy of the fallback now import the one `SITE_URL` constant, so the host is set in one place.
