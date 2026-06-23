---
"web": patch
---

Harden the Clerk sign-in surface for MFA (TOTP), passkeys, and bot protection. These factors are enabled via Clerk Dashboard toggles (no new dependency — @clerk/nextjs 7.5.x already supports them); add a regression guard that the sign-in/sign-up route clients keep their `'use client'` boundary and render `<SignIn>` without an SSR 500 so a future refactor can't break a hardened login.
