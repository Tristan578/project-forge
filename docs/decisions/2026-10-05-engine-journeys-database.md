# The engine journeys gate runs against a Postgres created for the run, behind Neon's local HTTP proxy

- **Date:** 2026-10-05 (verification record refreshed 2026-10-06)
- **Status:** Accepted
- **Context:** #10161 (parent epic #9723); consumers #10152, #10153, #10154, #10162; engine hand-off #9525
- **Supersedes:** nothing

## Decision

`.github/workflows/ci.yml` gains a required job, `test-e2e-engine-journeys`, that serves the
same `NEXT_PUBLIC_E2E_HOOKS=true` production build as `test-e2e-engine-smoke` against a
database that exists only for that run:

- a `pgvector/pgvector:pg17` **service container** (migration `0010` runs
  `CREATE EXTENSION IF NOT EXISTS vector`, which the stock `postgres` image does not ship);
- **Neon's documented local proxy** for the serverless driver,
  `ghcr.io/timowilhelm/local-neon-http-proxy`, started by a step on the runner's host network
  and probed with the driver's own request shape before anything depends on it;
- the real `npm run db:migrate` and the real `npm run db:drift`, with no substitution;
- `scripts/assert-e2e-db-host.sh`, which refuses to migrate, drift-check or serve unless the
  host in `DATABASE_URL` and in `E2E_NEON_HTTP_ENDPOINT` is exactly the loopback name this run
  provisioned;
- `web/playwright.journeys.config.ts`, which selects the tag **`@engine-journey`** and nothing
  else, under the smoke gate's SwiftShader flags. Its only member today is
  `web/e2e/tests/engine-journeys-health.spec.ts`, which asserts `/api/health` reports the
  per-run database `connected`.

The app reaches that database through one new, build-gated switch:
`web/src/lib/db/e2eNeonEndpoint.ts` honours `E2E_NEON_HTTP_ENDPOINT` only while
`e2eHooksEnabled()` is true, i.e. a build with `NEXT_PUBLIC_E2E_HOOKS` inlined or a
non-production process. A production build with the flag unset ignores the variable however
the runtime environment is set; `e2eNeonEndpoint.test.ts` pins that, both as behaviour through
the installed driver's `neonConfig` and as source shape, because no runtime test can see a
build-time inline.

This is option **(b)** of the issue. Options (b) and (c) were evaluated before (a), as the
issue requires; the reasons follow.

## Why the real driver cannot simply be pointed at a container

`@neondatabase/serverless` (installed: 1.1.0) does not open a TCP connection to the host in
`DATABASE_URL`. Its HTTP client POSTs every query to a Neon-protocol endpoint and carries the
connection string in a `Neon-Connection-String` header. The driver's own `CONFIG.md` documents
the knob this decision turns:

> Set `fetchEndpoint` to set the server endpoint to be sent queries via http fetch. This may be
> useful for local development (e.g. to set a port that's not the default 443). Provide either
> the full endpoint URL, or a function that takes the database host address and port and
> returns the full endpoint URL (including protocol). Default: `host => 'https://' + host + '/sql'`

(neondatabase/serverless, `CONFIG.md`, read 2026-10-06.) So a plain Postgres is unreachable to
the production code path unless something on the runner speaks the Neon HTTP protocol and the
driver is told where it is. That something is the proxy below; the telling is the override.

## Options

### (b) Service container + Neon's local HTTP proxy — chosen

**What Neon documents.** The guide
[Local development with Neon](https://neon.com/guides/local-development-with-neon) (read
2026-10-06) runs two services: `postgres:17` and
`ghcr.io/timowilhelm/local-neon-http-proxy:main` with
`PG_CONNECTION_STRING=postgres://postgres:postgres@postgres:5432/main` and port `4444`. It
configures the driver with

```ts
neonConfig.fetchEndpoint = (host) => {
  const [protocol, port] = host === 'db.localtest.me' ? ['http', 4444] : ['https', 443];
  return `${protocol}://${host}:${port}/sql`;
};
```

and explains the hostname in one sentence: the setup "uses `*.localtest.me` to enable testing
with local URLs without adding entries to your host file" — `localtest.me` is a public wildcard
that resolves every subdomain to `127.0.0.1`. The guide shows `useSecureWebSocket` and
`wsProxy` for the WebSocket (`Pool`) path; this repository uses only the HTTP client
(`neon(url)`), so neither applies.

**What the image is.** Pinned by digest, because its only tag is `main`:

- `ghcr.io/timowilhelm/local-neon-http-proxy:main@sha256:cd2ae14edf2feafbc3330492de5c80506f77274c3bd013154cdef697bdeb768a`
  — `docker-content-digest` of the `main` tag as the registry returned it on 2026-10-06. Its
  OCI labels record `org.opencontainers.image.revision = 7c86dc3dd5bede570270120bbc2d45f2cef36217`
  (the repository's current `main` head, pushed 2026-03-27) and a build time of 2026-03-27.
- At that revision, `docker/neon-proxy/Dockerfile` clones **neondatabase/neon at tag
  `release-proxy-8853`** (commit `58abce0207943f44ac801aebc4f3d881e90a6894`) and builds Neon's
  own `proxy` binary with `--features testing`; `start.sh` runs it as
  `--auth-backend=postgres --auth-endpoint=$PG_CONNECTION_STRING --wss=0.0.0.0:4445` after
  creating `neon_control_plane.endpoints` with one `psql` call; the `Caddyfile` listens on
  `:4444` with **no host matcher**, reverse-proxies to the TLS listener with
  `tls_server_name db.localtest.me` and rewrites the upstream `Host` header itself.
- `pgvector/pgvector:pg17@sha256:ac08538c6f8b9904c33c8224c5e5706dbe760aca29db1d096972b4052c22a75d`
  — the `pg17` tag's digest on 2026-10-06.

`scripts/check-actions-pinned.sh` reads `uses:` lines, not `image:`, so these two pins are
held by review. They are recorded here so a bump is a deliberate diff against a named revision.

**Why `localhost`, not `db.localtest.me`.** The guide's hostname is a DNS convenience, not a
proxy requirement. In the proxy source at the tag the image builds,
`proxy/src/serverless/http_util.rs` → `get_conn_info` derives the endpoint id from the
connection string's hostname by its **first label** —
`hostname.split_once('.').map_or(hostname, |(prefix, _)| prefix)` — and consults no TLS
common name on the HTTP path (the `--wss` listener's certificate matters to a TLS client,
and Caddy, not the app, is that client here). An IP literal is refused
(`ConnInfoError::MissingHostname`). The postgres auth backend
(`proxy/src/control_plane/client/mock.rs`) uses the endpoint id only to look up
`allowed_ips` in `neon_control_plane.endpoints` (no row: unrestricted) and connects to the
host and port of `--auth-endpoint`, never to the host in the request.

So the job's `DATABASE_URL` is `postgres://postgres:postgres@localhost:5432/spawnforge_journeys`
and `E2E_NEON_HTTP_ENDPOINT` is `http://localhost:4444/sql`: the proxy reads endpoint id
`localhost`, the app never resolves the host at all (the override is a string, used verbatim),
and `scripts/assert-e2e-db-host.sh` can compare the host by **strict equality** rather than by
"is loopback". That strictness is deliberate: `127.0.0.1` is not a working alternative — the
proxy refuses it — and a hostname that merely contains `localhost` is the oldest URL trick
there is. The proxy container runs with `--network host` and
`PG_CONNECTION_STRING="$DATABASE_URL"`, so `localhost:5432` inside it is the service
container's published port and `:4444` lands on the runner.

**What it costs and buys.** Two image pulls per run and no secret, no Neon API call, no
branch from the ten-branch allowance that `scripts/preview-db-branch.sh` shares with
production, staging, snapshots and the per-PR preview. The job therefore runs identically on
same-repo, fork and Dependabot pull requests, which is the acceptance criterion option (a)
cannot meet. The database is destroyed with the runner; the proxy is a step-started container
and a step tears it down. The job `needs: test-e2e-engine-smoke` and downloads the WebGL2
engine that job uploads after proving it present (#9525's reuse-before-rebuild, carried one
job further), so it compiles nothing and tests exactly the bytes the smoke gate did; the
price is serialisation behind the smoke gate, and the wall time is recorded on the PR.

**Risks accepted.** The proxy is a third-party build of Neon's binary; a digest pin and the
driver-shaped probe (which asserts the `SELECT 1` **row**, not a status code — lessons 1 and
14) are what stand between a silent protocol drift and a green board. Postgres 17 in a
container is not Neon's Postgres; migrations that depend on Neon-only behaviour would pass
here and fail there, and `db:drift` against the migrated container is the check that keeps
the two honest. `drizzle-orm`'s neon-http migrator records every journal row only after the
whole chain applies, so a failed migration leaves no row; `web/scripts/apply-migrations.ts`
names the failing migration from the statement it was executing instead.

### (c) PGlite in the server process — rejected for this job

`web/src/lib/db/__tests__/pgliteHarness.ts` already replays `web/drizzle/` and reimplements the
driver's tagged-template composition with its fidelity pinned against the real driver, and it
needs no network and no secret. But:

- it is **vitest-only**: it stands in for `@/lib/db/client` with `vi.mock`, so serving the
  production `next start` through it would mean a second, PGlite-backed branch inside
  `client.ts` — a substitution in the server under test, which is precisely what #10158 says
  must be named as such and never counted as proven;
- it has a **single connection**, while a served app opens as many as its requests;
- `db:drift` **cannot reach it**, so drift would be "proven by the harness replay" rather than
  by the drift script the deploy path runs — the issue's acceptance criterion grants that
  only to (c), and (b) can satisfy the stronger form.

The harness stays the right tool for unit tests. It is not the right tool for the one job
whose purpose is to run the real driver, the real migrate and the real drift.

### (a) A per-run Neon branch through `scripts/preview-db-branch.sh` — rejected

- The branch allowance is fixed at ten and shared (script header). One more branch per
  concurrent PR run, on top of one preview per PR, is a capacity collision waiting for a
  busy afternoon, and a hit on the limit would fail a *required* check for a reason
  unrelated to the change.
- It needs `NEON_API_KEY`, which Dependabot runs do not receive. The journeys would then
  record a named `not-run` on exactly the PRs that most need an unattended gate, and the job
  would carry a secret-handling branch that (b) does not need at all.
- Provisioning is a network round-trip to a control plane, so it adds the one failure mode
  the other options avoid.

Use (a) only if both (b) and (c) fail. Neither did.

## Consequences

- **Selector for the journeys that follow.** #10152, #10153 and #10154 tag their tests
  `@engine-journey`. `playwright.journeys.config.ts` greps that tag and nothing else; the
  smoke config greps `@engine-smoke|@engine-ui` and must never gain `@engine-journey`
  (`scripts/__tests__/e2e-tag-routing.test.sh` pins both), and a journey spec must not also
  carry `@ui`, because the keyless, database-less @ui shard would try to run it. A run that
  selects zero tests fails in Playwright itself ("No tests found"), so a renamed tag cannot
  pass vacuously.
- **Journey evidence is not yet wired here.** `scripts/check-journey-evidence.ts` refuses
  `--min-journeys` below 1 by design and no journey lives in this job until #10153; that PR
  registers `journeyEvidenceReporter` in the journeys config and adds the upload and check
  steps exactly as `test-e2e-engine-smoke` has them.
- **Clerk** is #10162's. This job serves a keyless build; the account fixture lands on top.
- The job is in `ci-success.needs` and mapped to both arms of its `if:` (`needs-web`,
  `needs-engine`) in `scripts/check-ci-success.sh`, like the smoke gate.

## Verification record

| Claim | How it was checked |
|---|---|
| Image digests | `docker-content-digest` response headers from `ghcr.io` and `registry-1.docker.io`, 2026-10-06 |
| Image build revision and date | OCI index annotations and config labels of the pinned digest |
| Proxy tag, flags, Caddy listener | `docker/neon-proxy/{Dockerfile,start.sh,Caddyfile}` at revision `7c86dc3d`, read through the GitHub API |
| Hostname → endpoint id, IP literals refused | `proxy/src/serverless/http_util.rs` at `release-proxy-8853` |
| Auth backend connects to `--auth-endpoint`, endpoint id only gates `allowed_ips` | `proxy/src/control_plane/client/mock.rs` at `release-proxy-8853` |
| `fetchEndpoint` accepts a full URL string | neondatabase/serverless `CONFIG.md`; `e2eNeonEndpoint.test.ts` against the installed 1.1.0 |
| Migrator records journal rows after the whole chain | `node_modules/drizzle-orm/neon-http/migrator.js` |
| The job end to end, and the migration mutation | Only CI can run them; the PR body carries the run links and the quoted log |
