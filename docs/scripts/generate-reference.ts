#!/usr/bin/env npx tsx
/**
 * Generates docs/reference/commands.md from the MCP command manifest.
 *
 * Usage:
 *   npx tsx docs/scripts/generate-reference.ts
 */

import { readFileSync, writeFileSync, mkdirSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const rootDir = join(__dirname, '..', '..');
const manifestPath = join(rootDir, 'mcp-server', 'manifest', 'commands.json');
const outputPath = join(rootDir, 'docs', 'reference', 'commands.md');

interface Parameter {
  type: string;
  description?: string;
  enum?: string[];
  items?: { type: string };
  minItems?: number;
  maxItems?: number;
}

interface Command {
  name: string;
  description: string;
  category: string;
  parameters: {
    type: string;
    properties: Record<string, Parameter>;
    required?: string[];
  };
  tokenCost: number;
  requiredScope: string;
}

interface Manifest {
  version: string;
  commands: Command[];
  resources?: Array<{ uri: string; name: string; description: string }>;
}

function formatParamType(param: Parameter): string {
  if (param.enum) {
    return param.enum.map(v => `\`"${v}"\``).join(' \\| ');
  }
  if (param.type === 'array' && param.items) {
    if (param.minItems && param.maxItems && param.minItems === param.maxItems) {
      return `${param.items.type}[${param.minItems}]`;
    }
    return `${param.items.type}[]`;
  }
  return param.type;
}

function buildExample(cmd: Command): Record<string, unknown> {
  const example: Record<string, unknown> = {};
  const required = new Set(cmd.parameters.required ?? []);

  for (const [key, param] of Object.entries(cmd.parameters.properties)) {
    if (!required.has(key)) continue;

    if (param.enum) {
      example[key] = param.enum[0];
    } else if (param.type === 'string') {
      example[key] = key === 'entityId' ? 'entity_1' : `my_${key}`;
    } else if (param.type === 'number') {
      example[key] = 1.0;
    } else if (param.type === 'integer') {
      example[key] = 1;
    } else if (param.type === 'boolean') {
      example[key] = true;
    } else if (param.type === 'array') {
      if (param.items?.type === 'number' && param.minItems === 3) {
        example[key] = [0.0, 0.0, 0.0];
      } else if (param.items?.type === 'number' && param.minItems === 4) {
        example[key] = [1.0, 1.0, 1.0, 1.0];
      } else if (param.items?.type === 'string') {
        example[key] = ['entity_1'];
      } else {
        example[key] = [];
      }
    }
  }

  return example;
}

function categoryDisplayName(cat: string): string {
  const names: Record<string, string> = {
    scene: 'Scene',
    materials: 'Materials',
    lighting: 'Lighting',
    environment: 'Environment',
    rendering: 'Rendering',
    editor: 'Editor',
    camera: 'Camera',
    history: 'History',
    query: 'Query',
    runtime: 'Runtime',
    physics: 'Physics',
    asset: 'Asset',
    scripting: 'Scripting',
    audio: 'Audio',
    particles: 'Particles',
    export: 'Export',
    animation: 'Animation',
    mesh: 'Mesh',
    terrain: 'Terrain',
    docs: 'Documentation',
  };
  return names[cat] ?? cat.charAt(0).toUpperCase() + cat.slice(1);
}

function generate(): void {
  const raw = readFileSync(manifestPath, 'utf-8');
  const manifest: Manifest = JSON.parse(raw);

  // Group commands by category
  const grouped = new Map<string, Command[]>();
  for (const cmd of manifest.commands) {
    const list = grouped.get(cmd.category) ?? [];
    list.push(cmd);
    grouped.set(cmd.category, list);
  }

  // Stable category order
  const categoryOrder = [
    'scene', 'materials', 'lighting', 'environment', 'rendering',
    'editor', 'camera', 'history', 'query', 'runtime',
    'physics', 'asset', 'scripting', 'audio', 'particles',
    'animation', 'mesh', 'terrain', 'export', 'docs',
  ];

  const sortedCategories = [...grouped.keys()].sort((a, b) => {
    const ai = categoryOrder.indexOf(a);
    const bi = categoryOrder.indexOf(b);
    return (ai === -1 ? 999 : ai) - (bi === -1 ? 999 : bi);
  });

  const lines: string[] = [];
  lines.push('# Command Reference');
  lines.push('');
  lines.push(`Complete reference for all ${manifest.commands.length} MCP commands available in Project Forge.`);
  lines.push('');
  lines.push('> This file is auto-generated from `mcp-server/manifest/commands.json`.');
  lines.push('> Run `npx tsx docs/scripts/generate-reference.ts` to regenerate.');
  lines.push('');

  // Table of Contents
  lines.push('## Categories');
  lines.push('');
  for (const cat of sortedCategories) {
    const cmds = grouped.get(cat)!;
    const anchor = categoryDisplayName(cat).toLowerCase().replace(/\s+/g, '-');
    lines.push(`- [${categoryDisplayName(cat)}](#${anchor}) (${cmds.length} commands)`);
  }
  lines.push('');
  lines.push('---');
  lines.push('');

  // Command sections
  for (const cat of sortedCategories) {
    const cmds = grouped.get(cat)!;
    lines.push(`## ${categoryDisplayName(cat)}`);
    lines.push('');

    for (const cmd of cmds) {
      lines.push(`### \`${cmd.name}\``);
      lines.push('');
      lines.push(cmd.description);
      lines.push('');

      // Parameters table
      const props = Object.entries(cmd.parameters.properties);
      if (props.length > 0) {
        const required = new Set(cmd.parameters.required ?? []);
        lines.push('| Parameter | Type | Required | Description |');
        lines.push('|-----------|------|----------|-------------|');
        for (const [key, param] of props) {
          const req = required.has(key) ? 'Yes' : 'No';
          const desc = param.description ?? '';
          lines.push(`| \`${key}\` | ${formatParamType(param)} | ${req} | ${desc} |`);
        }
        lines.push('');
      }

      // Example
      const example = buildExample(cmd);
      lines.push('**Example:**');
      lines.push('```json');
      lines.push(JSON.stringify({ command: cmd.name, params: example }, null, 2));
      lines.push('```');
      lines.push('');

      // Metadata
      lines.push(`Scope: \`${cmd.requiredScope}\` | Token cost: ${cmd.tokenCost}`);
      lines.push('');
      lines.push('---');
      lines.push('');
    }
  }

  // Resources section
  if (manifest.resources && manifest.resources.length > 0) {
    lines.push('## MCP Resources');
    lines.push('');
    lines.push('Resources provide live state without tool calls:');
    lines.push('');
    lines.push('| URI | Name | Description |');
    lines.push('|-----|------|-------------|');
    for (const res of manifest.resources) {
      lines.push(`| \`${res.uri}\` | ${res.name} | ${res.description} |`);
    }
    lines.push('');
  }

  // Write output
  mkdirSync(dirname(outputPath), { recursive: true });
  writeFileSync(outputPath, lines.join('\n'), 'utf-8');

  console.log(`Generated ${outputPath}`);
  console.log(`  ${manifest.commands.length} commands across ${sortedCategories.length} categories`);
}

generate();
