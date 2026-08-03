---
"web": patch
---

fix(marketing): remove fabricated testimonials and the user-count claim from the landing page (PF-1020, #9040)

SpawnForge is waitlist-only — every CTA on the page reads "Join the Waitlist" — yet the page published three named endorsements with invented job titles and a "Join thousands of creators" line. Both described users who do not exist.

- Deletes the `testimonials` data array and the entire social-proof section.
- Replaces the two tests that asserted the content was present with structural guards: no `blockquote`/`figcaption` endorsement markup, no "trusted by"/"loved by" heading, and no unverifiable population claim anywhere in the rendered text.
