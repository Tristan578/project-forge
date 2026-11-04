---
"web": patch
---

Upgrade Next.js to 16.4.3 (with `eslint-config-next` and `@next/bundle-analyzer` aligned to 16.4.3) and relock the dependencies that `npm audit` flagged at high or critical severity, so the audit gate passes again. Next.js 16.3.8 was inside the affected range (16.0.0 to 16.4.0, fixed in 16.4.1) of two critical advisories: GHSA-673q-mjm6-r5xr, remote code execution in `use cache` functions that return multiple typed arrays, and GHSA-2464-fhr4-w9xw, remote code execution in Image Optimization through an upstream library. It was also inside the range of GHSA-p3m5-59mp-jv5r, a Server Actions denial of service (this app defines no Server Actions). The same change raises DOMPurify to 3.4.17, undici to 8.12.3, zod to 4.6.7, vite to 8.3.5, Storybook to 10.6.2, body-parser to 2.4.0 and launch-editor to 2.14.2. `@vercel/config`'s nested zod 3 copy, for which no patched 3.x release exists, now resolves to the root zod 4.6.7 through a root override; its only zod use is a cron-string check that behaves the same on zod 4.

Next.js 16.4 removed `experimental.appNewScrollHandler`, which already defaulted to true in 16.3, so the option is dropped from `next.config.ts`. Keeping it failed type-checking and `next build`. Scroll restoration behaviour does not change.
