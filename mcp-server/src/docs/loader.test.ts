/**
 * Tests for docs/loader.ts — findMarkdownFiles, loadDocs, parseSections.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdirSync, writeFileSync, rmSync, mkdtempSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { loadDocs } from './loader.js';

/**
 * Create a temp directory tree for testing.
 */
function createTempDocs(files: Record<string, string>): string {
  const root = mkdtempSync(join(tmpdir(), 'loader-test-'));
  for (const [relPath, content] of Object.entries(files)) {
    const fullPath = join(root, relPath);
    const dir = fullPath.substring(0, fullPath.lastIndexOf('/'));
    if (dir !== root) {
      mkdirSync(dir, { recursive: true });
    }
    writeFileSync(fullPath, content, 'utf-8');
  }
  return root;
}

describe('loadDocs', () => {
  let tempDir: string;

  afterEach(() => {
    if (tempDir) {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it('returns empty docs map when directory does not exist', () => {
    const result = loadDocs('/tmp/__nonexistent_docs_dir_xyz__');
    expect(result.docs.size).toBe(0);
    expect(result.meta.size).toBe(0);
  });

  it('loads a single markdown file into docs map', () => {
    tempDir = createTempDocs({
      'intro.md': '# Introduction\n\nWelcome to SpawnForge.\n\n## Getting Started\n\nStart here.',
    });

    const result = loadDocs(tempDir);

    expect(result.docs.size).toBe(1);
    expect(result.docs.has('intro')).toBe(true);

    const doc = result.docs.get('intro')!;
    expect(doc.path).toBe('intro');
    expect(doc.title).toBe('Introduction');
    expect(doc.content).toContain('Welcome to SpawnForge');
  });

  it('extracts H1 title from markdown', () => {
    tempDir = createTempDocs({
      'commands.md': '# MCP Commands\n\nAll commands listed here.',
    });

    const result = loadDocs(tempDir);
    const doc = result.docs.get('commands')!;

    expect(doc.title).toBe('MCP Commands');
  });

  it('returns Untitled when no H1 heading is present', () => {
    tempDir = createTempDocs({
      'no-title.md': '## Section One\n\nSome content.\n\n## Section Two\n\nMore content.',
    });

    const result = loadDocs(tempDir);
    const doc = result.docs.get('no-title')!;

    expect(doc.title).toBe('Untitled');
  });

  it('parses sections split by ## headings', () => {
    tempDir = createTempDocs({
      'guide.md': '# Guide\n\n## Overview\n\nThis is the overview.\n\n## Installation\n\nRun npm install.',
    });

    const result = loadDocs(tempDir);
    const doc = result.docs.get('guide')!;

    expect(doc.sections).toHaveLength(2);
    expect(doc.sections[0].heading).toBe('Overview');
    expect(doc.sections[0].level).toBe(2);
    expect(doc.sections[0].content).toContain('This is the overview');

    expect(doc.sections[1].heading).toBe('Installation');
    expect(doc.sections[1].content).toContain('npm install');
  });

  it('loads markdown files from nested directories', () => {
    tempDir = createTempDocs({
      'features/physics.md': '# Physics\n\nRapier 3D integration.',
      'features/rendering.md': '# Rendering\n\nWebGPU backend.',
      'getting-started.md': '# Getting Started\n\nFirst steps.',
    });

    const result = loadDocs(tempDir);

    expect(result.docs.size).toBe(3);
    expect(result.docs.has('features/physics')).toBe(true);
    expect(result.docs.has('features/rendering')).toBe(true);
    expect(result.docs.has('getting-started')).toBe(true);
  });

  it('skips directories starting with underscore', () => {
    tempDir = createTempDocs({
      '_private/secret.md': '# Secret\n\nInternal.',
      'public.md': '# Public\n\nExternal.',
    });

    const result = loadDocs(tempDir);

    // _private directory should be skipped
    expect(result.docs.has('_private/secret')).toBe(false);
    expect(result.docs.has('public')).toBe(true);
  });

  it('skips files in scripts directory', () => {
    tempDir = createTempDocs({
      'scripts/build.md': '# Build Script\n\nAuto-generated.',
      'usage.md': '# Usage\n\nHow to use.',
    });

    const result = loadDocs(tempDir);

    expect(result.docs.has('scripts/build')).toBe(false);
    expect(result.docs.has('usage')).toBe(true);
  });

  it('loads _meta.json topic metadata', () => {
    tempDir = createTempDocs({
      '_meta.json': JSON.stringify({
        topics: {
          physics: {
            title: 'Physics System',
            tags: ['physics', 'rapier', '3d'],
            related: ['rendering'],
            commands: ['set_physics'],
          },
        },
      }),
      'physics.md': '# Physics\n\nPhysics content.',
    });

    const result = loadDocs(tempDir);

    expect(result.meta.has('physics')).toBe(true);
    const meta = result.meta.get('physics')!;
    expect(meta.title).toBe('Physics System');
    expect(meta.tags).toContain('physics');
    expect(meta.tags).toContain('rapier');
  });

  it('handles malformed _meta.json gracefully', () => {
    tempDir = createTempDocs({
      '_meta.json': '{ invalid json !!!',
      'doc.md': '# Doc\n\nContent.',
    });

    // Should not throw — invalid meta is silently ignored
    const result = loadDocs(tempDir);
    expect(result.docs.size).toBe(1);
    expect(result.meta.size).toBe(0);
  });

  it('handles empty markdown files without throwing', () => {
    tempDir = createTempDocs({
      'empty.md': '',
    });

    const result = loadDocs(tempDir);

    expect(result.docs.size).toBe(1);
    const doc = result.docs.get('empty')!;
    expect(doc.title).toBe('Untitled');
    expect(doc.sections).toHaveLength(0);
  });
});
