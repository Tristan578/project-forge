import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { checkGate } from '../ci-gate-check.js';

let tmpDir: string;
let contentDir: string;
let manifestPath: string;

const makeManifest = (commands: object[]) =>
  JSON.stringify({ version: '1.0', commands });

const writeMdx = (dir: string, filename: string, commandName: string, extra = '') => {
  fs.writeFileSync(
    path.join(dir, filename),
    `---\ncommandName: "${commandName}"\ncategory: "scene"\nvisibility: "public"\ndescription: "Test"\n---\n\nBody.${extra}`,
  );
};

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ci-gate-test-'));
  contentDir = path.join(tmpDir, 'mcp');
  manifestPath = path.join(tmpDir, 'commands.json');
  fs.mkdirSync(contentDir, { recursive: true });
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe('checkGate', () => {
  it('returns passed when no internal commands appear in MDX files', () => {
    fs.writeFileSync(
      manifestPath,
      makeManifest([
        { name: 'spawn_entity', visibility: 'public' },
        { name: 'generate_3d_model', visibility: 'internal' },
      ]),
    );
    writeMdx(contentDir, 'spawn_entity.mdx', 'spawn_entity');

    const result = checkGate(contentDir, manifestPath);

    expect(result.passed).toBe(true);
    expect(result.errors).toHaveLength(0);
    expect(result.checkedCount).toBe(1);
  });

  it('returns failed when an internal command is found in a public MDX file', () => {
    fs.writeFileSync(
      manifestPath,
      makeManifest([
        { name: 'spawn_entity', visibility: 'public' },
        { name: 'generate_3d_model', visibility: 'internal' },
      ]),
    );
    // Write MDX for the internal command (simulating a leak)
    writeMdx(contentDir, 'generate_3d_model.mdx', 'generate_3d_model');

    const result = checkGate(contentDir, manifestPath);

    expect(result.passed).toBe(false);
    expect(result.errors.length).toBeGreaterThan(0);
    expect(result.errors[0]).toContain('generate_3d_model');
    expect(result.errors[0]).toContain('internal');
  });

  it('returns passed when content directory is empty', () => {
    fs.writeFileSync(
      manifestPath,
      makeManifest([{ name: 'spawn_entity', visibility: 'public' }]),
    );
    // contentDir exists but has no .mdx files

    const result = checkGate(contentDir, manifestPath);

    expect(result.passed).toBe(true);
    expect(result.errors).toHaveLength(0);
    expect(result.checkedCount).toBe(0);
  });

  it('returns passed when content directory does not exist', () => {
    fs.writeFileSync(
      manifestPath,
      makeManifest([{ name: 'spawn_entity', visibility: 'public' }]),
    );
    const nonExistentDir = path.join(tmpDir, 'nonexistent');

    const result = checkGate(nonExistentDir, manifestPath);

    expect(result.passed).toBe(true);
    expect(result.errors).toHaveLength(0);
    expect(result.checkedCount).toBe(0);
  });

  it('returns failed for malformed manifest (unparseable JSON)', () => {
    fs.writeFileSync(manifestPath, 'not valid json {{{');
    writeMdx(contentDir, 'spawn_entity.mdx', 'spawn_entity');

    const result = checkGate(contentDir, manifestPath);

    expect(result.passed).toBe(false);
    expect(result.errors.length).toBeGreaterThan(0);
    expect(result.errors[0]).toMatch(/failed to read manifest/i);
  });

  it('returns failed for missing or non-string commandName in MDX frontmatter', () => {
    fs.writeFileSync(
      manifestPath,
      makeManifest([{ name: 'spawn_entity', visibility: 'public' }]),
    );
    // Write MDX with missing commandName
    fs.writeFileSync(
      path.join(contentDir, 'bad_command.mdx'),
      '---\ncategory: "scene"\n---\n\nBody.',
    );

    const result = checkGate(contentDir, manifestPath);

    expect(result.passed).toBe(false);
    expect(result.errors.length).toBeGreaterThan(0);
    expect(result.errors[0]).toContain('commandName');
  });

  it('ignores index.mdx when checking files', () => {
    fs.writeFileSync(
      manifestPath,
      makeManifest([
        { name: 'generate_3d_model', visibility: 'internal' },
      ]),
    );
    // index.mdx should be skipped even if it references an internal command name
    fs.writeFileSync(
      path.join(contentDir, 'index.mdx'),
      '---\ntitle: "MCP Commands"\n---\n\ngenerate_3d_model is internal.',
    );

    const result = checkGate(contentDir, manifestPath);

    expect(result.passed).toBe(true);
    expect(result.checkedCount).toBe(0);
  });

  it('reports multiple errors when multiple internal commands leaked', () => {
    fs.writeFileSync(
      manifestPath,
      makeManifest([
        { name: 'generate_3d_model', visibility: 'internal' },
        { name: 'generate_texture', visibility: 'internal' },
      ]),
    );
    writeMdx(contentDir, 'generate_3d_model.mdx', 'generate_3d_model');
    writeMdx(contentDir, 'generate_texture.mdx', 'generate_texture');

    const result = checkGate(contentDir, manifestPath);

    expect(result.passed).toBe(false);
    expect(result.errors.length).toBe(2);
  });
});
