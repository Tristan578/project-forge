/**
 * Sanctions purchase block (#9331): refuse to SELL or LICENSE anything to a
 * buyer in a sanctioned country or region. Spec:
 * `specs/2026-11-04-sanctions-geo-block.md`.
 *
 * SCOPE (owner decision, Tristan Nolan, 2026-11-16): "I'm okay with anyone
 * seeing my site content. What I don't want is to SELL/license anything to
 * someone in these countries." So nothing here refuses a page, a `/play` URL
 * or a read-only API call. Only the flows that sell or license something call
 * it: starting a Checkout (subscription or token pack), opening the billing
 * portal outside its cancel flow, and buying a marketplace asset. The Stripe
 * webhook re-checks the buyer's billing country before it grants anything
 * (`web/src/lib/billing/sanctionsFulfilment.ts`).
 *
 * THIS IS A POLICY LIST, NOT LEGAL ADVICE. It records the owner's business
 * decision (2026-11-04): "any OFAC/Sanctioned country should not be paying me
 * for anything". It is deliberately broader than what US sanctions law
 * requires of a US person, and it is not a substitute for screening against
 * the SDN list or for counsel's review.
 *
 * Sources, fetched 2026-11-04:
 *  - OFAC, Sanctions Programs and Country Information:
 *    https://ofac.treasury.gov/sanctions-programs-and-country-information
 *  - OFAC FAQ 10, "What jurisdictions or countries are sanctioned by the United
 *    States?" (updated 2026-10-26): https://ofac.treasury.gov/faqs/topic/1501
 *
 * Every entry names the basis it is on the list for, so one can be removed on
 * its own. To change the list: edit {@link BLOCKED_JURISDICTIONS}, bump the
 * review date, and update the table in the spec. The suite pins the two together.
 *
 * Country signals, in order of preference: the buyer's Stripe billing country
 * (the Checkout Session's `customer_details.address`, the saved customer
 * address, the card's issuing country), then Vercel's `x-vercel-ip-country` /
 * `x-vercel-ip-country-region` (https://vercel.com/docs/headers/request-headers).
 * A buyer is refused when ANY known signal is listed. An unknown country is
 * never a reason to refuse on its own: Checkout collects the billing address
 * and the webhook refuses to fulfil (and refunds) a listed one.
 */
import { NextResponse } from 'next/server';

export const SANCTIONS_POLICY_LAST_REVIEWED = '2026-11-16';

/** Why a jurisdiction is on the list. */
export type BlockBasis =
  /** Named in OFAC FAQ 10 as subject to broad ("comprehensive") sanctions. */
  | 'ofac-comprehensive'
  /** Not comprehensively sanctioned; blocked because the owner named it. */
  | 'owner-named'
  /** Has a country-based OFAC program on the Sanctions Programs page. */
  | 'ofac-country-program';

export interface BlockedJurisdiction {
  /** ISO 3166-1 alpha-2, upper case. */
  readonly country: string;
  /** Region portion of ISO 3166-2, upper case. Absent: the whole country. */
  readonly region?: string;
  readonly name: string;
  readonly basis: BlockBasis;
  /** The OFAC program(s) or FAQ this entry comes from, as OFAC names them. */
  readonly program: string;
}

export const BLOCKED_JURISDICTIONS: readonly BlockedJurisdiction[] = [
  // (a) Broad / comprehensive sanctions, OFAC FAQ 10.
  { country: 'CU', name: 'Cuba', basis: 'ofac-comprehensive', program: 'OFAC FAQ 10; Cuba Sanctions' },
  { country: 'IR', name: 'Iran', basis: 'ofac-comprehensive', program: 'OFAC FAQ 10; Iran Sanctions' },
  { country: 'KP', name: 'North Korea', basis: 'ofac-comprehensive', program: 'OFAC FAQ 10; North Korea Sanctions' },
  { country: 'UA', region: '43', name: 'Crimea region of Ukraine', basis: 'ofac-comprehensive', program: 'OFAC FAQ 10; Ukraine-/Russia-related Sanctions (EO 13685)' },
  // ISO 3166-2 lists Sevastopol (UA-40) separately from the Autonomous Republic
  // of Crimea (UA-43). It is on the Crimean peninsula; included so the Crimea
  // entry is not defeated by a geolocation database that codes the city apart.
  { country: 'UA', region: '40', name: 'Sevastopol (Crimea region of Ukraine)', basis: 'ofac-comprehensive', program: 'OFAC FAQ 10; Ukraine-/Russia-related Sanctions (EO 13685)' },
  { country: 'UA', region: '14', name: 'Donetsk region of Ukraine', basis: 'ofac-comprehensive', program: 'OFAC FAQ 10; Ukraine-/Russia-related Sanctions (EO 14065)' },
  { country: 'UA', region: '09', name: 'Luhansk region of Ukraine', basis: 'ofac-comprehensive', program: 'OFAC FAQ 10; Ukraine-/Russia-related Sanctions (EO 14065)' },
  // Not on any OFAC list. The EU restricts the non-government-controlled areas
  // of these two regions (Council Regulation (EU) 2022/263, extended to them by
  // Regulation (EU) 2022/1903 from 2022-10-07), and the owner may sell in the EU
  // (decision 2026-11-05). IP geolocation reports the oblast, not the front
  // line, so the whole oblast is blocked, Ukrainian-held cities included.
  { country: 'UA', region: '23', name: 'Zaporizhzhia region of Ukraine', basis: 'owner-named', program: 'EU Council Regulation (EU) 2022/263, extended by (EU) 2022/1903' },
  { country: 'UA', region: '65', name: 'Kherson region of Ukraine', basis: 'owner-named', program: 'EU Council Regulation (EU) 2022/263, extended by (EU) 2022/1903' },

  // (b) Named by the owner. Each also has a country-based OFAC program.
  { country: 'RU', name: 'Russia', basis: 'owner-named', program: 'Russian Harmful Foreign Activities Sanctions; Ukraine-/Russia-related Sanctions' },
  { country: 'BY', name: 'Belarus', basis: 'owner-named', program: 'Belarus Sanctions' },
  { country: 'CN', name: 'China', basis: 'owner-named', program: 'Chinese Military Companies Sanctions' },

  // (c) Every other country with a country-based program on the OFAC page.
  { country: 'AF', name: 'Afghanistan', basis: 'ofac-country-program', program: 'Afghanistan-Related Sanctions' },
  { country: 'MM', name: 'Burma (Myanmar)', basis: 'ofac-country-program', program: 'Burma-Related Sanctions' },
  { country: 'CF', name: 'Central African Republic', basis: 'ofac-country-program', program: 'Central African Republic Sanctions' },
  { country: 'CD', name: 'Democratic Republic of the Congo', basis: 'ofac-country-program', program: 'Democratic Republic of the Congo-Related Sanctions' },
  { country: 'HK', name: 'Hong Kong', basis: 'ofac-country-program', program: 'Hong Kong-Related Sanctions' },
  { country: 'IQ', name: 'Iraq', basis: 'ofac-country-program', program: 'Iraq-Related Sanctions' },
  { country: 'LB', name: 'Lebanon', basis: 'ofac-country-program', program: 'Lebanon-Related Sanctions' },
  { country: 'LY', name: 'Libya', basis: 'ofac-country-program', program: 'Libya Sanctions' },
  { country: 'ML', name: 'Mali', basis: 'ofac-country-program', program: 'Mali-Related Sanctions' },
  { country: 'NI', name: 'Nicaragua', basis: 'ofac-country-program', program: 'Nicaragua-related Sanctions' },
  { country: 'SO', name: 'Somalia', basis: 'ofac-country-program', program: 'Somalia Sanctions' },
  { country: 'SS', name: 'South Sudan', basis: 'ofac-country-program', program: 'South Sudan-Related Sanctions' },
  { country: 'SD', name: 'Sudan', basis: 'ofac-country-program', program: 'Sudan and Darfur Sanctions' },
  // Syria is NOT comprehensively sanctioned: OFAC FAQ 10 does not name it and
  // the programs page has no "Syria Sanctions" program any more. The only
  // active program tied to it is PAARSS, a targeted program named for Assad.
  // Blocked under the owner's "any sanctioned country" rule, basis (c).
  { country: 'SY', name: 'Syria', basis: 'ofac-country-program', program: 'Promoting Accountability for Assad and Regional Stabilization Sanctions (PAARSS)' },
  { country: 'VE', name: 'Venezuela', basis: 'ofac-country-program', program: 'Venezuela-Related Sanctions' },
  { country: 'YE', name: 'Yemen', basis: 'ofac-country-program', program: 'Yemen-related Sanctions' },
  // NOT on the list: "Balkans-Related Sanctions". The OFAC page names the
  // Western Balkans as a region but lists no countries, so which ones it covers
  // is the owner's call (see the spec's open decisions).
];

/**
 * Paths no country rule applies to: machine callers that carry their own
 * authentication and must not depend on where the caller's IP geolocates.
 * Health probes, Stripe and Clerk webhooks, Vercel cron, and the QStash
 * generation callback. Matched as whole path segments. The purchase check is
 * only called from purchase routes, so this is a guard against one of these
 * ever calling it by mistake, not a list of exemptions from a site-wide block.
 */
export const GEO_BLOCK_BYPASS_PATHS: readonly string[] = [
  '/api/health',
  '/api/status',
  '/api/stripe/webhook',
  '/api/auth/webhook',
  '/api/cron',
  '/api/webhooks/generation-complete',
];

export const COUNTRY_HEADER = 'x-vercel-ip-country';
export const REGION_HEADER = 'x-vercel-ip-country-region';

function segmentsOf(pathname: string): string[] | null {
  try {
    return pathname
      .split('/')
      .filter((s) => s !== '')
      .map((s) => decodeURIComponent(s).toLowerCase());
  } catch {
    return null;
  }
}

const BYPASS_SEGMENTS = GEO_BLOCK_BYPASS_PATHS.map((p) => p.split('/').filter((s) => s !== ''));

/**
 * Whether `pathname` is a bypass path or under one. Decoded and compared by
 * whole segments, so `/api/healthz` and `/api/cron-admin` are NOT bypasses.
 * Malformed percent-encoding is never a bypass.
 */
export function isGeoBlockBypassPath(pathname: string): boolean {
  const segments = segmentsOf(pathname);
  if (segments === null) return false;
  return BYPASS_SEGMENTS.some(
    (prefix) => prefix.length <= segments.length && prefix.every((s, i) => segments[i] === s),
  );
}

/** Find the list entry for a country/region pair, if any. */
export function findBlockedJurisdiction(
  country: string,
  region: string | null,
  list: readonly BlockedJurisdiction[] = BLOCKED_JURISDICTIONS,
): BlockedJurisdiction | undefined {
  return list.find(
    (j) => j.country === country && (j.region === undefined || (region !== null && j.region === region)),
  );
}

/** Where a country signal came from. */
export type CountrySource =
  | 'stripe-checkout-address'
  | 'stripe-customer-address'
  | 'stripe-card'
  | 'ip';

/** One piece of evidence about where the buyer is. Raw values; normalised on use. */
export interface CountrySignal {
  readonly source: CountrySource;
  readonly country: string | null | undefined;
  /** ISO 3166-2 region code, or (for a Stripe address) the free-text `state`. */
  readonly region?: string | null | undefined;
}

/**
 * Free-text spellings of the listed Ukrainian regions, for a Stripe address
 * whose `state` is a name rather than an ISO code. Matched as a substring of
 * the lower-cased, letters-only state, so "Respublika Krym", "Sevastopol' city"
 * and "Zaporizhzhia Oblast" all resolve.
 */
const UA_REGION_NAMES: ReadonlyArray<readonly [string, readonly string[]]> = [
  ['40', ['sevastopol', 'sebastopol']],
  ['43', ['crimea', 'krym']],
  ['14', ['donetsk']],
  ['09', ['luhansk', 'lugansk']],
  ['23', ['zaporizh', 'zaporozh']],
  ['65', ['kherson', 'cherson']],
];

function normalizeCountry(value: string | null | undefined): string | null {
  if (value === null || value === undefined) return null;
  const v = value.trim().toUpperCase();
  return /^[A-Z]{2}$/.test(v) ? v : null;
}

/**
 * The ISO 3166-2 region part for `country`: a bare code (`43`), a full code
 * (`UA-43`), or, for Ukraine, a region name from a Stripe address.
 */
export function normalizeRegion(country: string, value: string | null | undefined): string | null {
  if (value === null || value === undefined) return null;
  let v = value.trim().toUpperCase();
  if (v.startsWith(`${country}-`)) v = v.slice(country.length + 1);
  if (/^[A-Z0-9]{1,3}$/.test(v)) return v;
  if (country === 'UA') {
    const letters = value.toLowerCase().replace(/[^a-z]/g, '');
    for (const [code, names] of UA_REGION_NAMES) {
      if (names.some((n) => letters.includes(n))) return code;
    }
  }
  return null;
}

/** The IP signal Vercel attaches to every request it serves. */
export function ipCountrySignal(headers: Headers): CountrySignal {
  return { source: 'ip', country: headers.get(COUNTRY_HEADER), region: headers.get(REGION_HEADER) };
}

/** A restricted signal and the list entry it matched. */
export interface RestrictedMatch {
  readonly source: CountrySource;
  readonly jurisdiction: BlockedJurisdiction;
}

/**
 * The first signal that places the buyer in a listed jurisdiction, or `null`.
 * Signals with no usable country are ignored: unknown is not restricted.
 */
export function findRestrictedSignal(
  signals: readonly CountrySignal[],
  list: readonly BlockedJurisdiction[] = BLOCKED_JURISDICTIONS,
): RestrictedMatch | null {
  for (const s of signals) {
    const country = normalizeCountry(s.country);
    if (country === null) continue;
    const jurisdiction = findBlockedJurisdiction(country, normalizeRegion(country, s.region), list);
    if (jurisdiction) return { source: s.source, jurisdiction };
  }
  return null;
}

export type PurchaseGeoDecision =
  | { blocked: false; reason: 'allowed' | 'unknown' | 'bypass' }
  | { blocked: true; reason: 'jurisdiction'; source: CountrySource; jurisdiction: BlockedJurisdiction };

/**
 * Decide whether a purchase request is refused up front. Pure: reads the path,
 * the two Vercel headers and any Stripe signals the caller already holds.
 * Refused only when a KNOWN signal is listed; no signal at all is `unknown`
 * and allowed (the webhook checks the billing address Checkout collects).
 */
export function purchaseGeoDecision(
  pathname: string,
  headers: Headers,
  stripeSignals: readonly CountrySignal[] = [],
  list: readonly BlockedJurisdiction[] = BLOCKED_JURISDICTIONS,
): PurchaseGeoDecision {
  if (isGeoBlockBypassPath(pathname)) return { blocked: false, reason: 'bypass' };
  const signals = [...stripeSignals, ipCountrySignal(headers)];
  const match = findRestrictedSignal(signals, list);
  if (match) return { blocked: true, reason: 'jurisdiction', ...match };
  const known = signals.some((s) => normalizeCountry(s.country) !== null);
  return { blocked: false, reason: known ? 'allowed' : 'unknown' };
}

export const SANCTIONS_BLOCK_CODE = 'SANCTIONS_GEO_BLOCK';
export const PURCHASE_BLOCKED_MESSAGE = 'Purchases are not available in your region.';

const BLOCK_HEADERS = {
  // A geo-dependent answer must never be cached and served to another visitor.
  'Cache-Control': 'private, no-store',
  // RFC 7725 section 4: identify who is implementing the block.
  Link: '<https://www.spawnforge.ai>; rel="blocked-by"',
  'X-Content-Type-Options': 'nosniff',
} as const;

/** The 451 JSON a refused purchase gets. Says nothing about which signal matched. */
export function purchaseBlockedResponse(): NextResponse {
  return NextResponse.json(
    { error: PURCHASE_BLOCKED_MESSAGE, code: SANCTIONS_BLOCK_CODE },
    { status: 451, headers: BLOCK_HEADERS },
  );
}

/**
 * The purchase routes' entry point: the 451 for a refused purchase, or `null`
 * to carry on. Call it first in any route that sells or licenses something.
 */
export function sanctionsPurchaseBlock(
  req: { nextUrl: { pathname: string }; headers: Headers },
  stripeSignals: readonly CountrySignal[] = [],
): NextResponse | null {
  return purchaseGeoDecision(req.nextUrl.pathname, req.headers, stripeSignals).blocked
    ? purchaseBlockedResponse()
    : null;
}
