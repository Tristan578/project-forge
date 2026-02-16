import { NextRequest } from 'next/server';
import Anthropic from '@anthropic-ai/sdk';
import { authenticateRequest } from '@/lib/auth/api-auth';
import { resolveApiKey, ApiKeyError } from '@/lib/keys/resolver';
import { getTokenCost } from '@/lib/tokens/pricing';
import { refundTokens } from '@/lib/tokens/service';
import { getChatTools } from '@/lib/chat/tools';
import {
  sanitizeChatInput,
  validateBodySize,
  detectPromptInjection,
} from '@/lib/chat/sanitizer';

const SYSTEM_PROMPT = `You are an expert game creation assistant for Project Forge, an AI-powered 3D game engine that runs in the browser. You help users create games by orchestrating scene setup, materials, physics, scripting, audio, and more through MCP commands.

## What You Can Do
You have access to 118 MCP commands across 19 categories:
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

export async function POST(request: NextRequest) {
  // 1. Authenticate
  const auth = await authenticateRequest();
  if (!auth.ok) return auth.response;

  // 2. Validate request size (max 10KB)
  const bodyText = await request.text();
  if (!validateBodySize(bodyText, 10 * 1024)) {
    return Response.json(
      { error: 'Request too large. Maximum 10KB allowed.' },
      { status: 413 }
    );
  }

  // 3. Parse request
  let body: {
    messages: { role: string; content: unknown }[];
    model: string;
    sceneContext: string;
    thinking?: boolean;
  };

  try {
    body = JSON.parse(bodyText);
  } catch {
    return Response.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  const { messages, model, sceneContext, thinking } = body;
  if (!messages || !Array.isArray(messages)) {
    return Response.json({ error: 'messages array required' }, { status: 400 });
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
    const injectionCheck = detectPromptInjection(msg.content);
    if (msg.role === 'user' && injectionCheck.detected) {
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

  // 5. Resolve Anthropic API key
  const estimatedCost = getTokenCost(
    'chat_message',
    messages.length > 3 ? 'long' : 'short'
  );

  let apiKey: string;
  let usageId: string | undefined;

  try {
    const resolved = await resolveApiKey(
      auth.ctx.user.id,
      'anthropic',
      estimatedCost,
      messages.length > 3 ? 'chat_long' : 'chat_short',
      { model }
    );
    apiKey = resolved.key;
    usageId = resolved.usageId;
  } catch (err) {
    if (err instanceof ApiKeyError) {
      return Response.json({ error: err.message, code: err.code }, { status: 402 });
    }
    throw err;
  }

  // 6. Build Claude request
  const client = new Anthropic({ apiKey });

  const systemPrompt = sceneContext
    ? `${SYSTEM_PROMPT}\n\n${sceneContext}`
    : SYSTEM_PROMPT;

  const tools = getChatTools();

  // Convert messages to Anthropic format
  const anthropicMessages = messages.map((m) => ({
    role: m.role as 'user' | 'assistant',
    content: m.content as string | Anthropic.ContentBlockParam[],
  }));

  // 7. Stream response
  const encoder = new TextEncoder();

  const stream = new ReadableStream({
    async start(controller) {
      function send(data: unknown) {
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(data)}\n\n`));
      }

      try {
        // Build params with proper typing for streaming
        const baseParams = {
          model: model || 'claude-sonnet-4-5-20250929',
          max_tokens: thinking ? 16384 : 4096,
          system: systemPrompt,
          messages: anthropicMessages,
          tools: tools as Anthropic.Tool[],
          stream: true as const,
          ...(thinking ? { thinking: { type: 'enabled' as const, budget_tokens: 10000 } } : {}),
        };

        const response = await client.messages.create(baseParams);

        let stopReason: string | null = null;

        for await (const event of response) {
          switch (event.type) {
            case 'content_block_start': {
              const block = event.content_block;
              if (block.type === 'text') {
                send({ type: 'text_start' });
              } else if (block.type === 'tool_use') {
                send({
                  type: 'tool_start',
                  id: block.id,
                  name: block.name,
                  input: {},
                });
              } else if (block.type === 'thinking') {
                send({ type: 'thinking_start' });
              }
              break;
            }

            case 'content_block_delta': {
              const delta = event.delta;
              if (delta.type === 'text_delta') {
                send({ type: 'text_delta', text: delta.text });
              } else if (delta.type === 'input_json_delta') {
                send({ type: 'tool_input_delta', json: delta.partial_json });
              } else if (delta.type === 'thinking_delta') {
                send({ type: 'thinking_delta', text: delta.thinking });
              }
              break;
            }

            case 'content_block_stop': {
              send({ type: 'content_block_stop', index: event.index });
              break;
            }

            case 'message_delta': {
              if (event.delta && 'stop_reason' in event.delta) {
                stopReason = event.delta.stop_reason as string;
              }
              if (event.usage) {
                send({
                  type: 'usage',
                  outputTokens: event.usage.output_tokens,
                });
              }
              break;
            }

            case 'message_start': {
              if (event.message?.usage) {
                send({
                  type: 'usage',
                  inputTokens: event.message.usage.input_tokens,
                });
              }
              break;
            }

            case 'message_stop': {
              send({ type: 'turn_complete', stop_reason: stopReason || 'end_turn' });
              break;
            }
          }
        }
      } catch (err) {
        // Refund tokens on API failure
        if (usageId) {
          await refundTokens(auth.ctx.user.id, usageId).catch(() => {});
        }

        const message = err instanceof Error ? err.message : 'Claude API error';
        send({ type: 'error', message });
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
    },
  });
}
