---
"web": patch
---

`llms.txt` and `llms-full.txt`, and the site link at the end of the Terms and Privacy pages, now use `https://www.spawnforge.ai`, the canonical host, instead of the apex host that redirects to it. A test fails if either llms file links the apex host again.
