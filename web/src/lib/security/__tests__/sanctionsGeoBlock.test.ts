// @vitest-environment node
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, it, expect, vi } from 'vitest';
import {
  BLOCKED_JURISDICTIONS,
  COUNTRY_HEADER,
  GEO_BLOCK_BYPASS_PATHS,
  MISSING_COUNTRY_POLICY,
  REGION_HEADER,
  SANCTIONS_BLOCK_CODE,
  SANCTIONS_POLICY_LAST_REVIEWED,
  geoBlockDecision,
  geolocationExpected,
  isGeoBlockBypassPath,
  sanctionsBlockedResponse,
  sanctionsGeoBlock,
} from '../sanctionsGeoBlock';

function geo(country?: string, region?: string): Headers {
  const h = new Headers();
  if (country !== undefined) h.set(COUNTRY_HEADER, country);
  if (region !== undefined) h.set(REGION_HEADER, region);
  return h;
}

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

  it('carries the decided policy: every comprehensive jurisdiction and every owner-named country', () => {
    for (const [c, r] of [['CU'], ['IR'], ['KP'], ['UA', '43'], ['UA', '14'], ['UA', '09'], ['RU'], ['BY'], ['CN'], ['SY']] as const) {
      expect(geoBlockDecision('/', geo(c, r)).blocked, `${c}${r ? `-${r}` : ''}`).toBe(true);
    }
  });

  it('records when it was last reviewed', () => {
    expect(SANCTIONS_POLICY_LAST_REVIEWED).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });
});

describe('geoBlockDecision', () => {
  it.each(BLOCKED_JURISDICTIONS.map((j) => [j.name, j] as const))('blocks %s', (_name, j) => {
    const d = geoBlockDecision('/pricing', geo(j.country, j.region));
    expect(d).toMatchObject({ blocked: true, reason: 'jurisdiction', jurisdiction: j });
  });

  it.each(['US', 'GB', 'DE', 'JP', 'IN', 'BR', 'CA', 'TW'])('allows %s', (country) => {
    expect(geoBlockDecision('/pricing', geo(country))).toEqual({ blocked: false, reason: 'allowed' });
  });

  it('blocks only the listed regions of Ukraine', () => {
    expect(geoBlockDecision('/', geo('UA')).blocked).toBe(false);
    expect(geoBlockDecision('/', geo('UA', '30')).blocked).toBe(false); // Kyiv
    expect(geoBlockDecision('/', geo('UA', '46')).blocked).toBe(false); // Lviv
    for (const r of ['43', '40', '14', '09', '23', '65']) expect(geoBlockDecision('/', geo('UA', r)).blocked).toBe(true);
  });

  it('lists Zaporizhzhia and Kherson as the owner-named EU measure, not as an OFAC program', () => {
    for (const region of ['23', '65']) {
      const j = BLOCKED_JURISDICTIONS.find((e) => e.country === 'UA' && e.region === region);
      expect(j?.basis, `UA-${region}`).toBe('owner-named');
      expect(j?.program, `UA-${region}`).toMatch(/^EU Council Regulation \(EU\) 2022\/263, extended by \(EU\) 2022\/1903$/);
    }
  });

  it('normalises case and whitespace in the headers', () => {
    expect(geoBlockDecision('/', geo(' ir ')).blocked).toBe(true);
    expect(geoBlockDecision('/', geo('ua', ' 43')).blocked).toBe(true);
  });

  it('treats an absent or malformed country as missing, and follows the missing-country policy where requests are geolocated', () => {
    for (const h of [geo(), geo(''), geo('X'), geo('IRN'), geo('1R')]) {
      expect(geoBlockDecision('/', h, { missingCountryPolicy: 'allow', geolocated: true })).toEqual({ blocked: false, reason: 'missing-country' });
      expect(geoBlockDecision('/', h, { missingCountryPolicy: 'block', geolocated: true })).toEqual({ blocked: true, reason: 'missing-country' });
      // off Vercel no request carries the header, so neither policy applies
      expect(geoBlockDecision('/', h, { missingCountryPolicy: 'block', geolocated: false })).toEqual({ blocked: false, reason: 'not-geolocated' });
    }
    // a listed country is blocked whether or not the deployment geolocates
    expect(geoBlockDecision('/', geo('IR'), { geolocated: false }).blocked).toBe(true);
  });

  it('fails closed on a missing country by default (owner decision, 2026-11-05), on a Vercel deployment', () => {
    expect(MISSING_COUNTRY_POLICY).toBe('block');
    vi.stubEnv('VERCEL', '1');
    try {
      expect(geolocationExpected()).toBe(true);
      expect(geoBlockDecision('/', geo())).toEqual({ blocked: true, reason: 'missing-country' });
      expect(geoBlockDecision('/api/billing/checkout', geo()).blocked).toBe(true);
      expect(geoBlockDecision('/pricing', geo('US')).blocked).toBe(false);
    } finally {
      vi.unstubAllEnvs();
    }
  });

  it('does not apply the missing-country policy off Vercel (next dev, CI, Playwright)', () => {
    for (const v of [undefined, '', '0', 'true']) {
      if (v === undefined) vi.stubEnv('VERCEL', undefined as unknown as string);
      else vi.stubEnv('VERCEL', v);
      try {
        expect(geolocationExpected(), `VERCEL=${String(v)}`).toBe(false);
        expect(geoBlockDecision('/', geo()), `VERCEL=${String(v)}`).toEqual({ blocked: false, reason: 'not-geolocated' });
      } finally {
        vi.unstubAllEnvs();
      }
    }
  });

  it('reads VERCEL as a literal member expression on an executable line', () => {
    // Next.js substitutes process.env.X only when spelled out in full, and no runtime test here can see the
    // Edge bundle, so the source shape is pinned. Counted on non-comment lines, so a commented-out copy fails.
    const src = readFileSync(path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../sanctionsGeoBlock.ts'), 'utf8');
    const live = src.split('\n').filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l) && /process\.env\.VERCEL\b/.test(l));
    expect(live).toEqual(["  return process.env.VERCEL === '1';"]);
  });

  it('never blocks a bypass path, even from a listed country or under fail-closed', () => {
    for (const p of GEO_BLOCK_BYPASS_PATHS) {
      expect(geoBlockDecision(p, geo('IR')), p).toEqual({ blocked: false, reason: 'bypass' });
      expect(geoBlockDecision(`${p}/sub`, geo(), { missingCountryPolicy: 'block', geolocated: true }).blocked, p).toBe(false);
    }
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
  it('serves a plain, self-contained, uncacheable page for a document request', async () => {
    const res = sanctionsBlockedResponse('/pricing', 'GET');
    expect(res.status).toBe(451);
    expect(res.headers.get('content-type')).toBe('text/html; charset=utf-8');
    expect(res.headers.get('cache-control')).toBe('private, no-store');
    expect(res.headers.get('link')).toBe('<https://www.spawnforge.ai>; rel="blocked-by"');
    const html = await res.text();
    expect(html).toContain('not available in your region');
    expect(html).toContain('<meta name="robots" content="noindex">');
    expect(html).not.toMatch(/<script|<link|<img|<iframe|<style|style=|src=|@import|url\(/i);
  });

  it('sends no body for HEAD', async () => {
    const res = sanctionsBlockedResponse('/', 'HEAD');
    expect(res.status).toBe(451);
    expect(await res.text()).toBe('');
  });

  it('answers an API request with JSON', async () => {
    const res = sanctionsBlockedResponse('/api/projects', 'POST');
    expect(res.status).toBe(451);
    expect(res.headers.get('cache-control')).toBe('private, no-store');
    expect(await res.json()).toEqual({ error: 'This service is not available in your region.', code: SANCTIONS_BLOCK_CODE });
  });
});

describe('sanctionsGeoBlock', () => {
  const req = (pathname: string, country?: string, method = 'GET') => ({
    nextUrl: { pathname },
    method,
    headers: geo(country),
  });

  it('returns the 451 for a blocked request and null otherwise', () => {
    expect(sanctionsGeoBlock(req('/', 'KP'))?.status).toBe(451);
    expect(sanctionsGeoBlock(req('/', 'US'))).toBeNull();
    expect(sanctionsGeoBlock(req('/', undefined))).toBeNull();
    expect(sanctionsGeoBlock(req('/api/stripe/webhook', 'IR', 'POST'))).toBeNull();
  });
});
