/**
 * Stripe Tax feature guard (PF-912, S2 compliance).
 *
 * Stripe Tax (`automatic_tax: { enabled: true }`) only works once the merchant has
 * enabled Stripe Tax and added the relevant tax registrations in the Stripe
 * dashboard. Turning it on in a Checkout Session before that provisioning exists
 * makes `checkout.sessions.create` throw, which would break the upgrade flow in
 * prod and any test/CI environment without the dashboard config.
 *
 * This guard mirrors the `hasValidClerkKey` pattern in `web/src/app/layout.tsx`:
 * the integration stays completely inert until its env flag is explicitly set,
 * so a missing/absent provisioning step can never break CI, prod, or tests.
 *
 * Set `STRIPE_TAX_ENABLED=true` (exact string) once Stripe Tax + registrations are
 * live. Any other value (including unset, empty, or `"false"`) leaves it off.
 */
export function isStripeTaxEnabled(): boolean {
  return process.env.STRIPE_TAX_ENABLED === 'true';
}
