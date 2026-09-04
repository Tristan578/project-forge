/**
 * Vercel AI Gateway backend.
 *
 * Routes traffic through the Vercel AI Gateway at https://ai-gateway.vercel.sh/v1.
 * Supports OIDC auto-auth for Vercel deployments, or explicit AI_GATEWAY_API_KEY.
 * Capabilities: chat, embedding, image.
 */

import type { ProviderBackend, ProviderCapability } from '../types';
import { AI_MODELS } from '@/lib/ai/models';
import { isVercelRuntime } from '@/lib/config/providers';

const ENDPOINT = 'https://ai-gateway.vercel.sh/v1';

const DEFAULT_MODELS: Record<string, string> = {
  chat: AI_MODELS.gatewayChat,
  embedding: AI_MODELS.gatewayEmbedding,
  image: 'openai/dall-e-3',
};

const MODEL_MAP: Record<string, string> = {
  // Anthropic models — keep in sync with AI_MODELS in @/lib/ai/models. Every
  // canonical chat ID exposed to clients MUST appear here, otherwise the
  // gateway path falls back to DEFAULT_MODELS.chat (Sonnet) and silently
  // downgrades the request. On the premium path that means a Pro user whose
  // subscription entitles them to Opus 4.8 (the premium gate in
  // /api/chat/route.ts has already admitted the request) silently gets
  // Sonnet instead — no billing overcharge, but the user doesn't get the
  // model quality they're paying for. On the fast path it runs the other
  // way: a Haiku request gets upgraded to Sonnet, inflating upstream
  // per-request cost for what was meant to be the cheap tier.
  'claude-sonnet-5': 'anthropic/claude-sonnet-5',
  'claude-opus-5': 'anthropic/claude-opus-5',
  // 4.x ids stay mapped after the Claude 5 migration (PF-1216 / #9339) so an
  // explicitly-requested legacy model still routes to itself, and so pointing
  // AI_MODEL_PRIMARY/AI_MODEL_PREMIUM back at them needs no edit here.
  'claude-sonnet-4-6': 'anthropic/claude-sonnet-4-6',
  'claude-opus-4-8': 'anthropic/claude-opus-4-8',
  'claude-haiku-4-5': 'anthropic/claude-haiku-4-5',
  'claude-haiku-4-5-20251001': 'anthropic/claude-haiku-4-5',
  // OpenAI models
  'gpt-4o': 'openai/gpt-4o',
  'gpt-4o-mini': 'openai/gpt-4o-mini',
  'dall-e-3': 'openai/dall-e-3',
  // Google models
  'gemini-2-flash': 'google/gemini-2.0-flash',
  'gemini-embedding-2-preview': 'google/gemini-embedding-2-preview',
};

export const vercelGatewayBackend: ProviderBackend = {
  id: 'vercel-gateway',
  name: 'Vercel AI Gateway',
  capabilities: ['chat', 'embedding', 'image'] as ReadonlyArray<ProviderCapability>,

  isConfigured(): boolean {
    // Configured if either an explicit key is present or we're on a Vercel deployment
    // (OIDC tokens are injected automatically by the runtime)
    return Boolean(process.env.AI_GATEWAY_API_KEY) || isVercelRuntime();
  },

  getApiKey(): string {
    return process.env.AI_GATEWAY_API_KEY ?? '';
  },

  getEndpoint(): string {
    return ENDPOINT;
  },

  resolveModelId(canonicalModel: string): string {
    if (canonicalModel in MODEL_MAP) {
      return MODEL_MAP[canonicalModel];
    }
    // Check if it's already in gateway format (contains '/')
    if (canonicalModel.includes('/')) {
      return canonicalModel;
    }
    // Default to chat model
    return DEFAULT_MODELS.chat;
  },
};

export { DEFAULT_MODELS as vercelGatewayDefaultModels };
