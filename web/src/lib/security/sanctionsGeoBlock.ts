/**
 * Sanctions geo-block (#9331): refuse use of, and payment for, SpawnForge from
 * sanctioned countries and regions. Spec: `specs/2026-11-04-sanctions-geo-block.md`.
 *
 * THIS IS A POLICY LIST, NOT LEGAL ADVICE. It records the owner's business
 * decision (Tristan Nolan, 2026-11-04): "any OFAC/Sanctioned country should
 * not be paying me for anything or using my products." It is deliberately
 * broader than what US sanctions law requires of a US person, and it is not a
 * substitute for screening against the SDN list or for counsel's review.
 *
 * Last reviewed: 2026-11-04 (see {@link SANCTIONS_POLICY_LAST_REVIEWED}).
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
 * Source of truth for location: Vercel's `x-vercel-ip-country` (ISO 3166-1
 * alpha-2) and `x-vercel-ip-country-region` (the region portion of the ISO
 * 3166-2 code, e.g. `43` for UA-43 Crimea), documented at
 * https://vercel.com/docs/headers/request-headers. IP geolocation is a
 * good-faith control: a visitor on a VPN is not stopped by it.
 */
import { NextResponse } from 'next/server';

export const SANCTIONS_POLICY_LAST_REVIEWED = '2026-11-04';

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
 * What to do when Vercel sends no usable country header. `'allow'` (fail open)
 * is the default pending the owner's decision; see the spec. The header is
 * absent outside Vercel (local dev, CI, `next start`) and may be absent for an
 * IP Vercel cannot geolocate.
 */
export const MISSING_COUNTRY_POLICY: 'allow' | 'block' = 'allow';

/**
 * Paths no country rule applies to: machine callers that carry their own
 * authentication and must not depend on where the caller's IP geolocates.
 * Health probes, Stripe and Clerk webhooks, Vercel cron, and the QStash
 * generation callback. Matched as whole path segments.
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

export type GeoBlockDecision =
  | { blocked: false; reason: 'allowed' | 'bypass' | 'missing-country' }
  | { blocked: true; reason: 'jurisdiction' | 'missing-country'; jurisdiction?: BlockedJurisdiction };

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

function normalizeCode(value: string | null, pattern: RegExp): string | null {
  if (value === null) return null;
  const v = value.trim().toUpperCase();
  return pattern.test(v) ? v : null;
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

/**
 * Decide whether a request is geo-blocked. Pure: reads only the path and the
 * two Vercel headers.
 */
export function geoBlockDecision(
  pathname: string,
  headers: Headers,
  options: {
    list?: readonly BlockedJurisdiction[];
    missingCountryPolicy?: 'allow' | 'block';
  } = {},
): GeoBlockDecision {
  if (isGeoBlockBypassPath(pathname)) return { blocked: false, reason: 'bypass' };
  const country = normalizeCode(headers.get(COUNTRY_HEADER), /^[A-Z]{2}$/);
  if (country === null) {
    return (options.missingCountryPolicy ?? MISSING_COUNTRY_POLICY) === 'block'
      ? { blocked: true, reason: 'missing-country' }
      : { blocked: false, reason: 'missing-country' };
  }
  const region = normalizeCode(headers.get(REGION_HEADER), /^[A-Z0-9]{1,3}$/);
  const jurisdiction = findBlockedJurisdiction(country, region, options.list);
  return jurisdiction
    ? { blocked: true, reason: 'jurisdiction', jurisdiction }
    : { blocked: false, reason: 'allowed' };
}

export const SANCTIONS_BLOCK_CODE = 'SANCTIONS_GEO_BLOCK';

const BLOCKED_HTML = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex">
<title>Not available in your region</title>
</head>
<body>
<h1>SpawnForge is not available in your region</h1>
<p>We do not offer SpawnForge, or accept payment for it, in countries and regions subject to sanctions.</p>
<p>If you think this is a mistake, contact us at support@spawnforge.ai.</p>
</body>
</html>
`;

const BLOCK_HEADERS = {
  // A geo-dependent answer must never be cached and served to another visitor.
  'Cache-Control': 'private, no-store',
  // RFC 7725 section 4: identify who is implementing the block.
  Link: '<https://www.spawnforge.ai>; rel="blocked-by"',
  'X-Content-Type-Options': 'nosniff',
} as const;

/**
 * The 451 a blocked visitor gets. A plain, self-contained page for a document
 * request (no scripts, styles or images to fetch), JSON for an API request.
 */
export function sanctionsBlockedResponse(pathname: string, method: string): NextResponse {
  const isApi = pathname === '/api' || pathname.startsWith('/api/');
  if (isApi) {
    return NextResponse.json(
      { error: 'This service is not available in your region.', code: SANCTIONS_BLOCK_CODE },
      { status: 451, headers: BLOCK_HEADERS },
    );
  }
  return new NextResponse(method === 'HEAD' ? null : BLOCKED_HTML, {
    status: 451,
    headers: { ...BLOCK_HEADERS, 'Content-Type': 'text/html; charset=utf-8' },
  });
}

/**
 * The proxy's entry point: the 451 response for a blocked request, or `null`
 * to carry on. Payment routes call it too, so a payment is refused even if a
 * future matcher change stops the proxy running on that path.
 */
export function sanctionsGeoBlock(req: { nextUrl: { pathname: string }; method: string; headers: Headers }): NextResponse | null {
  const decision = geoBlockDecision(req.nextUrl.pathname, req.headers);
  return decision.blocked ? sanctionsBlockedResponse(req.nextUrl.pathname, req.method) : null;
}
