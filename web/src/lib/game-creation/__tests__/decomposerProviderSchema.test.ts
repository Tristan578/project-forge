/**
 * Pins the provider-facing JSON schema the decomposer hands to the model
 * (idea.FR-1.OP-02, #10174).
 *
 * `decomposeIntoSystems` passes a Zod shape to `generateDecomposition`, and
 * `Output.object({ schema })` turns that shape into JSON Schema through
 * `asSchema` from `@ai-sdk/provider-utils` (re-exported by `ai`). This test
 * runs the SAME conversion on the SAME object the seam receives and compares
 * the result to a committed file, so two things cannot drift silently:
 *
 *   1. The Zod shape itself. #10174 moves it out of `decomposer.ts` into the
 *      shared `briefSchema.ts`; the issue requires the model to see a
 *      byte-identical structured-output schema before and after that move,
 *      and this file is the evidence. A later PR that MEANS to change the
 *      provider shape (#10180 adds `openDecisions`) updates the snapshot on
 *      purpose, in the same diff as the change.
 *   2. The conversion. A dependency bump that changes how `ai` renders a Zod
 *      schema changes what the provider is told, with no code change here.
 *      That is worth a red test too.
 *
 * The snapshot was generated against the shape as it stood in
 * `decomposer.ts` on 2218e9be1, before the extraction.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { asSchema } from 'ai';
import type { z } from 'zod';
import { decomposeIntoSystems } from '../decomposer';
import { generateDecomposition } from '../decomposerLlm';

vi.mock('@/lib/game-creation/decomposerLlm', () => ({
  generateDecomposition: vi.fn(),
}));

vi.mock('@/lib/ai/contentSafety', () => ({
  sanitizePrompt: vi.fn((text: string) => ({ safe: true, filtered: text })),
}));

const seam = vi.mocked(generateDecomposition);

/** The Zod shape the decomposer passed to the seam on its first attempt. */
async function captureProviderShape(): Promise<z.ZodType> {
  // The seam rejects, so the decomposer retries and then throws. All that is
  // wanted here is the third argument of the call.
  seam.mockRejectedValue(new Error('capture only'));
  await expect(decomposeIntoSystems('capture the provider shape', '3d')).rejects.toThrow();
  expect(seam.mock.calls.length).toBeGreaterThan(0);
  return seam.mock.calls[0][2] as z.ZodType;
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('decomposer provider-facing schema (idea.FR-1.OP-02)', () => {
  it('matches the committed JSON schema snapshot after the ai SDK conversion', async () => {
    const shape = await captureProviderShape();

    // `asSchema` is exactly what `Output.object` applies to the schema option,
    // so this is the document the provider receives, not an approximation.
    const json = asSchema(shape).jsonSchema;

    await expect(`${JSON.stringify(json, null, 2)}\n`).toMatchFileSnapshot(
      './__snapshots__/decomposer-provider-schema.json',
    );
  });

  it('hands the provider the same shape object on every retry attempt', async () => {
    await captureProviderShape();

    // MAX_RETRIES is 2, so three attempts. A different object per attempt
    // would mean a schema built per call, which is where accidental drift
    // between attempts would come from.
    expect(seam).toHaveBeenCalledTimes(3);
    const first = seam.mock.calls[0][2];
    for (const call of seam.mock.calls) {
      expect(call[2]).toBe(first);
    }
  });
});
