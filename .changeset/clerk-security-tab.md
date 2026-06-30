---
"web": patch
---

Add a Security tab to the account settings page that mounts Clerk's prebuilt `<UserProfile routing="hash" />`, giving users self-serve access to MFA (authenticator app + backup codes), passkeys, and connected-account/device management (#8820). The tab inherits the app-level dark `appearance` and uses `routing="hash"` so Clerk's internal navigation stays scoped to the URL hash and cannot hijack the page's own `?tab=` query routing. Dormant-safe by default: the underlying factors only become enrollable once the owner toggles them in the Clerk Dashboard (no code change, $0 on the current plan), and with no Clerk keys the provider is not mounted so nothing renders. Bot protection is documented for the future real `<SignUp>` (the public route is currently a waitlist form). No dependency or `@clerk/nextjs` version change.
