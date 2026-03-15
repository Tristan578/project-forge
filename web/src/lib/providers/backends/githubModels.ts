/**
 * GitHub Models backend.
 *
 * Routes traffic through GitHub's free model inference endpoint at
 * https://models.inference.ai.azure.com. Requires a GitHub Personal Access Token
 * (GITHUB_MODELS_PAT). Free tier — ideal for prototyping and developer audiences.
 * Capabilities: chat, embedding.
 */

import type { ProviderBackend, ProviderCapability } from '../types';

const ENDPOINT = 'https://models.inference.ai.azure.com';

/** Canonical model → GitHub Models deployment name */
const MODEL_MAP: Record<string, string> = {
  // OpenAI models available on GitHub Models
  'gpt-4o': 'gpt-4o',
  'gpt-4o-mini': 'gpt-4o-mini',
  'o1-mini': 'o1-mini',
  'o1-preview': 'o1-preview',
  // Meta Llama models
  'llama-3-70b': 'Meta-Llama-3-70B-Instruct',
  'llama-3-8b': 'Meta-Llama-3-8B-Instruct',
  'llama-3.2-90b': 'Llama-3.2-90B-Vision-Instruct',
  'llama-3.2-11b': 'Llama-3.2-11B-Vision-Instruct',
  // Mistral models
  'mistral-large': 'Mistral-large',
  'mistral-nemo': 'Mistral-Nemo',
  'mistral-small': 'Mistral-small',
  // Phi models
  'phi-3-medium': 'Phi-3-medium-128k-instruct',
  'phi-3-mini': 'Phi-3-mini-128k-instruct',
  'phi-3.5-mini': 'Phi-3.5-mini-instruct',
  // Cohere models
  'cohere-r-plus': 'Cohere-command-r-plus',
  'cohere-r': 'Cohere-command-r',
  // AI21 models
  'jamba-1.5-mini': 'AI21-Jamba-1.5-Mini',
  'jamba-1.5-large': 'AI21-Jamba-1.5-Large',
  // Embeddings
  'text-embedding-3-small': 'text-embedding-3-small',
  'text-embedding-3-large': 'text-embedding-3-large',
  'cohere-embed-v3': 'Cohere-embed-v3-multilingual',
};

const DEFAULT_MODEL = 'gpt-4o-mini';

export const githubModelsBackend: ProviderBackend = {
  id: 'github-models',
  name: 'GitHub Models',
  capabilities: ['chat', 'embedding'] as ReadonlyArray<ProviderCapability>,

  isConfigured(): boolean {
    return Boolean(process.env.GITHUB_MODELS_PAT);
  },

  getApiKey(): string {
    return process.env.GITHUB_MODELS_PAT ?? '';
  },

  getEndpoint(): string {
    return ENDPOINT;
  },

  resolveModelId(canonicalModel: string): string {
    if (canonicalModel in MODEL_MAP) {
      return MODEL_MAP[canonicalModel];
    }
    // GitHub Models uses flat names (no provider prefix)
    return canonicalModel || DEFAULT_MODEL;
  },
};
