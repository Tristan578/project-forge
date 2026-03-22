/**
 * Vercel AI Gateway backend.
 *
 * Routes traffic through the Vercel AI Gateway at https://ai-gateway.vercel.sh/v1.
 * Supports OIDC auto-auth for Vercel deployments, or explicit AI_GATEWAY_API_KEY.
 * Capabilities: chat, embedding, image.
 */

import type { ProviderBackend, ProviderCapability } from '../types';
import { AI_MODELS } from '@/lib/ai/models';

const ENDPOINT = 'https://ai-gateway.vercel.sh/v1';

const DEFAULT_MODELS: Record<string, string> = {
  chat: AI_MODELS.gatewayChat,
  embedding: AI_MODELS.gatewayEmbedding,
  image: 'openai/dall-e-3',
};

const MODEL_MAP: Record<string, string> = {
  // Anthropic models
  'claude-sonnet-4-6': 'anthropic/claude-sonnet-4-6',
  'claude-opus-4': 'anthropic/claude-opus-4',
  'claude-haiku-3-5': 'anthropic/claude-haiku-3-5',
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
    return Boolean(
      process.env.AI_GATEWAY_API_KEY ||
      process.env.VERCEL ||
      process.env.VERCEL_ENV
    );
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
