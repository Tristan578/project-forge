/**
 * @vitest-environment node
 *
 * `docs/api/openapi.json` is served verbatim at `/api/openapi` and is one of the
 * three generated-artifact sync gates, but the route-sync gate only checks that
 * the spec is well-formed JSON and documents every route — it never inspects a
 * path parameter's `enum`. So the `provider` enum on `/api/keys/{provider}` could
 * (and did, #9522) drift from the constants the route actually validates against:
 *
 *   - PUT  validates `provider` against `BYOK_PROVIDERS` (Suno removed, #9522),
 *   - DELETE validates against `REMOVABLE_BYOK_PROVIDERS` (Suno retained so a
 *     stale key stays removable),
 *
 * yet the spec documented a single shared enum that still listed `suno` as a
 * valid PUT value — a request the route now answers 400. This suite pins each
 * operation's enum to the constant its handler uses, so the divergence the two
 * `requireOneOf(...)` calls introduce cannot silently rot the published spec.
 *
 * Fails closed (lessons-learned #9/#11): an unreadable or malformed spec, a
 * missing path, or an operation whose `provider` parameter is absent is a
 * failure, never a vacuous pass.
 */
import { describe, expect, it } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { BYOK_PROVIDERS, REMOVABLE_BYOK_PROVIDERS } from '../providers';

// __dirname is web/src/lib/config/__tests__ — five levels below the repo root.
const REPO_ROOT = join(__dirname, '..', '..', '..', '..', '..');
const SPEC_PATH = join(REPO_ROOT, 'docs', 'api', 'openapi.json');

interface OpenApiParameter {
  name: string;
  in: string;
  schema?: { enum?: string[] };
}
interface OpenApiOperation {
  parameters?: OpenApiParameter[];
}
interface OpenApiPathItem {
  parameters?: OpenApiParameter[];
  put?: OpenApiOperation;
  delete?: OpenApiOperation;
}

function loadSpec(): { paths: Record<string, OpenApiPathItem> } {
  expect(existsSync(SPEC_PATH), `OpenAPI spec missing at ${SPEC_PATH}`).toBe(true);
  const raw = readFileSync(SPEC_PATH, 'utf8');
  return JSON.parse(raw) as { paths: Record<string, OpenApiPathItem> };
}

/**
 * The effective `provider` path-parameter enum for one operation: OpenAPI lets
 * an operation-level parameter override a path-level one of the same name+in,
 * so consult the operation first, then fall back to the path item.
 */
function providerEnum(pathItem: OpenApiPathItem, op: 'put' | 'delete'): string[] {
  const operation = pathItem[op];
  expect(operation, `/api/keys/{provider} is missing its ${op.toUpperCase()} operation`).toBeDefined();
  const fromOp = operation!.parameters?.find((p) => p.name === 'provider' && p.in === 'path');
  const fromPath = pathItem.parameters?.find((p) => p.name === 'provider' && p.in === 'path');
  const param = fromOp ?? fromPath;
  const list = param?.schema?.enum;
  expect(
    Array.isArray(list) && list.length > 0,
    `${op.toUpperCase()} /api/keys/{provider} has no provider enum to check`,
  ).toBe(true);
  return list!;
}

describe('/api/keys/{provider} provider enum stays in sync with providers.ts (#9522)', () => {
  it("PUT's enum matches BYOK_PROVIDERS exactly (Suno omitted)", () => {
    const spec = loadSpec();
    const pathItem = spec.paths['/api/keys/{provider}'];
    expect(pathItem, 'spec is missing /api/keys/{provider}').toBeDefined();
    const put = providerEnum(pathItem, 'put');
    expect([...put].sort()).toEqual([...BYOK_PROVIDERS].sort());
    // The whole point of #9522: PUT no longer accepts a retired provider.
    expect(put).not.toContain('suno');
  });

  it("DELETE's enum matches REMOVABLE_BYOK_PROVIDERS exactly (Suno retained)", () => {
    const spec = loadSpec();
    const pathItem = spec.paths['/api/keys/{provider}'];
    expect(pathItem, 'spec is missing /api/keys/{provider}').toBeDefined();
    const del = providerEnum(pathItem, 'delete');
    expect([...del].sort()).toEqual([...REMOVABLE_BYOK_PROVIDERS].sort());
    // A retired key must stay deletable even though it can no longer be added.
    expect(del).toContain('suno');
  });

  it('the PUT and DELETE enums genuinely diverge (retired providers)', () => {
    const spec = loadSpec();
    const pathItem = spec.paths['/api/keys/{provider}'];
    const put = new Set(providerEnum(pathItem, 'put'));
    const del = providerEnum(pathItem, 'delete');
    const onlyDeletable = del.filter((p) => !put.has(p));
    expect(onlyDeletable).toContain('suno');
  });
});
