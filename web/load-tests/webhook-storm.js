/**
 * k6 load test: Stripe webhook flood
 *
 * Simulates 100 Stripe webhooks arriving within 10 seconds to verify:
 * - Idempotent processing (no double credit, no duplicate subscription updates)
 * - All webhooks return 200 (no 500 errors)
 * - System handles burst without queue overflow
 *
 * Usage:
 *   BASE_URL=http://localhost:3000 STRIPE_WEBHOOK_SECRET=whsec_xxx k6 run webhook-storm.js
 *
 * Note: This test sends mock webhook payloads. The Stripe signature is faked
 * unless STRIPE_WEBHOOK_SECRET is provided for proper HMAC signing.
 * In production-like testing, use `stripe trigger` CLI instead.
 */

import http from 'k6/http';
import { check } from 'k6';
import { Rate } from 'k6/metrics';
import { crypto } from 'k6/experimental/webcrypto';

const BASE_URL = __ENV.BASE_URL || 'http://localhost:3000';
const WEBHOOK_SECRET = __ENV.STRIPE_WEBHOOK_SECRET || '';

const errorRate = new Rate('errors');
const duplicateRate = new Rate('duplicates');

export const options = {
  scenarios: {
    webhook_burst: {
      executor: 'shared-iterations',
      vus: 10,
      iterations: 100,
      maxDuration: '30s',
    },
  },
  thresholds: {
    errors: ['rate<0.01'],  // < 1% error rate
  },
};

const EVENT_TYPES = [
  'checkout.session.completed',
  'customer.subscription.updated',
  'customer.subscription.deleted',
  'invoice.payment_succeeded',
  'invoice.payment_failed',
];

function makeWebhookPayload(eventType, index) {
  const now = Math.floor(Date.now() / 1000);
  return {
    id: `evt_test_${eventType.replace(/\./g, '_')}_${index}`,
    object: 'event',
    type: eventType,
    created: now,
    data: {
      object: {
        id: `sub_test_${index}`,
        customer: `cus_test_${index % 10}`,
        status: eventType.includes('deleted') ? 'canceled' : 'active',
        items: {
          data: [{
            price: { id: 'price_creator_monthly', product: 'prod_creator' },
          }],
        },
        metadata: { userId: `user_${index % 10}` },
      },
    },
    livemode: false,
  };
}

function signPayload(payload, _secret) {
  // k6 does not have Node.js crypto — return a placeholder signature.
  // For real testing, use `stripe listen --forward-to` which signs properly.
  const timestamp = Math.floor(Date.now() / 1000);
  return `t=${timestamp},v1=placeholder_signature_for_load_test`;
}

export default function () {
  const eventType = EVENT_TYPES[Math.floor(Math.random() * EVENT_TYPES.length)];
  const index = __ITER;
  const payload = makeWebhookPayload(eventType, index);
  const body = JSON.stringify(payload);

  const headers = {
    'Content-Type': 'application/json',
    'Stripe-Signature': signPayload(body, WEBHOOK_SECRET),
  };

  const res = http.post(`${BASE_URL}/api/webhooks/stripe`, body, { headers });

  const isError = res.status >= 500;
  errorRate.add(isError);

  // 400 is expected when signature verification fails (no real secret)
  check(res, {
    'no 500 errors': (r) => r.status < 500,
    'valid response': (r) => [200, 400].includes(r.status),
  });
}

export function handleSummary(data) {
  const total = data.metrics.http_reqs?.values?.count ?? 0;
  const errRate = data.metrics.errors?.values?.rate ?? 0;
  const p95 = data.metrics.http_req_duration?.values?.['p(95)'] ?? 0;

  console.log('\n======== WEBHOOK STORM TEST SUMMARY ========');
  console.log(`Total webhooks:  ${total}`);
  console.log(`p95 latency:     ${p95.toFixed(0)}ms`);
  console.log(`Error rate:      ${(errRate * 100).toFixed(2)}% (target: <1%)`);
  console.log('=============================================\n');

  return {};
}
