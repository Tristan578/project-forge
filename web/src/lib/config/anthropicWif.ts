/**
 * Environment contract for Anthropic Workload Identity Federation (#8858).
 *
 * The single source of the env-var NAMES, shared by the credential exchange
 * (`@/lib/ai/wifCredential`), the startup validator (`validateEnv.ts`) and the
 * health check (`healthChecks.ts`), so none of them can drift from the others.
 *
 * Deliberately import-free: `validateEnv.ts` runs from `instrumentation.ts`
 * `register()`, including in the edge runtime, and must not pull in Sentry or
 * the network code that `wifCredential.ts` carries.
 *
 * The three REQUIRED variables are the three required fields of the token
 * exchange request other than the JWT itself (`federation_rule_id`,
 * `organization_id`, `service_account_id`), per
 * https://platform.claude.com/docs/en/manage-claude/wif-reference#token-exchange-request.
 * `workspace_id` is "Conditional" there — required only when the federation rule
 * is enabled for more than one workspace — so it does not gate activation,
 * matching how the Anthropic SDKs treat `ANTHROPIC_WORKSPACE_ID`.
 *
 * The names carry a `WIF_` infix rather than reusing the SDKs' own
 * `ANTHROPIC_FEDERATION_RULE_ID` / `ANTHROPIC_ORGANIZATION_ID` /
 * `ANTHROPIC_SERVICE_ACCOUNT_ID`: this app performs the exchange itself (the
 * installed `@ai-sdk/anthropic` has no federation support), and a distinct
 * namespace keeps any other Anthropic tooling in the same environment from
 * silently changing its credential source.
 */

export const ANTHROPIC_WIF_REQUIRED_ENV = {
  federationRuleId: 'ANTHROPIC_WIF_FEDERATION_RULE_ID',
  organizationId: 'ANTHROPIC_WIF_ORGANIZATION_ID',
  serviceAccountId: 'ANTHROPIC_WIF_SERVICE_ACCOUNT_ID',
} as const;

/** Optional — see the module comment. Never gates activation. */
export const ANTHROPIC_WIF_WORKSPACE_ENV = 'ANTHROPIC_WIF_WORKSPACE_ID';

/** The required variable names, in a stable order. */
export const ANTHROPIC_WIF_REQUIRED_ENV_NAMES: readonly string[] = Object.values(
  ANTHROPIC_WIF_REQUIRED_ENV,
);

/** Names of the required WIF variables that are unset or empty. */
export function missingAnthropicWifEnv(): string[] {
  return ANTHROPIC_WIF_REQUIRED_ENV_NAMES.filter((name) => !process.env[name]);
}

/**
 * True when every required WIF variable is set. This is the ONLY activation
 * test — `getAnthropicCredential()` and the health check both call it, so the
 * reported state and the behaviour cannot disagree.
 */
export function isAnthropicWifConfigured(): boolean {
  return missingAnthropicWifEnv().length === 0;
}
