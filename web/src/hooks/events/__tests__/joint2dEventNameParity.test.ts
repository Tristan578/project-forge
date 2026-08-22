// @vitest-environment node
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

// Same seam the sibling suite uses: the handler reaches the store through
// `useEditorStore.getState()`, so the mock is what lets this assert WHICH
// action the reply routed to rather than only that the name was claimed.
vi.mock('@/stores/editorStore', () => ({
  useEditorStore: {
    getState: vi.fn(),
    setState: vi.fn(),
    subscribe: vi.fn(),
  },
}));

import { useEditorStore } from '@/stores/editorStore';
import { handlePhysicsEvent } from '../physicsEvents';
import { createMockSetGet, createMockActions, type StoreState } from './eventTestUtils';
import type { EventPayload } from '../types';

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

    // The constant's doc comment names the test that pins it, and that pointer
    // rots exactly as silently as the name would: it spent this branch's life
    // pointing at physicsEvents.test.ts, which spells the event name but never
    // reads the Rust source, so a reader chasing the pin found no pin.
    expect(source).toContain('joint2dEventNameParity.test.ts');
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

  describe('physicsEvents answers on every emitted joint name', () => {
    let actions: ReturnType<typeof createMockActions>;

    beforeEach(() => {
      vi.clearAllMocks();
      actions = createMockActions();
      vi.mocked(useEditorStore.getState).mockReturnValue(actions as unknown as StoreState);
    });

    // `revolute` is one of the four types `JOINT2D_TYPES` admits. An invented
    // spelling parses to `null`, which the handler swallows while still
    // returning `true` — so an invalid fixture would score green against the
    // weaker assertion this suite used to make.
    const JOINT = { entityId: 'a', targetEntityId: 'b', jointType: 'revolute' };

    it.each<[string, EventPayload]>([
      ['QUERY_JOINTS2D_LIST', [JOINT]],
      ['JOINT2D_CHANGED', JOINT],
    ])('%s routes to applyJoint2dFromEngine', (name, payload) => {
      const mock = createMockSetGet();

      expect(handlePhysicsEvent(name, payload, mock.set, mock.get)).toBe(true);
      // `true` alone is not proof: the malformed-payload branch returns `true`
      // too, so a wire shape the parser rejects would score identically. Assert
      // the state-only mirror actually ran — and that the DISPATCHING sibling
      // did not, since calling it would echo `set_joint_2d` straight back at
      // the engine that just reported the joint.
      expect(actions.applyJoint2dFromEngine).toHaveBeenCalledTimes(1);
      expect(actions.applyJoint2dFromEngine).toHaveBeenCalledWith(
        'a',
        expect.objectContaining({ targetEntityId: 'b', jointType: 'revolute' }),
      );
      expect(actions.setJoint2d).not.toHaveBeenCalled();
    });

    /**
     * The 3D list channel gets its own case rather than a row in the table
     * above: it routes to `setPrimaryJoint`, so folding it in would have to
     * weaken the assertion the table exists to make.
     *
     * The literal is pinned the same way — `process_joint_queries` spells
     * `QUERY_JOINTS_LIST` inline, and nothing else can see both sides of that
     * name at once.
     */
    it('QUERY_JOINTS_LIST routes to setPrimaryJoint on the name the engine emits', () => {
      const query = read(join('bridge', 'query.rs'));
      const body = query.slice(query.indexOf('pub(super) fn process_joint_queries'));
      expect(body.length, 'process_joint_queries missing from bridge/query.rs').toBeGreaterThan(0);
      const emit = /emit_event\("([A-Z0-9_]+)"/.exec(body);
      expect(emit, 'process_joint_queries does not emit').not.toBeNull();

      const mock = createMockSetGet();
      actions.primaryId = 'a';

      expect(
        handlePhysicsEvent(
          emit![1],
          [
            {
              entityId: 'a',
              jointType: 'revolute',
              connectedEntityId: 'b',
              anchorSelf: [0, 0, 0],
              anchorOther: [0, 0, 0],
              axis: [0, 1, 0],
            },
          ],
          mock.set,
          mock.get,
        ),
      ).toBe(true);
      expect(actions.setPrimaryJoint).toHaveBeenCalledTimes(1);
      expect(actions.setPrimaryJoint).toHaveBeenCalledWith(
        expect.objectContaining({ connectedEntityId: 'b', jointType: 'revolute' }),
      );
      expect(actions.setJoint).not.toHaveBeenCalled();
    });
  });
});
