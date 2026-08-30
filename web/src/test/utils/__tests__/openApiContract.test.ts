/**
 * Unit tests for the OpenAPI contract helper (#8621 / PF-803).
 *
 * `diffAgainstSpec` is what makes the real-response contract tests non-vacuous
 * — 11 of the spec's 12 component schemas accept `{}`, so ajv alone cannot see
 * a renamed or dropped field. A bug in this differ would turn every route
 * contract test into a silent pass, so it gets its own coverage rather than
 * being trusted implicitly.
 */

import { describe, it, expect } from 'vitest';
import { diffAgainstSpec, loadOpenApiContract } from '@/test/utils/openApiContract';

const objectSchema = {
  type: 'object',
  properties: {
    id: { type: 'string' },
    name: { type: 'string' },
  },
};

describe('diffAgainstSpec', () => {
  it('reports nothing when the property sets match exactly', () => {
    expect(diffAgainstSpec(objectSchema, { id: 'a', name: 'b' })).toEqual([]);
  });

  it('reports a documented property the body omits', () => {
    expect(diffAgainstSpec(objectSchema, { id: 'a' })).toEqual(['missing $.name']);
  });

  it('reports a body property the spec does not document', () => {
    expect(diffAgainstSpec(objectSchema, { id: 'a', name: 'b', legacy: 1 })).toEqual([
      'undocumented $.legacy',
    ]);
  });

  it('reports missing and undocumented properties together, sorted', () => {
    expect(diffAgainstSpec(objectSchema, { id: 'a', label: 'b' })).toEqual([
      'missing $.name',
      'undocumented $.label',
    ]);
  });

  it('treats an explicit undefined value as an absent key', () => {
    // NextResponse.json drops undefined properties, so the wire body has no key.
    const body = JSON.parse(JSON.stringify({ id: 'a', name: undefined })) as unknown;
    expect(diffAgainstSpec(objectSchema, body)).toEqual(['missing $.name']);
  });

  it('recurses into nested objects and reports the full path', () => {
    const schema = {
      type: 'object',
      properties: { profile: objectSchema },
    };
    expect(diffAgainstSpec(schema, { profile: { id: 'a', extra: true } })).toEqual([
      'missing $.profile.name',
      'undocumented $.profile.extra',
    ]);
  });

  it('recurses into array items and indexes the path', () => {
    const schema = { type: 'array', items: objectSchema };
    expect(diffAgainstSpec(schema, [{ id: 'a', name: 'b' }, { id: 'c' }])).toEqual([
      'missing $[1].name',
    ]);
  });

  it('flags an empty array of object items as unproven coverage', () => {
    const schema = { type: 'array', items: objectSchema };
    expect(diffAgainstSpec(schema, [])).toEqual(['empty-array $']);
  });

  it('permits an empty array when the caller opts in', () => {
    const schema = { type: 'array', items: objectSchema };
    expect(diffAgainstSpec(schema, [], '$', { allowEmptyArrays: true })).toEqual([]);
  });

  it('unions allOf branches so route-local extensions count as documented', () => {
    const schema = {
      allOf: [objectSchema, { type: 'object', properties: { thumbnailUrl: { type: 'string' } } }],
    };
    expect(diffAgainstSpec(schema, { id: 'a', name: 'b', thumbnailUrl: 'u' })).toEqual([]);
  });

  it('accepts null against a oneOf that documents a null branch', () => {
    const schema = { oneOf: [objectSchema, { type: 'null' }] };
    expect(diffAgainstSpec(schema, null)).toEqual([]);
  });

  it('rejects null against a oneOf with no null branch', () => {
    const schema = { oneOf: [objectSchema] };
    expect(diffAgainstSpec(schema, null)).toEqual(['unexpected-null $']);
  });

  it('checks the object branch of a oneOf when the value is not null', () => {
    const schema = { oneOf: [objectSchema, { type: 'null' }] };
    expect(diffAgainstSpec(schema, { id: 'a' })).toEqual(['missing $.name']);
  });

  it('reports a structural mismatch instead of silently passing', () => {
    expect(diffAgainstSpec(objectSchema, ['not', 'an', 'object'])).toEqual(['expected-object $']);
    expect(diffAgainstSpec({ type: 'array', items: objectSchema }, { id: 'a' })).toEqual([
      'expected-array $',
    ]);
  });

  it('ignores leaf schemas it cannot compare structurally', () => {
    expect(diffAgainstSpec({ type: 'string' }, 'anything')).toEqual([]);
    expect(diffAgainstSpec(undefined, { anything: true })).toEqual([]);
  });
});

describe('loadOpenApiContract', () => {
  const contract = loadOpenApiContract();

  it('compiles a component schema that enforces its own constraints', () => {
    const validate = contract.component('TokenBalance');
    expect(validate({ monthlyRemaining: 1, monthlyTotal: 2, addon: 0, total: 1 })).toBe(true);
    expect(validate({ monthlyRemaining: 1, monthlyTotal: 2, addon: 0 })).toBe(false);
  });

  it('inlines $refs so an operation validator resolves component schemas', () => {
    const schema = contract.operationSchema('get', '/api/publish/list', 200);
    const publications = (schema.properties as Record<string, Record<string, unknown>>).publications;
    const items = publications.items as Record<string, unknown>;
    // Resolved from #/components/schemas/Publication, not left as a dangling $ref.
    expect(Object.keys(items.properties as object)).toContain('slug');
    expect(items).not.toHaveProperty('$ref');
  });

  it('exposes the prepared component schema for property-set diffing', () => {
    const schema = contract.componentSchema('Error');
    expect(Object.keys(schema.properties as object)).toEqual(['error', 'code', 'details']);
    expect(diffAgainstSpec(schema, { error: 'nope', code: 'BAD_REQUEST' })).toEqual([
      'missing $.details',
    ]);
  });

  it('rewrites OpenAPI nullable into a JSON Schema null union', () => {
    const validate = contract.operation('get', '/api/tokens/balance', 200);
    expect(
      validate({ monthlyRemaining: 1, monthlyTotal: 2, addon: 0, total: 1, nextRefillDate: null }),
    ).toBe(true);
  });

  it('throws a named error for an operation the spec does not document', () => {
    expect(() => contract.operation('get', '/api/not/a/route', 200)).toThrow(
      /documents no GET \/api\/not\/a\/route/,
    );
    expect(() => contract.operation('get', '/api/tokens/balance', 418)).toThrow(
      /documents no 418 response/,
    );
    expect(() => contract.component('NotASchema')).toThrow(/no component schema named/);
  });
});
