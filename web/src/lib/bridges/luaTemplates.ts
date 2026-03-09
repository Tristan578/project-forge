import 'server-only';
import { readFileSync, existsSync } from 'fs';
import { join, dirname, resolve, relative } from 'path';
import { fileURLToPath } from 'url';

// Resolve templates dir relative to this file (works in both CJS and ESM)
const TEMPLATES_DIR = join(dirname(fileURLToPath(import.meta.url)), 'aseprite', 'templates');

/** Allowlist of valid template names — prevents path traversal. */
export const ALLOWED_TEMPLATES = new Set([
  'createSprite',
  'createAnimation',
  'editSprite',
  'applyPalette',
  'exportSheet',
]);

/** Escape a string value for safe inclusion in Lua source code. */
function escapeForLua(value: string): string {
  return value
    .replace(/\\/g, '\\\\')
    .replace(/"/g, '\\"')
    .replace(/\n/g, '\\n')
    .replace(/\r/g, '\\r');
}

/** Params that must be strictly numeric (integers within safe bounds). */
const NUMERIC_PARAMS = new Set([
  'width', 'height', 'newWidth', 'newHeight',
  'frameCount', 'frameDuration',
  'baseColorR', 'baseColorG', 'baseColorB', 'baseColorA',
  'columns',
]);

/**
 * Validate that a param value is safe for Lua template substitution.
 * Numeric params are coerced to integers. All other params are escaped.
 * Rejects values containing Lua code injection patterns.
 */
function validateParamValue(key: string, value: string): string {
  // Numeric params: strict integer validation — no code can sneak through
  if (NUMERIC_PARAMS.has(key)) {
    const num = Number(value);
    if (!Number.isFinite(num) || !Number.isInteger(num) || num < 0 || num > 99999) {
      throw new Error(`Parameter "${key}" must be an integer 0-99999, got: "${value}"`);
    }
    return String(num);
  }

  // Reject values that look like Lua code injection (dot and bracket notation)
  const dangerousPatterns = /(^|;|\))\s*(os|io|require|dofile|loadfile|load|pcall|app\.command)\s*[.([]/i;
  if (dangerousPatterns.test(value)) {
    throw new Error(`Unsafe parameter value for "${key}": contains prohibited Lua patterns`);
  }
  // Block bracket-notation bypass: os["execute"], io["open"], etc.
  if (/\b(os|io|require|dofile|loadfile|load|pcall)\s*\[/i.test(value)) {
    throw new Error(`Unsafe parameter value for "${key}": contains prohibited Lua bracket access`);
  }
  // Reject semicolons that could inject new statements
  if (/[;]/.test(value)) {
    throw new Error(`Unsafe parameter value for "${key}": contains semicolons`);
  }
  // Limit length to prevent abuse
  if (value.length > 1000) {
    throw new Error(`Parameter "${key}" exceeds maximum length (1000 chars)`);
  }
  return escapeForLua(value);
}

/** Render a Lua template by replacing {{key}} placeholders. */
export function renderTemplate(
  template: string,
  params: Record<string, string>
): string {
  return template.replace(/\{\{(\w+)\}\}/g, (_match, key: string) => {
    const value = params[key];
    if (value === undefined) return '';
    return validateParamValue(key, value);
  });
}

/** Load a named template from disk. Validates against allowlist to prevent path traversal. */
export function getTemplate(name: string): string {
  if (!ALLOWED_TEMPLATES.has(name)) {
    throw new Error(`Unknown bridge template: "${name}". Allowed: ${[...ALLOWED_TEMPLATES].join(', ')}`);
  }
  const filePath = resolve(TEMPLATES_DIR, `${name}.lua`);
  // Double-check resolved path stays within templates dir
  const rel = relative(TEMPLATES_DIR, filePath);
  if (rel.startsWith('..') || rel.includes('/')) {
    throw new Error(`Template path traversal blocked: "${name}"`);
  }
  if (!existsSync(filePath)) {
    throw new Error(`Bridge template not found: ${name}`);
  }
  return readFileSync(filePath, 'utf-8');
}

/** Load a template and render it with params in one step. */
export function buildScript(
  templateName: string,
  params: Record<string, string>
): string {
  const template = getTemplate(templateName);
  return renderTemplate(template, params);
}
