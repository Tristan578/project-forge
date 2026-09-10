/**
 * What `withEgressGuard` costs, measured rather than asserted.
 *
 * WHY THIS FILE EXISTS. The PR that added the guard quoted "+1.088 ms before,
 * +0.339 ms after, on a 13 KB listing body" and "+0.087 ms on a typical error
 * envelope" in the changeset and in a docblock, with no harness anywhere in the
 * diff. So neither the method nor the environment was recorded, no regression
 * could be detected, and the numbers could not be re-checked after a change
 * (lessons-learned #8 and #10). Worse, a 13 KB listing is not the body that pays
 * the cost: the guard sits on `GET /api/play/[userId]/[slug]` (public),
 * `GET /api/projects/[id]` and `/api/user/export-data`, which carry whole scene
 * graphs.
 *
 * WHAT IT MEASURES. The two paths that exist after the fast path landed, on the
 * same bodies, so the difference between them is the thing being reported:
 *
 *   FAST PATH  — nothing in the response matches, so the guard scans and returns
 *                the handler's own Response. No parse, no walk, no stringify.
 *                This is what essentially every request pays.
 *   MATCH PATH — a secret is present, so the body is parsed, walked and
 *                re-serialised. Only a response that actually carries a
 *                credential pays this.
 *
 * HOW TO RUN, from `web/`:
 *
 *     npx tsx scripts/bench-egress-guard.ts
 *
 * It prints the environment it ran in alongside every number, because a figure
 * reported without the tree it was taken in does not transfer.
 */
import { performance } from 'node:perf_hooks';
import os from 'node:os';
import { NextResponse } from 'next/server';
import { withEgressGuard } from '../src/lib/security/egressGuard';
import { buildDeepSceneBody } from '../src/lib/security/__tests__/deepSceneBody';

const ITERATIONS = 200;
const WARMUP = 30;

/** A key SHAPE, assembled so the repository carries no scannable token. */
const SECRET = 'sk-' + 'ant-' + 'api03-' + 'A'.repeat(36);

interface Case {
  label: string;
  text: string;
  contentType: string;
  status: number;
}

function jsonCase(label: string, value: unknown, status = 200): Case {
  return { label, text: JSON.stringify(value), contentType: 'application/json', status };
}

function buildCases(): Case[] {
  const scene = buildDeepSceneBody({ entities: 400 });
  const sceneWithSecret = buildDeepSceneBody({
    entities: 400,
    plantedDeepText: `upstream said ${SECRET}`,
  });
  // The fast path's WORST case after the JSON-escape fix. `hasCandidate` scans
  // a JSON-unescaped view of the body in addition to the raw text, gated on the
  // body containing a backslash at all — so a scene whose script source carries
  // one (a quote, a tab, a Windows path) pays a second linear pass over 350 KB
  // where the default fixture pays only an `indexOf`. Both are measured, because
  // "the fix did not simply route everything down the slow path" is a claim, and
  // the number is what makes it checkable.
  const sceneWithEscapes = buildDeepSceneBody({
    entities: 400,
    plantedDeepText: 'log: "retry" at C:\\tmp\\run\tno credential here',
  });
  const listing = {
    games: Array.from({ length: 60 }, (_, i) => ({
      id: `g-${i}`,
      slug: `game-${i}`,
      title: `Game ${i}`,
      description: 'A short description of a published game.',
      plays: i * 13,
      thumbnailUrl: `https://cdn.example.test/thumbs/${i}.png`,
    })),
  };
  return [
    jsonCase('error envelope (91 B)', { error: 'Generation failed. Try again.' }, 500),
    jsonCase('error envelope WITH a secret', { error: `upstream said ${SECRET}` }, 500),
    jsonCase('community listing', listing),
    jsonCase('published scene, 400 entities', scene),
    jsonCase('same scene WITH JSON escapes, no secret', sceneWithEscapes),
    jsonCase('published scene WITH a secret planted at depth 8', sceneWithSecret),
  ];
}

async function measure(c: Case): Promise<{ guarded: number; bare: number; bytes: number }> {
  const make = () =>
    new NextResponse(c.text, { status: c.status, headers: { 'content-type': c.contentType } });
  const guardedHandler = withEgressGuard(async () => make());

  for (let i = 0; i < WARMUP; i += 1) {
    await (await guardedHandler()).text();
    await make().text();
  }

  const g0 = performance.now();
  for (let i = 0; i < ITERATIONS; i += 1) await (await guardedHandler()).text();
  const guarded = (performance.now() - g0) / ITERATIONS;

  const b0 = performance.now();
  for (let i = 0; i < ITERATIONS; i += 1) await make().text();
  const bare = (performance.now() - b0) / ITERATIONS;

  return { guarded, bare, bytes: Buffer.byteLength(c.text) };
}

async function main(): Promise<void> {
  console.log('withEgressGuard cost');
  console.log(`  node       ${process.version}`);
  console.log(`  platform   ${process.platform} ${process.arch}`);
  console.log(`  cpu        ${os.cpus()[0]?.model ?? 'unknown'}`);
  console.log(`  iterations ${ITERATIONS} (after ${WARMUP} warmup)`);
  console.log(`  env keys   ${Object.keys(process.env).length}`);
  console.log('');
  console.log('  body                                                 bytes    guard    bare    delta');

  for (const c of buildCases()) {
    const { guarded, bare, bytes } = await measure(c);
    const delta = guarded - bare;
    console.log(
      `  ${c.label.padEnd(50)} ${String(bytes).padStart(7)} `
      + `${guarded.toFixed(3).padStart(7)} ${bare.toFixed(3).padStart(7)} `
      + `${(delta >= 0 ? '+' : '') + delta.toFixed(3)}`,
    );
  }
  console.log('');
  console.log('  All figures in milliseconds per request, synchronous CPU on the response path.');
}

void main();
