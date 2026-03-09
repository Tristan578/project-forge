import { readFileSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

// Resolve templates dir relative to this file (works in both CJS and ESM)
const TEMPLATES_DIR = join(dirname(fileURLToPath(import.meta.url)), 'aseprite', 'templates');

/** Escape a string value for safe inclusion in Lua source code. */
function escapeForLua(value: string): string {
  return value
    .replace(/\\/g, '\\\\')
    .replace(/"/g, '\\"')
    .replace(/\n/g, '\\n')
    .replace(/\r/g, '\\r');
}

/** Render a Lua template by replacing {{key}} placeholders. */
export function renderTemplate(
  template: string,
  params: Record<string, string>
): string {
  return template.replace(/\{\{(\w+)\}\}/g, (_match, key: string) => {
    const value = params[key];
    if (value === undefined) return '';
    return escapeForLua(value);
  });
}

/** Load a named template from disk. */
export function getTemplate(name: string): string {
  const filePath = join(TEMPLATES_DIR, `${name}.lua`);
  if (!existsSync(filePath)) {
    throw new Error(`Bridge template not found: ${name} (expected at ${filePath})`);
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
