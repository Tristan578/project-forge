---
"web": minor
---

Deliver the waitlist that every marketing CTA promises: /sign-up now renders an accessible email-capture form (idle/submitting/success/error states, aria-live status region, hidden honeypot) instead of a mailto dead end, backed by a new public POST /api/waitlist route (IP rate limited, strict server-side email validation with trim+lowercase normalization, honeypot short-circuit, and duplicate-safe inserts via onConflictDoNothing on the new waitlist_signups table's unique email index — migration 0007). Sign-ups themselves remain disabled; this is lead capture only.
