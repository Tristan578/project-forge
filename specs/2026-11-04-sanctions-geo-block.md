# Spec: Sanctions geo-block

> **Status:** Policy decided by Tristan Nolan on 2026-11-04. Missing-header behaviour (§5) and the Balkans entry (§2.4) still need his call.
> **Date:** 2026-11-04
> **Ticket:** GH #9331
> **Milestone:** E6: Content Safety & Trust
> **Scope:** Refuse use of, and payment for, spawnforge.ai from sanctioned countries and regions, at the edge, from one config list.

**This is a policy list, not legal advice.** It records the owner's business decision and is deliberately broader than what US sanctions law requires of a US person. It does not replace screening customers against OFAC's SDN list, and it has not been reviewed by counsel.

---

## 1. Decision

Tristan's words, 2026-11-04: *"any OFAC/Sanctioned country should not be paying me for anything or using my products."* He named China, Russia and North Korea explicitly, and Belarus.

So the default list blocks:

- (a) every jurisdiction OFAC names as subject to broad ("comprehensive") sanctions;
- (b) Russia, Belarus and China, which he named;
- (c) every other country that has a country-based program on OFAC's Sanctions Programs page.

Every entry carries the program it comes from, so he can remove one he disagrees with.

## 2. Sources and the list

Both fetched 2026-11-04:

- OFAC, **Sanctions Programs and Country Information**: https://ofac.treasury.gov/sanctions-programs-and-country-information (36 active programs).
- OFAC **FAQ 10**, "What jurisdictions or countries are sanctioned by the United States?" (released 2018-05-21, updated 2026-10-26): https://ofac.treasury.gov/faqs/topic/1501. It names the broad-sanctions jurisdictions: Cuba, Iran, North Korea, and the Crimea, so-called Donetsk People's Republic and Luhansk People's Republic regions of Ukraine. It notes Russia faces narrower, category-based restrictions.

### 2.1 What changed against the request

- **Syria is not comprehensively sanctioned any more.** FAQ 10 does not name it among the broad-sanctions jurisdictions, and the programs page (re-checked 2026-11-04) lists no "Syria Sanctions" or "Syria-Related Sanctions" program. The only active program there tied to Syria is *Promoting Accountability for Assad and Regional Stabilization Sanctions (PAARSS)*, a targeted program named for Assad rather than for the country. Syria stays blocked under Tristan's "any sanctioned country" rule, labelled basis (c) with PAARSS as its program, and is not described anywhere in this change as comprehensively embargoed.
- **Ethiopia and Zimbabwe are not on the programs page,** so they are not on the list. Add them by hand if wanted.
- **Hong Kong** has its own program (*Hong Kong-Related Sanctions*) and its own ISO code (`HK`), so it is listed separately from China.

### 2.2 The list

`web/src/lib/security/sanctionsGeoBlock.ts` → `BLOCKED_JURISDICTIONS` is the source of truth. `sanctionsGeoBlock.test.ts` parses the table below and fails if the two disagree.

Country is ISO 3166-1 alpha-2. Region is the region part of ISO 3166-2, which is what Vercel's `x-vercel-ip-country-region` carries; `-` means the whole country.

<!-- geo-block-table:start -->
| Country | Region | Name | Basis | Program |
|---|---|---|---|---|
| CU | - | Cuba | ofac-comprehensive | OFAC FAQ 10; Cuba Sanctions |
| IR | - | Iran | ofac-comprehensive | OFAC FAQ 10; Iran Sanctions |
| KP | - | North Korea | ofac-comprehensive | OFAC FAQ 10; North Korea Sanctions |
| UA | 43 | Crimea region of Ukraine | ofac-comprehensive | OFAC FAQ 10; Ukraine-/Russia-related Sanctions (EO 13685) |
| UA | 40 | Sevastopol (Crimea region of Ukraine) | ofac-comprehensive | OFAC FAQ 10; Ukraine-/Russia-related Sanctions (EO 13685) |
| UA | 14 | Donetsk region of Ukraine | ofac-comprehensive | OFAC FAQ 10; Ukraine-/Russia-related Sanctions (EO 14065) |
| UA | 09 | Luhansk region of Ukraine | ofac-comprehensive | OFAC FAQ 10; Ukraine-/Russia-related Sanctions (EO 14065) |
| RU | - | Russia | owner-named | Russian Harmful Foreign Activities Sanctions; Ukraine-/Russia-related Sanctions |
| BY | - | Belarus | owner-named | Belarus Sanctions |
| CN | - | China | owner-named | Chinese Military Companies Sanctions |
| AF | - | Afghanistan | ofac-country-program | Afghanistan-Related Sanctions |
| MM | - | Burma (Myanmar) | ofac-country-program | Burma-Related Sanctions |
| CF | - | Central African Republic | ofac-country-program | Central African Republic Sanctions |
| CD | - | Democratic Republic of the Congo | ofac-country-program | Democratic Republic of the Congo-Related Sanctions |
| HK | - | Hong Kong | ofac-country-program | Hong Kong-Related Sanctions |
| IQ | - | Iraq | ofac-country-program | Iraq-Related Sanctions |
| LB | - | Lebanon | ofac-country-program | Lebanon-Related Sanctions |
| LY | - | Libya | ofac-country-program | Libya Sanctions |
| ML | - | Mali | ofac-country-program | Mali-Related Sanctions |
| NI | - | Nicaragua | ofac-country-program | Nicaragua-related Sanctions |
| SO | - | Somalia | ofac-country-program | Somalia Sanctions |
| SS | - | South Sudan | ofac-country-program | South Sudan-Related Sanctions |
| SD | - | Sudan | ofac-country-program | Sudan and Darfur Sanctions |
| SY | - | Syria | ofac-country-program | Promoting Accountability for Assad and Regional Stabilization Sanctions (PAARSS) |
| VE | - | Venezuela | ofac-country-program | Venezuela-Related Sanctions |
| YE | - | Yemen | ofac-country-program | Yemen-related Sanctions |
<!-- geo-block-table:end -->

Sevastopol (UA-40) is a separate ISO 3166-2 code from the Autonomous Republic of Crimea (UA-43) but lies on the peninsula, so it is listed to keep the Crimea entry from being defeated by a geolocation database that codes the city apart.

### 2.3 Programs on the page that are not country-based (not on the list)

Counter Narcotics Trafficking; Counter Terrorism; Countering America's Adversaries Through Sanctions Act; Cyber-Related; Foreign Interference in a United States Election; Global Magnitsky; Hostages and Wrongfully Detained U.S. Nationals; International Criminal Court-Related; Magnitsky; Non-Proliferation; Rough Diamond Trade Controls; Transnational Criminal Organizations. These target people and activities anywhere, not a place, so geo-blocking does not apply to them.

### 2.4 Open: Balkans-Related Sanctions (Tristan's call)

The programs page lists *Balkans-Related Sanctions* (EO 14140, EO 14033, EO 13219) but names no countries, and the page does not define "Western Balkans". It is **not on the list** until Tristan says which countries it means. An attempt to fetch the official definition from the eCFR (31 CFR part 588) and the Federal Register text of EO 14033 was not permitted in this session, so this spec does not assert a country list for it.

### 2.5 Open: other occupied regions of Ukraine

FAQ 10 names Crimea, Donetsk and Luhansk only. Zaporizhzhia (UA-23) and Kherson (UA-65) are not on the list. Tristan's call.

## 3. What a blocked visitor sees

- **Status 451** (Unavailable For Legal Reasons, RFC 7725), for every method.
- **Page request:** a plain, self-contained HTML page: "SpawnForge is not available in your region", one sentence saying we do not offer the service or accept payment in sanctioned countries and regions, and the support address already used on the site. No scripts, styles, fonts or images, so nothing else is fetched. `noindex`.
- **API request** (`/api` and below): `{"error":"This service is not available in your region.","code":"SANCTIONS_GEO_BLOCK"}`.
- **Headers:** `Cache-Control: private, no-store` (a geo-dependent answer must never be cached and served to another visitor), `Link: <https://www.spawnforge.ai>; rel="blocked-by"` (RFC 7725 §4), `X-Content-Type-Options: nosniff`.
- The page does not say which list entry matched or why. The decision is observable as a 451 in Vercel's request logs, with no personal content logged.

## 4. Where it runs

1. **`web/src/proxy.ts`, first.** `proxy()` calls `sanctionsGeoBlock(req)` before Clerk and before the published-game preflight, so a blocked visitor never reaches auth or the app. It covers every path the proxy matcher covers: all pages, all `/api` routes, and every `/play` URL. The matcher's static-file exclusion used to skip any path containing `.html`, `.js`, ... in any segment, so a dynamic page with an extension-shaped parameter (`/editor/abc.html`) never reached the proxy; it now skips only a single top-level segment (the files in `public/`), and `proxyGeoBlock.test.ts` checks every dynamic route and every public file against Next.js's own matcher compiler.
2. **Every payment route, again.** `/api/billing/checkout`, `/api/billing/portal`, `/api/tokens/purchase` and `/api/marketplace/assets/[id]/purchase` each call `sanctionsGeoBlock(req)` as their first statement, before BotID, auth, Stripe or the database. This holds the payment refusal even if a later change to the proxy matcher stops covering a payment path. `paymentGeoBlock.test.ts` derives the payment routes from the tree (mutating handler plus the Stripe client or a `purchase` directory), so a new one fails until it calls the check.

Not covered, by design: static files the matcher excludes (`/_next/*`, images, fonts, engine WASM). They carry no account, content or payment surface. Published-game assets served from the R2 CDN are outside this app and are not covered either.

## 5. Bypass rules

No country rule applies to these paths, matched as whole decoded path segments (`/api/healthz` and `/api/cron-admin` are **not** bypasses; malformed percent-encoding is never a bypass):

| Path | Why |
|---|---|
| `/api/health`, `/api/status` | Health probes and uptime checks; they must not fail because a probe region geolocates oddly. |
| `/api/stripe/webhook` | Stripe's servers; signature-verified. |
| `/api/auth/webhook` | Clerk's servers; signature-verified. |
| `/api/cron` | Vercel Cron; `CRON_SECRET`-authenticated. |
| `/api/webhooks/generation-complete` | QStash callback; signature-verified. |

## 6. Source of truth for location, and the missing header

Vercel's request headers (https://vercel.com/docs/headers/request-headers): `x-vercel-ip-country` is the ISO 3166-1 alpha-2 code for the requester's public IP; `x-vercel-ip-country-region` is up to three characters, the region part of ISO 3166-2 for the first-level region. Values are trimmed and upper-cased; a country that is not two letters is treated as missing.

**Missing header — Tristan's call.** The header is absent outside Vercel (local dev, CI, `next start`) and may be absent for an IP Vercel cannot geolocate.

- **Fail open (current default, `MISSING_COUNTRY_POLICY = 'allow'`):** local dev and CI keep working with no setup; a visitor Vercel cannot place is served. Recommended, because the header is present on Vercel for geolocated traffic and the other choice blocks real visitors on a lookup miss.
- **Fail closed (`'block'`):** a visitor Vercel cannot place gets the 451. Stricter, but would also 451 every local and CI request unless they inject a country header.

Changing it is a one-word edit to `MISSING_COUNTRY_POLICY`; the tests cover both values.

**Not verified:** whether Vercel overwrites a client-supplied `x-vercel-ip-country` header. Vercel's page documents that it overwrites `X-Forwarded-For` to prevent spoofing but says nothing either way about the geo headers. If it does not, a visitor could send `x-vercel-ip-country: US` to get past the block. A VPN gets past it regardless. Check by sending the header to a deployed route that echoes it, once one exists.

## 7. Limits

- IP geolocation is a good-faith control. A VPN, proxy or Tor exit outside the list is not stopped.
- It does not screen people. A sanctioned person outside these countries is not stopped by this; SDN screening is separate work.
- **Stripe checkout itself is not geo-restricted by this change.** Our API refuses to create a session from a blocked country, but a card issued in a blocked country used from elsewhere is Stripe's to refuse. A Stripe Radar rule on `:card_country:` would add that layer; it is a dashboard setting for Tristan, not part of this change.
- The list is in code. Changing it is a reviewed PR and a deploy, which is deliberate for a policy list. Issue #9331 asked for "configurable without a redeploy"; Edge Config could provide that later if Tristan wants it.
- **Scope is spawnforge.ai only.** `docs.spawnforge.ai` (`apps/docs`, its own Vercel project and proxy) and Tristan's other web properties are not covered by this PR; they need the same check, and a copy of the list kept in sync by test, in follow-up work.

## 8. Acceptance

- A request with a listed country (or listed country and region) gets 451 from the proxy before auth, on pages and APIs.
- The four payment routes answer 451 for a listed country before BotID, auth, Stripe or the database, and run normally for an unlisted one.
- Bypass paths are never blocked; near-miss paths are.
- Ukraine outside the listed regions is not blocked; Ukraine with region `43`, `40`, `14` or `09` is.
- The list in code and the table above agree, and every entry has a basis and a program.
- Review: re-check both OFAC sources and update §2 and `SANCTIONS_POLICY_LAST_REVIEWED` whenever a program is added or removed, and at least every six months.
