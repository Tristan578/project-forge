/**
 * k6 load test: /api/chat concurrent requests
 *
 * Simulates 50 concurrent users sending chat messages to verify:
 * - p95 response time < 5s
 * - Zero 500 errors under load
 * - Rate limiting returns 429 (not 500)
 *
 * Usage:
 *   BASE_URL=http://localhost:3000 CLERK_SESSION_TOKEN=<token> k6 run chat-load.js
 *
 * Requires a valid Clerk session token. Get one from browser DevTools:
 *   document.cookie → __session value
 *
 * For dev-mode testing without auth, use:
 *   BASE_URL=http://spawnforge.localhost:1355 k6 run chat-load.js
 */

import http from 'k6/http';
import { check, sleep } from 'k6';
import { Rate, Trend } from 'k6/metrics';

const BASE_URL = __ENV.BASE_URL || 'http://localhost:3000';
const SESSION_TOKEN = __ENV.CLERK_SESSION_TOKEN || '';

// Custom metrics
const errorRate = new Rate('errors');
const rateLimitRate = new Rate('rate_limited');
const chatLatency = new Trend('chat_latency', true);

export const options = {
  scenarios: {
    ramp_up: {
      executor: 'ramping-vus',
      startVUs: 1,
      stages: [
        { duration: '30s', target: 10 },  // Warm up
        { duration: '1m', target: 50 },   // Ramp to 50 users
        { duration: '2m', target: 50 },   // Sustained load
        { duration: '30s', target: 0 },   // Cool down
      ],
    },
  },
  thresholds: {
    http_req_duration: ['p(95)<5000'],  // p95 < 5s
    errors: ['rate<0.01'],              // < 1% error rate
  },
};

const PROMPTS = [
  'Add a red cube to the scene',
  'Create a directional light',
  'Set the background color to blue',
  'Add physics to the selected entity',
  'Rename the entity to Player',
  'Move the camera to position 0 5 -10',
  'Add a sphere with metallic material',
  'Create a ground plane',
];

export default function () {
  const prompt = PROMPTS[Math.floor(Math.random() * PROMPTS.length)];

  const headers = {
    'Content-Type': 'application/json',
  };

  if (SESSION_TOKEN) {
    headers['Cookie'] = `__session=${SESSION_TOKEN}`;
  }

  const payload = JSON.stringify({
    messages: [{ role: 'user', content: prompt }],
    sceneContext: { entities: [], selectedId: null },
  });

  const res = http.post(`${BASE_URL}/api/chat`, payload, { headers });

  chatLatency.add(res.timings.duration);

  const is429 = res.status === 429;
  rateLimitRate.add(is429);

  // 429 is expected under load — not an error
  const isError = res.status >= 500;
  errorRate.add(isError);

  check(res, {
    'status is not 500': (r) => r.status < 500,
    'status is 200 or 429': (r) => r.status === 200 || r.status === 429,
    'response has body': (r) => r.body && r.body.length > 0,
  });

  // Random think time between requests (1-3s)
  sleep(1 + Math.random() * 2);
}

export function handleSummary(data) {
  const p95 = data.metrics.http_req_duration?.values?.['p(95)'] ?? 0;
  const errRate = data.metrics.errors?.values?.rate ?? 0;
  const rlRate = data.metrics.rate_limited?.values?.rate ?? 0;

  console.log('\n========== CHAT LOAD TEST SUMMARY ==========');
  console.log(`p95 latency:    ${p95.toFixed(0)}ms (target: <5000ms)`);
  console.log(`Error rate:     ${(errRate * 100).toFixed(2)}% (target: <1%)`);
  console.log(`Rate limited:   ${(rlRate * 100).toFixed(1)}%`);
  console.log('=============================================\n');

  return {};
}
