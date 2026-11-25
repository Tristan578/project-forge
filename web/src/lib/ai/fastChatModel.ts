/**
 * The fast-tier chat model for a resolved platform/BYOK key, on whichever
 * endpoint that key authenticates against.
 *
 * `/api/generate/{localize,pacing}` used to build `createAnthropic(...)`
 * unconditionally, so on a deployment that routes everything else through the
 * Vercel AI Gateway they were the last calls still needing `ANTHROPIC_API_KEY`.
 * The resolver now returns the gateway credential for platform chat whenever
 * the gateway can authenticate (`GATEWAY_PREFERRED_CAPABILITIES`), tagged
 * `route: 'gateway'`; this helper turns that into a gateway model, and every
 * other key (BYOK, or the direct Anthropic platform key on a deployment with no
 * gateway) into the Anthropic model exactly as before.
 *
 * The key is passed to the client constructor and nowhere else: it is not
 * logged, not returned, and not placed in an error message.
 */
import { createAnthropic } from '@ai-sdk/anthropic';
import { createGateway } from '@ai-sdk/gateway';
import { anthropicClientAuthForKey } from '@/lib/ai/wifCredential';
import { omitUndefinedValues } from '@/lib/utils/omitUndefined';
import { AI_MODEL_FAST, GATEWAY_MODEL_FAST } from '@/lib/ai/models';
import type { KeyRoute } from '@/lib/keys/resolver';
import { DIRECT_CAPABILITY_PROVIDER, type ProviderName } from '@/lib/config/providers';

export interface FastChatModel {
  /** AI SDK model instance to pass as `model`. */
  model: ReturnType<ReturnType<typeof createGateway>> | ReturnType<ReturnType<typeof createAnthropic>>;
  /** Model id, for analytics. */
  modelId: string;
  /** Endpoint the call goes to, for analytics. */
  provider: ProviderName;
}

/**
 * Build the fast-tier chat model for a resolved key.
 * @param apiKey Key from `resolveApiKey`. On the gateway route an empty string
 *   means "authenticate with the Vercel OIDC token".
 * @param keyRoute `ResolvedKey.route`; anything but `'gateway'` is direct.
 * @returns The model instance plus the id and provider to report.
 */
export function fastChatModelForKey(apiKey: string, keyRoute: KeyRoute | undefined): FastChatModel {
  if (keyRoute === 'gateway') {
    // An empty key means OIDC: omit `apiKey` so the gateway client reads
    // AI_GATEWAY_API_KEY (absent here) and then the Vercel OIDC token.
    const gatewayProvider = createGateway(apiKey ? { apiKey } : {});
    return { model: gatewayProvider(GATEWAY_MODEL_FAST), modelId: GATEWAY_MODEL_FAST, provider: 'vercel-gateway' };
  }
  // A platform key can be a federated Bearer token (#8858); passing it as
  // `apiKey` would send it as `x-api-key`, which Anthropic rejects.
  // omitUndefinedValues: `AnthropicClientAuth` admits an explicit
  // `apiKey: undefined`, but `AnthropicProviderSettings` does not.
  const anthropicProvider = createAnthropic(omitUndefinedValues(anthropicClientAuthForKey(apiKey)));
  return { model: anthropicProvider(AI_MODEL_FAST), modelId: AI_MODEL_FAST, provider: DIRECT_CAPABILITY_PROVIDER.chat };
}
