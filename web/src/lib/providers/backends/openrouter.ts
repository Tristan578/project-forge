/**
 * OpenRouter backend.
 *
 * Routes traffic through the OpenRouter API at https://openrouter.ai/api/v1.
 * OpenAI-compatible endpoint with 500+ models. Requires OPENROUTER_API_KEY.
 * Capabilities: chat, embedding, image.
 */

import type { ProviderBackend, ProviderCapability } from '../types';
import { AI_MODELS } from '@/lib/ai/models';

const ENDPOINT = 'https://openrouter.ai/api/v1';

/**
 * Canonical model → OpenRouter model ID.
 *
 * Anthropic models — keep in sync with AI_MODELS in @/lib/ai/models. Every
 * canonical chat ID exposed to clients MUST appear here, otherwise
 * resolveModelId falls back to DEFAULT_MODEL (Sonnet) and silently
 * downgrades the request. On the premium path that means a Pro user whose
 * subscription entitles them to Opus 4.8 (the premium gate in
 * /api/chat/route.ts has already admitted the request) silently gets
 * Sonnet instead. On the fast path it runs the other way: a Haiku request
 * gets upgraded to Sonnet, inflating upstream per-request cost for what was
 * meant to be the cheap tier.
 */
const MODEL_MAP: Record<string, string> = {
  // Anthropic models on OpenRouter
  'claude-sonnet-4-6': 'anthropic/claude-sonnet-4-6',
  'claude-opus-4-8': 'anthropic/claude-opus-4-8',
  'claude-haiku-4-5': 'anthropic/claude-haiku-4-5',
  'claude-haiku-4-5-20251001': 'anthropic/claude-haiku-4-5',
  // OpenAI models on OpenRouter
  'gpt-4o': 'openai/gpt-4o',
  'gpt-4o-mini': 'openai/gpt-4o-mini',
  'dall-e-3': 'openai/dall-e-3',
  // Google models on OpenRouter
  'gemini-2-flash': 'google/gemini-2.0-flash-exp:free',
  'gemini-pro': 'google/gemini-pro',
  // Meta models on OpenRouter
  'llama-3-70b': 'meta-llama/llama-3-70b-instruct',
  'llama-3-8b': 'meta-llama/llama-3-8b-instruct:free',
  // Mistral models on OpenRouter
  'mistral-large': 'mistralai/mistral-large',
  'mistral-7b': 'mistralai/mistral-7b-instruct:free',
};

const DEFAULT_MODEL = AI_MODELS.openrouterDefault;

export const openrouterBackend: ProviderBackend = {
  id: 'openrouter',
  name: 'OpenRouter',
  capabilities: ['chat', 'embedding', 'image'] as ReadonlyArray<ProviderCapability>,

  isConfigured(): boolean {
    return Boolean(process.env.OPENROUTER_API_KEY);
  },

  getApiKey(): string {
    return process.env.OPENROUTER_API_KEY ?? '';
  },

  getEndpoint(): string {
    return ENDPOINT;
  },

  resolveModelId(canonicalModel: string): string {
    if (canonicalModel in MODEL_MAP) {
      return MODEL_MAP[canonicalModel];
    }
    // Pass through if already in provider/model format
    if (canonicalModel.includes('/')) {
      return canonicalModel;
    }
    return DEFAULT_MODEL;
  },
};
