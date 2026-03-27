import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { checkSync } from '../check-manifest-sync.js';

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
