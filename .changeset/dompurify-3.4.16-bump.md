---
"web": patch
---

Raise the root `dompurify` override and lockfile entry to 3.4.16, which clears GHSA-p98j-92pf-mc4p (an IN_PLACE sanitize with a node-removing hook could leave detached subtrees with live event handlers) and brings in the 3.4.14–3.4.16 hardening, including the SVG `pointer-events` and `vector-effect` attribute allow-list addition. No app code imports dompurify, and neither consumer runs this copy at runtime: the Monaco editor uses its own vendored DOMPurify 3.2.7 and is loaded from a CDN, and PostHog's product-tours script, the only part of posthog-js that uses DOMPurify, is served from PostHog's own assets host with DOMPurify bundled. So this clears the audit advisory for the installed tree and changes no sanitizer the app runs.
