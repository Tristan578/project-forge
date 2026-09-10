import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import path from 'path';
import os from 'os';
import {
  checkSync,
  checkCommandIndex,
  projectCommandIndex,
  COMMAND_INDEX_FIELDS,
  COMMAND_INDEX_PATH,
  CANONICAL_MANIFEST_PATH,
} from '../check-manifest-sync.js';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

let tmpDir: string;
let canonicalPath: string;
let copyPath: string;

const makeManifest = (commands: object[]) =>
  JSON.stringify({ version: '1.0', commands });

const makeFormattedManifest = (commands: object[]) =>
  JSON.stringify({ version: '1.0', commands }, null, 2);

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'manifest-sync-test-'));
  canonicalPath = path.join(tmpDir, 'commands-canonical.json');
  copyPath = path.join(tmpDir, 'commands-copy.json');
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe('checkSync', () => {
  it('returns passed when both files have identical commands', () => {
    const commands = [
      { name: 'spawn_entity', visibility: 'public', description: 'Create entity' },
      { name: 'despawn_entity', visibility: 'public', description: 'Delete entity' },
    ];
    fs.writeFileSync(canonicalPath, makeManifest(commands));
    fs.writeFileSync(copyPath, makeManifest(commands));

    const result = checkSync(canonicalPath, copyPath);

    expect(result.passed).toBe(true);
    expect(result.error).toBeUndefined();
  });

  it('returns failed when canonical and copy have different commands', () => {
    fs.writeFileSync(
      canonicalPath,
      makeManifest([
        { name: 'spawn_entity', visibility: 'public' },
        { name: 'new_command', visibility: 'public' }, // extra command in canonical
      ]),
    );
    fs.writeFileSync(
      copyPath,
      makeManifest([{ name: 'spawn_entity', visibility: 'public' }]),
    );

    const result = checkSync(canonicalPath, copyPath);

    expect(result.passed).toBe(false);
    expect(result.error).toMatch(/out of sync/i);
  });

  it('returns failed when canonical file is missing', () => {
    const missingPath = path.join(tmpDir, 'nonexistent-canonical.json');
    fs.writeFileSync(copyPath, makeManifest([]));

    const result = checkSync(missingPath, copyPath);

    expect(result.passed).toBe(false);
    expect(result.error).toMatch(/canonical/i);
  });

  it('returns failed when copy file is missing', () => {
    fs.writeFileSync(canonicalPath, makeManifest([]));
    const missingCopyPath = path.join(tmpDir, 'nonexistent-copy.json');

    const result = checkSync(canonicalPath, missingCopyPath);

    expect(result.passed).toBe(false);
    expect(result.error).toMatch(/copy/i);
  });

  it('returns passed for whitespace/formatting differences (structural comparison)', () => {
    const commands = [
      { name: 'spawn_entity', visibility: 'public', description: 'Create entity' },
    ];
    // Canonical: compact JSON, copy: pretty-printed JSON
    fs.writeFileSync(canonicalPath, makeManifest(commands));
    fs.writeFileSync(copyPath, makeFormattedManifest(commands));

    const result = checkSync(canonicalPath, copyPath);

    expect(result.passed).toBe(true);
  });

  it('returns passed when commands are in different order (sorts by name)', () => {
    const commandsA = [
      { name: 'spawn_entity', visibility: 'public' },
      { name: 'despawn_entity', visibility: 'public' },
    ];
    const commandsB = [
      { name: 'despawn_entity', visibility: 'public' },
      { name: 'spawn_entity', visibility: 'public' },
    ];
    fs.writeFileSync(canonicalPath, makeManifest(commandsA));
    fs.writeFileSync(copyPath, makeManifest(commandsB));

    const result = checkSync(canonicalPath, copyPath);

    expect(result.passed).toBe(true);
  });

  it('returns failed when a command field differs between files', () => {
    fs.writeFileSync(
      canonicalPath,
      makeManifest([{ name: 'spawn_entity', visibility: 'public', description: 'Original' }]),
    );
    fs.writeFileSync(
      copyPath,
      makeManifest([{ name: 'spawn_entity', visibility: 'public', description: 'Modified' }]),
    );

    const result = checkSync(canonicalPath, copyPath);

    expect(result.passed).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// The command index (#9954)
// ---------------------------------------------------------------------------

describe('checkCommandIndex', () => {
  let indexPath: string;

  beforeEach(() => {
    indexPath = path.join(tmpDir, 'commandIndex.json');
  });

  const fullCommand = (name: string, over: Record<string, unknown> = {}) => ({
    name,
    category: 'scene',
    requiredScope: 'project:read',
    description: 'a description that must NOT reach the browser',
    parameters: { type: 'object', properties: { entityId: { type: 'string' } } },
    ...over,
  });

  it('passes when the index is the projection of canonical', () => {
    const commands = [fullCommand('spawn_entity'), fullCommand('despawn_entity')];
    fs.writeFileSync(canonicalPath, makeManifest(commands));
    fs.writeFileSync(indexPath, JSON.stringify(projectCommandIndex(commands)));

    expect(checkCommandIndex(canonicalPath, indexPath)).toEqual({ passed: true });
  });

  // The reason the index exists. If the check tolerated extra keys, a
  // description or a parameter schema could be added back one field at a time
  // and the 205 KB would return with every gate green.
  it('fails when the index carries a field beyond the three', () => {
    const commands = [fullCommand('spawn_entity')];
    fs.writeFileSync(canonicalPath, makeManifest(commands));
    const bloated = projectCommandIndex(commands);
    (bloated.commands[0] as unknown as Record<string, unknown>).description =
      'a description that must NOT reach the browser';
    fs.writeFileSync(indexPath, JSON.stringify(bloated));

    const result = checkCommandIndex(canonicalPath, indexPath);
    expect(result.passed).toBe(false);
    expect(result.error).toMatch(/generate:command-index/);
  });

  it('fails when a command is missing from the index', () => {
    const commands = [fullCommand('spawn_entity'), fullCommand('despawn_entity')];
    fs.writeFileSync(canonicalPath, makeManifest(commands));
    fs.writeFileSync(indexPath, JSON.stringify(projectCommandIndex([commands[0]])));

    expect(checkCommandIndex(canonicalPath, indexPath).passed).toBe(false);
  });

  it('fails when a category is stale in the index', () => {
    const commands = [fullCommand('publish_game', { category: 'publishing' })];
    fs.writeFileSync(canonicalPath, makeManifest(commands));
    const stale = projectCommandIndex(commands);
    stale.commands[0].category = 'scene';
    fs.writeFileSync(indexPath, JSON.stringify(stale));

    // A category the bridge ALLOWS standing in for one it DENIES is the worst
    // shape this drift can take, so it is the one asserted.
    expect(checkCommandIndex(canonicalPath, indexPath).passed).toBe(false);
  });

  it('fails when a requiredScope is stale in the index', () => {
    const commands = [fullCommand('generate_sprite', { requiredScope: 'ai:generate' })];
    fs.writeFileSync(canonicalPath, makeManifest(commands));
    const stale = projectCommandIndex(commands);
    stale.commands[0].requiredScope = 'project:read';
    fs.writeFileSync(indexPath, JSON.stringify(stale));

    expect(checkCommandIndex(canonicalPath, indexPath).passed).toBe(false);
  });

  it('passes when command order and key order differ but the content matches', () => {
    const commands = [fullCommand('spawn_entity'), fullCommand('despawn_entity')];
    fs.writeFileSync(canonicalPath, makeManifest(commands));
    fs.writeFileSync(
      indexPath,
      JSON.stringify({
        commands: [
          { requiredScope: 'project:read', name: 'spawn_entity', category: 'scene' },
          { category: 'scene', requiredScope: 'project:read', name: 'despawn_entity' },
        ],
      }),
    );

    expect(checkCommandIndex(canonicalPath, indexPath).passed).toBe(true);
  });

  it('names the regeneration command when the index file is missing', () => {
    fs.writeFileSync(canonicalPath, makeManifest([fullCommand('spawn_entity')]));

    const result = checkCommandIndex(canonicalPath, path.join(tmpDir, 'nope.json'));
    expect(result.passed).toBe(false);
    expect(result.error).toMatch(/generate:command-index/);
  });

  it('fails when the canonical manifest cannot be read', () => {
    fs.writeFileSync(indexPath, JSON.stringify({ commands: [] }));

    const result = checkCommandIndex(path.join(tmpDir, 'nope.json'), indexPath);
    expect(result.passed).toBe(false);
    expect(result.error).toMatch(/canonical/i);
  });
});

/**
 * THE REAL FILES, not fixtures.
 *
 * Every case above builds its own manifest, so all of them would still pass
 * with the committed index hours out of date. A skip here would report "not
 * applicable" for a state that actually means the artifact is gone, so a
 * missing file FAILS (lesson 9).
 */
describe('the committed command index', () => {
  const repoRoot = path.resolve(__dirname, '../../../..');

  it('is the projection of the committed canonical manifest', () => {
    const canonical = path.join(repoRoot, CANONICAL_MANIFEST_PATH);
    const index = path.join(repoRoot, COMMAND_INDEX_PATH);

    expect(fs.existsSync(canonical), `missing ${CANONICAL_MANIFEST_PATH}`).toBe(true);
    expect(fs.existsSync(index), `missing ${COMMAND_INDEX_PATH}`).toBe(true);

    const result = checkCommandIndex(canonical, index);
    expect(result.error ?? 'passed').toBe('passed');
  });

  it('carries no field beyond the three, so it cannot grow back into the bundle', () => {
    const index = JSON.parse(
      fs.readFileSync(path.join(repoRoot, COMMAND_INDEX_PATH), 'utf-8'),
    ) as { commands: Array<Record<string, unknown>> };

    expect(index.commands.length).toBeGreaterThan(0);
    for (const command of index.commands) {
      expect(Object.keys(command).sort(), String(command.name)).toEqual(
        [...COMMAND_INDEX_FIELDS].sort(),
      );
    }
  });
});
