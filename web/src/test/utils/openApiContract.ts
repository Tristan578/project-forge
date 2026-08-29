/**
 * Bind REAL API route responses to the published OpenAPI contract
 * (`docs/api/openapi.json`, served at `/api/openapi` and rendered by Swagger UI
 * at `/api-docs`).
 *
 * Why this exists (#8621 / PF-803)
 * --------------------------------
 * `contracts.test.ts` used to compile the spec's component schemas into ajv
 * validators and then run them against hand-written literals. That is circular:
 * it proves the fixture matches the schema, never that a route produces a
 * conforming body. A route could rename every field and stay green.
 *
 * Two things are needed to close that loop, and ajv alone only provides one:
 *
 *  1. `operationValidator()` compiles the schema for a specific OPERATION
 *     response (`GET /api/publish/list` → `200`), envelope and `$ref`s
 *     included — not just the bare component. Run it on a real handler's body.
 *
 *  2. `diffAgainstSpec()` compares PROPERTY SETS. This is not redundant with
 *     ajv: of the 12 component schemas in the spec, only `TokenBalance`
 *     declares `required` / `additionalProperties: false`. For the other 11,
 *     `{}` is a valid instance, so `expect(validate(realBody)).toBe(true)` is a
 *     tautology. The diff reports every documented property the response omits
 *     and every response property the spec does not document, so a rename or a
 *     dropped field fails the build naming the exact JSON path.
 *
 * Nothing here reads the network or the database — callers invoke route
 * handlers with the route's own external boundaries mocked.
 */

import { readFileSync } from 'fs';
import path from 'path';
import Ajv, { type ValidateFunction } from 'ajv';
import addFormats from 'ajv-formats';

type JsonObject = Record<string, unknown>;

/** HTTP methods the spec documents. */
export type SpecMethod = 'get' | 'post' | 'put' | 'patch' | 'delete';

interface OpenApiDocument {
  components?: { schemas?: Record<string, JsonObject> };
  paths?: Record<string, Record<string, JsonObject>>;
}

function isObject(value: unknown): value is JsonObject {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** True when an OpenAPI `type` (string or array form) admits `name`. */
function typeAdmits(type: unknown, name: string): boolean {
  return type === name || (Array.isArray(type) && type.includes(name));
}

/**
 * Rewrite OpenAPI 3.0 `nullable: true` into JSON Schema's `type: [X, 'null']`.
 *
 * Ajv v8 has no `nullable` option, so without this every nullable field in the
 * spec (`TokenBalance.nextRefillDate`, `Publication.description`, ...) would
 * reject a legitimate `null` from a real route.
 */
function stripNullable(node: unknown): unknown {
  if (Array.isArray(node)) return node.map(stripNullable);
  if (!isObject(node)) return node;

  const out: JsonObject = {};
  for (const [key, value] of Object.entries(node)) {
    if (key === 'nullable') continue;
    out[key] = stripNullable(value);
  }

  if (node.nullable === true && 'type' in out) {
    const type = out.type;
    if (typeof type === 'string') out.type = [type, 'null'];
    else if (Array.isArray(type) && !type.includes('null')) out.type = [...type, 'null'];
  }

  return out;
}

/**
 * Inline every `$ref` against the spec root.
 *
 * The operation response schemas we compile live at
 * `paths./x.get.responses.200...`, so their `#/components/schemas/Y` pointers
 * are relative to the whole document. Compiling a detached sub-schema with ajv
 * would leave those pointers unresolvable, so we splice the targets in.
 * The spec's component schemas do not reference each other, so a `seen` guard
 * is enough to turn an accidental cycle into a loud throw rather than a hang.
 */
function inlineRefs(node: unknown, root: JsonObject, seen: readonly string[] = []): unknown {
  if (Array.isArray(node)) return node.map((item) => inlineRefs(item, root, seen));
  if (!isObject(node)) return node;

  const ref = node.$ref;
  if (typeof ref === 'string') {
    if (seen.includes(ref)) {
      throw new Error(`Cyclic $ref in the OpenAPI spec: ${[...seen, ref].join(' -> ')}`);
    }
    return inlineRefs(resolvePointer(root, ref), root, [...seen, ref]);
  }

  const out: JsonObject = {};
  for (const [key, value] of Object.entries(node)) {
    out[key] = inlineRefs(value, root, seen);
  }
  return out;
}

/** Resolve a local JSON pointer (`#/components/schemas/Error`) against the root. */
function resolvePointer(root: JsonObject, ref: string): unknown {
  if (!ref.startsWith('#/')) {
    throw new Error(`Only local $refs are supported, got: ${ref}`);
  }
  let cursor: unknown = root;
  for (const rawSegment of ref.slice(2).split('/')) {
    const segment = rawSegment.replace(/~1/g, '/').replace(/~0/g, '~');
    if (!isObject(cursor) || !(segment in cursor)) {
      throw new Error(`Unresolvable $ref in the OpenAPI spec: ${ref}`);
    }
    cursor = cursor[segment];
  }
  return cursor;
}

/**
 * The published spec, plus ajv validators compiled from it.
 *
 * `load()` is not cached: `contracts.test.ts` calls `vi.resetModules()` between
 * tests, and a module-level cache would be rebuilt on every reset anyway.
 * Callers hold the returned object for the lifetime of a describe block.
 */
export interface OpenApiContract {
  /** The parsed spec document, `$ref`s intact. */
  spec: OpenApiDocument;
  /** Validator for a component schema by name, e.g. `'TokenBalance'`. */
  component(name: string): ValidateFunction;
  /**
   * The de-referenced, JSON-Schema-ised component schema behind `component()`.
   * Feed it to {@link diffAgainstSpec} to compare property sets.
   */
  componentSchema(name: string): JsonObject;
  /** Validator for one operation's response body, e.g. `('get', '/api/projects', 200)`. */
  operation(method: SpecMethod, routePath: string, status: number): ValidateFunction;
  /**
   * The de-referenced, JSON-Schema-ised sub-schema behind `operation()`.
   * Feed it to {@link diffAgainstSpec} to compare property sets.
   */
  operationSchema(method: SpecMethod, routePath: string, status: number): JsonObject;
}

/**
 * Read `docs/api/openapi.json` and compile it.
 *
 * The spec is hand-maintained and has shipped with a trailing comma before
 * (which 500s `/api/openapi` in production), so trailing commas are stripped
 * before parsing rather than failing the whole suite on one.
 */
export function loadOpenApiContract(): OpenApiContract {
  // web/src/test/utils -> web/src/test -> web/src -> web -> repo root
  const specPath = path.resolve(__dirname, '../../../../docs/api/openapi.json');
  const raw = readFileSync(specPath, 'utf-8');
  const spec = JSON.parse(raw.replace(/,(\s*[}\]])/g, '$1')) as OpenApiDocument;
  const root = spec as unknown as JsonObject;

  // `strict: false` tolerates OpenAPI-isms (`example`, `summary`) that are not
  // JSON Schema keywords; ajv-formats registers `uuid` / `date-time` so a real
  // response's id and timestamp formats are actually checked instead of ignored.
  const ajv = new Ajv({ allErrors: true, strict: false });
  addFormats(ajv);

  const componentCache = new Map<string, ValidateFunction>();
  const operationCache = new Map<string, ValidateFunction>();
  const schemaCache = new Map<string, JsonObject>();

  function prepare(node: unknown): JsonObject {
    return stripNullable(inlineRefs(node, root)) as JsonObject;
  }

  function operationSchema(method: SpecMethod, routePath: string, status: number): JsonObject {
    const key = `${method} ${routePath} ${status}`;
    const cached = schemaCache.get(key);
    if (cached) return cached;

    const operation = spec.paths?.[routePath]?.[method];
    if (!isObject(operation)) {
      throw new Error(`OpenAPI spec documents no ${method.toUpperCase()} ${routePath}`);
    }
    const responses = operation.responses;
    const response = isObject(responses) ? responses[String(status)] : undefined;
    if (!isObject(response)) {
      throw new Error(`OpenAPI spec documents no ${status} response for ${method.toUpperCase()} ${routePath}`);
    }
    const content = isObject(response.content) ? response.content['application/json'] : undefined;
    const schema = isObject(content) ? content.schema : undefined;
    if (!isObject(schema)) {
      throw new Error(
        `OpenAPI spec documents no application/json body for ${method.toUpperCase()} ${routePath} ${status}`,
      );
    }

    const resolved = prepare(schema);
    schemaCache.set(key, resolved);
    return resolved;
  }

  function componentSchema(name: string): JsonObject {
    const key = `component ${name}`;
    const cached = schemaCache.get(key);
    if (cached) return cached;
    const schema = spec.components?.schemas?.[name];
    if (!schema) throw new Error(`OpenAPI spec has no component schema named "${name}"`);
    const resolved = prepare(schema);
    schemaCache.set(key, resolved);
    return resolved;
  }

  return {
    spec,

    component(name: string): ValidateFunction {
      const cached = componentCache.get(name);
      if (cached) return cached;
      const validate = ajv.compile(componentSchema(name));
      componentCache.set(name, validate);
      return validate;
    },

    componentSchema,

    operation(method: SpecMethod, routePath: string, status: number): ValidateFunction {
      const key = `${method} ${routePath} ${status}`;
      const cached = operationCache.get(key);
      if (cached) return cached;
      const validate = ajv.compile(operationSchema(method, routePath, status));
      operationCache.set(key, validate);
      return validate;
    },

    operationSchema,
  };
}

/** Options for {@link diffAgainstSpec}. */
export interface DiffOptions {
  /**
   * When `false` (the default) an empty array where the spec declares object
   * items is reported as `empty-array <path>`. A contract test that asserts an
   * empty list has checked nothing about the item shape, so surfacing it keeps
   * a thin fixture from reading as coverage.
   */
  allowEmptyArrays?: boolean;
}

/**
 * Compare the property SETS of a real response body against a de-referenced
 * spec schema and return every divergence, sorted for stable assertions.
 *
 * Returned strings, all suffixed with a JSON path:
 * - `missing $.x`         — the spec documents `x`; the response has no such key
 * - `undocumented $.x`    — the response returns `x`; the spec does not document it
 * - `expected-object $.x` / `expected-array $.x` — structural mismatch
 * - `unexpected-null $.x` — `null` where no `null` branch is documented
 * - `empty-array $.x`     — see {@link DiffOptions.allowEmptyArrays}
 *
 * `undefined` properties are invisible here by design: `NextResponse.json`
 * drops them, so a route returning `resultUrl: undefined` genuinely ships a
 * body with no `resultUrl` key, and that is what clients see.
 */
export function diffAgainstSpec(
  schema: unknown,
  value: unknown,
  at = '$',
  options: DiffOptions = {},
): string[] {
  return collectDiff(schema, value, at, options).sort();
}

function collectDiff(schema: unknown, value: unknown, at: string, options: DiffOptions): string[] {
  if (!isObject(schema)) return [];

  // allOf: the spec uses it to extend a component with route-local fields
  // (e.g. GenerationStatus + thumbnailUrl). Union the declared properties.
  if (Array.isArray(schema.allOf)) {
    const properties: JsonObject = {};
    for (const branch of schema.allOf) {
      if (isObject(branch) && isObject(branch.properties)) Object.assign(properties, branch.properties);
    }
    return collectDiff({ type: 'object', properties }, value, at, options);
  }

  // oneOf/anyOf: used for nullable objects (`{ profile: SellerProfile | null }`).
  const union = schema.oneOf ?? schema.anyOf;
  if (Array.isArray(union)) {
    if (value === null) {
      const nullable = union.some((branch) => isObject(branch) && typeAdmits(branch.type, 'null'));
      return nullable ? [] : [`unexpected-null ${at}`];
    }
    const objectBranch = union.find((branch) => isObject(branch) && isObject(branch.properties));
    return objectBranch ? collectDiff(objectBranch, value, at, options) : [];
  }

  if (typeAdmits(schema.type, 'array') || isObject(schema.items)) {
    if (!Array.isArray(value)) return [`expected-array ${at}`];
    const items = schema.items;
    if (value.length === 0) {
      const declaresShape = isObject(items) && isObject(items.properties);
      return declaresShape && !options.allowEmptyArrays ? [`empty-array ${at}`] : [];
    }
    return value.flatMap((item, index) => collectDiff(items, item, `${at}[${index}]`, options));
  }

  if (isObject(schema.properties)) {
    if (!isObject(value)) return [`expected-object ${at}`];
    const declared = Object.keys(schema.properties);
    const actual = Object.keys(value);
    const out: string[] = [];
    for (const key of declared) {
      if (!actual.includes(key)) out.push(`missing ${at}.${key}`);
    }
    for (const key of actual) {
      if (!declared.includes(key)) out.push(`undocumented ${at}.${key}`);
    }
    for (const key of declared) {
      if (actual.includes(key)) {
        out.push(...collectDiff(schema.properties[key], value[key], `${at}.${key}`, options));
      }
    }
    return out;
  }

  return [];
}
