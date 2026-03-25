// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
// We don't import scriptWorker directly because it's a web worker file that executes immediately on import.
// Instead, we test the sandboxing logic by simulating the worker environment with dynamic imports.

// Mock self for the worker environment
const mockPostMessage = vi.fn();
const globalScope = globalThis as Record<string, unknown>;

type MessageHandler = (e: { data: Record<string, unknown> }) => void | Promise<void>;

async function setupWorker(): Promise<MessageHandler> {
  await import('../scriptWorker');
  return (globalScope.self as Record<string, unknown>).onmessage as MessageHandler;
}

function initMsg(scripts: { entityId: string; enabled: boolean; source: string }[], extras?: Record<string, unknown>) {
  return {
    data: {
      type: 'init',
      scripts,
      entities: {},
      entityInfos: {},
      ...extras,
    },
  };
}

describe('scriptWorker', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    globalScope.self = {
      postMessage: mockPostMessage,
    };
  });

  afterEach(() => {
    delete globalScope.self;
    vi.resetModules();
  });

  // ─── Initialization ─────────────────────────────────────────────

  it('registers message listener on initialization', async () => {
    await import('../scriptWorker');
    expect((globalScope.self as Record<string, unknown>).onmessage).toBeInstanceOf(Function);
  });

  it('ignores unknown message types without crashing', async () => {
    const handler = await setupWorker();
    expect(() => handler({ data: { type: 'unknown_action' } })).not.toThrow();
  });

  // ─── Script Compilation ─────────────────────────────────────────

  it('compiles and initializes scripts successfully via init', async () => {
    const handler = await setupWorker();
    const validCode = 'function onStart() { forge.log("Started"); }';

    await handler(initMsg([{ entityId: 'entity_1', enabled: true, source: validCode }]));

    expect(mockPostMessage).toHaveBeenCalledWith({
      type: 'log',
      level: 'info',
      entityId: 'entity_1',
      message: 'Started',
    });
  });

  it('reports compilation errors for syntax issues during init', async () => {
    const handler = await setupWorker();
    const invalidCode = 'function onStart() { return { x: 1 ; }';

    await handler(initMsg([{ entityId: 'entity_invalid', enabled: true, source: invalidCode }]));

    expect(mockPostMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'error',
        entityId: 'entity_invalid',
        message: expect.stringContaining('Compilation error:'),
      })
    );
  });

  it('executes scripts in a sandbox preventing global access', async () => {
    const handler = await setupWorker();
    const maliciousCode = 'function onUpdate(dt) { forge.log(typeof fetch); forge.log(typeof navigator); }';

    await handler(initMsg([{ entityId: 'entity_malicious', enabled: true, source: maliciousCode }]));
    await handler({ data: { type: 'tick', dt: 0.16 } });

    expect(mockPostMessage).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'log', message: 'undefined' })
    );
  });

  it('skips disabled scripts during init', async () => {
    const handler = await setupWorker();
    const code = 'function onStart() { forge.log("should not run"); }';

    await handler(initMsg([{ entityId: 'eid_disabled', enabled: false, source: code }]));

    const logCalls = mockPostMessage.mock.calls.filter(
      (c) => c[0]?.type === 'log' && c[0]?.message === 'should not run'
    );
    expect(logCalls).toHaveLength(0);
  });

  it('rejects non-string script source', async () => {
    const handler = await setupWorker();

    await handler(initMsg([{ entityId: 'eid_bad', enabled: true, source: 42 as unknown as string }]));

    expect(mockPostMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'error',
        entityId: 'eid_bad',
        message: expect.stringContaining('script source must be a string'),
      })
    );
  });

  it('rejects script source exceeding 512KB size limit', async () => {
    const handler = await setupWorker();
    const bigSource = 'x'.repeat(512 * 1024 + 1);

    await handler(initMsg([{ entityId: 'eid_big', enabled: true, source: bigSource }]));

    expect(mockPostMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'error',
        entityId: 'eid_big',
        message: expect.stringContaining('exceeds maximum allowed size'),
      })
    );
  });

  it('initializes multiple scripts and calls onStart in order', async () => {
    const handler = await setupWorker();
    const order: string[] = [];

    // Capture order via log messages
    const code1 = 'function onStart() { forge.log("first"); }';
    const code2 = 'function onStart() { forge.log("second"); }';

    await handler(initMsg([
      { entityId: 'e1', enabled: true, source: code1 },
      { entityId: 'e2', enabled: true, source: code2 },
    ]));

    const logCalls = mockPostMessage.mock.calls.filter((c) => c[0]?.type === 'log');
    for (const call of logCalls) {
      order.push(call[0].message as string);
    }
    expect(order).toEqual(['first', 'second']);
  });

  it('isolates errors in one script from others during init', async () => {
    const handler = await setupWorker();
    const badCode = 'function onStart() { throw new Error("boom"); }';
    const goodCode = 'function onStart() { forge.log("ok"); }';

    await handler(initMsg([
      { entityId: 'e_bad', enabled: true, source: badCode },
      { entityId: 'e_good', enabled: true, source: goodCode },
    ]));

    expect(mockPostMessage).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'error', entityId: 'e_bad', message: expect.stringContaining('onStart error:') })
    );
    expect(mockPostMessage).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'log', entityId: 'e_good', message: 'ok' })
    );
  });

  // ─── Forge Transform API ────────────────────────────────────────

  it('forge.getTransform returns entity state', async () => {
    const handler = await setupWorker();
    const code = `function onStart() {
      var t = forge.getTransform("e1");
      forge.log(t ? t.position[0].toString() : "null");
    }`;

    await handler(initMsg(
      [{ entityId: 'e1', enabled: true, source: code }],
      { entities: { e1: { position: [5, 10, 15], rotation: [0, 0, 0], scale: [1, 1, 1] } } }
    ));

    expect(mockPostMessage).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'log', message: '5' })
    );
  });

  it('forge.getTransform returns null for unknown entity', async () => {
    const handler = await setupWorker();
    const code = `function onStart() {
      var t = forge.getTransform("unknown");
      forge.log(t === null ? "null" : "exists");
    }`;

    await handler(initMsg([{ entityId: 'e1', enabled: true, source: code }]));

    expect(mockPostMessage).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'log', message: 'null' })
    );
  });

  it('forge.setPosition pushes update_transform command', async () => {
    const handler = await setupWorker();
    const code = 'function onStart() { forge.setPosition("e1", 1, 2, 3); }';

    await handler(initMsg([{ entityId: 'e1', enabled: true, source: code }]));

    const cmdMsg = mockPostMessage.mock.calls.find((c) => c[0]?.type === 'commands');
    expect(cmdMsg).not.toBeUndefined();
    expect(cmdMsg![0].commands).toContainEqual(
      expect.objectContaining({ cmd: 'update_transform', entityId: 'e1', position: [1, 2, 3] })
    );
  });

  it('forge.translate adds to current position', async () => {
    const handler = await setupWorker();
    const code = 'function onStart() { forge.translate("e1", 1, 2, 3); }';

    await handler(initMsg(
      [{ entityId: 'e1', enabled: true, source: code }],
      { entities: { e1: { position: [10, 20, 30], rotation: [0, 0, 0], scale: [1, 1, 1] } } }
    ));

    const cmdMsg = mockPostMessage.mock.calls.find((c) => c[0]?.type === 'commands');
    expect(cmdMsg![0].commands).toContainEqual(
      expect.objectContaining({ cmd: 'update_transform', entityId: 'e1', position: [11, 22, 33] })
    );
  });

  it('forge.rotate converts degrees to radians', async () => {
    const handler = await setupWorker();
    const code = 'function onStart() { forge.rotate("e1", 90, 0, 0); }';

    await handler(initMsg(
      [{ entityId: 'e1', enabled: true, source: code }],
      { entities: { e1: { position: [0, 0, 0], rotation: [0, 0, 0], scale: [1, 1, 1] } } }
    ));

    const cmdMsg = mockPostMessage.mock.calls.find((c) => c[0]?.type === 'commands');
    const rotCmd = cmdMsg![0].commands.find((c: Record<string, unknown>) => c.rotation);
    expect(rotCmd.rotation[0]).toBeCloseTo(Math.PI / 2);
  });

  it('forge.spawn returns runtime ID and pushes spawn_entity command', async () => {
    const handler = await setupWorker();
    const code = `function onStart() {
      var id = forge.spawn("cube", { name: "TestCube", position: [1, 2, 3] });
      forge.log(id);
    }`;

    await handler(initMsg([{ entityId: 'e1', enabled: true, source: code }]));

    expect(mockPostMessage).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'log', message: expect.stringContaining('runtime_') })
    );
    const cmdMsg = mockPostMessage.mock.calls.find((c) => c[0]?.type === 'commands');
    expect(cmdMsg![0].commands).toContainEqual(
      expect.objectContaining({ cmd: 'spawn_entity', entityType: 'cube', name: 'TestCube', position: [1, 2, 3] })
    );
  });

  it('forge.destroy pushes delete_entities command', async () => {
    const handler = await setupWorker();
    const code = 'function onStart() { forge.destroy("e2"); }';

    await handler(initMsg([{ entityId: 'e1', enabled: true, source: code }]));

    const cmdMsg = mockPostMessage.mock.calls.find((c) => c[0]?.type === 'commands');
    expect(cmdMsg![0].commands).toContainEqual(
      expect.objectContaining({ cmd: 'delete_entities', entityIds: ['e2'] })
    );
  });

  // ─── Forge Visual Control ───────────────────────────────────────

  it('forge.setColor pushes update_material command', async () => {
    const handler = await setupWorker();
    const code = 'function onStart() { forge.setColor("e1", 1, 0, 0, 0.5); }';

    await handler(initMsg([{ entityId: 'e1', enabled: true, source: code }]));

    const cmdMsg = mockPostMessage.mock.calls.find((c) => c[0]?.type === 'commands');
    expect(cmdMsg![0].commands).toContainEqual(
      expect.objectContaining({ cmd: 'update_material', entityId: 'e1', baseColor: [1, 0, 0, 0.5] })
    );
  });

  it('forge.setVisibility pushes set_visibility command', async () => {
    const handler = await setupWorker();
    const code = 'function onStart() { forge.setVisibility("e1", false); }';

    await handler(initMsg([{ entityId: 'e1', enabled: true, source: code }]));

    const cmdMsg = mockPostMessage.mock.calls.find((c) => c[0]?.type === 'commands');
    expect(cmdMsg![0].commands).toContainEqual(
      expect.objectContaining({ cmd: 'set_visibility', entityId: 'e1', visible: false })
    );
  });

  // ─── Forge Logging ──────────────────────────────────────────────

  it('forge.warn and forge.error post messages with correct level', async () => {
    const handler = await setupWorker();
    const code = 'function onStart() { forge.warn("w"); forge.error("e"); }';

    await handler(initMsg([{ entityId: 'e1', enabled: true, source: code }]));

    expect(mockPostMessage).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'log', level: 'warn', message: 'w' })
    );
    expect(mockPostMessage).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'log', level: 'error', message: 'e' })
    );
  });

  // ─── Forge Scene API ────────────────────────────────────────────

  it('forge.scene.getEntities returns entity list', async () => {
    const handler = await setupWorker();
    const code = `function onStart() {
      var ents = forge.scene.getEntities();
      forge.log(ents.length.toString());
      forge.log(ents[0].name);
    }`;

    await handler(initMsg(
      [{ entityId: 'e1', enabled: true, source: code }],
      {
        entities: { e1: { position: [0, 0, 0], rotation: [0, 0, 0], scale: [1, 1, 1] } },
        entityInfos: { e1: { name: 'MyCube', type: 'cube', colliderRadius: 0.5 } },
      }
    ));

    expect(mockPostMessage).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'log', message: '1' })
    );
    expect(mockPostMessage).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'log', message: 'MyCube' })
    );
  });

  it('forge.scene.findByName is case-insensitive partial match', async () => {
    const handler = await setupWorker();
    const code = `function onStart() {
      var results = forge.scene.findByName("cube");
      forge.log(results.length.toString());
    }`;

    await handler(initMsg(
      [{ entityId: 'e1', enabled: true, source: code }],
      {
        entityInfos: { e1: { name: 'MyCube', type: 'cube', colliderRadius: 0.5 }, e2: { name: 'Sphere', type: 'sphere', colliderRadius: 0.5 } },
      }
    ));

    expect(mockPostMessage).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'log', message: '1' })
    );
  });

  it('forge.scene.getEntitiesInRadius finds nearby entities', async () => {
    const handler = await setupWorker();
    const code = `function onStart() {
      var nearby = forge.scene.getEntitiesInRadius([0, 0, 0], 5);
      forge.log(nearby.length.toString());
    }`;

    await handler(initMsg(
      [{ entityId: 'e1', enabled: true, source: code }],
      {
        entities: {
          e1: { position: [0, 0, 0], rotation: [0, 0, 0], scale: [1, 1, 1] },
          e2: { position: [3, 0, 0], rotation: [0, 0, 0], scale: [1, 1, 1] },
          e3: { position: [100, 0, 0], rotation: [0, 0, 0], scale: [1, 1, 1] },
        },
      }
    ));

    expect(mockPostMessage).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'log', message: '2' })
    );
  });

  it('forge.scene.load posts scene_load message', async () => {
    const handler = await setupWorker();
    const code = 'function onStart() { forge.scene.load("Level2", { type: "fade" }); }';

    await handler(initMsg([{ entityId: 'e1', enabled: true, source: code }]));

    expect(mockPostMessage).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'scene_load', sceneName: 'Level2', transition: { type: 'fade' } })
    );
  });

  it('forge.scene.restart posts scene_restart message', async () => {
    const handler = await setupWorker();
    const code = 'function onStart() { forge.scene.restart(); }';

    await handler(initMsg([{ entityId: 'e1', enabled: true, source: code }]));

    expect(mockPostMessage).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'scene_restart' })
    );
  });

  // ─── Forge Input API ────────────────────────────────────────────

  it('forge.input reads from inputState', async () => {
    const handler = await setupWorker();
    const code = `function onStart() {
      forge.log(forge.input.isPressed("jump") ? "yes" : "no");
      forge.log(forge.input.justPressed("fire") ? "yes" : "no");
      forge.log(forge.input.getAxis("horizontal").toString());
    }`;

    await handler(initMsg(
      [{ entityId: 'e1', enabled: true, source: code }],
      { inputState: { pressed: { jump: true }, justPressed: { fire: true }, justReleased: {}, axes: { horizontal: 0.75 } } }
    ));

    const logs = mockPostMessage.mock.calls.filter((c) => c[0]?.type === 'log').map((c) => c[0].message);
    expect(logs).toContain('yes');
    expect(logs).toContain('0.75');
  });

  it('forge.input.getAxis returns 0 for unset axis', async () => {
    const handler = await setupWorker();
    const code = 'function onStart() { forge.log(forge.input.getAxis("nonexistent").toString()); }';

    await handler(initMsg([{ entityId: 'e1', enabled: true, source: code }]));

    expect(mockPostMessage).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'log', message: '0' })
    );
  });

  // ─── Forge Physics API ──────────────────────────────────────────

  it('forge.physics.applyForce and applyImpulse push correct commands', async () => {
    const handler = await setupWorker();
    const code = `function onStart() {
      forge.physics.applyForce("e1", 1, 2, 3);
      forge.physics.applyImpulse("e1", 4, 5, 6);
    }`;

    await handler(initMsg([{ entityId: 'e1', enabled: true, source: code }]));

    const cmdMsg = mockPostMessage.mock.calls.find((c) => c[0]?.type === 'commands');
    expect(cmdMsg![0].commands).toContainEqual(
      expect.objectContaining({ cmd: 'apply_force', entityId: 'e1', force: [1, 2, 3], isImpulse: false })
    );
    expect(cmdMsg![0].commands).toContainEqual(
      expect.objectContaining({ cmd: 'apply_force', entityId: 'e1', force: [4, 5, 6], isImpulse: true })
    );
  });

  it('forge.physics.setVelocity pushes set_velocity command', async () => {
    const handler = await setupWorker();
    const code = 'function onStart() { forge.physics.setVelocity("e1", 10, 0, 0); }';

    await handler(initMsg([{ entityId: 'e1', enabled: true, source: code }]));

    const cmdMsg = mockPostMessage.mock.calls.find((c) => c[0]?.type === 'commands');
    expect(cmdMsg![0].commands).toContainEqual(
      expect.objectContaining({ cmd: 'set_velocity', entityId: 'e1', velocity: [10, 0, 0] })
    );
  });

  it('forge.physics.getContacts finds nearby entities', async () => {
    const handler = await setupWorker();
    const code = `function onStart() {
      var contacts = forge.physics.getContacts("e1");
      forge.log(contacts.length.toString());
    }`;

    await handler(initMsg(
      [{ entityId: 'e1', enabled: true, source: code }],
      {
        entities: {
          e1: { position: [0, 0, 0], rotation: [0, 0, 0], scale: [1, 1, 1] },
          e2: { position: [0.5, 0, 0], rotation: [0, 0, 0], scale: [1, 1, 1] },
          e3: { position: [100, 0, 0], rotation: [0, 0, 0], scale: [1, 1, 1] },
        },
        entityInfos: {
          e1: { name: 'A', type: 'cube', colliderRadius: 0.5 },
          e2: { name: 'B', type: 'cube', colliderRadius: 0.5 },
          e3: { name: 'C', type: 'cube', colliderRadius: 0.5 },
        },
      }
    ));

    expect(mockPostMessage).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'log', message: '1' })
    );
  });

  it('forge.physics.distanceTo returns distance or Infinity', async () => {
    const handler = await setupWorker();
    const code = `function onStart() {
      forge.log(forge.physics.distanceTo("e1", "e2").toFixed(1));
      forge.log(forge.physics.distanceTo("e1", "nonexistent").toString());
    }`;

    await handler(initMsg(
      [{ entityId: 'e1', enabled: true, source: code }],
      {
        entities: {
          e1: { position: [0, 0, 0], rotation: [0, 0, 0], scale: [1, 1, 1] },
          e2: { position: [3, 4, 0], rotation: [0, 0, 0], scale: [1, 1, 1] },
        },
      }
    ));

    expect(mockPostMessage).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'log', message: '5.0' })
    );
    expect(mockPostMessage).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'log', message: 'Infinity' })
    );
  });

  // ─── Forge Physics2D API ────────────────────────────────────────

  it('forge.physics2d pushes correct 2D physics commands', async () => {
    const handler = await setupWorker();
    const code = `function onStart() {
      forge.physics2d.applyForce("e1", 10, 20);
      forge.physics2d.applyImpulse("e1", 5, 10);
      forge.physics2d.setVelocity("e1", 1, 2);
      forge.physics2d.setAngularVelocity("e1", 3.14);
      forge.physics2d.setGravity(0, -20);
    }`;

    await handler(initMsg([{ entityId: 'e1', enabled: true, source: code }]));

    const cmdMsg = mockPostMessage.mock.calls.find((c) => c[0]?.type === 'commands');
    const cmds = cmdMsg![0].commands;
    expect(cmds).toContainEqual(expect.objectContaining({ cmd: 'apply_force2d', entityId: 'e1', forceX: 10, forceY: 20 }));
    expect(cmds).toContainEqual(expect.objectContaining({ cmd: 'apply_impulse2d', entityId: 'e1', impulseX: 5, impulseY: 10 }));
    expect(cmds).toContainEqual(expect.objectContaining({ cmd: 'set_velocity2d', entityId: 'e1', velocityX: 1, velocityY: 2 }));
    expect(cmds).toContainEqual(expect.objectContaining({ cmd: 'set_angular_velocity2d', entityId: 'e1', omega: 3.14 }));
    expect(cmds).toContainEqual(expect.objectContaining({ cmd: 'set_gravity2d', gravityX: 0, gravityY: -20 }));
  });

  it('forge.physics2d.getVelocity reads from synced state', async () => {
    const handler = await setupWorker();
    const code = `function onStart() {
      var v = forge.physics2d.getVelocity("e1");
      forge.log(v ? v.x.toString() : "null");
    }`;

    await handler(initMsg(
      [{ entityId: 'e1', enabled: true, source: code }],
      { physics2dVelocities: { e1: { velocity: [5, 10], angularVelocity: 1.5 } } }
    ));

    expect(mockPostMessage).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'log', message: '5' })
    );
  });

  // ─── Forge Audio API ────────────────────────────────────────────

  it('forge.audio play/stop/pause push commands and track state', async () => {
    const handler = await setupWorker();
    const code = `function onStart() {
      forge.audio.play("a1");
      forge.log(forge.audio.isPlaying("a1") ? "playing" : "stopped");
      forge.audio.stop("a1");
      forge.log(forge.audio.isPlaying("a1") ? "playing" : "stopped");
    }`;

    await handler(initMsg([{ entityId: 'e1', enabled: true, source: code }]));

    const logs = mockPostMessage.mock.calls.filter((c) => c[0]?.type === 'log').map((c) => c[0].message);
    expect(logs).toContain('playing');
    expect(logs).toContain('stopped');

    const cmdMsg = mockPostMessage.mock.calls.find((c) => c[0]?.type === 'commands');
    expect(cmdMsg![0].commands).toContainEqual(expect.objectContaining({ cmd: 'play_audio', entityId: 'a1' }));
    expect(cmdMsg![0].commands).toContainEqual(expect.objectContaining({ cmd: 'stop_audio', entityId: 'a1' }));
  });

  it('forge.audio.setVolume and setPitch push set_audio commands', async () => {
    const handler = await setupWorker();
    const code = `function onStart() {
      forge.audio.setVolume("a1", 0.5);
      forge.audio.setPitch("a1", 1.5);
    }`;

    await handler(initMsg([{ entityId: 'e1', enabled: true, source: code }]));

    const cmdMsg = mockPostMessage.mock.calls.find((c) => c[0]?.type === 'commands');
    expect(cmdMsg![0].commands).toContainEqual(expect.objectContaining({ cmd: 'set_audio', entityId: 'a1', volume: 0.5 }));
    expect(cmdMsg![0].commands).toContainEqual(expect.objectContaining({ cmd: 'set_audio', entityId: 'a1', pitch: 1.5 }));
  });

  it('forge.audio.playOneShot pushes audio_play_one_shot command', async () => {
    const handler = await setupWorker();
    const code = 'function onStart() { forge.audio.playOneShot("sfx_boom", { position: [1, 2, 3], volume: 0.8 }); }';

    await handler(initMsg([{ entityId: 'e1', enabled: true, source: code }]));

    const cmdMsg = mockPostMessage.mock.calls.find((c) => c[0]?.type === 'commands');
    expect(cmdMsg![0].commands).toContainEqual(
      expect.objectContaining({ cmd: 'audio_play_one_shot', assetId: 'sfx_boom', position: [1, 2, 3], volume: 0.8 })
    );
  });

  it('forge.audio.crossfade pushes audio_crossfade command', async () => {
    const handler = await setupWorker();
    const code = 'function onStart() { forge.audio.crossfade("a1", "a2", 1000); }';

    await handler(initMsg([{ entityId: 'e1', enabled: true, source: code }]));

    const cmdMsg = mockPostMessage.mock.calls.find((c) => c[0]?.type === 'commands');
    expect(cmdMsg![0].commands).toContainEqual(
      expect.objectContaining({ cmd: 'audio_crossfade', fromEntityId: 'a1', toEntityId: 'a2', durationMs: 1000 })
    );
  });

  // ─── Forge Camera API ───────────────────────────────────────────

  it('forge.camera APIs push correct commands', async () => {
    const handler = await setupWorker();
    const code = `function onStart() {
      forge.camera.follow("e1", [0, 5, -10]);
      forge.camera.setPosition(1, 2, 3);
      forge.camera.lookAt(0, 0, 0);
      forge.camera.stopFollow();
    }`;

    await handler(initMsg([{ entityId: 'e1', enabled: true, source: code }]));

    const cmdMsg = mockPostMessage.mock.calls.find((c) => c[0]?.type === 'commands');
    const cmds = cmdMsg![0].commands;
    expect(cmds).toContainEqual(expect.objectContaining({ cmd: 'camera_follow', entityId: 'e1', offset: [0, 5, -10] }));
    expect(cmds).toContainEqual(expect.objectContaining({ cmd: 'camera_set_position', position: [1, 2, 3] }));
    expect(cmds).toContainEqual(expect.objectContaining({ cmd: 'camera_look_at', target: [0, 0, 0] }));
    expect(cmds).toContainEqual(expect.objectContaining({ cmd: 'camera_stop_follow' }));
  });

  it('forge.camera.setMode and shake post messages', async () => {
    const handler = await setupWorker();
    const code = `function onStart() {
      forge.camera.setMode("firstPerson");
      forge.camera.shake(0.5, 1.0);
    }`;

    await handler(initMsg([{ entityId: 'e1', enabled: true, source: code }]));

    expect(mockPostMessage).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'camera_set_mode', mode: 'firstPerson' })
    );
    expect(mockPostMessage).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'camera_shake', intensity: 0.5, duration: 1.0 })
    );
  });

  // ─── Forge UI/HUD API ──────────────────────────────────────────

  it('forge.ui.showText and updateText produce UI updates', async () => {
    const handler = await setupWorker();
    const code = `function onStart() {
      forge.ui.showText("score", "Score: 0", 10, 10, { fontSize: 32, color: "red" });
      forge.ui.updateText("score", "Score: 100");
    }`;

    await handler(initMsg([{ entityId: 'e1', enabled: true, source: code }]));

    const uiMsg = mockPostMessage.mock.calls.find((c) => c[0]?.type === 'ui');
    expect(uiMsg).not.toBeUndefined();
    expect(uiMsg![0].elements).toContainEqual(
      expect.objectContaining({ id: 'score', text: 'Score: 100', x: 10, y: 10, fontSize: 32, color: 'red' })
    );
  });

  it('forge.ui.removeText removes element', async () => {
    const handler = await setupWorker();
    const code = `function onStart() {
      forge.ui.showText("temp", "Hi", 0, 0);
      forge.ui.removeText("temp");
    }`;

    await handler(initMsg([{ entityId: 'e1', enabled: true, source: code }]));

    const uiMsg = mockPostMessage.mock.calls.find((c) => c[0]?.type === 'ui');
    expect(uiMsg![0].elements).toHaveLength(0);
  });

  it('forge.ui.clear removes all elements', async () => {
    const handler = await setupWorker();
    const code = `function onStart() {
      forge.ui.showText("a", "A", 0, 0);
      forge.ui.showText("b", "B", 0, 0);
      forge.ui.clear();
    }`;

    await handler(initMsg([{ entityId: 'e1', enabled: true, source: code }]));

    const uiMsg = mockPostMessage.mock.calls.find((c) => c[0]?.type === 'ui');
    expect(uiMsg![0].elements).toHaveLength(0);
  });

  it('forge.ui screen management posts messages', async () => {
    const handler = await setupWorker();
    const code = `function onStart() {
      forge.ui.showScreen("hud");
      forge.ui.hideScreen("menu");
      forge.ui.toggleScreen("settings");
      forge.ui.hideAllScreens();
    }`;

    await handler(initMsg([{ entityId: 'e1', enabled: true, source: code }]));

    expect(mockPostMessage).toHaveBeenCalledWith(expect.objectContaining({ type: 'ui_screen', action: 'show', target: 'hud' }));
    expect(mockPostMessage).toHaveBeenCalledWith(expect.objectContaining({ type: 'ui_screen', action: 'hide', target: 'menu' }));
    expect(mockPostMessage).toHaveBeenCalledWith(expect.objectContaining({ type: 'ui_screen', action: 'toggle', target: 'settings' }));
    expect(mockPostMessage).toHaveBeenCalledWith(expect.objectContaining({ type: 'ui_screen', action: 'hide_all' }));
  });

  it('forge.ui widget manipulation posts messages', async () => {
    const handler = await setupWorker();
    const code = `function onStart() {
      forge.ui.setWidgetText("hud", "score", "100");
      forge.ui.setWidgetVisible("hud", "health", false);
      forge.ui.setWidgetStyle("hud", "bar", { width: "50%" });
    }`;

    await handler(initMsg([{ entityId: 'e1', enabled: true, source: code }]));

    expect(mockPostMessage).toHaveBeenCalledWith(expect.objectContaining({ type: 'ui_widget', action: 'set_text', screen: 'hud', widget: 'score', text: '100' }));
    expect(mockPostMessage).toHaveBeenCalledWith(expect.objectContaining({ type: 'ui_widget', action: 'set_visible', screen: 'hud', widget: 'health', visible: false }));
    expect(mockPostMessage).toHaveBeenCalledWith(expect.objectContaining({ type: 'ui_widget', action: 'set_style', screen: 'hud', widget: 'bar', style: { width: '50%' } }));
  });

  // ─── Forge Dialogue API ─────────────────────────────────────────

  it('forge.dialogue posts correct messages', async () => {
    const handler = await setupWorker();
    const code = `function onStart() {
      forge.dialogue.start("tree1");
      forge.dialogue.advance();
      forge.dialogue.setVariable("tree1", "gold", 100);
      forge.dialogue.end();
    }`;

    await handler(initMsg([{ entityId: 'e1', enabled: true, source: code }]));

    expect(mockPostMessage).toHaveBeenCalledWith(expect.objectContaining({ type: 'dialogue_start', treeId: 'tree1' }));
    expect(mockPostMessage).toHaveBeenCalledWith(expect.objectContaining({ type: 'dialogue_advance' }));
    expect(mockPostMessage).toHaveBeenCalledWith(expect.objectContaining({ type: 'dialogue_set_variable', treeId: 'tree1', key: 'gold', value: 100 }));
    expect(mockPostMessage).toHaveBeenCalledWith(expect.objectContaining({ type: 'dialogue_end' }));
  });

  // ─── Forge Particles API ────────────────────────────────────────

  it('forge.particles pushes correct commands', async () => {
    const handler = await setupWorker();
    const code = `function onStart() {
      forge.particles.setPreset("e1", "fire");
      forge.particles.enable("e1");
      forge.particles.disable("e1");
      forge.particles.burst("e1");
    }`;

    await handler(initMsg([{ entityId: 'e1', enabled: true, source: code }]));

    const cmdMsg = mockPostMessage.mock.calls.find((c) => c[0]?.type === 'commands');
    const cmds = cmdMsg![0].commands;
    expect(cmds).toContainEqual(expect.objectContaining({ cmd: 'set_particle_preset', entityId: 'e1', preset: 'fire' }));
    expect(cmds).toContainEqual(expect.objectContaining({ cmd: 'toggle_particle', entityId: 'e1', enabled: true }));
    expect(cmds).toContainEqual(expect.objectContaining({ cmd: 'toggle_particle', entityId: 'e1', enabled: false }));
    expect(cmds).toContainEqual(expect.objectContaining({ cmd: 'burst_particle', entityId: 'e1' }));
  });

  // ─── Forge Animation API ───────────────────────────────────────

  it('forge.animation pushes correct commands', async () => {
    const handler = await setupWorker();
    const code = `function onStart() {
      forge.animation.play("e1", "walk", 0.5);
      forge.animation.pause("e1");
      forge.animation.resume("e1");
      forge.animation.stop("e1");
      forge.animation.setSpeed("e1", 2.0);
      forge.animation.setLoop("e1", false);
      forge.animation.setBlendWeight("e1", "run", 0.7);
    }`;

    await handler(initMsg([{ entityId: 'e1', enabled: true, source: code }]));

    const cmdMsg = mockPostMessage.mock.calls.find((c) => c[0]?.type === 'commands');
    const cmds = cmdMsg![0].commands;
    expect(cmds).toContainEqual(expect.objectContaining({ cmd: 'play_animation', entityId: 'e1', clipName: 'walk', crossfadeSecs: 0.5 }));
    expect(cmds).toContainEqual(expect.objectContaining({ cmd: 'pause_animation', entityId: 'e1' }));
    expect(cmds).toContainEqual(expect.objectContaining({ cmd: 'resume_animation', entityId: 'e1' }));
    expect(cmds).toContainEqual(expect.objectContaining({ cmd: 'stop_animation', entityId: 'e1' }));
    expect(cmds).toContainEqual(expect.objectContaining({ cmd: 'set_animation_speed', entityId: 'e1', speed: 2.0 }));
    expect(cmds).toContainEqual(expect.objectContaining({ cmd: 'set_animation_loop', entityId: 'e1', looping: false }));
    expect(cmds).toContainEqual(expect.objectContaining({ cmd: 'set_animation_blend_weight', entityId: 'e1', clipName: 'run', weight: 0.7 }));
  });

  // ─── Forge Tilemap API ──────────────────────────────────────────

  it('forge.tilemap.getTile reads from synced state', async () => {
    const handler = await setupWorker();
    const code = `function onStart() {
      forge.log(String(forge.tilemap.getTile("tm1", 1, 0, 0)));
      forge.log(String(forge.tilemap.getTile("tm1", 5, 5, 0)));
    }`;

    await handler(initMsg(
      [{ entityId: 'e1', enabled: true, source: code }],
      {
        tilemapStates: {
          tm1: {
            tileSize: [32, 32],
            mapSize: [3, 3],
            layers: [{ tiles: [0, 1, 2, 3, 4, 5, 6, 7, 8] }],
            origin: 'TopLeft' as const,
          },
        },
      }
    ));

    expect(mockPostMessage).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'log', message: '1' })
    );
    // Out of bounds returns null
    expect(mockPostMessage).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'log', message: 'null' })
    );
  });

  it('forge.tilemap.setTile and fillRect push commands', async () => {
    const handler = await setupWorker();
    const code = `function onStart() {
      forge.tilemap.setTile("tm1", 0, 0, 5);
      forge.tilemap.fillRect("tm1", 0, 0, 3, 3, 1);
    }`;

    await handler(initMsg([{ entityId: 'e1', enabled: true, source: code }]));

    const cmdMsg = mockPostMessage.mock.calls.find((c) => c[0]?.type === 'commands');
    expect(cmdMsg![0].commands).toContainEqual(expect.objectContaining({ cmd: 'set_tile', tilemapId: 'tm1', x: 0, y: 0, tileId: 5 }));
    expect(cmdMsg![0].commands).toContainEqual(expect.objectContaining({ cmd: 'fill_tiles', tilemapId: 'tm1', x: 0, y: 0, width: 3, height: 3, tileId: 1 }));
  });

  // ─── Forge Sprite API ──────────────────────────────────────────

  it('forge.sprite pushes correct commands', async () => {
    const handler = await setupWorker();
    const code = `function onStart() {
      forge.sprite.playAnimation("e1", "idle");
      forge.sprite.stopAnimation("e1");
      forge.sprite.setAnimSpeed("e1", 2.0);
      forge.sprite.setAnimParam("e1", "running", true);
    }`;

    await handler(initMsg([{ entityId: 'e1', enabled: true, source: code }]));

    const cmdMsg = mockPostMessage.mock.calls.find((c) => c[0]?.type === 'commands');
    const cmds = cmdMsg![0].commands;
    expect(cmds).toContainEqual(expect.objectContaining({ cmd: 'play_sprite_animation', entityId: 'e1', clipName: 'idle' }));
    expect(cmds).toContainEqual(expect.objectContaining({ cmd: 'stop_sprite_animation', entityId: 'e1' }));
    expect(cmds).toContainEqual(expect.objectContaining({ cmd: 'set_sprite_anim_speed', entityId: 'e1', speed: 2.0 }));
    expect(cmds).toContainEqual(expect.objectContaining({ cmd: 'set_sprite_anim_param', entityId: 'e1', paramName: 'running', value: true }));
  });

  // ─── Forge Skeleton API ─────────────────────────────────────────

  it('forge.skeleton.getBones reads from synced state', async () => {
    const handler = await setupWorker();
    const code = `function onStart() {
      var bones = forge.skeleton.getBones("e1");
      forge.log(bones ? bones[0].name : "null");
    }`;

    await handler(initMsg(
      [{ entityId: 'e1', enabled: true, source: code }],
      {
        skeletonStates: {
          e1: {
            bones: [{ name: 'root', parentBone: null, localPosition: [0, 0], localRotation: 0, localScale: [1, 1], length: 50 }],
            activeSkin: 'default',
          },
        },
      }
    ));

    expect(mockPostMessage).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'log', message: 'root' })
    );
  });

  it('forge.skeleton.getSkin reads active skin', async () => {
    const handler = await setupWorker();
    const code = `function onStart() {
      forge.log(forge.skeleton.getSkin("e1") || "null");
    }`;

    await handler(initMsg(
      [{ entityId: 'e1', enabled: true, source: code }],
      {
        skeletonStates: {
          e1: { bones: [], activeSkin: 'warrior' },
        },
      }
    ));

    expect(mockPostMessage).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'log', message: 'warrior' })
    );
  });

  // ─── Forge Time & State API ─────────────────────────────────────

  it('forge.time provides delta and elapsed', async () => {
    const handler = await setupWorker();
    const code = `function onUpdate(dt) {
      forge.log(forge.time.delta.toFixed(2));
      forge.log(forge.time.elapsed.toFixed(1));
    }`;

    await handler(initMsg([{ entityId: 'e1', enabled: true, source: code }]));
    await handler({ data: { type: 'tick', dt: 0.016, elapsed: 1.5 } });

    expect(mockPostMessage).toHaveBeenCalledWith(expect.objectContaining({ type: 'log', message: '0.02' }));
    expect(mockPostMessage).toHaveBeenCalledWith(expect.objectContaining({ type: 'log', message: '1.5' }));
  });

  it('forge.state persists across ticks', async () => {
    const handler = await setupWorker();
    const code = `
      function onStart() { forge.state.set("score", 0); }
      function onUpdate(dt) {
        var s = forge.state.get("score") || 0;
        forge.state.set("score", s + 1);
        forge.log(forge.state.get("score").toString());
      }
    `;

    await handler(initMsg([{ entityId: 'e1', enabled: true, source: code }]));
    await handler({ data: { type: 'tick', dt: 0.016 } });
    await handler({ data: { type: 'tick', dt: 0.016 } });

    const logs = mockPostMessage.mock.calls.filter((c) => c[0]?.type === 'log').map((c) => c[0].message);
    expect(logs).toContain('1');
    expect(logs).toContain('2');
  });

  // ─── Tick Message Handling ──────────────────────────────────────

  it('tick updates entity states and calls onUpdate', async () => {
    const handler = await setupWorker();
    const code = `function onUpdate(dt) {
      var t = forge.getTransform("e1");
      forge.log(t ? t.position[0].toString() : "null");
    }`;

    await handler(initMsg([{ entityId: 'e1', enabled: true, source: code }]));
    await handler({
      data: {
        type: 'tick',
        dt: 0.016,
        entities: { e1: { position: [42, 0, 0], rotation: [0, 0, 0], scale: [1, 1, 1] } },
      },
    });

    expect(mockPostMessage).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'log', message: '42' })
    );
  });

  it('tick estimates 2D velocities from position deltas', async () => {
    const handler = await setupWorker();
    const code = `function onUpdate(dt) {
      var v = forge.physics2d.getVelocity("e1");
      if (v) forge.log(v.x.toFixed(0));
    }`;

    await handler(initMsg(
      [{ entityId: 'e1', enabled: true, source: code }],
      { entities: { e1: { position: [0, 0, 0], rotation: [0, 0, 0], scale: [1, 1, 1] } } }
    ));

    // First tick establishes previous position
    await handler({
      data: {
        type: 'tick',
        dt: 0.1,
        entities: { e1: { position: [0, 0, 0], rotation: [0, 0, 0], scale: [1, 1, 1] } },
      },
    });

    mockPostMessage.mockClear();

    // Second tick: position changes by 10 over dt=0.1 → velocity ~100
    await handler({
      data: {
        type: 'tick',
        dt: 0.1,
        entities: { e1: { position: [10, 0, 0], rotation: [0, 0, 0], scale: [1, 1, 1] } },
      },
    });

    expect(mockPostMessage).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'log', message: '100' })
    );
  });

  it('tick uses engine-provided velocities over estimated ones', async () => {
    const handler = await setupWorker();
    const code = `function onUpdate(dt) {
      var v = forge.physics2d.getVelocity("e1");
      if (v) forge.log(v.x.toFixed(0));
    }`;

    await handler(initMsg(
      [{ entityId: 'e1', enabled: true, source: code }],
      { entities: { e1: { position: [0, 0, 0], rotation: [0, 0, 0], scale: [1, 1, 1] } } }
    ));

    await handler({
      data: {
        type: 'tick',
        dt: 0.1,
        entities: { e1: { position: [10, 0, 0], rotation: [0, 0, 0], scale: [1, 1, 1] } },
        physics2dVelocities: { e1: { velocity: [999, 0], angularVelocity: 0 } },
      },
    });

    expect(mockPostMessage).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'log', message: '999' })
    );
  });

  it('tick syncs audio playing state from main thread', async () => {
    const handler = await setupWorker();
    const code = `function onUpdate(dt) {
      forge.log(forge.audio.isPlaying("a1") ? "yes" : "no");
    }`;

    await handler(initMsg([{ entityId: 'e1', enabled: true, source: code }]));
    await handler({
      data: { type: 'tick', dt: 0.016, audioPlayingStates: { a1: true } },
    });

    expect(mockPostMessage).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'log', message: 'yes' })
    );
  });

  it('tick isolates errors between scripts', async () => {
    const handler = await setupWorker();
    const badCode = 'function onUpdate(dt) { throw new Error("tick boom"); }';
    const goodCode = 'function onUpdate(dt) { forge.log("survived"); }';

    await handler(initMsg([
      { entityId: 'e_bad', enabled: true, source: badCode },
      { entityId: 'e_good', enabled: true, source: goodCode },
    ]));
    await handler({ data: { type: 'tick', dt: 0.016 } });

    expect(mockPostMessage).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'error', entityId: 'e_bad', message: expect.stringContaining('onUpdate error:') })
    );
    expect(mockPostMessage).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'log', entityId: 'e_good', message: 'survived' })
    );
  });

  // ─── Stop Message Handling ──────────────────────────────────────

  it('stop calls onDestroy and clears state', async () => {
    const handler = await setupWorker();
    const code = 'function onDestroy() { forge.log("destroyed"); }';

    await handler(initMsg([{ entityId: 'e1', enabled: true, source: code }]));
    mockPostMessage.mockClear();

    await handler({ data: { type: 'stop' } });

    expect(mockPostMessage).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'log', message: 'destroyed' })
    );
    // Sends final UI clear
    expect(mockPostMessage).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'ui', elements: [] })
    );
  });

  it('stop isolates errors in onDestroy', async () => {
    const handler = await setupWorker();
    const badCode = 'function onDestroy() { throw new Error("destroy fail"); }';
    const goodCode = 'function onDestroy() { forge.log("cleanup ok"); }';

    await handler(initMsg([
      { entityId: 'e_bad', enabled: true, source: badCode },
      { entityId: 'e_good', enabled: true, source: goodCode },
    ]));
    mockPostMessage.mockClear();

    await handler({ data: { type: 'stop' } });

    expect(mockPostMessage).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'error', entityId: 'e_bad', message: expect.stringContaining('onDestroy error:') })
    );
    expect(mockPostMessage).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'log', entityId: 'e_good', message: 'cleanup ok' })
    );
  });

  // ─── Collision Events ───────────────────────────────────────────

  it('COLLISION_EVENT fires registered enter callbacks', async () => {
    const handler = await setupWorker();
    const code = `function onStart() {
      forge.physics.onCollisionEnter("e1", function(otherId) {
        forge.log("hit:" + otherId);
      });
    }`;

    await handler(initMsg([{ entityId: 'e1', enabled: true, source: code }]));
    mockPostMessage.mockClear();

    await handler({ data: { type: 'COLLISION_EVENT', entityA: 'e1', entityB: 'e2', started: true } });

    expect(mockPostMessage).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'log', message: 'hit:e2' })
    );
  });

  it('COLLISION_EVENT fires exit callbacks', async () => {
    const handler = await setupWorker();
    const code = `function onStart() {
      forge.physics.onCollisionExit("e1", function(otherId) {
        forge.log("exit:" + otherId);
      });
    }`;

    await handler(initMsg([{ entityId: 'e1', enabled: true, source: code }]));
    mockPostMessage.mockClear();

    await handler({ data: { type: 'COLLISION_EVENT', entityA: 'e1', entityB: 'e2', started: false } });

    expect(mockPostMessage).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'log', message: 'exit:e2' })
    );
  });

  it('COLLISION_EVENT fires callbacks for both entities', async () => {
    const handler = await setupWorker();
    const code = `function onStart() {
      forge.physics.onCollisionEnter("e1", function(otherId) { forge.log("A:" + otherId); });
      forge.physics.onCollisionEnter("e2", function(otherId) { forge.log("B:" + otherId); });
    }`;

    await handler(initMsg([{ entityId: 'e1', enabled: true, source: code }]));
    mockPostMessage.mockClear();

    await handler({ data: { type: 'COLLISION_EVENT', entityA: 'e1', entityB: 'e2', started: true } });

    expect(mockPostMessage).toHaveBeenCalledWith(expect.objectContaining({ type: 'log', message: 'A:e2' }));
    expect(mockPostMessage).toHaveBeenCalledWith(expect.objectContaining({ type: 'log', message: 'B:e1' }));
  });

  it('COLLISION_EVENT handles callback errors gracefully', async () => {
    const handler = await setupWorker();
    const code = `function onStart() {
      forge.physics.onCollisionEnter("e1", function(otherId) { throw new Error("cb error"); });
    }`;

    await handler(initMsg([{ entityId: 'e1', enabled: true, source: code }]));
    mockPostMessage.mockClear();

    await handler({ data: { type: 'COLLISION_EVENT', entityA: 'e1', entityB: 'e2', started: true } });

    expect(mockPostMessage).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'error', entityId: 'e1', message: expect.stringContaining('Collision callback error:') })
    );
  });

  it('forge.physics.offCollision removes callbacks', async () => {
    const handler = await setupWorker();
    const code = `function onStart() {
      forge.physics.onCollisionEnter("e1", function(otherId) { forge.log("should not fire"); });
      forge.physics.offCollision("e1");
    }`;

    await handler(initMsg([{ entityId: 'e1', enabled: true, source: code }]));
    mockPostMessage.mockClear();

    await handler({ data: { type: 'COLLISION_EVENT', entityA: 'e1', entityB: 'e2', started: true } });

    const logs = mockPostMessage.mock.calls.filter((c) => c[0]?.type === 'log');
    expect(logs).toHaveLength(0);
  });

  // ─── Command Limiting ──────────────────────────────────────────

  it('flushCommands truncates commands exceeding MAX_COMMANDS_PER_FRAME', async () => {
    const handler = await setupWorker();
    // Generate 150 commands — exceeds the 100 limit
    const lines = [];
    for (let i = 0; i < 150; i++) {
      lines.push(`forge.setPosition("e1", ${i}, 0, 0);`);
    }
    const code = `function onStart() { ${lines.join('\n')} }`;

    await handler(initMsg([{ entityId: 'e1', enabled: true, source: code }]));

    // Should post error about limit
    expect(mockPostMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'error',
        message: expect.stringContaining('Command limit exceeded'),
      })
    );

    // Should only flush 100 commands
    const cmdMsg = mockPostMessage.mock.calls.find((c) => c[0]?.type === 'commands');
    expect(cmdMsg![0].commands).toHaveLength(100);
  });

  // ─── Scene Info Message ─────────────────────────────────────────

  it('scene_info sets current scene and all scene names', async () => {
    const handler = await setupWorker();
    const code = `function onUpdate(dt) {
      forge.log(forge.scene.getCurrent());
    }`;

    await handler(initMsg([{ entityId: 'e1', enabled: true, source: code }]));

    await handler({ data: { type: 'scene_info', currentScene: 'Level2', allSceneNames: ['Level1', 'Level2'] } });
    await handler({ data: { type: 'tick', dt: 0.016 } });

    expect(mockPostMessage).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'log', message: 'Level2' })
    );
  });

  // ─── Re-init Clears State ──────────────────────────────────────

  it('re-init clears previous scripts and state', async () => {
    const handler = await setupWorker();

    // First init
    await handler(initMsg([{ entityId: 'e1', enabled: true, source: 'function onStart() { forge.state.set("x", 1); }' }]));

    // Second init with different script
    await handler(initMsg([{ entityId: 'e2', enabled: true, source: 'function onStart() { forge.log(String(forge.state.get("x"))); }' }]));

    // State should be cleared — x should be undefined
    expect(mockPostMessage).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'log', message: 'undefined' })
    );
  });

  // ─── Forge Screen Orientation ───────────────────────────────────

  it('forge.screen.orientation returns landscape-primary in worker', async () => {
    const handler = await setupWorker();
    const code = 'function onStart() { forge.log(forge.screen.orientation); }';

    await handler(initMsg([{ entityId: 'e1', enabled: true, source: code }]));

    expect(mockPostMessage).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'log', message: 'landscape-primary' })
    );
  });

  // ─── Forge Input Vibrate ────────────────────────────────────────

  it('forge.input.vibrate pushes vibrate command', async () => {
    const handler = await setupWorker();
    const code = 'function onStart() { forge.input.vibrate([100, 50, 100]); }';

    await handler(initMsg([{ entityId: 'e1', enabled: true, source: code }]));

    const cmdMsg = mockPostMessage.mock.calls.find((c) => c[0]?.type === 'commands');
    expect(cmdMsg![0].commands).toContainEqual(
      expect.objectContaining({ cmd: 'vibrate', pattern: [100, 50, 100] })
    );
  });

  // ─── Forge Emissive ─────────────────────────────────────────────

  it('forge.setEmissive pushes update_material with emissive', async () => {
    const handler = await setupWorker();
    const code = 'function onStart() { forge.setEmissive("e1", 1, 0.5, 0, 2.0); }';

    await handler(initMsg([{ entityId: 'e1', enabled: true, source: code }]));

    const cmdMsg = mockPostMessage.mock.calls.find((c) => c[0]?.type === 'commands');
    expect(cmdMsg![0].commands).toContainEqual(
      expect.objectContaining({ cmd: 'update_material', entityId: 'e1', emissive: [1, 0.5, 0, 2.0] })
    );
  });

  // ─── Audio Layer API ────────────────────────────────────────────

  it('forge.audio.addLayer and removeLayer push correct commands', async () => {
    const handler = await setupWorker();
    const code = `function onStart() {
      forge.audio.addLayer("e1", "music", "track1", { volume: 0.8, loop: true, bus: "music" });
      forge.audio.removeLayer("e1", "music");
      forge.audio.removeAllLayers("e1");
    }`;

    await handler(initMsg([{ entityId: 'e1', enabled: true, source: code }]));

    const cmdMsg = mockPostMessage.mock.calls.find((c) => c[0]?.type === 'commands');
    const cmds = cmdMsg![0].commands;
    expect(cmds).toContainEqual(expect.objectContaining({ cmd: 'audio_add_layer', entityId: 'e1', slotName: 'music', assetId: 'track1', volume: 0.8, loop: true, bus: 'music' }));
    expect(cmds).toContainEqual(expect.objectContaining({ cmd: 'audio_remove_layer', entityId: 'e1', slotName: 'music' }));
    expect(cmds).toContainEqual(expect.objectContaining({ cmd: 'audio_remove_all_layers', entityId: 'e1' }));
  });

  // ─── Audio Fade & Music API ─────────────────────────────────────

  it('forge.audio.fadeIn/fadeOut and setMusicIntensity push commands', async () => {
    const handler = await setupWorker();
    const code = `function onStart() {
      forge.audio.fadeIn("e1", 500);
      forge.audio.fadeOut("e1", 1000);
      forge.audio.setMusicIntensity(0.75);
      forge.audio.loadStems({ drums: "asset1", bass: "asset2" });
    }`;

    await handler(initMsg([{ entityId: 'e1', enabled: true, source: code }]));

    const cmdMsg = mockPostMessage.mock.calls.find((c) => c[0]?.type === 'commands');
    const cmds = cmdMsg![0].commands;
    expect(cmds).toContainEqual(expect.objectContaining({ cmd: 'audio_fade_in', entityId: 'e1', durationMs: 500 }));
    expect(cmds).toContainEqual(expect.objectContaining({ cmd: 'audio_fade_out', entityId: 'e1', durationMs: 1000 }));
    expect(cmds).toContainEqual(expect.objectContaining({ cmd: 'set_music_intensity', intensity: 0.75 }));
    expect(cmds).toContainEqual(expect.objectContaining({ cmd: 'set_music_stems', stems: { drums: 'asset1', bass: 'asset2' } }));
  });

  // ─── Audio Bus API ──────────────────────────────────────────────

  it('forge.audio bus control pushes commands and returns defaults', async () => {
    const handler = await setupWorker();
    const code = `function onStart() {
      forge.audio.setBusVolume("sfx", 0.5);
      forge.audio.muteBus("music", true);
      forge.log(forge.audio.getBusVolume("sfx").toString());
      forge.log(forge.audio.isBusMuted("music").toString());
    }`;

    await handler(initMsg([{ entityId: 'e1', enabled: true, source: code }]));

    const cmdMsg = mockPostMessage.mock.calls.find((c) => c[0]?.type === 'commands');
    expect(cmdMsg![0].commands).toContainEqual(expect.objectContaining({ cmd: 'update_audio_bus', busName: 'sfx', volume: 0.5 }));
    expect(cmdMsg![0].commands).toContainEqual(expect.objectContaining({ cmd: 'update_audio_bus', busName: 'music', muted: true }));
    // Worker always returns defaults since it can't query engine state
    expect(mockPostMessage).toHaveBeenCalledWith(expect.objectContaining({ type: 'log', message: '1' }));
    expect(mockPostMessage).toHaveBeenCalledWith(expect.objectContaining({ type: 'log', message: 'false' }));
  });

  // ─── Skeleton2d API ─────────────────────────────────────────────

  it('forge.skeleton2d pushes correct commands', async () => {
    const handler = await setupWorker();
    const code = `function onStart() {
      forge.skeleton2d.createSkeleton("e1");
      forge.skeleton2d.addBone("e1", "leg", "root", 0, -50, 0, 40);
      forge.skeleton2d.removeBone("e1", "leg");
      forge.skeleton2d.setSkin("e1", "warrior");
      forge.skeleton2d.playAnimation("e1", "walk");
    }`;

    await handler(initMsg([{ entityId: 'e1', enabled: true, source: code }]));

    const cmdMsg = mockPostMessage.mock.calls.find((c) => c[0]?.type === 'commands');
    const cmds = cmdMsg![0].commands;
    expect(cmds).toContainEqual(expect.objectContaining({ cmd: 'create_skeleton2d', entityId: 'e1' }));
    expect(cmds).toContainEqual(expect.objectContaining({ cmd: 'add_bone2d', entityId: 'e1', boneName: 'leg', parentBone: 'root' }));
    expect(cmds).toContainEqual(expect.objectContaining({ cmd: 'remove_bone2d', entityId: 'e1', boneName: 'leg' }));
    expect(cmds).toContainEqual(expect.objectContaining({ cmd: 'set_skeleton2d_skin', entityId: 'e1', skinName: 'warrior' }));
    expect(cmds).toContainEqual(expect.objectContaining({ cmd: 'play_skeletal_animation2d', entityId: 'e1', animationName: 'walk' }));
  });
});