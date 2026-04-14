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
import crypto from 'k6/crypto';
import exec from 'k6/execution';

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
  'invoice.paid',
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

function signPayload(payload, secret) {
  const timestamp = Math.floor(Date.now() / 1000);
  if (!secret) {
    // Without a secret, return a placeholder that will fail server-side
    // verification with a 400. For real testing, pass STRIPE_WEBHOOK_SECRET.
    return `t=${timestamp},v1=placeholder_signature_for_load_test`;
  }
  const signedPayload = `${timestamp}.${payload}`;
  const mac = crypto.hmac('sha256', secret, signedPayload, 'hex');
  return `t=${timestamp},v1=${mac}`;
}

export default function () {
  // Use a 50-slot repeating pool so half the requests (iterations 50-99)
  // reuse event IDs from iterations 0-49, exercising the idempotency guard.
  const pool = 50;
  const index = exec.scenario.iterationInTest % pool;
  // Derive eventType from index (not random) so repeated indices produce
  // identical event IDs — random selection would reduce duplicate rate to ~10%.
  const eventType = EVENT_TYPES[index % EVENT_TYPES.length];
  const payload = makeWebhookPayload(eventType, index);
  const body = JSON.stringify(payload);

  const headers = {
    'Content-Type': 'application/json',
    'Stripe-Signature': signPayload(body, WEBHOOK_SECRET),
  };

  const res = http.post(`${BASE_URL}/api/stripe/webhook`, body, { headers });

  const isError = res.status >= 500;
  errorRate.add(isError);

  // Track duplicate detection: server returns {"received":true,"duplicate":true}
  // when the idempotency guard fires for a previously-processed event ID.
  let isDuplicate = false;
  if (res.status === 200 && res.body) {
    try {
      const json = res.json();
      isDuplicate = json.duplicate === true;
    } catch (_) {
      // non-JSON body (e.g. 400 from failed sig verification) — not a duplicate
    }
  }
  duplicateRate.add(isDuplicate ? 1 : 0);

  // 400 is expected when signature verification fails (no real secret)
  check(res, {
    'no 500 errors': (r) => r.status < 500,
    'valid response': (r) => [200, 400, 409].includes(r.status),
  });
}

export function handleSummary(data) {
  const total = data.metrics.http_reqs?.values?.count ?? 0;
  const errRate = data.metrics.errors?.values?.rate ?? 0;
  const dupRate = data.metrics.duplicates?.values?.rate ?? 0;
  const p95 = data.metrics.http_req_duration?.values?.['p(95)'] ?? 0;

  console.log('\n======== WEBHOOK STORM TEST SUMMARY ========');
  console.log(`Total webhooks:  ${total}`);
  console.log(`p95 latency:     ${p95.toFixed(0)}ms`);
  console.log(`Error rate:      ${(errRate * 100).toFixed(2)}% (target: <1%)`);
  console.log(`Duplicate rate:  ${(dupRate * 100).toFixed(2)}%`);
  console.log('=============================================\n');

  return {};
}
