import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { generateMcpDocs } from '../generate-mcp-docs.js';

// Minimal valid commands.json structure for testing
const makeManifest = (commands: object[]) => JSON.stringify({ version: '1.0', commands });

const publicCommand = {
  name: 'spawn_entity',
  description: 'Create a new entity in the scene',
  category: 'scene',
  visibility: 'public',
  parameters: {
    type: 'object',
    properties: {
      entityType: { type: 'string', description: 'Type of entity' },
      name: { type: 'string', description: 'Display name' },
    },
    required: ['entityType'],
  },
  tokenCost: 0,
  requiredScope: 'scene:write',
};

const internalCommand = {
  name: 'generate_3d_model',
  description: 'Generate a 3D model using AI',
  category: 'generation',
  visibility: 'internal',
  parameters: {
    type: 'object',
    properties: {
      prompt: { type: 'string', description: 'Generation prompt' },
    },
    required: ['prompt'],
  },
  tokenCost: 100,
  requiredScope: 'generation:generate',
};

const noParamsCommand = {
  name: 'redo',
  description: 'Redo the last undone action',
  category: 'history',
  visibility: 'public',
  parameters: {
    type: 'object',
    properties: {},
    required: [],
  },
  tokenCost: 0,
  requiredScope: 'scene:write',
};

let tmpDir: string;
let manifestPath: string;
let outputDir: string;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'generate-mcp-docs-test-'));
  manifestPath = path.join(tmpDir, 'commands.json');
  outputDir = path.join(tmpDir, 'mcp');
  fs.mkdirSync(outputDir, { recursive: true });
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe('generateMcpDocs', () => {
  it('generates MDX only for public commands (filters internal)', () => {
    fs.writeFileSync(manifestPath, makeManifest([publicCommand, internalCommand]));
    const result = generateMcpDocs(manifestPath, outputDir);

    expect(result.errors).toHaveLength(0);
    expect(result.generatedCount).toBe(1);

    const files = fs.readdirSync(outputDir).filter(f => f.endsWith('.mdx') && f !== 'index.mdx');
    expect(files).toHaveLength(1);
    expect(files[0]).toBe('spawn_entity.mdx');
    expect(fs.existsSync(path.join(outputDir, 'generate_3d_model.mdx'))).toBe(false);
  });

  it('each generated MDX has all 4 required frontmatter fields', () => {
    fs.writeFileSync(manifestPath, makeManifest([publicCommand]));
    generateMcpDocs(manifestPath, outputDir);

    const content = fs.readFileSync(path.join(outputDir, 'spawn_entity.mdx'), 'utf-8');
    // Extract frontmatter
    const fmMatch = content.match(/^---\n([\s\S]*?)\n---/);
    expect(fmMatch, 'MDX must have frontmatter block').not.toBeNull();

    expect(content).toContain('commandName:');
    expect(content).toContain('category:');
    expect(content).toContain('visibility:');
    expect(content).toContain('description:');
  });

  it('generated body includes description paragraph, parameters table, example JSON, and category link', () => {
    fs.writeFileSync(manifestPath, makeManifest([publicCommand]));
    generateMcpDocs(manifestPath, outputDir);

    const content = fs.readFileSync(path.join(outputDir, 'spawn_entity.mdx'), 'utf-8');

    // Description paragraph
    expect(content).toContain('Create a new entity in the scene');

    // Parameters table (has columns: Name, Type, Required, Description)
    expect(content).toContain('| Name |');
    expect(content).toContain('| Type |');
    expect(content).toContain('| Required |');
    expect(content).toContain('| Description |');
    // Parameter rows
    expect(content).toContain('entityType');

    // Example JSON block
    expect(content).toContain('```json');
    expect(content).toContain('"command"');
    expect(content).toContain('"spawn_entity"');

    // Category link
    expect(content).toContain('/mcp/scene');
    expect(content).toContain('scene');
  });

  it('returns correct generatedCount', () => {
    fs.writeFileSync(manifestPath, makeManifest([publicCommand, internalCommand, noParamsCommand]));
    const result = generateMcpDocs(manifestPath, outputDir);

    expect(result.errors).toHaveLength(0);
    expect(result.generatedCount).toBe(2); // publicCommand + noParamsCommand
  });

  it('returns error for malformed manifest', () => {
    fs.writeFileSync(manifestPath, 'not valid json {{{');
    const result = generateMcpDocs(manifestPath, outputDir);

    expect(result.generatedCount).toBe(0);
    expect(result.errors.length).toBeGreaterThan(0);
    expect(result.errors[0]).toMatch(/failed to read/i);
  });

  it('returns zero count when all commands are internal', () => {
    fs.writeFileSync(manifestPath, makeManifest([internalCommand]));
    const result = generateMcpDocs(manifestPath, outputDir);

    expect(result.errors).toHaveLength(0);
    expect(result.generatedCount).toBe(0);
    const files = fs.readdirSync(outputDir).filter(f => f.endsWith('.mdx') && f !== 'index.mdx');
    expect(files).toHaveLength(0);
  });

  it('shows "no parameters" message when command has no parameters', () => {
    fs.writeFileSync(manifestPath, makeManifest([noParamsCommand]));
    generateMcpDocs(manifestPath, outputDir);

    const content = fs.readFileSync(path.join(outputDir, 'redo.mdx'), 'utf-8');
    expect(content).toContain('This command takes no parameters');
  });

  it('sanitizes HTML in generated MDX description', () => {
    const xssCommand = {
      ...publicCommand,
      name: 'xss_test',
      description: 'A command with <script>alert("xss")</script> in description',
    };
    fs.writeFileSync(manifestPath, makeManifest([xssCommand]));
    generateMcpDocs(manifestPath, outputDir);

    const content = fs.readFileSync(path.join(outputDir, 'xss_test.mdx'), 'utf-8');
    expect(content).not.toContain('<script>');
    expect(content).toContain('&lt;script&gt;');
  });
});

describe('command name validation', () => {
  it('skips commands with invalid name format and adds error', () => {
    const badNameCommand = {
      ...publicCommand,
      name: 'bad-name!',
    };
    fs.writeFileSync(manifestPath, makeManifest([badNameCommand]));
    const result = generateMcpDocs(manifestPath, outputDir);

    expect(result.generatedCount).toBe(0);
    expect(result.errors.length).toBeGreaterThan(0);
    expect(result.errors[0]).toMatch(/invalid name format/i);
    expect(fs.existsSync(path.join(outputDir, 'bad-name!.mdx'))).toBe(false);
  });

  it('accepts valid snake_case command names', () => {
    const validCommand = { ...publicCommand, name: 'spawn_entity_2d' };
    fs.writeFileSync(manifestPath, makeManifest([validCommand]));
    const result = generateMcpDocs(manifestPath, outputDir);

    expect(result.errors).toHaveLength(0);
    expect(result.generatedCount).toBe(1);
  });

  it('rejects command names starting with a digit', () => {
    const badCommand = { ...publicCommand, name: '1bad_name' };
    fs.writeFileSync(manifestPath, makeManifest([badCommand]));
    const result = generateMcpDocs(manifestPath, outputDir);

    expect(result.generatedCount).toBe(0);
    expect(result.errors.length).toBeGreaterThan(0);
  });
});

describe('YAML frontmatter injection prevention', () => {
  it('rejects commands with invalid category (injection prevention)', () => {
    // Generator validates category with /^[a-z0-9_-]+$/ before writing any file.
    // A category containing quotes or newlines fails validation → command is skipped,
    // no MDX is written, preventing YAML frontmatter injection entirely.
    const injectionCommand = {
      ...publicCommand,
      name: 'safe_name',
      category: 'scene"injected: true\nfoo',
    };
    fs.writeFileSync(manifestPath, makeManifest([injectionCommand]));
    const result = generateMcpDocs(manifestPath, outputDir);

    // Command is rejected, no file written
    expect(result.generatedCount).toBe(0);
    expect(result.errors.length).toBeGreaterThan(0);
    expect(result.errors[0]).toContain('invalid category');
  });

  it('escapes HTML special chars in param type in table', () => {
    const cmdWithHtmlType = {
      ...publicCommand,
      name: 'test_cmd',
      parameters: {
        type: 'object',
        properties: {
          val: { type: 'string<script>', description: 'A value' },
        },
        required: ['val'],
      },
    };
    fs.writeFileSync(manifestPath, makeManifest([cmdWithHtmlType]));
    generateMcpDocs(manifestPath, outputDir);

    const content = fs.readFileSync(path.join(outputDir, 'test_cmd.mdx'), 'utf-8');
    expect(content).not.toContain('<script>');
    expect(content).toContain('&lt;script&gt;');
  });

  it('escapes HTML in enum values in table', () => {
    const cmdWithHtmlEnum = {
      ...publicCommand,
      name: 'enum_cmd',
      parameters: {
        type: 'object',
        properties: {
          mode: { type: 'string', enum: ['safe', '<evil>'], description: 'Mode' },
        },
        required: ['mode'],
      },
    };
    fs.writeFileSync(manifestPath, makeManifest([cmdWithHtmlEnum]));
    generateMcpDocs(manifestPath, outputDir);

    const content = fs.readFileSync(path.join(outputDir, 'enum_cmd.mdx'), 'utf-8');
    expect(content).not.toContain('<evil>');
    expect(content).toContain('&lt;evil&gt;');
  });
});

describe('author sanitization', () => {
  it('is tested via sanitizeAuthor helper', async () => {
    const { sanitizeAuthor } = await import('../generate-mcp-docs.js');

    // Normal author passes through
    expect(sanitizeAuthor('Tristan Nolan')).toBe('Tristan Nolan');

    // HTML is escaped
    expect(sanitizeAuthor('Evil <script> User')).toBe('Evil &lt;script&gt; User');
    expect(sanitizeAuthor('User & Co')).toBe('User &amp; Co');
    expect(sanitizeAuthor('"Quoted"')).toBe('&quot;Quoted&quot;');

    // Bot patterns are filtered
    expect(sanitizeAuthor('github-actions[bot]')).toBeNull();
    expect(sanitizeAuthor('dependabot[bot]')).toBeNull();
    expect(sanitizeAuthor('renovate-bot')).toBeNull();

    // Non-printable chars are filtered
    expect(sanitizeAuthor('Name\x00Null')).toBeNull();
    expect(sanitizeAuthor('Name\u200bZeroWidth')).toBeNull();
    expect(sanitizeAuthor('Name\u202eBiDi')).toBeNull();
  });
});
