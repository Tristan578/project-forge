# AI Asset Generation

Five generation dialogs that create 3D models, textures, sound effects, voice lines, and background music directly inside the editor using text descriptions.

## Overview

AI Asset Generation lets you describe what you want in plain language. When generation finishes, the asset is added to your **Asset Panel** automatically and can be placed in the scene like any other asset. Platform-key generation uses tokens from your account balance; the cost is shown in the dialog before you submit. Generation with your own provider key is billed by that provider.

## Accessing the Generation Dialogs

All generation dialogs are available from the **Asset Panel**:

1. Open the **Asset Panel** from the left sidebar.
2. Click the generation button for the asset type you want (3D Model, Texture, Sound, Voice, or Music), or right-click in the panel to see all options.
   - A type whose required key is missing stays clickable and explains the setup needed. **Settings** accepts Anthropic, Meshy, Hyper3D and ElevenLabs keys; other credentials must be configured by the deployment operator. Generate is disabled until the required key is there.
   - If the app cannot read your saved keys for a moment (a database blip), nothing is disabled — the request is allowed through and the route decides.
3. Fill in the prompt and options, then click **Generate**.
4. A progress indicator appears while the job runs. When complete, the asset appears in your Asset Panel.

You can also trigger generation from the **AI Chat** panel by describing the asset you need.

## Generation Types

### 3D Model
Generates a textured 3D mesh from a text description. Powered by Meshy.

| Option | Description |
|---|---|
| Prompt | Description of the 3D object you want (3-500 characters) |
| Art Style | Realistic, Cartoon, Low-poly, or PBR |
| Quality | Standard (100 tokens) or High (200 tokens) |
| Negative Prompt | Things to exclude from the generation |

Example prompts: "a weathered stone castle tower", "cute cartoon mushroom character", "sci-fi drone with glowing engines"

### Texture
Generates a tileable texture from a description. Powered by Meshy.

| Option | Description |
|---|---|
| Prompt | Description of the surface material (3-500 characters) |

Example prompts: "rusty metal plate with rivets", "mossy cobblestone path", "smooth marble with dark veins"

### Sound Effect
Generates a short sound effect. Powered by ElevenLabs.

| Option | Description |
|---|---|
| Prompt | Description of the sound you want |
| Duration | Length in seconds (1-22) |
| Attach to Entity | Automatically attach the sound to the currently selected entity |

Token cost: 20 tokens.

Example prompts: "coin pickup chime", "heavy footsteps on gravel", "electric sparking crackle"

### Voice Line
Generates spoken dialogue in a chosen voice style. Powered by ElevenLabs.

| Option | Description |
|---|---|
| Text | The line to speak (3-500 characters) |
| Voice Style | Neutral, Friendly, Sinister, Excited, or Calm |
| Attach to Entity | Automatically attach the audio to the currently selected entity |

Token cost: 40 tokens.

### Music Track

Generates a background music track from a description, using ElevenLabs (the same provider as sound effects and voice — a single ElevenLabs key covers all three). When generation finishes, the audio is returned inline and added to your Asset Panel.

| Option | Description |
|---|---|
| Prompt | Description of the music mood and style |
| Duration | Length in seconds (15-120) |
| Instrumental | Generate without vocals (recommended for game music) |
| Attach to Entity | Automatically attach the track to the currently selected entity |

Token cost: 80 tokens.

Example prompts: "epic orchestral battle theme with drums and strings", "ambient forest sounds with gentle piano", "chiptune platformer jingle"

### AI Skybox
Generate a custom skybox cubemap. Access this from the **Generate Skybox** button in the Environment section of Scene Settings.

| Option | Description |
|---|---|
| Prompt | Description of the sky and environment |

## Provider routing and keys

Platform credential resolution has two policies. Existing stored BYOK credentials take precedence; Settings accepts only Anthropic, Meshy, Hyper3D and ElevenLabs keys. `GATEWAY_CAPABILITIES` in `web/src/lib/config/providers.ts` names what the Vercel AI Gateway can serve — read by the `vercel-gateway` backend and `verify-platform-generation.ts` — while the narrower `RESOLVER_GATEWAY_CAPABILITIES` names the capabilities whose platform key `resolveApiKey` resolves through the gateway with **no** fallback. The availability gates read the credential policy. A configured result indicates credential readiness, without proving generation or upstream authentication.

| Capability | Platform path | Platform key |
|---|---|---|
| Image | Gateway only (#9523) | `AI_GATEWAY_API_KEY` (or Vercel OIDC) — `PLATFORM_OPENAI_KEY` no longer serves it |
| Embedding | Gateway only (#9523) | `AI_GATEWAY_API_KEY` (or Vercel OIDC) — `PLATFORM_OPENAI_KEY` no longer serves it |
| Editor chat (`/api/chat`) | Existing backend routing | Gateway / OIDC or a configured direct/router backend |
| Localization and pacing | Direct Anthropic | `ANTHROPIC_API_KEY` or an existing Anthropic BYOK credential, even with a gateway key |
| Sprite / Pixel art | Direct | `PLATFORM_REPLICATE_KEY` + `PLATFORM_OPENAI_KEY` (DALL-E 3 default) |
| 3D Model / Texture | Direct | `PLATFORM_MESHY_KEY` |
| Sound Effect / Voice / Music | Direct | `PLATFORM_ELEVENLABS_KEY` |
| Background Removal | Direct | `PLATFORM_REMOVEBG_KEY` |

Image and embedding resolve `AI_GATEWAY_API_KEY` (or Vercel OIDC) and never fall back to the direct OpenAI key: if neither is present the capability reports unavailable rather than silently routing around the gateway. This prepares credential selection; no production image or embedding consumer uses this new resolver path yet. Gateway endpoint/model adapters and OIDC-aware SDK authentication must accompany a future consumer, tracked for image in #9818. An empty key is an OIDC sentinel, not an injected HTTP authorization token. Editor chat retains its existing backend routing. `/api/generate/localize` and `/api/generate/pacing` always resolve direct Anthropic credentials, even when the gateway key is set (#10074). `sprite`/`pixel_art` stay on their direct keys pending an output-quality evaluation, and voice/sfx/music stay on ElevenLabs (the gateway has no sound-effect or music models). The full per-capability decision table lives in `docs/guides/platform-keys.md`.

## Tips

- Keep 3D model prompts specific about the shape and style — "a round wooden barrel with metal bands" works better than "a barrel".
- Generated textures tile automatically, making them immediately usable on large terrain or architectural surfaces.
- For game music, always enable **Instrumental** — lyrics rarely fit game loops and can become repetitive.
