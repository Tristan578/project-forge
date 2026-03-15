# AI Gateway & Provider Backend Research

> Research date: 2026-03-15
> Purpose: Evaluate AI gateway/proxy services for SpawnForge's provider abstraction layer
> Current state: Direct provider keys only (Anthropic, OpenAI, Meshy, Hyper3D, ElevenLabs, Suno, Replicate, RemoveBG)

---

## Table of Contents

1. [Provider Assessments](#provider-assessments)
2. [Comparison Matrix](#comparison-matrix)
3. [Recommendation & Priority Order](#recommendation--priority-order)
4. [Integration Notes for SpawnForge](#integration-notes-for-spawnforge)

---

## Provider Assessments

### 1. Vercel AI Gateway

| Attribute | Details |
|-----------|---------|
| **URL** | https://vercel.com/ai-gateway |
| **Capabilities** | Chat, embeddings, image generation (via providers) |
| **Auth** | OIDC tokens (auto on Vercel), API key for non-Vercel deployments (`AI_GATEWAY_API_KEY`) |
| **Pricing** | Zero markup on provider token prices. $5 free credits/month on signup. Pay-as-you-go credits |
| **API Format** | Vercel AI SDK (TypeScript-native). OpenAI-compatible via SDK adapters |
| **Self-Hostable** | No -- Vercel-managed only |
| **BYOK** | Yes. First-class support. No extra per-token charge when using own keys |
| **Models** | 100+ models: OpenAI, Anthropic, Google, Meta, xAI, Mistral, DeepSeek, Cohere, Perplexity, Alibaba, Amazon Bedrock |
| **Relevance** | **HIGH** -- SpawnForge already deploys on Vercel. Native Next.js integration via AI SDK v6. Embedding support for future RAG features. Zero markup aligns with indie dev pricing sensitivity |

**Key advantages:**
- Native integration with SpawnForge's Next.js 16 stack
- AI SDK v6 provides streaming, tool calling, embeddings out of the box
- OIDC auth is automatic on Vercel deployments (no key management)
- Zero markup pricing makes it cost-neutral vs direct provider access
- Built-in observability dashboard

**Key risks:**
- Vendor lock-in to Vercel platform
- OIDC token expires every 12 hours in local dev (needs `vc env pull`)

---

### 2. OpenRouter

| Attribute | Details |
|-----------|---------|
| **URL** | https://openrouter.ai |
| **Capabilities** | Chat, embeddings (multimodal), image generation (GPT-5 Image, Gemini, others) |
| **Auth** | API key (single key for all models) |
| **Pricing** | No markup on provider token prices. 5.5% platform fee (min $0.80) on non-crypto payments. BYOK: first 1M requests/month free, then 5% fee. Free models available (rate-limited: 20 req/min, 200 req/day) |
| **API Format** | OpenAI-compatible REST API. Works with any OpenAI SDK |
| **Self-Hostable** | No |
| **BYOK** | Yes. Bring own provider keys with generous free tier (1M requests/month) |
| **Models** | 500+ models: Claude, GPT, Gemini, DeepSeek, Llama, Grok, Mistral, and hundreds more |
| **Relevance** | **HIGH** -- Largest model selection. Popular with indie devs. OpenAI-compatible API means minimal integration effort. Free models for prototyping. Credit-based system with no minimums |

**Key advantages:**
- Largest model catalog (500+) through single API key
- OpenAI-compatible = drop-in replacement in most code
- Free models available for users without budget
- No minimum purchase, no expiration on credits
- Very popular in indie/hobbyist community
- Multimodal embeddings (text + image)

**Key risks:**
- 5.5% platform fee adds up at scale
- Free model rate limits are tight (200 req/day)
- Not self-hostable -- single point of failure

---

### 3. GitHub Models

| Attribute | Details |
|-----------|---------|
| **URL** | https://github.com/marketplace/models |
| **Capabilities** | Chat, embeddings. No image generation. Limited audio |
| **Auth** | GitHub Personal Access Token (PAT) with `models:read` permission |
| **Pricing** | Free tier with rate limits (varies by model, e.g. GPT-4o: 10 req/min, 50 req/day). Paid use available via GitHub billing |
| **API Format** | OpenAI-compatible REST API (Azure-backed) |
| **Self-Hostable** | No |
| **BYOK** | No -- uses GitHub's managed infrastructure |
| **Models** | OpenAI (GPT-4o, GPT-4.1), Anthropic (Claude Sonnet 4, Opus 4), Meta (Llama), DeepSeek, Microsoft Phi, Mistral, Cohere, Grok |
| **Relevance** | **MEDIUM** -- Good free tier for prototyping. PAT auth is simple. But rate limits are very restrictive for production use. No BYOK limits flexibility |

**Key advantages:**
- Free access with existing GitHub account
- PAT-based auth is familiar to developers
- Azure-backed infrastructure is reliable
- Good for prototyping and testing

**Key risks:**
- Very restrictive rate limits (50 req/day for top models)
- No BYOK -- can't bring own provider keys
- Limited to chat/embeddings -- no image/audio generation
- Not suitable for production workloads without paid tier

---

### 4. LiteLLM

| Attribute | Details |
|-----------|---------|
| **URL** | https://github.com/BerriAI/litellm |
| **Capabilities** | Chat, embeddings, image generation (via underlying providers) |
| **Auth** | Configurable: API key, JWT, SSO (enterprise). Users provide their own provider keys |
| **Pricing** | Open source (free). Enterprise Basic: $250/month. Enterprise Premium: $30,000/year. SSO free for up to 5 users |
| **API Format** | OpenAI-compatible proxy. Supports native provider formats too |
| **Self-Hostable** | Yes -- Docker image, Helm chart, requires Postgres (+ Redis for distributed) |
| **BYOK** | Yes -- core design. Users configure their own provider API keys |
| **Models** | 100+ providers: OpenAI, Anthropic, Google Vertex, AWS Bedrock, Azure, Cohere, HuggingFace, Groq, NVIDIA NIM, Sagemaker, VLLM |
| **Relevance** | **MEDIUM** -- Excellent for self-hosted deployments or enterprise customers. Overkill for SpawnForge's SaaS model. But useful as a reference architecture for the provider abstraction pattern |

**Key advantages:**
- Fully open source and self-hostable
- 100+ provider support through unified API
- Cost tracking, guardrails, load balancing built in
- No vendor lock-in
- Docker deployment is straightforward

**Key risks:**
- Requires infrastructure management (Postgres, Docker)
- Enterprise features (SSO, RBAC) behind paywall
- Adds operational complexity for a SaaS product
- Python-based -- doesn't fit SpawnForge's TypeScript stack natively

---

### 5. Portkey

| Attribute | Details |
|-----------|---------|
| **URL** | https://portkey.ai |
| **Capabilities** | Chat, embeddings, image generation, audio (routes to 1600+ models across providers) |
| **Auth** | API key. Enterprise: SSO, RBAC |
| **Pricing** | Free: 10K logs/month, 30-day retention. Pro: custom pricing (~$9/100K logs). Enterprise: custom |
| **API Format** | OpenAI-compatible. Universal API for 250+ providers |
| **Self-Hostable** | Yes (open source gateway component) |
| **BYOK** | Yes -- routes requests through user's own provider keys |
| **Models** | 1600+ models across 250+ providers. Supports language, vision, audio, and image models |
| **Relevance** | **MEDIUM** -- Strong gateway features (caching, fallbacks, load balancing). But primarily an enterprise tool. Free tier is generous for logging/observability. Gateway component is open source |

**Key advantages:**
- Composable fallbacks (fallback targets can be load balancers, conditional routers, etc.)
- Semantic caching reduces latency and cost
- Load balancing across API keys and providers
- Open source gateway component
- Guardrails and content moderation built in

**Key risks:**
- Primarily enterprise-focused pricing
- Log-based pricing model can get expensive at scale
- Adds another dependency in the request path

---

### 6. Helicone

| Attribute | Details |
|-----------|---------|
| **URL** | https://helicone.ai |
| **Capabilities** | Observability/proxy for chat, embeddings (not a model provider itself) |
| **Auth** | API key (proxy header injection) |
| **Pricing** | Free: 10K requests/month. Paid: $20/seat/month |
| **API Format** | Proxy layer -- forwards to any OpenAI-compatible provider |
| **Self-Hostable** | Yes (open source) |
| **BYOK** | N/A -- Helicone is an observability layer, not a model router. Users always use their own keys |
| **Models** | Proxies to 100+ providers. Cost tracking for 300+ models |
| **Relevance** | **LOW** -- Primarily an observability tool, not a gateway. Useful for monitoring/analytics but doesn't solve the multi-provider routing problem. Could complement another gateway |

**Key advantages:**
- P95 overhead < 5ms -- minimal latency impact
- Cost tracking across 300+ models
- Open source, self-hostable
- Great analytics and logging

**Key risks:**
- Not a gateway/router -- only observability
- Per-seat pricing doesn't fit SaaS model well
- Overlaps with Vercel AI Gateway's built-in observability

---

### 7. AWS Bedrock

| Attribute | Details |
|-----------|---------|
| **URL** | https://aws.amazon.com/bedrock/ |
| **Capabilities** | Chat, embeddings, image generation (via Titan/Stable Diffusion). Unified Converse API |
| **Auth** | IAM (no separate API key management). AWS SDK credentials |
| **Pricing** | On-demand per-token. Provisioned Throughput for guaranteed capacity. Batch inference (async, cheaper). No free tier (AWS Free Tier has limited Bedrock credits) |
| **API Format** | AWS SDK (Converse API). Not directly OpenAI-compatible |
| **Self-Hostable** | No -- AWS managed service |
| **BYOK** | No -- uses AWS's managed model access. You pay AWS, not providers directly |
| **Models** | Claude 3.5/3.7 Sonnet, Claude 3.5 Haiku, Llama 3/3.3, Amazon Titan, Amazon Nova, Stable Diffusion, Cohere |
| **Relevance** | **LOW** -- Enterprise-focused. IAM auth adds complexity. Not OpenAI-compatible. SpawnForge's indie audience unlikely to have AWS accounts configured. Good model selection but accessible through simpler gateways |

**Key advantages:**
- Enterprise-grade reliability and security
- IAM auth eliminates API key management
- Cost optimization features (batch, caching, Flex pricing)
- Unified Converse API across all models
- Regional deployment for data residency

**Key risks:**
- Requires AWS account and IAM setup
- Not OpenAI-compatible -- custom SDK required
- Complex pricing model
- Overkill for indie game developers

---

### 8. Azure OpenAI

| Attribute | Details |
|-----------|---------|
| **URL** | https://azure.microsoft.com/en-us/products/ai-services/openai-service |
| **Capabilities** | Chat, embeddings, image generation (DALL-E), audio (TTS, STT via GPT-4o audio) |
| **Auth** | Azure Active Directory (AAD) + API key. Regional endpoints |
| **Pricing** | Standard (pay-per-token, same rates as OpenAI). Provisioned Throughput Units (PTUs) for high volume. Global and regional deployment options |
| **API Format** | OpenAI-compatible with Azure-specific headers (api-version, deployment name) |
| **Self-Hostable** | No -- Azure managed |
| **BYOK** | No -- Azure manages the model access |
| **Models** | GPT-5 series, GPT-4.1, GPT-4o, DALL-E, Whisper, TTS. Enterprise content filtering included |
| **Relevance** | **LOW** -- Enterprise-focused. Requires Azure account and deployment setup. Same pricing as direct OpenAI but with more operational overhead. Content filtering may block game-related content unexpectedly |

**Key advantages:**
- Enterprise compliance (SOC2, HIPAA, etc.)
- Content filtering for safety
- Regional deployment for data residency
- PTU pricing can reduce costs at scale by 50%+

**Key risks:**
- Complex deployment model (must deploy each model to a region)
- Azure-specific auth headers add integration complexity
- Content filtering may be too aggressive for game content
- Requires Azure subscription and resource provisioning

---

### 9. GCP Vertex AI

| Attribute | Details |
|-----------|---------|
| **URL** | https://cloud.google.com/vertex-ai |
| **Capabilities** | Chat (Gemini), embeddings (text + multimodal), image generation (Imagen) |
| **Auth** | Service account JSON / Application Default Credentials (ADC) |
| **Pricing** | Per-token. Gemini 2.5 Pro: $1.25/M input, $10/M output. Gemini 2.5 Flash: $0.30/M input, $2.50/M output. Text Embedding 004: FREE |
| **API Format** | Google Cloud SDK. Also accessible via OpenAI-compatible endpoint (recent addition) |
| **Self-Hostable** | No -- GCP managed |
| **BYOK** | No -- GCP manages access |
| **Models** | Gemini 2.5 Pro/Flash, Gemini 2.0, Imagen 3, Text Embedding 004, PaLM (legacy) |
| **Relevance** | **LOW** -- Service account auth is complex for end users. Primarily useful for Gemini access, but Gemini is available through simpler gateways (OpenRouter, Vercel). Free embeddings are notable |

**Key advantages:**
- Gemini 2.5 Pro is highly competitive on benchmarks
- Free text embeddings (Text Embedding 004)
- Multimodal embedding support
- Recent OpenAI-compatible endpoint addition

**Key risks:**
- Service account auth is complex
- GCP account required
- Gemini available through simpler gateways
- Limited model diversity (Google models only)

---

### 10. Cloudflare AI Gateway + Workers AI

| Attribute | Details |
|-----------|---------|
| **URL** | https://developers.cloudflare.com/ai-gateway/ (Gateway) / https://developers.cloudflare.com/workers-ai/ (Workers AI) |
| **Capabilities** | **Gateway**: Proxy/cache/analytics for any provider. **Workers AI**: Serverless inference for 50+ open models |
| **Auth** | Cloudflare API token. Workers AI: environment binding or REST API |
| **Pricing** | **Gateway**: Free on all plans (caching, rate limiting, logging, analytics). **Workers AI**: Free tier (100K req/day), paid ($5/month base + $0.30/M additional requests) |
| **API Format** | **Gateway**: Proxies any provider's format. **Workers AI**: OpenAI-compatible |
| **Self-Hostable** | No -- Cloudflare edge network |
| **BYOK** | **Gateway**: Yes -- proxies requests to your own provider keys. **Workers AI**: N/A (Cloudflare-hosted models) |
| **Models** | **Workers AI**: 50+ open models (Llama, Mistral, Stable Diffusion, Whisper, embedding models). **Gateway**: Routes to OpenAI, Anthropic, Google, Groq, HuggingFace, Workers AI, etc. |
| **Relevance** | **MEDIUM-HIGH** -- SpawnForge already uses Cloudflare (R2 CDN, Workers). Gateway is FREE and adds caching/analytics. Workers AI provides cheap inference for open models. Edge deployment = low latency globally |

**Key advantages:**
- AI Gateway is completely FREE -- caching, rate limiting, logging, analytics
- Workers AI has generous free tier (100K req/day)
- SpawnForge already has Cloudflare infrastructure (R2, Workers)
- Edge deployment in 200+ cities = low latency
- Gateway caching reduces costs for repeated queries
- Can layer on top of other providers (cache OpenAI/Anthropic calls)

**Key risks:**
- Workers AI model selection limited to open-source models
- No Claude or GPT access via Workers AI (only via Gateway proxy)
- Gateway adds a hop in the request path
- Workers AI model quality below frontier models

---

## Comparison Matrix

| Provider | Chat | Embed | Image | Audio | Auth | Free Tier | Markup | OpenAI-Compat | Self-Host | BYOK | Models |
|----------|------|-------|-------|-------|------|-----------|--------|---------------|-----------|------|--------|
| **Vercel AI Gateway** | Yes | Yes | Via providers | No | OIDC / API key | $5/month credits | 0% | Via AI SDK | No | Yes | 100+ |
| **OpenRouter** | Yes | Yes | Yes | No | API key | Free models (rate-limited) | 5.5% fee | Yes (native) | No | Yes (1M free/mo) | 500+ |
| **GitHub Models** | Yes | Yes | No | No | PAT | 50 req/day (GPT-4o) | 0% | Yes | No | No | ~30 |
| **LiteLLM** | Yes | Yes | Yes | No | Configurable | Open source | 0% | Yes (proxy) | Yes | Yes | 100+ providers |
| **Portkey** | Yes | Yes | Yes | Yes | API key | 10K logs/mo | 0% | Yes | Partial | Yes | 1600+ |
| **Helicone** | Proxy | Proxy | Proxy | Proxy | API key | 10K req/mo | 0% | Proxy | Yes | N/A (observability) | 300+ tracked |
| **AWS Bedrock** | Yes | Yes | Yes | No | IAM | Limited | 0% | No (Converse API) | No | No | ~20 |
| **Azure OpenAI** | Yes | Yes | Yes | Yes | AAD + API key | None | 0% | Mostly | No | No | ~15 |
| **GCP Vertex AI** | Yes | Yes | Yes | No | Service account | Free embeddings | 0% | Recent addition | No | No | ~10 |
| **Cloudflare** | Yes* | Yes* | Yes* | Yes* | CF API token | Gateway: free. Workers AI: 100K/day | 0% | Workers AI: Yes | No | Gateway: Yes | 50+ (Workers AI) |

\* Cloudflare AI Gateway proxies to other providers; Workers AI runs open models directly.

---

## Recommendation & Priority Order

### Tier 1: Implement First (High Impact, Low Effort)

#### 1. Vercel AI Gateway
**Why first:** SpawnForge already deploys on Vercel. AI SDK v6 provides native Next.js integration with streaming, tool calling, and embeddings. Zero markup. OIDC auth is automatic in production. This should be the **default backend** for platform-managed AI.

**Integration effort:** Low. Replace direct Anthropic/OpenAI SDK calls with `@ai-sdk/ai-gateway` provider. Configuration is mostly environment variables.

#### 2. OpenRouter
**Why second:** Largest model catalog (500+), extremely popular with indie developers. OpenAI-compatible API means near-zero code changes for BYOK users. Free models let users experiment without cost. This should be the **primary BYOK gateway** -- users bring one OpenRouter key and get access to everything.

**Integration effort:** Low. OpenAI-compatible endpoint. Add `openrouter` to the `Provider` type, store the key, and route through `https://openrouter.ai/api/v1`.

### Tier 2: Implement Next (Medium Impact)

#### 3. Cloudflare AI Gateway (proxy layer)
**Why:** SpawnForge already uses Cloudflare (R2, Workers). The AI Gateway is FREE and adds caching, rate limiting, and analytics on top of existing provider calls. This is not a replacement for providers but a **middleware layer** that reduces costs via caching and adds observability.

**Integration effort:** Medium. Route existing provider calls through a Cloudflare AI Gateway endpoint. Configure caching rules for repeated/similar prompts.

#### 4. Cloudflare Workers AI (open models)
**Why:** Provides cheap/free inference for open models (Llama, Mistral, Whisper). Useful for cost-sensitive users on lower tiers. Edge deployment means low latency. Good for non-critical tasks (summarization, embeddings, basic chat).

**Integration effort:** Medium. Add Workers AI as a provider option. Different auth model (CF binding vs API key).

### Tier 3: Consider Later (Niche Audiences)

#### 5. GitHub Models
**Why:** Free with a GitHub account. Good for students/hobbyists prototyping. PAT auth is simple. But rate limits are too restrictive for production.

**Integration effort:** Low. OpenAI-compatible API with PAT auth.

#### 6. LiteLLM (reference only)
**Why:** Valuable as a reference architecture for provider abstraction patterns. Not recommended to deploy -- Python-based, requires infrastructure management. But studying its unified API design can inform SpawnForge's abstraction layer.

**Integration effort:** N/A (reference only).

### Tier 4: Not Recommended for SpawnForge

#### 7-10. AWS Bedrock, Azure OpenAI, GCP Vertex AI, Portkey, Helicone
**Why not:** Enterprise-focused services that add significant complexity (IAM/AAD/service accounts) with minimal benefit for indie game developers. These providers' models are already accessible through Vercel AI Gateway and OpenRouter with much simpler auth. Portkey and Helicone are useful tools but SpawnForge gets comparable features from Vercel AI Gateway's built-in observability and Cloudflare's free analytics.

---

## Integration Notes for SpawnForge

### Current Provider Architecture

The existing provider abstraction (`web/src/lib/keys/resolver.ts`) handles:
- BYOK key storage (encrypted, per-provider)
- Platform key fallback with token deduction
- Tier-based access control

Current `Provider` type: `'anthropic' | 'meshy' | 'hyper3d' | 'elevenlabs' | 'suno' | 'openai' | 'replicate' | 'removebg'`

### Proposed Changes

1. **Add gateway providers to the `Provider` union type:**
   ```typescript
   type GatewayProvider = 'openrouter' | 'vercel-ai-gateway';
   type Provider = 'anthropic' | 'openai' | ... | GatewayProvider;
   ```

2. **Route AI chat through Vercel AI Gateway by default:**
   - Use `@ai-sdk/ai-gateway` for platform-managed calls
   - Zero config for Vercel deployments (OIDC auto-auth)
   - Fallback to direct provider keys if gateway is unavailable

3. **Add OpenRouter as a BYOK gateway option:**
   - Users enter one OpenRouter API key in Settings
   - SpawnForge presents the full model catalog
   - Route through `https://openrouter.ai/api/v1` with OpenAI SDK

4. **Layer Cloudflare AI Gateway for caching:**
   - Proxy platform AI calls through `https://gateway.ai.cloudflare.com/v1/{account_id}/{gateway_id}`
   - Cache repeated prompts (scene descriptions, template generation)
   - Free analytics on AI usage patterns

5. **Settings UI additions:**
   - Model selector dropdown (populated from gateway's model list)
   - Gateway preference (Vercel AI Gateway / OpenRouter / Direct)
   - Cost estimation before generation

### Migration Path

| Phase | What | Effort |
|-------|------|--------|
| Phase 1 | Vercel AI Gateway for platform chat | 1-2 days |
| Phase 2 | OpenRouter BYOK support | 1 day |
| Phase 3 | Cloudflare caching layer | 1 day |
| Phase 4 | Model selector UI + cost preview | 2-3 days |
| Phase 5 | Workers AI for embeddings/cheap inference | 1-2 days |

---

## Sources

- [Vercel AI Gateway](https://vercel.com/ai-gateway)
- [Vercel AI Gateway Pricing](https://vercel.com/docs/ai-gateway/pricing)
- [Vercel AI Gateway Models](https://vercel.com/docs/ai-gateway/models-and-providers)
- [AI SDK Provider: AI Gateway](https://ai-sdk.dev/providers/ai-sdk-providers/ai-gateway)
- [OpenRouter Pricing](https://openrouter.ai/pricing)
- [OpenRouter FAQ](https://openrouter.ai/docs/faq)
- [OpenRouter Models](https://openrouter.ai/docs/guides/overview/models)
- [OpenRouter Embeddings API](https://openrouter.ai/docs/api/reference/embeddings)
- [OpenRouter Image Generation](https://openrouter.ai/docs/guides/overview/multimodal/image-generation)
- [GitHub Models Billing](https://docs.github.com/billing/managing-billing-for-your-products/about-billing-for-github-models)
- [GitHub Models Quickstart](https://docs.github.com/en/github-models/quickstart)
- [GitHub Models Marketplace](https://github.com/marketplace/models)
- [LiteLLM GitHub](https://github.com/BerriAI/litellm)
- [LiteLLM Docker Deployment](https://docs.litellm.ai/docs/proxy/deploy)
- [LiteLLM Enterprise](https://docs.litellm.ai/docs/enterprise)
- [Portkey AI Gateway](https://portkey.ai/features/ai-gateway)
- [Portkey Pricing](https://portkey.ai/pricing)
- [Portkey Fallbacks](https://portkey.ai/docs/product/ai-gateway/fallbacks)
- [Helicone](https://www.helicone.ai/)
- [Helicone GitHub](https://github.com/Helicone/helicone)
- [AWS Bedrock Pricing](https://aws.amazon.com/bedrock/pricing/)
- [Azure OpenAI Pricing](https://azure.microsoft.com/en-us/pricing/details/azure-openai/)
- [GCP Vertex AI Pricing](https://cloud.google.com/vertex-ai/generative-ai/pricing)
- [Cloudflare AI Gateway](https://developers.cloudflare.com/ai-gateway/)
- [Cloudflare Workers AI](https://developers.cloudflare.com/workers-ai/)
- [Cloudflare AI Gateway Pricing](https://developers.cloudflare.com/ai-gateway/reference/pricing/)
- [Top 5 LLM Gateways for Production in 2026](https://dev.to/hadil/top-5-llm-gateways-for-production-in-2026-a-deep-practical-comparison-16p)
