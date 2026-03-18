/**
 * SchemaValidator — validates AI-generated JSON responses against expected
 * command schemas.
 *
 * Design:
 *   - `validateCommandResponse` checks a parsed object against a SchemaDefinition
 *   - Pre-built schemas for common SpawnForge command types
 *   - Graceful degradation: failures are logged as warnings, not thrown
 *   - Extensible: callers can pass ad-hoc schemas without registering them
 */

// ---------------------------------------------------------------------------
// Schema types
// ---------------------------------------------------------------------------

export type FieldType = 'string' | 'number' | 'boolean' | 'array' | 'object';

export interface FieldSchema {
  type: FieldType;
  required: boolean;
  /** Minimum value for numbers */
  min?: number;
  /** Maximum value for numbers */
  max?: number;
  /** Allowed values for strings */
  enum?: readonly string[];
  /** Schema for items inside an array */
  items?: FieldSchema;
  /** Schema for object properties */
  properties?: Record<string, FieldSchema>;
}

export interface SchemaDefinition {
  name: string;
  fields: Record<string, FieldSchema>;
}

export interface ValidationResult {
  valid: boolean;
  errors: string[];
}

// ---------------------------------------------------------------------------
// Pre-built schemas for common SpawnForge commands
// ---------------------------------------------------------------------------

const ENTITY_TYPES = [
  'cube', 'sphere', 'cylinder', 'plane', 'cone', 'torus', 'capsule',
  'light_point', 'light_directional', 'light_spot', 'camera',
] as const;

const BLEND_MODES = ['opaque', 'transparent', 'add', 'multiply'] as const;
const COLLIDER_TYPES = ['box', 'sphere', 'capsule', 'cylinder', 'trimesh', 'convex'] as const;
const BODY_TYPES = ['dynamic', 'static', 'kinematic'] as const;

export const BUILT_IN_SCHEMAS: Record<string, SchemaDefinition> = {
  spawn_entity: {
    name: 'spawn_entity',
    fields: {
      entityType: { type: 'string', required: true, enum: ENTITY_TYPES },
      name: { type: 'string', required: false },
      position: { type: 'array', required: false },
      rotation: { type: 'array', required: false },
      scale: { type: 'array', required: false },
    },
  },

  set_material: {
    name: 'set_material',
    fields: {
      entityId: { type: 'string', required: true },
      baseColor: { type: 'array', required: false },
      metallic: { type: 'number', required: false, min: 0, max: 1 },
      roughness: { type: 'number', required: false, min: 0, max: 1 },
      emissiveIntensity: { type: 'number', required: false, min: 0 },
      alpha: { type: 'number', required: false, min: 0, max: 1 },
      alphaMode: { type: 'string', required: false, enum: BLEND_MODES },
    },
  },

  update_transform: {
    name: 'update_transform',
    fields: {
      entityId: { type: 'string', required: true },
      position: { type: 'array', required: false },
      rotation: { type: 'array', required: false },
      scale: { type: 'array', required: false },
    },
  },

  set_physics: {
    name: 'set_physics',
    fields: {
      entityId: { type: 'string', required: true },
      bodyType: { type: 'string', required: false, enum: BODY_TYPES },
      colliderType: { type: 'string', required: false, enum: COLLIDER_TYPES },
      mass: { type: 'number', required: false, min: 0 },
      restitution: { type: 'number', required: false, min: 0, max: 1 },
      friction: { type: 'number', required: false, min: 0 },
      gravityScale: { type: 'number', required: false },
    },
  },

  set_script: {
    name: 'set_script',
    fields: {
      entityId: { type: 'string', required: true },
      code: { type: 'string', required: true },
    },
  },

  delete_entity: {
    name: 'delete_entity',
    fields: {
      entityId: { type: 'string', required: true },
    },
  },

  rename_entity: {
    name: 'rename_entity',
    fields: {
      entityId: { type: 'string', required: true },
      name: { type: 'string', required: true },
    },
  },

  set_audio: {
    name: 'set_audio',
    fields: {
      entityId: { type: 'string', required: true },
      url: { type: 'string', required: false },
      volume: { type: 'number', required: false, min: 0, max: 1 },
      loop: { type: 'boolean', required: false },
      spatial: { type: 'boolean', required: false },
    },
  },

  update_light: {
    name: 'update_light',
    fields: {
      entityId: { type: 'string', required: true },
      intensity: { type: 'number', required: false, min: 0 },
      color: { type: 'array', required: false },
      range: { type: 'number', required: false, min: 0 },
      shadows: { type: 'boolean', required: false },
    },
  },
};

// ---------------------------------------------------------------------------
// Validator
// ---------------------------------------------------------------------------

/** Validate a single field value against its schema */
function validateField(
  value: unknown,
  schema: FieldSchema,
  path: string,
  errors: string[]
): void {
  if (value === undefined || value === null) {
    if (schema.required) {
      errors.push(`Missing required field: ${path}`);
    }
    return;
  }

  // Type check
  if (schema.type === 'array') {
    if (!Array.isArray(value)) {
      errors.push(`Field ${path} must be an array, got ${typeof value}`);
      return;
    }
    if (schema.items) {
      for (let i = 0; i < (value as unknown[]).length; i++) {
        validateField((value as unknown[])[i], schema.items, `${path}[${i}]`, errors);
      }
    }
    return;
  }

  if (schema.type === 'object') {
    if (typeof value !== 'object' || Array.isArray(value)) {
      errors.push(`Field ${path} must be an object, got ${Array.isArray(value) ? 'array' : typeof value}`);
      return;
    }
    if (schema.properties) {
      for (const [propName, propSchema] of Object.entries(schema.properties)) {
        validateField(
          (value as Record<string, unknown>)[propName],
          propSchema,
          `${path}.${propName}`,
          errors
        );
      }
    }
    return;
  }

  if (typeof value !== schema.type) {
    errors.push(`Field ${path} must be ${schema.type}, got ${typeof value}`);
    return;
  }

  // Number bounds
  if (schema.type === 'number') {
    const n = value as number;
    if (schema.min !== undefined && n < schema.min) {
      errors.push(`Field ${path} must be >= ${schema.min}, got ${n}`);
    }
    if (schema.max !== undefined && n > schema.max) {
      errors.push(`Field ${path} must be <= ${schema.max}, got ${n}`);
    }
  }

  // Enum check
  if (schema.enum && schema.type === 'string') {
    if (!schema.enum.includes(value as string)) {
      errors.push(`Field ${path} must be one of [${schema.enum.join(', ')}], got "${value as string}"`);
    }
  }
}

/**
 * Validate an AI-generated JSON response against a schema.
 *
 * Never throws — all failures are captured in `errors`. This enables
 * graceful degradation: the caller decides whether to block or warn.
 */
export function validateCommandResponse(
  response: unknown,
  schema: SchemaDefinition
): ValidationResult {
  const errors: string[] = [];

  if (typeof response !== 'object' || response === null || Array.isArray(response)) {
    errors.push(`Response must be a plain object, got ${Array.isArray(response) ? 'array' : typeof response}`);
    return { valid: false, errors };
  }

  const obj = response as Record<string, unknown>;

  for (const [fieldName, fieldSchema] of Object.entries(schema.fields)) {
    validateField(obj[fieldName], fieldSchema, fieldName, errors);
  }

  return { valid: errors.length === 0, errors };
}

/**
 * Validate against a built-in schema by command name.
 * Returns `{ valid: true, errors: [] }` if no schema is registered (graceful degradation).
 */
export function validateBuiltInCommand(
  commandName: string,
  response: unknown
): ValidationResult {
  const schema = BUILT_IN_SCHEMAS[commandName];
  if (!schema) {
    // No schema registered — treat as valid (unknown commands pass through)
    return { valid: true, errors: [] };
  }
  return validateCommandResponse(response, schema);
}

/**
 * Validate and log warnings without blocking.
 * Returns true if valid; logs a console.warn if invalid.
 */
export function validateOrWarn(
  commandName: string,
  response: unknown,
  schema?: SchemaDefinition
): boolean {
  const result = schema
    ? validateCommandResponse(response, schema)
    : validateBuiltInCommand(commandName, response);

  if (!result.valid) {
    console.warn(
      `[SchemaValidator] Command "${commandName}" response failed validation:`,
      result.errors
    );
  }

  return result.valid;
}
