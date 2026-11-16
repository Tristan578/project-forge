# Spec: Sanctions purchase block

> **Status:** List policy decided by Tristan Nolan on 2026-11-04; scope narrowed by him on 2026-11-16 to sales and licences only (§1.1).
> **Date:** 2026-11-04 (scope revised 2026-11-16)
> **Ticket:** GH #9331
> **Milestone:** E6: Content Safety & Trust
> **Scope:** Refuse to sell or license anything on spawnforge.ai to a buyer in a sanctioned country or region, from one config list. Site content stays open to every country.

**This is a policy list, not legal advice.** It records the owner's business decision and is deliberately broader than what US sanctions law requires of a US person. It does not replace screening customers against OFAC's SDN list, and it has not been reviewed by counsel.

---

## 1. Decision

Tristan's words, 2026-11-04: *"any OFAC/Sanctioned country should not be paying me for anything or using my products."* He named China, Russia and North Korea explicitly, and Belarus.

So the list covers:

- (a) every jurisdiction OFAC names as subject to broad ("comprehensive") sanctions;
- (b) Russia, Belarus and China, which he named;
- (c) every other country that has a country-based program on OFAC's Sanctions Programs page.

Every entry carries the program it comes from, so he can remove one he disagrees with.

### 1.1 Scope: sales and licences only (Tristan, 2026-11-16)

*"I'm okay with anyone seeing my site content. What I don't want is to SELL/license anything to someone in these countries."*

So no page, `/play` URL or read-only API request is refused by country. What is refused is a purchase: starting a Checkout for a paid plan or a token pack, opening the billing portal where plans can be switched, buying (licensing) a marketplace asset, and, at fulfilment, granting a paid plan, tokens or paid entitlements to a buyer whose Stripe billing country is listed. The list itself (§2.2) is unchanged by this decision: one merged list for every site, 22 countries and six Ukrainian regions.

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
| UA | 23 | Zaporizhzhia region of Ukraine | owner-named | EU Council Regulation (EU) 2022/263, extended by (EU) 2022/1903 |
| UA | 65 | Kherson region of Ukraine | owner-named | EU Council Regulation (EU) 2022/263, extended by (EU) 2022/1903 |
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

### 2.4 Decided: Balkans-Related Sanctions, no countries (Tristan, 2026-11-16)

The programs page lists *Balkans-Related Sanctions* (EO 14140, EO 14033, EO 13219) but names no countries, and the page does not define "Western Balkans". Tristan picked one merged list for every site (the 22 countries and six Ukrainian regions in §2.2) with no Balkans countries, so it is **not on the list**. An attempt to fetch the official definition from the eCFR (31 CFR part 588) and the Federal Register text of EO 14033 was not permitted in this session, so this spec does not assert a country list for it.

### 2.5 Decided: Zaporizhzhia and Kherson (Tristan, 2026-11-05)

FAQ 10 names Crimea, Donetsk and Luhansk only, so OFAC does not require blocking Zaporizhzhia (UA-23) or Kherson (UA-65). The EU restricts the non-government-controlled areas of both (Council Regulation (EU) 2022/263, extended to them by Regulation (EU) 2022/1903 from 2022-10-07; https://finance.ec.europa.eu/publications/donetsk-kherson-luhansk-and-zaporizhzhia-oblasts_en). Tristan may sell in the EU, so both are on the list as `owner-named`. IP geolocation reports the oblast, not the front line, so the whole oblast is blocked, including the Ukrainian-held cities of Zaporizhzhia and Kherson.

## 3. What a refused buyer sees

- **Up front** (a purchase route, when a known signal is listed): **status 451** (Unavailable For Legal Reasons, RFC 7725) with `{"error":"Purchases are not available in your region.","code":"SANCTIONS_GEO_BLOCK"}`, `Cache-Control: private, no-store`, `Link: <https://www.spawnforge.ai>; rel="blocked-by"` and `X-Content-Type-Options: nosniff`. The body does not say which entry or which signal matched.
- **At fulfilment** (the Stripe webhook, when the billing address or card is listed): nothing is granted, the payment is refunded in full (a subscription is also cancelled), and a warning is logged to the console and Sentry Logs with the country/region code, the signal and the Stripe ids only. The buyer sees the refund from Stripe; the site sends no message of its own.
- Every page, `/play` URL and read-only API answers as normal, from any country.

## 4. Where it runs

1. **Purchase routes, first statement.** `sanctionsPurchaseBlock(req)` in `web/src/lib/security/sanctionsGeoBlock.ts`, before BotID, auth, Stripe or the database:
   - `/api/billing/checkout` (paid-plan subscription),
   - `/api/tokens/purchase` (token pack),
   - `/api/marketplace/assets/[id]/purchase` (issues a licence to an asset; paid in tokens, so the IP is the only signal there; free assets included, since claiming one records a licence),
   - `/api/billing/portal`, except its cancel flow (§7).
   `paymentGeoBlock.test.ts` derives these routes from the tree (a mutating handler that imports the Stripe client or sits under a `purchase` directory, minus the bypass paths), so a new one fails until it calls the check.
2. **Checkout collects the address.** Both Checkout Session builders set `billing_address_collection: 'required'`, and `customer_update.address: 'auto'` wherever the session has a `customer` (always for a subscription; for a token pack only when the user already has a Stripe customer), so the address is saved on the customer for the later subscription events.
3. **Stripe webhook, before any grant** (`web/src/lib/billing/sanctionsFulfilment.ts`, called from `web/src/app/api/stripe/webhook/route.ts`):
   - `checkout.session.completed`, mode `payment` (token pack): if `customer_details.address` or the card's issuing country (`latest_charge.payment_method_details.card.country`) is listed, no tokens are credited and the PaymentIntent is refunded.
   - `checkout.session.completed`, mode `subscription`: if `customer_details.address` is listed, the subscription is cancelled and every paid payment on its first invoice refunded. The resulting `customer.subscription.deleted` reverts the user to the free tier as for any cancellation.
   - `customer.subscription.created`: no plan is granted when the customer's saved address is listed.
   - `customer.subscription.updated`: an upgrade (more monthly tokens than the current tier) is not applied when the saved address is listed. Downgrades, cancellations and status changes always apply.
   - `entitlements.active_entitlement_summary.updated`: a non-empty feature set is not stored when the saved address is listed; an empty one always is.
   - `charge.refunded`: a charge refunded under this policy carries the metadata key `spawnforge_sanctions_refund`, set on the charge before the refund, and claws nothing back, because nothing was granted. (Without the mark, the fallback in `reverseAddonTokens` would take the buyer's existing addon tokens.)
   Refunds use the Stripe idempotency key `sanctions-refund:<payment_intent>`, and an already-refunded charge counts as done, so a redelivered event is safe. Any other refund or cancel failure answers 500 and releases the event, so Stripe redelivers it.

Not covered, by design: pages, `/play`, read-only APIs, static files. The proxy runs no country check.

**Proxy matcher fix (independent, kept).** The same PR anchored the proxy matcher's static-file exclusion to a single top-level segment (it used to skip any path with `.html`, `.js`, ... in any segment, so `/editor/abc.html` rendered with no auth redirect and no client-header stripping) and excluded `/_vercel/*` by prefix. That fix does not depend on the country check; `proxyGeoBlock.test.ts` keeps checking every dynamic route and every public file against Next.js's own matcher compiler, and that the proxy forwards every page and API from a listed country.

## 5. Bypass rules

`GEO_BLOCK_BYPASS_PATHS` is never refused by country, matched as whole decoded path segments (`/api/healthz` and `/api/cron-admin` are **not** bypasses; malformed percent-encoding is never a bypass). With no site-wide block it guards against one of these ever calling the purchase check, and keeps the Stripe webhook out of the derived purchase-route set.

| Path | Why |
|---|---|
| `/api/health`, `/api/status` | Health probes and uptime checks. |
| `/api/stripe/webhook` | Stripe's servers; signature-verified. Checks the billing address itself (§4.3). |
| `/api/auth/webhook` | Clerk's servers; signature-verified. |
| `/api/cron` | Vercel Cron; `CRON_SECRET`-authenticated. |
| `/api/webhooks/generation-complete` | QStash callback; signature-verified. |

## 6. Country sources, and an unknown country

A buyer is refused when **any known signal** places them in a listed jurisdiction. In order of preference:

1. **Stripe billing country.** At fulfilment: the Checkout Session's `customer_details.address.country` (and `state`, for the Ukrainian regions), the customer's saved `address`, and for a token pack the card's issuing country. Up front the routes hold no address (the database stores only the Stripe customer id), so the saved address is checked at fulfilment, not before Checkout.
2. **Vercel IP geolocation.** `x-vercel-ip-country` (ISO 3166-1 alpha-2) and `x-vercel-ip-country-region` (the region part of ISO 3166-2), https://vercel.com/docs/headers/request-headers.

Values are trimmed and upper-cased; a country that is not two letters is treated as unknown. A Stripe `state` is read as a region code (`43`, `UA-43`) or, for Ukraine, by name (Crimea/Krym, Sevastopol, Donetsk, Luhansk/Lugansk, Zaporizhzhia/Zaporozhye, Kherson).

**Unknown country: not refused (Tristan, 2026-11-16).** A missing or malformed IP header no longer refuses anyone (the 2026-11-05 fail-closed decision applied to the whole site and is superseded): refusing every buyer Vercel cannot place risks refusing every buyer. Instead Checkout requires the billing address and the webhook refuses a listed one (§4). A Stripe lookup that fails (customer or PaymentIntent unreadable) also counts as unknown and is reported to Sentry; the Checkout Session's own address needs no lookup, so a listed buyer is still caught there.

**Not verified:** whether Vercel overwrites a client-supplied `x-vercel-ip-country`. If not, a buyer could send `US` to pass the up-front check; the billing-address check at fulfilment still applies. A VPN gets past the IP check regardless.

## 7. Billing portal

The portal is configured (Dashboard, or `STRIPE_PORTAL_CONFIGURATION_ID`) to allow plan switching across the tiers (`web/src/lib/billing/portal-config.ts`), so it can start an upgrade, which is a sale. Decision:

- A customer whose IP is listed is refused the portal's home page (451).
- The cancel deep link (`POST /api/billing/portal?flow=cancel`, `flow_data.type = subscription_cancel`) stays open to every country, so an existing customer can always cancel. If the user has no subscription id, the deep link would be dropped and the portal would open on its home page, so that case is refused too.
- Backstop: an upgrade made in the portal is not applied by the webhook when the customer's saved address is listed (§4.3).

**Not verified:** whether a customer inside the cancel flow can navigate to the portal home page and switch plans there. Stripe's deep-link guide does not say. If they can, a customer with a listed IP but an unlisted saved address could upgrade that way.

## 8. Limits

- IP geolocation is a good-faith control; a VPN, proxy or Tor exit outside the list is not stopped up front. The billing-address and card checks at fulfilment are what a VPN does not change, but a buyer can enter a false address.
- It does not screen people. SDN screening is separate work.
- **A refused portal upgrade is not refunded.** The webhook does not apply it, but the proration Stripe charged for it stays charged. TODO in code (`customer.subscription.updated`).
- A subscription's card country is not checked (only a token pack's); the subscription path uses the billing address.
- A Stripe Radar rule on `:card_country:` would add a layer at Stripe itself; it is a dashboard setting for Tristan, not part of this change.
- The list is in code. Changing it is a reviewed PR and a deploy, which is deliberate for a policy list.
- **Scope is spawnforge.ai only.** `docs.spawnforge.ai` and Tristan's other sites are not covered here.

## 9. Acceptance

- Every page, `/play` URL and API is forwarded by the proxy from a listed country.
- The four purchase routes answer 451 "Purchases are not available in your region." for a listed IP before BotID, auth, Stripe or the database; run normally for an unlisted country and for an unknown one.
- The portal's cancel flow opens for a listed IP when there is a subscription to cancel; its home page does not.
- Both Checkout Session builders require the billing address.
- The webhook grants nothing to a listed billing address or (token pack) card country; refunds the payment; cancels a subscription; marks the charge so the refund claws back nothing; and is safe on redelivery.
- Ukraine outside the listed regions is not refused; Ukraine with region `43`, `40`, `14`, `09`, `23` or `65` (or a matching region name in a Stripe address) is.
- The list in code and the table in §2.2 agree, entry for entry, and the 22 countries and six regions are pinned by test.
- Review: re-check both OFAC sources and update §2 and `SANCTIONS_POLICY_LAST_REVIEWED` whenever a program is added or removed, and at least every six months.
