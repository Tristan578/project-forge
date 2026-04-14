/**
 * k6 load test: /api/generate/* concurrent generation requests
 *
 * Simulates 20 concurrent users submitting generation requests to verify:
 * - Rate limiting returns 429 (not 500)
 * - No 500 errors under concurrent load
 * - Graceful degradation when providers are saturated
 *
 * Usage:
 *   BASE_URL=http://localhost:3000 CLERK_SESSION_TOKEN=<token> k6 run generate-load.js
 */

import http from 'k6/http';
import { check, sleep } from 'k6';
import { Rate, Trend } from 'k6/metrics';

const BASE_URL = __ENV.BASE_URL || 'http://localhost:3000';
const SESSION_TOKEN = __ENV.CLERK_SESSION_TOKEN || '';

const errorRate = new Rate('errors');
const rateLimitRate = new Rate('rate_limited');
const genLatency = new Trend('generation_latency', true);

export const options = {
  scenarios: {
    concurrent_gen: {
      executor: 'ramping-vus',
      startVUs: 1,
      stages: [
        { duration: '20s', target: 5 },   // Warm up
        { duration: '1m', target: 20 },   // Ramp to 20 concurrent
        { duration: '2m', target: 20 },   // Sustained load
        { duration: '20s', target: 0 },   // Cool down
      ],
    },
  },
  thresholds: {
    errors: ['rate<0.05'],  // < 5% error rate (providers may throttle)
  },
};

const GENERATE_ROUTES = [
  {
    path: '/api/generate/model',
    payload: { prompt: 'A low-poly tree', style: 'low-poly' },
  },
  {
    path: '/api/generate/texture',
    payload: { prompt: 'Brick wall texture seamless', width: 512, height: 512 },
  },
  {
    path: '/api/generate/sfx',
    payload: { prompt: 'Explosion sound effect', duration: 2 },
  },
  {
    path: '/api/generate/sprite',
    payload: { prompt: 'Pixel art character idle', width: 64, height: 64 },
  },
  {
    path: '/api/generate/voice',
    payload: { text: 'Welcome to the game', voice: 'neutral' },
  },
  {
    path: '/api/generate/skybox',
    payload: { prompt: 'Sunset over mountains' },
  },
  {
    path: '/api/generate/music',
    payload: { prompt: 'Upbeat adventure theme', duration: 30 },
  },
];

export default function () {
  const route = GENERATE_ROUTES[Math.floor(Math.random() * GENERATE_ROUTES.length)];

  const headers = { 'Content-Type': 'application/json' };
  if (SESSION_TOKEN) {
    headers['Cookie'] = `__session=${SESSION_TOKEN}`;
  }

  const res = http.post(
    `${BASE_URL}${route.path}`,
    JSON.stringify(route.payload),
    { headers, timeout: '30s' },
  );

  genLatency.add(res.timings.duration);

  const is429 = res.status === 429;
  rateLimitRate.add(is429);

  const isError = res.status >= 500;
  errorRate.add(isError);

  check(res, {
    'no 500 errors': (r) => r.status < 500,
    'valid response status': (r) => [200, 201, 400, 401, 402, 429].includes(r.status),
  });

  // Generation requests are expensive — longer think time
  sleep(2 + Math.random() * 3);
}

export function handleSummary(data) {
  const p95 = data.metrics.http_req_duration?.values?.['p(95)'] ?? 0;
  const errRate = data.metrics.errors?.values?.rate ?? 0;
  const rlRate = data.metrics.rate_limited?.values?.rate ?? 0;

  console.log('\n========= GENERATE LOAD TEST SUMMARY =========');
  console.log(`p95 latency:    ${p95.toFixed(0)}ms`);
  console.log(`Error rate:     ${(errRate * 100).toFixed(2)}% (target: <5%)`);
  console.log(`Rate limited:   ${(rlRate * 100).toFixed(1)}%`);
  console.log('================================================\n');

  return {};
}
