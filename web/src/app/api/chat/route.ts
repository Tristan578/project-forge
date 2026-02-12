import { NextRequest } from 'next/server';
import Anthropic from '@anthropic-ai/sdk';
import { authenticateRequest } from '@/lib/auth/api-auth';
import { resolveApiKey, ApiKeyError } from '@/lib/keys/resolver';
import { getTokenCost } from '@/lib/tokens/pricing';
import { refundTokens } from '@/lib/tokens/service';
import { getChatTools } from '@/lib/chat/tools';

const SYSTEM_PROMPT = `You are an AI game creation assistant for Project Forge, a browser-based 3D game engine.
You help users build games by creating and modifying 3D scenes using the provided tools.

Guidelines:
- When the user asks you to create something, use the tools to make it happen.
- Explain what you're doing briefly, then act. Don't ask permission for simple operations.
- For complex requests, break them into steps and execute each one.
- You can read the current scene state to understand what exists.
- Use spawn_entity to create objects, update_transform to position them, update_material to color them.
- Entity IDs are numeric strings like "4294967299". Use get_scene_graph to find entity IDs.
- After creating entities, you can select them with select_entity for the user to see.
- Be creative and helpful. If the user says "make it look cool", use your judgment.
- Keep your text responses concise. Focus on action, not explanation.`;

export async function POST(request: NextRequest) {
  // 1. Authenticate
  const auth = await authenticateRequest();
  if (!auth.ok) return auth.response;

  // 2. Parse request
  let body: {
    messages: { role: string; content: unknown }[];
    model: string;
    sceneContext: string;
  };

  try {
    body = await request.json();
  } catch {
    return Response.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  const { messages, model, sceneContext } = body;
  if (!messages || !Array.isArray(messages)) {
    return Response.json({ error: 'messages array required' }, { status: 400 });
  }

  // 3. Resolve Anthropic API key
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

  // 4. Build Claude request
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

  // 5. Stream response
  const encoder = new TextEncoder();

  const stream = new ReadableStream({
    async start(controller) {
      function send(data: unknown) {
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(data)}\n\n`));
      }

      try {
        const response = await client.messages.create({
          model: model || 'claude-sonnet-4-5-20250929',
          max_tokens: 4096,
          system: systemPrompt,
          messages: anthropicMessages,
          tools: tools as Anthropic.Tool[],
          stream: true,
        });

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
              }
              break;
            }

            case 'content_block_delta': {
              const delta = event.delta;
              if (delta.type === 'text_delta') {
                send({ type: 'text_delta', text: delta.text });
              } else if (delta.type === 'input_json_delta') {
                send({ type: 'tool_input_delta', json: delta.partial_json });
              }
              break;
            }

            case 'content_block_stop': {
              // Tool input is now complete — the client will parse and execute
              send({ type: 'content_block_stop', index: event.index });
              break;
            }

            case 'message_delta': {
              if (event.usage) {
                send({
                  type: 'usage',
                  inputTokens: event.usage.output_tokens, // message_delta only has output
                });
              }
              break;
            }

            case 'message_stop': {
              send({ type: 'done' });
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
