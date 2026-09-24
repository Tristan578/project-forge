# Activating Anthropic Workload Identity Federation (#8858)

The platform Anthropic credential is a single long-lived secret,
`ANTHROPIC_API_KEY`. If it leaks, it works from anywhere until someone rotates
it, and the Claude Console cannot tell which deployment made a given call.

[Workload Identity Federation](https://platform.claude.com/docs/en/manage-claude/workload-identity-federation)
(WIF) replaces it with a short-lived token. The server exchanges the OIDC JWT
that Vercel issues to the function for an Anthropic access token bound to a
**service account**. Anthropic's docs describe that token as "prefixed
`sk-ant-oat01-...`", sent as `Authorization: Bearer`. The exchange lives in
`web/src/lib/ai/wifCredential.ts`. It follows the documented request and
response in the
[WIF reference](https://platform.claude.com/docs/en/manage-claude/wif-reference#token-exchange-request):
`POST https://api.anthropic.com/v1/oauth/token` with the RFC 7523 `jwt-bearer`
grant.

What uses the federated token when it is on:

- **The direct-backend chat client**. `/api/chat` resolves the credential
  before it builds the agent. This applies only when the request routes to the
  `direct` backend, not through the AI Gateway, OpenRouter or GitHub Models. The
  keys that are set decide which backend serves chat.
- **`getPlatformKey('anthropic')`** in `web/src/lib/keys/resolver.ts`. This is
  the platform key that `/api/generate/localize` and `/api/generate/pacing` use.
  Those routes turn it into a client with `anthropicClientAuthForKey()`, so a
  Bearer token is never sent as `x-api-key`.

A user's own (BYOK) Anthropic key still wins over any platform credential.

## Dormant by default

The feature is **fully dormant** until all three variables are set:

| Variable | Exchange field | Value |
|---|---|---|
| `ANTHROPIC_WIF_FEDERATION_RULE_ID` | `federation_rule_id` | `fdrl_...` |
| `ANTHROPIC_WIF_ORGANIZATION_ID` | `organization_id` | organization UUID |
| `ANTHROPIC_WIF_SERVICE_ACCOUNT_ID` | `service_account_id` | `svac_...` |
| `ANTHROPIC_WIF_WORKSPACE_ID` *(optional)* | `workspace_id` | `wrkspc_...` or `default`. Required only when the rule is enabled for more than one workspace |

- With any of the three unset, `getAnthropicCredential()` returns `null`
  **without a network call**, and every caller uses `ANTHROPIC_API_KEY` exactly
  as before.
- A partial set, meaning one or two of the three, is not an error. It prints a
  startup **warning** from `validateEnvironment()` that names the missing
  variables, because the only other symptom is that federation silently stays
  off.
- These names are this app's own. They are deliberately **not** the Anthropic
  SDKs' `ANTHROPIC_FEDERATION_RULE_ID` family. This app does the exchange
  itself, because the installed `@ai-sdk/anthropic` has no federation support.

**Keep `ANTHROPIC_API_KEY` set.** Every failed exchange falls back to it. The
capability-availability tables in `web/src/lib/config/providers.ts` and
`directBackend.getApiKey()` also still read it. Running on federation alone is
out of scope for this change.

Anthropic's docs warn that `ANTHROPIC_API_KEY` "shadows federation" in the
SDKs' automatic credential resolution. That does **not** apply here: this app
tries federation first, explicitly.

## Activation steps (owner-only)

These steps are for project `spawnforge`, Vercel scope `tnolan`, team
`team_5SxqWz8yLPKiOnLbTXUyJKsp`. **Never** use `nolantj-livecoms-projects`.

1. **[HUMAN] Confirm OIDC federation is enabled on the Vercel project.** This
   is a dashboard setting on the `spawnforge` project; see
   [Vercel OIDC](https://vercel.com/docs/oidc). This guide does not assume
   whether it is already on, so check it. Note which **issuer mode** the team
   uses:
   - Team mode: `iss` = `https://oidc.vercel.com/<team_slug>`
   - Global mode: `iss` = `https://oidc.vercel.com`
2. **Read the claims of a real token.** Run `vercel env pull` (scope `tnolan`).
   This writes a development `VERCEL_OIDC_TOKEN` to `.env.local`. Decode it with
   the command from Anthropic's troubleshooting guide:
   ```bash
   jq -rR 'split(".")[1] | gsub("-";"+") | gsub("_";"/") | @base64d | fromjson' <<< "$VERCEL_OIDC_TOKEN"
   ```
   Record `iss`, `aud`, `sub` and `exp - iat`. Vercel's documented example has
   these values:
   - `aud` = `https://vercel.com/<team_slug>`
   - `sub` = `owner:<team_slug>:project:<project>:environment:<env>`
   - `exp - iat` = 7200 seconds

   Confirm against the token you decoded rather than the example. A local
   development token may differ from the one the deployed function receives.
3. **[HUMAN] Create the federation in the Claude Console.** Go to **Settings →
   Workload identity → Connect workload** and choose **Custom OIDC**. The wizard
   creates the issuer, the service account and the rule in one flow.
   - **Issuer URL:** the decoded `iss`, byte for byte. Anthropic rejects any
     mismatch, including a trailing slash. Keep the default JWKS source,
     `discovery`, and use **Verify issuer** to confirm Anthropic can fetch the
     keys. If discovery fails, check the JWKS options in the
     [WIF reference](https://platform.claude.com/docs/en/manage-claude/wif-reference#jwks-source-modes).
   - **Maximum JWT lifetime:** Anthropic rejects a JWT whose `exp - iat` exceeds
     the issuer's maximum, which is "1 hour by default". If step 2 showed more
     than 3600 seconds, raise the issuer's maximum or every exchange fails.
   - **Match:** `subject_prefix` set to the decoded `sub` for the production
     environment, for example
     `owner:<team_slug>:project:spawnforge:environment:production`, plus
     `audience` set to the decoded `aud`. A rule must set at least one of
     `subject_prefix`, `claims` or `condition`; an `audience`-only rule is
     rejected. Give Preview its own rule, or leave Preview on the static key.
   - **Scope:** chat needs only Messages. `workspace:inference` covers
     "Messages (including streaming and token counting), Models". The wizard
     prefills `workspace:developer`, which also allows Files, Skills and Managed
     Agents.
   - **Token lifetime:** the wizard prefills `600`. The app re-exchanges 60
     seconds before expiry.
   - Record the rule ID (`fdrl_...`), the service account ID (`svac_...`) and
     the organization UUID (**Settings → Organization**). Also record the
     workspace ID if the rule spans more than one workspace.
4. **Set the variables in Vercel.** Set them for Production, and for Preview
   only if you created a Preview rule.
   ```bash
   vercel env add ANTHROPIC_WIF_FEDERATION_RULE_ID production --scope tnolan
   vercel env add ANTHROPIC_WIF_ORGANIZATION_ID production --scope tnolan
   vercel env add ANTHROPIC_WIF_SERVICE_ACCOUNT_ID production --scope tnolan
   # only if the rule spans several workspaces:
   vercel env add ANTHROPIC_WIF_WORKSPACE_ID production --scope tnolan
   ```
5. **Redeploy** so the functions pick up the new variables.
6. **Pull locally.** Run `vercel env pull` again so `.env.local` matches.
   Locally the exchange uses `VERCEL_OIDC_TOKEN` from that file, which expires.
   When local exchanges start failing, pull again.

## Verifying it is live

- **The Console's authentication history. [HUMAN]** Anthropic's
  [WIF reference](https://platform.claude.com/docs/en/manage-claude/wif-reference)
  says every assertion denial returns the same opaque 401
  (`authentication_error`, `Authentication failed`), and that the deny reason
  is recorded on the attempt's entry in the authentication history instead,
  for example `match_subject_prefix`, `workspace_id_required` or `jti_reused`.
  That entry is the authoritative signal. The reference links the page as
  https://platform.claude.com/settings/workload-identity-federation?tab=history.
  Reading this deployment's own attempts there needs a Console login, which is
  the [HUMAN] part.
- **Sentry.** A failed exchange is captured once, followed by 60 seconds of
  backoff during which the static key is used without retrying. The captured
  error is one of these fixed messages:
  - `Anthropic WIF token exchange failed: HTTP <status>`
  - `Anthropic WIF: no Vercel OIDC token ...`, which means OIDC is not reaching
    the function (step 1)
  - A response-shape message

  Silence in Sentry, with Console history showing successful exchanges, means
  the feature is working.
- **Health report.** The internal report from `runAllHealthChecks()` carries
  `details.wifConfigured` on the **Chat Backend** entry. It reflects whether
  the three variables are present, not whether an exchange succeeded. The
  public `GET /api/health` strips every `details` object (`sanitizeForPublic`),
  so the field does **not** appear there.

## Rolling back

Remove any one of the three variables in Vercel and redeploy. The feature
returns to fully dormant immediately: no exchange runs, and every path uses
`ANTHROPIC_API_KEY`. Nothing is persisted, because the token cache is in memory
per function instance, so there is nothing to migrate or clean up.

## Maintenance note

The exchange is hand-written because the installed `@ai-sdk/anthropic` accepts
only a concrete `apiKey` or `authToken` string. If the SDK gains a credential
provider, or the app moves to `@anthropic-ai/sdk` (whose
`oidcFederationProvider` the Anthropic docs show), replace the manual fetch.
Also drop `anthropicClientAuthForKey()` once every Anthropic client takes a
typed credential.

`web/src/lib/ai/__tests__/wifCredential.test.ts` pins the documented request
and response shape and cites the reference URL beside the assertion. If
Anthropic changes the contract, change that test **from the docs**, not from
the code.
