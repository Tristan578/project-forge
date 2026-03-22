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

/** Canonical model → OpenRouter model ID */
const MODEL_MAP: Record<string, string> = {
  // Anthropic models on OpenRouter
  'claude-sonnet-4-6': 'anthropic/claude-sonnet-4-6',
  'claude-opus-4': 'anthropic/claude-opus-4',
  'claude-haiku-3-5': 'anthropic/claude-haiku-3-5',
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
