// @vitest-environment node
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, it, expect } from 'vitest';
import {
  BLOCKED_JURISDICTIONS,
  COUNTRY_HEADER,
  GEO_BLOCK_BYPASS_PATHS,
  PURCHASE_BLOCKED_MESSAGE,
  REGION_HEADER,
  SANCTIONS_BLOCK_CODE,
  SANCTIONS_POLICY_LAST_REVIEWED,
  findRestrictedSignal,
  isGeoBlockBypassPath,
  normalizeRegion,
  purchaseBlockedResponse,
  purchaseGeoDecision,
  sanctionsPurchaseBlock,
} from '../sanctionsGeoBlock';

function geo(country?: string, region?: string): Headers {
  const h = new Headers();
  if (country !== undefined) h.set(COUNTRY_HEADER, country);
  if (region !== undefined) h.set(REGION_HEADER, region);
  return h;
}

const CHECKOUT = '/api/billing/checkout';

const SPEC = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../../../../../specs/2026-11-04-sanctions-geo-block.md',
);

/** The table between the spec's markers, as `country|region|name|basis|program` rows. */
function specRows(): string[] {
  const text = readFileSync(SPEC, 'utf8');
  const start = text.indexOf('<!-- geo-block-table:start -->');
  const end = text.indexOf('<!-- geo-block-table:end -->');
  expect(start, 'spec table start marker').toBeGreaterThan(-1);
  expect(end, 'spec table end marker').toBeGreaterThan(start);
  return text
    .slice(start, end)
    .split('\n')
    .filter((l) => l.startsWith('|') && !l.startsWith('|---') && !l.startsWith('| Country'))
    .map((l) => l.split('|').slice(1, -1).map((c) => c.trim()).join('|'));
}

describe('the blocked list', () => {
  it('is exactly the merged list: 22 countries and six Ukrainian regions (owner decision, 2026-11-16)', () => {
    const countries = BLOCKED_JURISDICTIONS.filter((j) => j.region === undefined).map((j) => j.country).sort();
    expect(countries).toEqual(
      ['AF', 'BY', 'MM', 'CF', 'CN', 'CU', 'CD', 'HK', 'IR', 'IQ', 'LB', 'LY', 'ML', 'NI', 'KP', 'RU', 'SO', 'SS', 'SD', 'SY', 'VE', 'YE'].sort(),
    );
    const regions = BLOCKED_JURISDICTIONS.filter((j) => j.region !== undefined).map((j) => `${j.country}-${j.region}`);
    expect(regions.sort()).toEqual(['UA-09', 'UA-14', 'UA-23', 'UA-40', 'UA-43', 'UA-65']);
  });

  it('matches the table in the spec, entry for entry', () => {
    const fromCode = BLOCKED_JURISDICTIONS.map(
      (j) => [j.country, j.region ?? '-', j.name, j.basis, j.program].join('|'),
    );
    const fromSpec = specRows();
    expect(fromSpec.length).toBeGreaterThan(20);
    expect(fromCode).toEqual(fromSpec);
  });

  it('has well-formed, unique entries with a basis and a program each', () => {
    const keys = new Set<string>();
    for (const j of BLOCKED_JURISDICTIONS) {
      expect(j.country).toMatch(/^[A-Z]{2}$/);
      if (j.region !== undefined) expect(j.region).toMatch(/^[A-Z0-9]{1,3}$/);
      expect(['ofac-comprehensive', 'owner-named', 'ofac-country-program']).toContain(j.basis);
      expect(j.program.trim()).not.toBe('');
      const key = `${j.country}-${j.region ?? '*'}`;
      expect(keys.has(key), `duplicate ${key}`).toBe(false);
      keys.add(key);
    }
  });

  it('lists Zaporizhzhia and Kherson as the owner-named EU measure, not as an OFAC program', () => {
    for (const region of ['23', '65']) {
      const j = BLOCKED_JURISDICTIONS.find((e) => e.country === 'UA' && e.region === region);
      expect(j?.basis, `UA-${region}`).toBe('owner-named');
      expect(j?.program, `UA-${region}`).toMatch(/^EU Council Regulation \(EU\) 2022\/263, extended by \(EU\) 2022\/1903$/);
    }
  });

  it('records when it was last reviewed', () => {
    expect(SANCTIONS_POLICY_LAST_REVIEWED).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });
});

describe('purchaseGeoDecision: the IP signal', () => {
  it.each(BLOCKED_JURISDICTIONS.map((j) => [j.name, j] as const))('refuses a purchase from %s', (_name, j) => {
    const d = purchaseGeoDecision(CHECKOUT, geo(j.country, j.region));
    expect(d).toMatchObject({ blocked: true, reason: 'jurisdiction', source: 'ip', jurisdiction: j });
  });

  it.each(['US', 'GB', 'DE', 'JP', 'IN', 'BR', 'CA', 'TW'])('allows %s', (country) => {
    expect(purchaseGeoDecision(CHECKOUT, geo(country))).toEqual({ blocked: false, reason: 'allowed' });
  });

  it('refuses only the listed regions of Ukraine', () => {
    expect(purchaseGeoDecision(CHECKOUT, geo('UA')).blocked).toBe(false);
    expect(purchaseGeoDecision(CHECKOUT, geo('UA', '30')).blocked).toBe(false); // Kyiv
    expect(purchaseGeoDecision(CHECKOUT, geo('UA', '46')).blocked).toBe(false); // Lviv
    for (const r of ['43', '40', '14', '09', '23', '65']) expect(purchaseGeoDecision(CHECKOUT, geo('UA', r)).blocked).toBe(true);
  });

  it('normalises case and whitespace in the headers', () => {
    expect(purchaseGeoDecision(CHECKOUT, geo(' ir ')).blocked).toBe(true);
    expect(purchaseGeoDecision(CHECKOUT, geo('ua', ' 43')).blocked).toBe(true);
  });

  it('does NOT refuse a buyer whose country is unknown: no header, or a malformed one', () => {
    for (const h of [geo(), geo(''), geo('X'), geo('IRN'), geo('1R')]) {
      expect(purchaseGeoDecision(CHECKOUT, h)).toEqual({ blocked: false, reason: 'unknown' });
    }
  });

  it('never refuses on a bypass path', () => {
    for (const p of GEO_BLOCK_BYPASS_PATHS) {
      expect(purchaseGeoDecision(p, geo('IR')), p).toEqual({ blocked: false, reason: 'bypass' });
      expect(purchaseGeoDecision(`${p}/sub`, geo('IR')).blocked, p).toBe(false);
    }
  });
});

describe('purchaseGeoDecision: Stripe signals', () => {
  it('refuses when a Stripe billing address is listed, whatever the IP says', () => {
    const d = purchaseGeoDecision(CHECKOUT, geo('US'), [{ source: 'stripe-customer-address', country: 'IR' }]);
    expect(d).toMatchObject({ blocked: true, source: 'stripe-customer-address' });
  });

  it('refuses when the IP is listed, whatever the Stripe address says (any known signal)', () => {
    const d = purchaseGeoDecision(CHECKOUT, geo('RU'), [{ source: 'stripe-customer-address', country: 'US' }]);
    expect(d).toMatchObject({ blocked: true, source: 'ip' });
  });

  it('allows a known, unlisted Stripe country with no IP header', () => {
    expect(purchaseGeoDecision(CHECKOUT, geo(), [{ source: 'stripe-card', country: 'US' }])).toEqual({ blocked: false, reason: 'allowed' });
  });
});

describe('findRestrictedSignal and region names from a Stripe address', () => {
  it.each([
    ['Crimea', '43'],
    ['Respublika Krym', '43'],
    ["Sevastopol' city", '40'],
    ['Donetsk Oblast', '14'],
    ['Luhanska oblast', '09'],
    ['Lugansk', '09'],
    ['Zaporizhzhia Oblast', '23'],
    ['Zaporozhye', '23'],
    ['Kherson', '65'],
    ['UA-43', '43'],
    ['43', '43'],
  ])('reads the Ukrainian state %j as region %s', (state, code) => {
    expect(normalizeRegion('UA', state)).toBe(code);
    expect(findRestrictedSignal([{ source: 'stripe-checkout-address', country: 'UA', region: state }])?.jurisdiction.region).toBe(code);
  });

  it.each(['Kyiv', 'Lviv Oblast', 'Odesa', '', null])('does not restrict Ukraine with state %j', (state) => {
    expect(findRestrictedSignal([{ source: 'stripe-checkout-address', country: 'UA', region: state }])).toBeNull();
  });

  it('ignores signals with no usable country and returns the first listed one', () => {
    expect(findRestrictedSignal([{ source: 'ip', country: null }, { source: 'stripe-card', country: '' }])).toBeNull();
    expect(findRestrictedSignal([{ source: 'stripe-card', country: 'us' }, { source: 'ip', country: 'cu' }])?.source).toBe('ip');
  });
});

describe('isGeoBlockBypassPath', () => {
  it('matches the listed paths and their subtrees', () => {
    expect(GEO_BLOCK_BYPASS_PATHS.length).toBeGreaterThan(4);
    expect(isGeoBlockBypassPath('/api/cron/health-monitor')).toBe(true);
    expect(isGeoBlockBypassPath('/api/stripe/webhook')).toBe(true);
    expect(isGeoBlockBypassPath('/api/stripe/webhook/')).toBe(true);
    expect(isGeoBlockBypassPath('/%61pi/health')).toBe(true);
  });

  it.each([
    '/api/healthz',
    '/api/health-admin',
    '/api/cron-admin',
    '/api/stripe/webhooks-admin',
    '/api/stripe',
    '/api/auth',
    '/api/billing/checkout',
    '/health',
    '/',
    '/api/%E0%A4%A',
  ])('does not treat %s as a bypass', (p) => {
    expect(isGeoBlockBypassPath(p)).toBe(false);
  });
});

describe('the 451 response', () => {
  it('is uncacheable JSON saying purchases are not available in the region', async () => {
    const res = purchaseBlockedResponse();
    expect(res.status).toBe(451);
    expect(res.headers.get('cache-control')).toBe('private, no-store');
    expect(res.headers.get('link')).toBe('<https://www.spawnforge.ai>; rel="blocked-by"');
    expect(await res.json()).toEqual({ error: 'Purchases are not available in your region.', code: SANCTIONS_BLOCK_CODE });
    expect(PURCHASE_BLOCKED_MESSAGE).toBe('Purchases are not available in your region.');
  });
});

describe('sanctionsPurchaseBlock', () => {
  const req = (pathname: string, country?: string) => ({ nextUrl: { pathname }, headers: geo(country) });

  it('returns the 451 for a listed buyer and null otherwise', () => {
    expect(sanctionsPurchaseBlock(req(CHECKOUT, 'KP'))?.status).toBe(451);
    expect(sanctionsPurchaseBlock(req(CHECKOUT, 'US'))).toBeNull();
    expect(sanctionsPurchaseBlock(req(CHECKOUT, undefined))).toBeNull();
    expect(sanctionsPurchaseBlock(req('/api/stripe/webhook', 'IR'))).toBeNull();
    expect(sanctionsPurchaseBlock(req(CHECKOUT, 'US'), [{ source: 'stripe-customer-address', country: 'SY' }])?.status).toBe(451);
  });
});
