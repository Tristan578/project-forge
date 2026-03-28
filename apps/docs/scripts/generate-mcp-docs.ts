/**
 * generate-mcp-docs.ts
 *
 * Generates MDX documentation pages for public MCP commands from commands.json.
 * Only commands with visibility: "public" are included.
 *
 * Usage:
 *   tsx scripts/generate-mcp-docs.ts
 *
 * Output:
 *   apps/docs/content/mcp/<command-name>.mdx
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { execFileSync } from 'child_process';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '../../..');

// ---- Types ----

interface CommandParameter {
  type: string;
  description?: string;
  enum?: string[];
  items?: { type: string };
  minItems?: number;
  maxItems?: number;
}

interface CommandParametersSchema {
  type: string;
  properties: Record<string, CommandParameter>;
  required?: string[];
}

interface Command {
  name: string;
  description: string;
  category: string;
  visibility?: string;
  parameters: CommandParametersSchema;
  tokenCost?: number;
  requiredScope?: string;
  example?: Record<string, unknown>;
}

interface CommandManifest {
  version: string;
  commands: Command[];
}

export interface GenerateResult {
  generatedCount: number;
  errors: string[];
}

// ---- Exports (for tests) ----

/**
 * Sanitize a git author name for safe inclusion in MDX.
 * Returns null if the author should be omitted (bot, non-printable chars, etc.).
 */
export function sanitizeAuthor(raw: string): string | null {
  // Filter bot patterns
  if (/bot\b/i.test(raw) || /github-actions/i.test(raw)) {
    return null;
  }

  // HTML-escape special chars
  const escaped = raw
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');

  // Check for non-printable chars (ASCII control, zero-width, BiDi overrides, BOM)
  if (/[\x00-\x1f\x7f-\x9f\u200b-\u200f\u202a-\u202e\u2060\ufeff]/.test(escaped)) {
    return null;
  }

  return escaped;
}

/** Escape a value for safe inclusion in YAML double-quoted strings and MDX body. */
function htmlEscape(value: unknown): string {
  const str = value == null ? '' : String(value);
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/[\r\n]/g, ' ');
}

/** Validate category format (alphanumeric + hyphens/underscores only). */
function isValidCategory(category: string): boolean {
  return /^[a-z0-9_-]+$/.test(category);
}

/** Validate visibility is an expected value. */
function isValidVisibility(v: unknown): v is 'public' | 'internal' {
  return v === 'public' || v === 'internal';
}

/** Get git last-updated metadata for a file. Returns { date, author } or null. */
function getGitMetadata(filePath: string): { date: string; author: string | null } | null {
  try {
    // Use execFileSync with argument array to avoid shell injection
    const date = execFileSync(
      'git',
      ['log', '-1', '--format=%aI', '--', filePath],
      { cwd: repoRoot, encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'] }
    ).trim();

    if (!date) return null;

    const rawAuthor = execFileSync(
      'git',
      ['log', '-1', '--format=%an', '--', filePath],
      { cwd: repoRoot, encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'] }
    ).trim();

    const author = rawAuthor ? sanitizeAuthor(rawAuthor) : null;

    return { date, author };
  } catch {
    return null;
  }
}

/** Validate that a command name matches the expected safe format. */
function isValidCommandName(name: string): boolean {
  return /^[a-z_][a-z0-9_]*$/.test(name);
}

/** Build the parameters table for a command. */
function buildParametersTable(cmd: Command): string {
  const props = cmd.parameters?.properties ?? {};
  const required = new Set(cmd.parameters?.required ?? []);
  const entries = Object.entries(props);

  if (entries.length === 0) {
    return 'This command takes no parameters.\n';
  }

  const rows = entries.map(([name, param]) => {
    const isRequired = required.has(name) ? 'Yes' : 'No';
    const typeStr = param.enum
      ? param.enum.map(v => `\`${htmlEscape(v)}\``).join(', ')
      : htmlEscape(param.type);
    const desc = param.description ? htmlEscape(param.description) : '';
    return `| \`${htmlEscape(name)}\` | ${typeStr} | ${isRequired} | ${desc} |`;
  });

  return [
    '| Name | Type | Required | Description |',
    '|------|------|----------|-------------|',
    ...rows,
    '',
  ].join('\n');
}

/** Build an example JSON invocation for a command. */
function buildExampleJson(cmd: Command): string {
  let args: Record<string, unknown>;

  if (cmd.example) {
    args = cmd.example as Record<string, unknown>;
  } else {
    // Synthesize from required parameters
    args = {};
    const props = cmd.parameters?.properties ?? {};
    const required = cmd.parameters?.required ?? [];
    for (const paramName of required.slice(0, 3)) {
      const param = props[paramName];
      if (!param) continue;
      if (param.enum && param.enum.length > 0) {
        args[paramName] = param.enum[0];
      } else if (param.type === 'string') {
        args[paramName] = `example_${paramName}`;
      } else if (param.type === 'number') {
        args[paramName] = 1;
      } else if (param.type === 'boolean') {
        args[paramName] = true;
      } else if (param.type === 'array') {
        args[paramName] = [0, 0, 0];
      } else {
        args[paramName] = null;
      }
    }
  }

  const payload = { command: cmd.name, args };
  return '```json\n' + JSON.stringify(payload, null, 2) + '\n```\n';
}

/** Generate a single MDX page for a public command. */
function generateCommandMdx(cmd: Command, metadata: { date: string; author: string | null } | null): string {
  const escapedDesc = htmlEscape(cmd.description);
  const escapedName = htmlEscape(cmd.name);
  const escapedCategory = htmlEscape(cmd.category);

  const frontmatter = [
    '---',
    `commandName: "${escapedName}"`,
    `category: "${escapedCategory}"`,
    `visibility: "${isValidVisibility(cmd.visibility) ? cmd.visibility : 'internal'}"`,
    `description: "${escapedDesc}"`,
    ...(metadata ? [`lastUpdated: "${metadata.date}"`] : []),
    ...(metadata?.author ? [`lastUpdatedBy: "${metadata.author}"`] : []),
    '---',
  ].join('\n');

  const body = [
    '',
    `${escapedDesc}`,
    '',
    '## Parameters',
    '',
    buildParametersTable(cmd),
    '## Example',
    '',
    buildExampleJson(cmd),
    `Part of the [${cmd.category}](/mcp/${cmd.category}) command group.`,
    '',
  ].join('\n');

  return frontmatter + '\n' + body;
}

/**
 * Core generation function — testable, no side effects on process.
 *
 * @param manifestPath - Path to commands.json
 * @param outputDir - Directory to write generated MDX files
 * @returns { generatedCount, errors }
 */
export function generateMcpDocs(manifestPath: string, outputDir: string): GenerateResult {
  const errors: string[] = [];

  // Read manifest
  let manifest: CommandManifest;
  try {
    manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf-8')) as CommandManifest;
  } catch (err) {
    return {
      generatedCount: 0,
      errors: [`Failed to read manifest: ${manifestPath} — ${err}`],
    };
  }

  if (!manifest.commands || !Array.isArray(manifest.commands)) {
    return {
      generatedCount: 0,
      errors: [`Manifest missing .commands array: ${manifestPath}`],
    };
  }

  // Get git metadata once for the manifest file
  const metadata = getGitMetadata(manifestPath);

  // Ensure output dir exists
  fs.mkdirSync(outputDir, { recursive: true });

  const includeInternal = process.env.INCLUDE_INTERNAL === 'true';
  const publicCommands = manifest.commands.filter(
    cmd => includeInternal || cmd.visibility === 'public'
  );

  let generatedCount = 0;

  for (const cmd of publicCommands) {
    if (!isValidCommandName(cmd.name)) {
      errors.push(`Skipping command with invalid name format: "${cmd.name}" (must match /^[a-z_][a-z0-9_]*$/)`);
      continue;
    }
    if (!isValidCategory(cmd.category)) {
      errors.push(`Skipping command "${cmd.name}" with invalid category: "${cmd.category}" (must match /^[a-z0-9_-]+$/)`);
      continue;
    }
    try {
      const mdx = generateCommandMdx(cmd, metadata);
      const filePath = path.join(outputDir, `${cmd.name}.mdx`);
      fs.writeFileSync(filePath, mdx, 'utf-8');
      generatedCount++;
    } catch (err) {
      errors.push(`Failed to generate ${cmd.name}: ${err}`);
    }
  }

  return { generatedCount, errors };
}

// ---- CLI wrapper ----

const isMainModule =
  process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url));

if (isMainModule) {
  const manifestPath = process.env.MANIFEST_PATH
    ? path.resolve(process.env.MANIFEST_PATH)
    : path.join(repoRoot, 'mcp-server/manifest/commands.json');
  const outputDir = path.join(__dirname, '../content/mcp');

  const result = generateMcpDocs(manifestPath, outputDir);

  for (const err of result.errors) {
    console.error(`Error: ${err}`);
  }

  console.log(`Generated ${result.generatedCount} MCP command pages.`);
  if (result.errors.length > 0) {
    console.warn(`${result.errors.length} commands had generation errors (non-fatal).`);
    // Don't exit(1) — partial generation is acceptable for deployment.
    // CI gate script (ci-gate-check.ts) enforces strict error checking separately.
  }
}
