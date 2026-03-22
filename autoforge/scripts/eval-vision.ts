/**
 * Tier 2 Evaluation — Vision scoring via Vercel AI Gateway
 *
 * Takes screenshots of rendered scenes and scores them with a configurable
 * vision model (default: Gemini 3 Flash) on 5 dimensions: composition,
 * lighting, material, completeness, polish. Returns a score 0-50.
 *
 * Routes through Vercel AI Gateway for unified observability, zero markup.
 * Falls back to direct Anthropic SDK if no gateway key is configured.
 */

import { readFileSync } from 'fs';
import { config } from '../autoforge.config.js';

export interface VisionScore {
  composition: number;
  lighting: number;
  material: number;
  completeness: number;
  polish: number;
  total: number;
  notes: string;
}

export interface VisionResult {
  score: number;
  maxScore: number;
  perAngle: VisionScore[];
  averaged: VisionScore;
  model: string;
}

const RUBRIC = `Score this game scene screenshot on 5 dimensions (1-10 each).
Be critical — a score of 5 means "acceptable but generic", 7 means "good, would impress a casual user", 9-10 means "professional quality".

1. COMPOSITION: Are objects placed in a way that makes spatial sense? Is there a clear focal point? Do objects have appropriate scale relative to each other? Are objects floating or intersecting incorrectly?

2. LIGHTING: Does the lighting match the mood described? Are there appropriate shadows? Is the scene readable (not too dark or washed out)? Do light sources make physical sense?

3. MATERIAL QUALITY: Do surfaces look convincing for what they represent? Is there appropriate material variety (not all the same color/texture)? Do metals look metallic, wood look like wood, etc.?

4. COMPLETENESS: Are the key elements from the prompt present? Is anything obviously missing that the user would expect? Does the scene tell a coherent visual story?

5. POLISH: Would a user be impressed by this as a starting point for their game? Does it feel like a real game scene or a bare tech demo? Are there nice details?

Scene prompt: "{prompt}"
Expected elements: {elements}

Return ONLY valid JSON, no markdown fences:
{"composition": N, "lighting": N, "material": N, "completeness": N, "polish": N, "total": N, "notes": "one sentence on the single biggest improvement opportunity"}`;

// ---------------------------------------------------------------------------
// Client initialization — AI Gateway (OpenAI-compatible) or direct Anthropic
// ---------------------------------------------------------------------------

interface VisionClient {
  scoreScreenshot(
    base64: string,
    mediaType: string,
    filledRubric: string
  ): Promise<string>;
  modelName: string;
}

function createGatewayClient(): VisionClient {
  // Vercel AI Gateway exposes an OpenAI-compatible chat completions endpoint.
  // We call it directly with fetch — no SDK dependency needed.
  const baseUrl = config.aiGatewayUrl.replace(/\/$/, '');
  const apiKey = config.aiGatewayApiKey;
  const model = config.visionModel; // e.g. "google/gemini-3-flash"

  return {
    modelName: model,
    async scoreScreenshot(base64, mediaType, filledRubric) {
      const response = await fetch(`${baseUrl}/v1/chat/completions`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model,
          max_tokens: 300,
          messages: [
            {
              role: 'user',
              content: [
                {
                  type: 'image_url',
                  image_url: { url: `data:${mediaType};base64,${base64}` },
                },
                { type: 'text', text: filledRubric },
              ],
            },
          ],
        }),
      });

      if (!response.ok) {
        const body = await response.text();
        throw new Error(`AI Gateway ${response.status}: ${body.slice(0, 200)}`);
      }

      const json = (await response.json()) as {
        choices: Array<{ message: { content: string } }>;
      };
      return json.choices[0]?.message?.content || '';
    },
  };
}

async function createAnthropicClient(): Promise<VisionClient> {
  // Fallback: direct Anthropic SDK (requires @anthropic-ai/sdk)
  const { default: Anthropic } = await import('@anthropic-ai/sdk');
  const client = new Anthropic({ apiKey: config.anthropicApiKey });

  // Strip provider prefix for direct Anthropic calls
  const model = config.visionModel.includes('/')
    ? config.visionModel.split('/').pop()!
    : config.visionModel;

  return {
    modelName: `anthropic/${model}`,
    async scoreScreenshot(base64, mediaType, filledRubric) {
      const response = await client.messages.create({
        model,
        max_tokens: 300,
        messages: [
          {
            role: 'user',
            content: [
              {
                type: 'image',
                source: {
                  type: 'base64',
                  media_type: mediaType as 'image/png' | 'image/jpeg' | 'image/gif' | 'image/webp',
                  data: base64,
                },
              },
              { type: 'text', text: filledRubric },
            ],
          },
        ],
      });
      const block = response.content[0];
      return block.type === 'text' ? block.text : '';
    },
  };
}

let _client: VisionClient | null = null;

async function getClient(): Promise<VisionClient> {
  if (_client) return _client;

  if (config.aiGatewayApiKey) {
    console.log(`  Vision model: ${config.visionModel} (via AI Gateway)`);
    _client = createGatewayClient();
  } else if (config.anthropicApiKey) {
    console.log(`  Vision model: ${config.visionModel} (direct Anthropic SDK)`);
    _client = await createAnthropicClient();
  } else {
    throw new Error(
      'No API key configured. Set AI_GATEWAY_API_KEY (recommended) or ANTHROPIC_API_KEY in autoforge/.env'
    );
  }

  return _client;
}

// ---------------------------------------------------------------------------
// Scoring
// ---------------------------------------------------------------------------

function parseScore(text: string): VisionScore {
  try {
    const cleaned = text
      .replace(/```json\n?/g, '')
      .replace(/```\n?/g, '')
      .trim();
    const parsed = JSON.parse(cleaned) as VisionScore;
    for (const key of [
      'composition',
      'lighting',
      'material',
      'completeness',
      'polish',
    ] as const) {
      parsed[key] = Math.max(1, Math.min(10, Math.round(parsed[key])));
    }
    parsed.total =
      parsed.composition +
      parsed.lighting +
      parsed.material +
      parsed.completeness +
      parsed.polish;
    return parsed;
  } catch {
    console.error('Failed to parse Vision response:', text);
    return {
      composition: 3,
      lighting: 3,
      material: 3,
      completeness: 3,
      polish: 3,
      total: 15,
      notes: 'parse_error: ' + text.slice(0, 100),
    };
  }
}

async function scoreScreenshot(
  screenshotPath: string,
  promptText: string,
  expectedElements: string
): Promise<VisionScore> {
  const imageData = readFileSync(screenshotPath);
  const base64 = imageData.toString('base64');
  const mediaType = screenshotPath.endsWith('.png')
    ? 'image/png'
    : 'image/jpeg';

  const filledRubric = RUBRIC.replace('{prompt}', promptText).replace(
    '{elements}',
    expectedElements
  );

  const client = await getClient();
  const text = await client.scoreScreenshot(base64, mediaType, filledRubric);
  return parseScore(text);
}

/**
 * Score a scene from multiple camera angles.
 * Takes an array of screenshot file paths.
 */
export async function scoreScene(
  screenshots: string[],
  promptText: string,
  expectedElements: Record<string, unknown>
): Promise<VisionResult> {
  const elementsStr = JSON.stringify(expectedElements, null, 2);

  const perAngle: VisionScore[] = [];
  for (const path of screenshots) {
    const score = await scoreScreenshot(path, promptText, elementsStr);
    perAngle.push(score);
  }

  // Average across angles
  const averaged: VisionScore = {
    composition: 0,
    lighting: 0,
    material: 0,
    completeness: 0,
    polish: 0,
    total: 0,
    notes: perAngle.map((s) => s.notes).join(' | '),
  };

  for (const s of perAngle) {
    averaged.composition += s.composition;
    averaged.lighting += s.lighting;
    averaged.material += s.material;
    averaged.completeness += s.completeness;
    averaged.polish += s.polish;
  }

  const count = perAngle.length || 1;
  averaged.composition = Math.round(averaged.composition / count);
  averaged.lighting = Math.round(averaged.lighting / count);
  averaged.material = Math.round(averaged.material / count);
  averaged.completeness = Math.round(averaged.completeness / count);
  averaged.polish = Math.round(averaged.polish / count);
  averaged.total =
    averaged.composition +
    averaged.lighting +
    averaged.material +
    averaged.completeness +
    averaged.polish;

  const client = await getClient();
  return {
    score: averaged.total,
    maxScore: 50,
    perAngle,
    averaged,
    model: client.modelName,
  };
}
