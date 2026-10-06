---
"web": patch
---

Update `sharp`, the image-optimisation backend behind Next.js image handling, from 0.35.4 to 0.35.5 (with its bundled libvips moving to 1.3.4) so the npm audit gate passes again. 0.35.5 fixes GHSA-wq5f-xc86-pv6w, a vulnerability in the librsvg library that sharp ships inside its platform binaries (CVE-2026-96889). The bump stays inside the range `web/package.json` already declares, so this is a lockfile-only change: no manifest moves and no application code changes.
