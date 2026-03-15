/**
 * Unified AI provider abstraction types.
 *
 * Defines the capability taxonomy, backend identifiers, and the ProviderBackend
 * interface used by all concrete backend implementations.
 */

/** All capability types that a backend can support */
export type ProviderCapability =
  | 'chat'
  | 'embedding'
  | 'image'
  | 'model3d'
  | 'texture'
  | 'sfx'
  | 'voice'
  | 'music'
  | 'sprite'
  | 'bg_removal';

/** All supported backend identifiers */
export type BackendId =
  | 'direct'
  | 'vercel-gateway'
  | 'openrouter'
  | 'github-models'
  | 'cloudflare-ai'
  | 'byok';

/**
 * A resolved route — everything needed to make an API call through a
 * specific backend for a specific capability.
 */
export interface ResolvedRoute {
  /** Which backend is handling this request */
  backendId: BackendId;
  /** API key to use — may be empty string for OIDC-authenticated backends */
  apiKey: string;
  /** Optional base URL override */
  endpoint?: string;
  /** Resolved model identifier (backend-specific format) */
  modelId?: string;
  /** Whether this call should be tracked in the cost ledger */
  metered: boolean;
  /** Usage record ID if metered — set after token deduction */
  usageId?: string;
}

/**
 * Interface every backend must implement.
 * Backends are plain objects — no classes required.
 */
export interface ProviderBackend {
  /** Unique backend identifier */
  id: BackendId;
  /** Human-readable name for the backend */
  name: string;
  /** Capabilities this backend can fulfil */
  capabilities: ReadonlyArray<ProviderCapability>;
  /** Returns true if this backend is usable in the current environment */
  isConfigured(): boolean;
  /** Returns the API key, or empty string for OIDC-authenticated backends */
  getApiKey(): string;
  /** Returns the base API endpoint URL */
  getEndpoint(): string;
  /**
   * Maps a canonical model name to the backend-specific model identifier.
   * Returns the input unchanged if no mapping is needed.
   */
  resolveModelId(canonicalModel: string): string;
}
