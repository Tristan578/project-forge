# R2 OIDC Federation Evaluation

**Status:** Evaluated — keeping long-lived API keys for now.
**Last reviewed:** 2026-03-21
**Ticket:** PF-639

---

## Current State

R2 uploads use long-lived API key credentials stored as Vercel environment variables:

- `ASSET_R2_ACCESS_KEY_ID` — S3-compatible access key ID
- `ASSET_R2_SECRET_ACCESS_KEY` — corresponding secret key

These credentials are scoped to the `spawnforge-assets` bucket and used by server-side
API routes that generate signed upload URLs for user asset uploads.

---

## Alternative: Vercel OIDC Federation

Vercel supports OIDC token exchange, allowing Workers/Functions to prove their identity
to a cloud provider without storing long-lived credentials. This is used today for AWS
and GCP integrations where the cloud provider's IAM layer supports OIDC identity tokens.

Under this model the flow would be:

1. Vercel issues a short-lived OIDC token to the Function at invocation time.
2. The Function exchanges the OIDC token for temporary cloud-provider credentials.
3. The Function uses those credentials for its R2 operation.
4. Credentials expire automatically after a short TTL (typically 1 hour).

---

## Pros

- No key rotation required — OIDC tokens are short-lived and automatically rotated.
- Short-lived tokens limit the blast radius of a credential leak.
- Full audit trail — Cloudflare can log each token exchange, giving per-invocation
  visibility into which Vercel deployment accessed which resource.
- Aligns with Vercel's recommended practice for AWS/GCP integrations and reduces
  secrets management toil.

---

## Cons

- Cloudflare R2 does not natively support OIDC as of March 2026.
  Cloudflare's IAM model uses S3-compatible HMAC keys, not federated identity providers.
- A workaround exists: deploy a Cloudflare Worker that validates the Vercel OIDC token
  and issues short-lived STS-style credentials. However this adds operational complexity:
  - Additional Worker to maintain and monitor.
  - Network round-trip on every upload request (latency penalty).
  - The Worker itself needs a long-lived Cloudflare API token, partially defeating
    the purpose.
- No first-class Vercel integration exists for R2 OIDC today (unlike AWS/GCP).
- The OIDC-to-HMAC proxy pattern is unsupported by Cloudflare; any breakage requires
  custom debugging.

---

## Recommendation

**Keep the current long-lived API key approach.**

Mitigate risks with the following hygiene practices (already in place):

- Credentials stored as Vercel encrypted environment variables (not in source code).
- Keys are scoped to the `spawnforge-assets` bucket only (least privilege).
- Rotate keys quarterly via Cloudflare dashboard, or immediately on any suspected leak.
- Monitor for unexpected R2 usage via Cloudflare Analytics dashboard.

**Revisit when:**

- Cloudflare adds native OIDC support for R2 (track on Cloudflare's public roadmap).
- A Vercel-Cloudflare R2 first-class integration becomes available.
- Key rotation toil becomes a recurring operational burden (trigger a re-evaluation).

---

## Related

- Cloudflare R2 docs: https://developers.cloudflare.com/r2/api/s3/tokens/
- Vercel OIDC federation docs: https://vercel.com/docs/security/secure-backend-access/oidc
- Engine CDN worker: `infra/engine-cdn/worker.js` (separate R2 bucket, read-only)
- Asset upload flow: `web/src/app/api/assets/upload/route.ts`
