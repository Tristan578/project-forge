// @vitest-environment node
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  RENDER_ERROR_CLASSES,
  RENDER_ERROR_EVENT,
  RENDER_ERROR_OUTCOMES,
} from '@/lib/engine/renderErrorWire';

/**
 * Cross-language pin for the `RENDER_ERROR` wire (#8887).
 *
 * `cargo test` cannot see the TypeScript parser, and this suite cannot run the
 * bridge (it is wasm32-only). If the Rust enum spellings, the event name, or
 * the registration drift from what `renderErrorWire.ts` accepts, the parser
 * drops every report and the editor goes back to a silently frozen viewport.
 *
 * Every source pin matches an EXECUTABLE line (anchored, comment lines
 * excluded), so commenting a registration out turns this red (lessons #16).
 * Unreadable files and unparseable enums fail; nothing here skips.
 */
const ENGINE = join(__dirname, '..', '..', '..', '..', '..', 'engine', 'src');

function read(...relative: string[]): string {
  const path = join(ENGINE, ...relative);
  const source = readFileSync(path, 'utf8');
  expect(source.length, `${path} is empty`).toBeGreaterThan(0);
  return source;
}

/** Lines that are code, not `//` comments. */
function codeLines(source: string): string[] {
  return source.split(/\r?\n/).filter((line) => !/^\s*\/\//.test(line));
}

function camelCase(variant: string): string {
  return variant.charAt(0).toLowerCase() + variant.slice(1);
}

function snakeToCamel(field: string): string {
  return field.replace(/_([a-z])/g, (_m, c: string) => c.toUpperCase());
}

/** The body of `pub enum|struct <name> { ... }`, requiring a camelCase serde rename right above it. */
function serdeBody(source: string, kind: 'enum' | 'struct', name: string): string {
  const re = new RegExp(
    `#\\[serde\\(rename_all = "camelCase"\\)\\]\\s*pub ${kind} ${name} \\{([^}]*)\\}`,
  );
  const match = re.exec(source);
  expect(match, `pub ${kind} ${name} with #[serde(rename_all = "camelCase")] not found`).not.toBeNull();
  return match![1];
}

function enumVariants(source: string, name: string): string[] {
  const variants = codeLines(serdeBody(source, 'enum', name))
    .map((line) => line.trim().replace(/,$/, ''))
    .filter((line) => /^[A-Z][A-Za-z]*$/.test(line));
  expect(variants.length, `no variants parsed out of ${name}`).toBeGreaterThan(0);
  return variants;
}

describe('RENDER_ERROR wire matches the engine', () => {
  const core = read('core', 'render_errors.rs');

  it('class spellings are the serde camelCase of RenderErrorClass', () => {
    expect(enumVariants(core, 'RenderErrorClass').map(camelCase)).toEqual([...RENDER_ERROR_CLASSES]);
  });

  it('outcome spellings are the serde camelCase of RenderErrorOutcome', () => {
    expect(enumVariants(core, 'RenderErrorOutcome').map(camelCase)).toEqual([...RENDER_ERROR_OUTCOMES]);
  });

  it('payload fields are the serde camelCase of RenderErrorReport', () => {
    const fields = codeLines(serdeBody(core, 'struct', 'RenderErrorReport'))
      .map((line) => /^\s*pub ([a-z_]+):/.exec(line)?.[1])
      .filter((f): f is string => Boolean(f))
      .map(snakeToCamel);
    expect(fields).toEqual(['errorClass', 'outcome', 'detail', 'occurrence']);
  });

  it('the bridge emits on the event name the editor listens for', () => {
    const lines = codeLines(read('bridge', 'events.rs'));
    const emits = lines.filter((line) => /^\s*emit_event\("RENDER_ERROR", report\);\s*$/.test(line));
    expect(emits).toHaveLength(1);
    expect(RENDER_ERROR_EVENT).toBe('RENDER_ERROR');
  });

  it('the drain system emits every pending report', () => {
    const lines = codeLines(read('bridge', 'render_errors.rs'));
    expect(lines.filter((line) => /^\s*for report in tracker\.take_pending\(\) \{\s*$/.test(line))).toHaveLength(1);
    expect(lines.filter((line) => /^\s*emit_render_error\(&report\);\s*$/.test(line))).toHaveLength(1);
  });

  it('init_engine installs the handler plugin and registers the drain', () => {
    const lines = codeLines(read('bridge', 'mod.rs'));
    expect(lines.filter((line) => /^\s*app\.add_plugins\(RenderErrorReportingPlugin\);\s*$/.test(line))).toHaveLength(1);
    expect(
      lines.filter((line) =>
        /^\s*\.add_systems\(Update, render_errors::emit_render_error_reports\);\s*$/.test(line),
      ),
    ).toHaveLength(1);
  });

  it('the plugin installs the SpawnForge handler, not Bevy\'s default', () => {
    const lines = codeLines(core);
    expect(
      lines.filter((line) =>
        /^\s*\.insert_resource\(RenderErrorHandler\(spawnforge_render_error_handler\)\);\s*$/.test(line),
      ),
    ).toHaveLength(1);
  });
});
