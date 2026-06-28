# PF-910 (#8820) — Clerk MFA (TOTP) + Passkeys + Bot-Protection Discoverability

## Summary

The MFA/passkey enrollment UI is fundamentally Clerk Dashboard configuration (zero
code) PLUS one genuine code improvement: make Clerk's prebuilt **Security** UI
**discoverable** from SpawnForge's own `/settings` page.

Clerk's `<UserProfile>` component auto-renders a Security section — Two-step
verification (TOTP authenticator app + backup codes) and Passkeys — once the
corresponding Clerk Dashboard toggles are enabled. Today that UI is only reachable
through the small `<UserButton>` avatar menu in the dashboard/editor chrome. This
feature surfaces it directly as a tab on the settings page.

## Approach

Add a **Security** tab to `web/src/components/settings/SettingsPage.tsx` that renders
Clerk's `<UserProfile routing="hash" />`, reusing the file's existing `?tab=` URL-sync
and accessible tab-nav patterns, and inheriting the dark theme from the app-level
`<ClerkProvider appearance={{ theme: dark }}>`.

- `routing="hash"` keeps Clerk's internal Profile/Security navigation inside the URL
  hash, so it does not fight SpawnForge's own `?tab=` query-param routing or trigger a
  Next.js route mismatch (the page is not a Clerk catch-all route).
- The tab is added to the existing `TABS` array, so it automatically inherits the
  same `<button>` rendering, `aria-current="page"` active marker, desktop sidebar +
  mobile horizontal layouts, and the `handleTabChange` URL-sync — no bespoke nav code.

This is the only required code change.

### Out of scope (deliberately NOT changed)

- `web/src/app/layout.tsx` — NO change. `<ClerkProvider appearance={{ theme: dark }}>`
  (~line 135) is inherited by `<UserProfile>`. **Never reintroduce `baseTheme`** — Clerk
  7.5 removed it (would break tsc / visual regression).
- `web/src/proxy.ts` — NO change. Forcing MFA at the proxy/middleware layer is a product
  decision, out of scope.
- `web/src/app/sign-up/[[...sign-up]]/SignUpClient.tsx` — NO change. **Nuance:**
  `/sign-up` is a SpawnForge **waitlist** form, NOT Clerk's `<SignUp/>` component, so
  Clerk Dashboard bot-protection on sign-up is inert today. Enabling bot protection in
  the dashboard is future-proofing only (it activates if/when the real Clerk `<SignUp/>`
  is adopted).
- No `@clerk/nextjs` version bump. It is override-pinned to `^7.5.7`
  (`@clerk/shared ^4.14.0`) in the ROOT `package.json`; bumping is blocked by #8856.
  7.5.7 already supports MFA/passkeys.

### Optional / nice-to-have (skip if it risks budget)

- `web/src/components/settings/SettingsPanel.tsx` — the in-editor settings dialog has its
  own `TAB_ORDER`; a matching Security tab is parity-only. The `SettingsPage` tab is the
  acceptance criterion.

## Integration points (exact files)

1. `web/src/components/settings/SettingsPage.tsx` — PRIMARY. Add `'security'` to the `Tab`
   union + `TABS` array (icon: `Shield`), render `<UserProfile routing="hash" />` in
   `renderContent()`. Must be a `'use client'` file (it already is).
2. `web/src/components/settings/__tests__/SettingsPage.test.tsx` — add unit coverage for
   the Security tab: mock `@clerk/nextjs` `<UserProfile>` (mirroring how
   `DashboardLayout`/`EditorLayout` tests mock `<UserButton>`); assert the tab renders,
   switches `activeTab`, syncs `?tab=security`, and exposes `aria-current` matching the
   existing tabs.

## External prerequisites (NOT a code task — activation runbook)

These are toggled once in the Clerk Dashboard (org owner). All $0 on the current Clerk
Pro plan. Live keys are needed to E2E the actual enrollment flow (CI runs in Clerk
passthrough mode and cannot exercise enrollment).

1. **User & Authentication → Multi-factor**: enable **Authenticator application (TOTP)**
   and **Backup codes**.
2. **User & Authentication → Passkeys**: enable Passkeys.
3. **Attack protection → Bot protection**: enable (future-proofing; inert until the real
   Clerk `<SignUp/>` replaces the waitlist form).

Once toggled, the Security tab's `<UserProfile>` automatically renders the Two-step
verification and Passkeys management UI — no further code change.

## Test plan

- **Unit (vitest/RTL):** the Security-tab cases above. `@clerk/nextjs` is mocked because
  CI/E2E run in Clerk passthrough mode (no keys → `<ClerkProvider>` not mounted).
- **Regression:** `proxy.ts` and `SignUpClient.tsx` are untouched, so
  `web/src/__tests__/proxy.test.ts` and `SignUpClient.test.tsx` stay green.
- **Gate (Node 24):** `npx eslint --max-warnings 0 .` + `npx tsc --noEmit` + targeted
  `npx vitest run` on the touched settings test(s).
