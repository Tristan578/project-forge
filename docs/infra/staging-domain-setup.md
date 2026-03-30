# Staging Custom Domain Setup (#8000)

## Status: Manual dashboard action required

The `staging.spawnforge.ai` custom domain cannot be configured via the Vercel CLI or API
because `spawnforge.ai` is not registered through Vercel (it is managed via Cloudflare).

## Steps to complete

1. **Add the domain to the Vercel project via the dashboard:**
   - Go to https://vercel.com/tnolan/spawnforge-staging/settings/domains
   - Add `staging.spawnforge.ai`
   - Vercel will display a CNAME target to add in Cloudflare DNS

2. **Add the DNS record in Cloudflare:**
   - Account ID: `0b949ff499d179e24dde841f71d6134f`
   - Add CNAME: `staging` pointing to `cname.vercel-dns.com` (Vercel shows the exact target)
   - Proxy status: DNS only (grey cloud) — Vercel manages TLS

3. **Verify:**
   - The Vercel dashboard shows the domain as verified once DNS propagates (minutes to hours)
   - Confirm with: `curl -I https://staging.spawnforge.ai`

## Why the CLI could not complete this

Running `vercel domains add staging.spawnforge.ai spawnforge-staging --scope tnolan`
returned HTTP 403 `domain_not_owned`. This is because `spawnforge.ai` is registered
externally (Cloudflare). Vercel requires dashboard-level ownership verification for
external domains before any API or CLI subdomain assignment succeeds.

## Project reference

- Staging project ID: `prj_Bpb6yuxUjMwzMjPjdtWEijRIMu30`
- Team ID: `team_5SxqWz8yLPKiOnLbTXUyJKsp` (scope: `tnolan`)
