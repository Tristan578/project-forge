---
"web": patch
---

Update DOMPurify to 3.4.16, which fixes a DOM XSS issue where a node-removing afterSanitize hook could leave detached subtrees with live event handlers when sanitizing IN_PLACE (GHSA-p98j-92pf-mc4p), plus two further IN_PLACE sanitization fixes and a CommonJS typings fix. The editor pulls DOMPurify in through the Monaco code editor and the PostHog analytics SDK, and the root package.json override now requires 3.4.16 or newer.
