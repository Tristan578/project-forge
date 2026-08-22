// @vitest-environment node
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { handlePhysicsEvent } from '../physicsEvents';
import { createMockSetGet, createMockActions } from './eventTestUtils';

/**
 * Cross-language pin for the two 2D-joint reply channels (PF-1194).
 *
 * `list_joints_2d` and `get_joint_2d` are only useful if the name the engine
 * emits on is the name the browser listens for, and NOTHING else checks that:
 * `cargo test` cannot see `physicsEvents.ts`, and the TS suite cannot call the
 * bridge (it is wasm32-only). Rename the Rust literal and every joint in every
 * list is dropped silently — the exact shape of the inbound-phantom class in
 * `.claude/rules/gotchas.md` -> Engine & Game Loop.
 *
 * Deliberately textual, and it fails closed: an unreadable file or a constant
 * it cannot parse is a failure, never a skip.
 */
describe('2D joint reply channels match the engine', () => {
  const ENGINE = join(__dirname, '..', '..', '..', '..', '..', 'engine', 'src');

  function read(relative: string): string {
    const path = join(ENGINE, relative);
    const source = readFileSync(path, 'utf8');
    expect(source.length, `${path} is empty`).toBeGreaterThan(0);
    return source;
  }

  it('emits the joint list on the name physicsEvents listens for', () => {
    const source = read(join('core', 'physics_2d.rs'));
    const match = /pub const QUERY_JOINTS2D_LIST_EVENT: &str = "([A-Z0-9_]+)";/.exec(source);
    expect(match, 'QUERY_JOINTS2D_LIST_EVENT not found in core/physics_2d.rs').not.toBeNull();
    expect(match![1]).toBe('QUERY_JOINTS2D_LIST');
  });

  it('emits the joint list through the constant, not a second literal', () => {
    const source = read(join('bridge', 'query.rs'));
    expect(source).toContain('physics_2d::QUERY_JOINTS2D_LIST_EVENT');
    // A bare literal at the emit site is how the constant gets bypassed.
    expect(source).not.toContain('emit_event("QUERY_JOINTS2D_LIST"');
  });

  it('answers a single-joint read on JOINT2D_CHANGED', () => {
    const events = read(join('bridge', 'events.rs'));
    const body = events.slice(events.indexOf('pub fn emit_joint2d_changed'));
    expect(body.indexOf('pub fn emit_joint2d_changed'), 'emit_joint2d_changed missing').toBe(0);
    const emit = /emit_event\("([A-Z0-9_]+)"/.exec(body);
    expect(emit, 'emit_joint2d_changed does not emit').not.toBeNull();
    expect(emit![1]).toBe('JOINT2D_CHANGED');

    const query = read(join('bridge', 'query.rs'));
    expect(query).toContain('emit_joint2d_changed(&entity_id, joint)');
  });

  it.each(['QUERY_JOINTS2D_LIST', 'JOINT2D_CHANGED'])(
    'physicsEvents handles %s',
    (name) => {
      const mock = createMockSetGet(createMockActions());
      const payload =
        name === 'QUERY_JOINTS2D_LIST'
          ? [{ entityId: 'a', targetEntityId: 'b', jointType: 'fixed' }]
          : { entityId: 'a', targetEntityId: 'b', jointType: 'fixed' };
      expect(handlePhysicsEvent(name, payload, mock.set, mock.get)).toBe(true);
    },
  );
});
