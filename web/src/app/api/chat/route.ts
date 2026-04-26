/**
 * POST /api/chat — AI chat with streaming tool use.
 *
 * Resolves an API key (BYOK first, then platform), deducts tokens upfront,
 * and streams Claude responses back via SSE. If the stream fails after deduction,
 * tokens are refunded via refundTokens(). Never remove `usageId` from the response —
 * client-side useGenerationPolling.triggerRefund() needs it for async job refunds.
 */

export const maxDuration = 120; // API_MAX_DURATION_CHAT_S

import { NextRequest } from 'next/server';
import { readdir, readFile } from 'fs/promises';
import path from 'path';
import { resolveApiKey, ApiKeyError } from '@/lib/keys/resolver';
import { getTokenCost } from '@/lib/tokens/pricing';
import { refundTokens } from '@/lib/tokens/service';
import {
  sanitizeChatInput,
  sanitizeSystemPrompt,
  validateBodySize,
  detectPromptInjection,
} from '@/lib/chat/sanitizer';
import { withApiMiddleware } from '@/lib/api/middleware';
import { assertTier } from '@/lib/auth/api-auth';
import { captureException } from '@/lib/monitoring/sentry-server';
import { logCost } from '@/lib/costs/costLogger';
import { buildDocContext } from '@/lib/chat/docContext';
import type { DocEntry } from '@/lib/docs/docsIndex';
import { createSpawnforgeAgent } from '@/lib/ai/spawnforgeAgent';
import { isPremiumModel } from '@/lib/ai/models';
import { resolveChatRoute } from '@/lib/providers/resolveChat';
import type { UserModelMessage, AssistantModelMessage } from '@ai-sdk/provider-utils';

// ---------------------------------------------------------------------------
// Docs loading (server-side, filesystem)
// ---------------------------------------------------------------------------

const DOCS_ROOT = path.join(process.cwd(), '..', 'docs');
let cachedDocsEntries: DocEntry[] | null = null;

function extractTitle(content: string): string {
  const match = content.match(/^#\s+(.+)$/m);
  return match ? match[1].trim() : 'Untitled';
}

function extractSections(content: string): Array<{ heading: string; content: string }> {
  const sections: Array<{ heading: string; content: string }> = [];
  const lines = content.split('\n');
  let currentHeading = '';
  let currentContent: string[] = [];

  for (const line of lines) {
    const headingMatch = line.match(/^#{2,3}\s+(.+)$/);
    if (headingMatch) {
      if (currentHeading) {
        sections.push({ heading: currentHeading, content: currentContent.join('\n').trim() });
      }
      currentHeading = headingMatch[1].trim();
      currentContent = [];
    } else {
      currentContent.push(line);
    }
  }
  if (currentHeading) {
    sections.push({ heading: currentHeading, content: currentContent.join('\n').trim() });
  }
  return sections;
}

async function loadDocsRecursive(dir: string, basePath: string = ''): Promise<DocEntry[]> {
  const entries: DocEntry[] = [];
  try {
    const items = await readdir(dir, { withFileTypes: true });
    for (const item of items) {
      const fullPath = path.join(dir, item.name);
      if (item.isDirectory() && !item.name.startsWith('_') && !item.name.startsWith('.')) {
        const subEntries = await loadDocsRecursive(fullPath, basePath ? `${basePath}/${item.name}` : item.name);
        entries.push(...subEntries);
      } else if (item.isFile() && item.name.endsWith('.md')) {
        const content = await readFile(fullPath, 'utf-8');
        const docPath = basePath
          ? `${basePath}/${item.name.replace('.md', '')}`
          : item.name.replace('.md', '');
        const category = basePath.split('/')[0] || 'root';
        entries.push({
          path: docPath,
          title: extractTitle(content),
          content,
          category,
          sections: extractSections(content),
        });
      }
    }
  } catch {
    // docs directory missing or unreadable — silently skip
  }
  return entries;
}

async function getDocsEntries(): Promise<DocEntry[]> {
  if (cachedDocsEntries) return cachedDocsEntries;
  cachedDocsEntries = await loadDocsRecursive(DOCS_ROOT);
  return cachedDocsEntries;
}

// ---------------------------------------------------------------------------

const SYSTEM_PROMPT = `You are an expert game creation assistant for SpawnForge, an AI-powered 3D game engine that runs in the browser. You help users create games by orchestrating scene setup, materials, physics, scripting, audio, and more through MCP commands.

## What You Can Do
You have access to 350 MCP commands across 41 categories. Key categories include:
- **scene**: spawn_entity, delete_entities, duplicate_entity, rename_entity, set_parent, get_scene_graph
- **materials**: update_material (PBR: baseColor, metallic, roughness, emissive, textures, alpha modes, clearcoat, transmission)
- **lighting**: update_light, set_ambient_light (point, directional, spot lights with shadows)
- **environment**: set_environment (fog, clear color)
- **rendering**: set_post_processing (bloom, chromatic aberration, color grading, sharpening)
- **physics**: set_physics, remove_physics, set_physics_force, set_velocity (rigid bodies, colliders, forces)
- **audio**: set_audio, play_audio, stop_audio, create_audio_bus, update_audio_bus (3D spatial audio, mixer)
- **scripting**: set_script, remove_script, get_script (TypeScript game logic via forge.* API)
- **particles**: set_particle, toggle_particle (9 GPU presets: fire, smoke, sparks, rain, snow, explosion, magic, dust, trail)
- **animation**: play_animation, set_animation_speed, set_animation_blend_weight (skeletal animation)
- **asset**: import_gltf, load_texture (3D models and textures)
- **mesh**: csg_union, csg_subtract, csg_intersect, extrude_shape, lathe_shape, array_entity, combine_meshes
- **terrain**: spawn_terrain, update_terrain, sculpt_terrain
- **export**: export_game (standalone HTML)

## Game Creation Workflow
1. **Plan the scene** - Identify what entities are needed (player, enemies, environment, collectibles, lights)
2. **Spawn entities** - Use spawn_entity with types: cube, sphere, cylinder, plane, cone, torus, capsule
3. **Position everything** - Use update_transform to place entities (position [x,y,z], rotation, scale)
4. **Add materials** - Use update_material for colors, metallic/roughness, emissive glow, textures
5. **Set up lighting** - Spawn lights, configure ambient light, add shadows
6. **Add physics** - Use set_physics for rigid bodies (dynamic/static/kinematic), colliders, gravity
7. **Write scripts** - Use set_script with TypeScript to add game logic (movement, AI, scoring)
8. **Add audio** - Attach sounds, configure spatial audio, set up audio buses
9. **Add particles** - Fire, smoke, sparkles for visual effects
10. **Test** - User clicks Play to test, Stop to return to editing

## Scripting API (forge.*)
Scripts run in a sandboxed TypeScript environment with these APIs:

### Transform & Spawning
- \`forge.getTransform(entityId)\` → { position, rotation, scale }
- \`forge.setPosition(entityId, x, y, z)\`
- \`forge.translate(entityId, dx, dy, dz)\` — relative movement
- \`forge.rotate(entityId, dx, dy, dz)\` — degrees
- \`forge.spawn(type, { name, position })\` → entity ID
- \`forge.destroy(entityId)\`

### Visual Control
- \`forge.setColor(entityId, r, g, b, a?)\` — RGBA 0-1
- \`forge.setVisibility(entityId, visible)\`
- \`forge.setEmissive(entityId, r, g, b, intensity?)\` — glow effect

### Scene Queries
- \`forge.scene.getEntities()\` → [{ id, name, type, position }]
- \`forge.scene.findByName(name)\` → entity IDs (case-insensitive substring match)
- \`forge.scene.getEntityName(entityId)\` / \`getEntityType(entityId)\`
- \`forge.scene.getEntitiesInRadius(position, radius)\` → nearby entity IDs

### Input
- \`forge.input.isPressed(action)\` / \`justPressed\` / \`justReleased\`
- \`forge.input.getAxis(action)\`
- Default actions: move_forward, move_backward, move_left, move_right, jump, fire, interact

### Physics
- \`forge.physics.applyForce(entityId, fx, fy, fz)\`
- \`forge.physics.applyImpulse(entityId, fx, fy, fz)\`
- \`forge.physics.setVelocity(entityId, vx, vy, vz)\`
- \`forge.physics.getContacts(entityId, radius?)\` → overlapping entity IDs
- \`forge.physics.distanceTo(entityIdA, entityIdB)\`

### UI/HUD
- \`forge.ui.showText(id, text, x%, y%, { fontSize, color })\`
- \`forge.ui.updateText(id, newText)\`
- \`forge.ui.removeText(id)\` / \`forge.ui.clear()\`

### Audio & Animation
- \`forge.audio.play(entityId)\` / \`stop\` / \`pause\` / \`setVolume\` / \`fadeIn\` / \`fadeOut\`
- \`forge.animation.play(entityId, clipName, crossfadeSecs?)\`

### State & Time
- \`forge.time.delta\` — seconds since last frame
- \`forge.time.elapsed\` — seconds since Play started
- \`forge.state.get(key)\` / \`forge.state.set(key, value)\` — shared state between scripts

## Script Structure
\`\`\`typescript
// entityId is available as a global (the entity this script is on)
function onStart() { /* called once when Play starts */ }
function onUpdate(dt) { /* called every frame */ }
function onDestroy() { /* called when Play stops */ }
\`\`\`

## Example: Simple Platformer Player
\`\`\`typescript
const SPEED = 5;
const JUMP_FORCE = 8;

function onStart() {
  forge.ui.showText("controls", "WASD to move, Space to jump", 25, 90, { fontSize: 14, color: "#aaa" });
}

function onUpdate(dt) {
  let dx = 0, dz = 0;
  if (forge.input.isPressed("move_forward")) dz -= 1;
  if (forge.input.isPressed("move_backward")) dz += 1;
  if (forge.input.isPressed("move_left")) dx -= 1;
  if (forge.input.isPressed("move_right")) dx += 1;

  if (dx !== 0 || dz !== 0) {
    const len = Math.sqrt(dx * dx + dz * dz);
    forge.translate(entityId, (dx / len) * SPEED * dt, 0, (dz / len) * SPEED * dt);
  }

  if (forge.input.justPressed("jump")) {
    forge.physics.applyImpulse(entityId, 0, JUMP_FORCE, 0);
  }
}
\`\`\`

## Tips
- Always use get_scene_graph first to see what entities exist and their IDs
- Entity IDs are numeric strings like "4294967299"
- Use descriptive entity names (e.g., "Player", "Enemy_1", "Coin_3") — scripts use findByName
- Set up an input preset (FPS, Platformer, TopDown, Racing) before writing movement scripts
- For physics, use "dynamic" body type for moving objects, "static" for floors/walls
- Use forge.state for cross-script communication (e.g., score manager + UI script)
- Use forge.ui.showText with percentage coordinates (0-100 for x and y)
- Always respond with what you did and suggest next steps`;

// ---------------------------------------------------------------------------
// Build ModelMessage[] from incoming request messages
// ---------------------------------------------------------------------------

type IncomingMessage = { role: string; content: unknown };

function buildModelMessages(
  messages: IncomingMessage[],
): Array<UserModelMessage | AssistantModelMessage> {
  const result: Array<UserModelMessage | AssistantModelMessage> = [];

  for (const msg of messages) {
    if (msg.role === 'user') {
      // Pass structured content (image + text parts) directly to AI SDK
      // Only stringify if it's not already a string or valid content array
      const content = typeof msg.content === 'string'
        ? msg.content
        : Array.isArray(msg.content)
          ? msg.content
          : String(msg.content);
      result.push({ role: 'user' as const, content });
    } else if (msg.role === 'assistant') {
      const text = typeof msg.content === 'string'
        ? msg.content
        : JSON.stringify(msg.content);
      result.push({ role: 'assistant' as const, content: [{ type: 'text' as const, text }] });
    }
  }

  return result;
}

// ---------------------------------------------------------------------------
// Load manifest tools for AI SDK
// ---------------------------------------------------------------------------

export async function POST(request: NextRequest) {
  // 1. Authenticate + rate-limit via shared middleware pipeline
  const mid = await withApiMiddleware(request, {
    requireAuth: true,
    rateLimit: true,
    rateLimitConfig: { key: (id) => `chat:${id}`, max: 10, windowSeconds: 60 },
  });
  if (mid.error) return mid.error;
  const auth = { ctx: mid.authContext! };

  // 1b. Tier gate — starter tier has no AI access
  const tierError = assertTier(auth.ctx.user, ['hobbyist', 'creator', 'pro']);
  if (tierError) return tierError;

  // 2. Validate request size (max 1MB — generous limit for conversation history + scene context;
  //    the more precise MAX_INPUT_CHARS check below enforces the actual token budget)
  const bodyText = await request.text();
  if (!validateBodySize(bodyText, 1024 * 1024)) {
    return Response.json(
      { error: 'Request too large. Maximum 1MB allowed.' },
      { status: 413 }
    );
  }

  // 3. Parse request
  let body: {
    messages: IncomingMessage[];
    model: string;
    sceneContext: string;
    thinking?: boolean;
    systemOverride?: string;
  };

  try {
    body = JSON.parse(bodyText);
  } catch {
    return Response.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  const { messages, model, sceneContext, thinking, systemOverride } = body;
  if (!messages || !Array.isArray(messages)) {
    return Response.json({ error: 'messages array required' }, { status: 400 });
  }

  // Premium model gate: claude-opus-4-7 is restricted to Pro tier. Reject
  // before billing so non-Pro users requesting premium are not charged the
  // estimated cost. The gate only blocks the model — it does not silently
  // downgrade, so the client gets an explicit signal to update its UI.
  if (isPremiumModel(model) && auth.ctx.user.tier !== 'pro') {
    return Response.json(
      { error: 'The premium model (Opus 4.7) requires a Pro subscription.' },
      { status: 403 },
    );
  }

  // 4. Validate message length and content
  for (const msg of messages) {
    if (typeof msg.content !== 'string') {
      continue; // Skip non-text messages (tool results)
    }

    if (msg.content.length > 4000) {
      return Response.json(
        { error: 'Message too long. Maximum 4000 characters per message.' },
        { status: 400 }
      );
    }

    // Detect prompt injection attempts
    if (msg.role === 'user' && detectPromptInjection(msg.content)) {
      return Response.json(
        { error: 'Message contains suspicious patterns.' },
        { status: 400 }
      );
    }

    // Sanitize user messages
    if (msg.role === 'user') {
      msg.content = sanitizeChatInput(msg.content);
    }
  }

  // 5. Resolve API key for billing — determines which key to use and deducts tokens.
  const estimatedCost = getTokenCost(
    'chat_message',
    messages.length > 3 ? 'long' : 'short'
  );

  let usageId: string | undefined;

  // Only deduct tokens / check tier when using the direct (platform key) path.
  const chatRoute = resolveChatRoute(model);
  const usingDirectBackend = !chatRoute || chatRoute.backendId === 'direct';

  if (usingDirectBackend) {
    try {
      const resolved = await resolveApiKey(
        auth.ctx.user.id,
        'anthropic',
        estimatedCost,
        'chat_message',
        { model, length: messages.length > 3 ? 'long' : 'short' }
      );
      usageId = resolved.usageId;
    } catch (err) {
      if (err instanceof ApiKeyError) {
        return Response.json({ error: err.message, code: err.code }, { status: 402 });
      }
      throw err;
    }
  }

  // 5b. Server-side token budget validation
  const MAX_INPUT_CHARS = 600000; // ~150k tokens (well within Claude's window)
  let totalChars = 0;
  for (const msg of messages) {
    if (typeof msg.content === 'string') {
      totalChars += msg.content.length;
    } else if (Array.isArray(msg.content)) {
      for (const block of msg.content) {
        if (typeof block === 'object' && block !== null) {
          const b = block as Record<string, unknown>;
          if (b.type === 'text' && typeof b.text === 'string') {
            totalChars += b.text.length;
          } else if (b.type === 'tool_result' && typeof b.content === 'string') {
            totalChars += b.content.length;
          } else if ('source' in b) {
            const src = b.source;
            if (typeof src === 'object' && src !== null && 'data' in src && typeof (src as Record<string, unknown>).data === 'string') {
              totalChars += ((src as Record<string, unknown>).data as string).length;
            }
          }
        }
      }
    }
  }
  if (totalChars > MAX_INPUT_CHARS) {
    if (usageId) {
      await refundTokens(auth.ctx.user.id, usageId).catch((err: unknown) => {
        captureException(err, { route: '/api/chat', phase: 'refund_413', usageId });
      });
    }
    return Response.json(
      { error: 'Conversation too long. Please start a new conversation or clear older messages.' },
      { status: 413 }
    );
  }

  // 6. Build system prompt with optional scene context and doc context.
  // systemOverride replaces the default system prompt for features like game
  // review and tutorial generation. It is NOT user-controlled free text — it
  // comes from application code that constructs domain-specific instructions.
  // We sanitize (strip control chars, enforce length cap) but skip the
  // injection-pattern check: detectPromptInjection targets user messages
  // attempting to hijack the system prompt from *within* a conversation turn,
  // which is a different threat model. Applying it here false-positives on
  // legitimate instructional phrasing like "you are now a game reviewer" or
  // "new instruction: focus on level design" (PF-968, PF-901).
  let effectiveSystemPrompt = SYSTEM_PROMPT;
  // Tier gate: systemOverride is only available to creator and pro tiers.
  // Without this, any authenticated user (including free starter) can replace
  // the system prompt and use the endpoint as an unrestricted AI proxy.
  const canOverrideSystem = auth.ctx.user.tier === 'creator' || auth.ctx.user.tier === 'pro';
  if (canOverrideSystem && typeof systemOverride === 'string' && systemOverride.length > 0) {
    // Strip control characters and enforce system-prompt length cap.
    // sanitizeSystemPrompt uses MAX_SYSTEM_PROMPT_LENGTH (10,000) — NOT the
    // 4,000-char user-message limit — so valid long system prompts are never
    // silently truncated.
    effectiveSystemPrompt = sanitizeSystemPrompt(systemOverride);
  }

  let systemText = effectiveSystemPrompt;
  if (sceneContext && typeof sceneContext === 'string') {
    // sceneContext is client-supplied structured data (engine scene state).
    // Strip control characters (security) but do NOT apply the 10k system
    // prompt length cap — scene context for complex scenes can legitimately
    // be 50k+ chars. The total input budget (MAX_INPUT_CHARS = 600k) at
    // step 5b is the real size guard for the entire conversation.
    const sanitizedContext = sceneContext.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '');
    systemText += '\n\n' + sanitizedContext;
  }

  // Inject relevant documentation when the user appears to be asking a how-to question
  const lastUserMessage = [...messages]
    .reverse()
    .find((m) => m.role === 'user' && typeof m.content === 'string');
  if (lastUserMessage && typeof lastUserMessage.content === 'string') {
    try {
      const docsEntries = await getDocsEntries();
      const docCtx = buildDocContext(lastUserMessage.content, docsEntries);
      if (docCtx) {
        systemText += '\n\n' + docCtx;
      }
    } catch {
      // Doc context is best-effort — never block the chat request
    }
  }

  // 7. Create agent with resolved model backend + instructions
  // resolveChatRoute is called once here (also used in step 5 for billing);
  // the result determines whether we use direct Anthropic or gateway.
  const usingDirect = usingDirectBackend;
  // Tier gate: thinking mode (10k extra tokens per step) restricted to creator/pro,
  // consistent with the systemOverride gate. Prevents amplified token burn on free tiers.
  const canUseThinking = auth.ctx.user.tier === 'creator' || auth.ctx.user.tier === 'pro';
  const agent = createSpawnforgeAgent({
    isDirectBackend: usingDirect,
    model: model || '',
    instructions: systemText,
    thinking: canUseThinking && thinking === true,
  });

  // 8. Convert messages
  const modelMessages = buildModelMessages(messages);

  // 9. Stream via Agent and return UI message stream response
  try {
    const result = await agent.stream({
      messages: modelMessages,
      onStepFinish: async ({ usage }) => {
        // Log actual LLM token usage to the cost ledger once each step completes.
        // usage.inputTokens and usage.outputTokens are the actual values from
        // the model (not the estimated cost charged upfront via resolveApiKey).
        if (auth.ctx.user.id && usageId && usage) {
          const totalTokens = (usage.inputTokens ?? 0) + (usage.outputTokens ?? 0);
          logCost(
            auth.ctx.user.id,
            'chat_message',
            usingDirect ? 'anthropic' : 'gateway',
            null,
            totalTokens,
            {
              model,
              promptTokens: usage.inputTokens,
              completionTokens: usage.outputTokens,
              usageId,
            },
          ).catch((err: unknown) => {
            captureException(err, { route: '/api/chat', phase: 'log_token_usage' });
          });
        }
      },
    });

    // Handle mid-stream errors: refund tokens when the LLM API fails after
    // the HTTP 200 response is sent. The onFinish callback on the UI message
    // stream fires after the stream completes (success or failure). We check
    // the finish reason to detect errors and issue refunds.
    return result.toUIMessageStreamResponse({
      onFinish: async ({ finishReason }) => {
        if (finishReason === 'error' && usageId) {
          captureException(new Error('Stream finished with error'), {
            route: '/api/chat', model, phase: 'mid-stream',
          });
          await refundTokens(auth.ctx.user.id, usageId).catch((refundErr: unknown) => {
            captureException(refundErr, { route: '/api/chat', phase: 'refund_mid_stream', usageId });
          });
        }
      },
    });
  } catch (err) {
    captureException(err, { route: '/api/chat', model });

    if (usageId) {
      await refundTokens(auth.ctx.user.id, usageId).catch((refundErr: unknown) => {
        captureException(refundErr, { route: '/api/chat', phase: 'refund', usageId });
      });
    }

    const message = err instanceof Error ? err.message : 'AI API error';
    return Response.json({ error: message }, { status: 500 });
  }
}
