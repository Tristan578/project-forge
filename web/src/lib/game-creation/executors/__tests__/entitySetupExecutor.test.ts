import { describe, it, expect, vi } from 'vitest';
import { entitySetupExecutor } from '../entitySetupExecutor';
import type { ExecutorContext } from '../../types';

function makeCtx(overrides?: Partial<ExecutorContext>): ExecutorContext {
  return {
    dispatchCommand: vi.fn(),
    store: { sceneGraph: { nodes: {} } } as never,
    projectType: '3d',
    userTier: 'creator',
    signal: new AbortController().signal,
    resolveStepOutput: vi.fn(),
    ...overrides,
  };
}

describe('entitySetupExecutor', () => {
  it('has correct name and error message', () => {
    expect(entitySetupExecutor.name).toBe('entity_setup');
    expect(entitySetupExecutor.userFacingErrorMessage).toContain('Could not create an entity');
  });

  it('spawns a capsule for player role in 3D', async () => {
    const ctx = makeCtx();
    const result = await entitySetupExecutor.execute({
      entity: { name: 'Hero', role: 'player' },
      scene: 'MainScene',
      projectType: '3d',
    }, ctx);

    expect(result.success).toBe(true);
    expect(result.output).toEqual({
      entityName: 'Hero',
      role: 'player',
      entityType: 'capsule',
    });
    expect(ctx.dispatchCommand).toHaveBeenCalledWith('switch_scene', { sceneId: 'MainScene' });
    expect(ctx.dispatchCommand).toHaveBeenCalledWith('spawn_entity', { entityType: 'capsule', name: 'Hero' });
  });

  it('spawns a sphere for projectile role in 3D', async () => {
    const ctx = makeCtx();
    const result = await entitySetupExecutor.execute({
      entity: { name: 'Bullet', role: 'projectile' },
      scene: 'Level1',
      projectType: '3d',
    }, ctx);

    expect(result.success).toBe(true);
    expect(result.output?.entityType).toBe('sphere');
  });

  it('spawns a cube for enemy role in 3D', async () => {
    const ctx = makeCtx();
    const result = await entitySetupExecutor.execute({
      entity: { name: 'Goblin', role: 'enemy' },
      scene: 'Level1',
      projectType: '3d',
    }, ctx);

    expect(result.success).toBe(true);
    expect(result.output?.entityType).toBe('cube');
  });

  it('always spawns a plane for 2D projects regardless of role', async () => {
    const ctx = makeCtx();
    const result = await entitySetupExecutor.execute({
      entity: { name: 'Player', role: 'player' },
      scene: 'Scene1',
      projectType: '2d',
    }, ctx);

    expect(result.success).toBe(true);
    expect(result.output?.entityType).toBe('plane');
  });

  it('uses dispatchCommandBatch when available', async () => {
    const batch = vi.fn().mockReturnValue({ success: true });
    const ctx = makeCtx({ dispatchCommandBatch: batch });

    const result = await entitySetupExecutor.execute({
      entity: { name: 'Deco', role: 'decoration' },
      scene: 'S1',
      projectType: '3d',
    }, ctx);

    expect(result.success).toBe(true);
    expect(batch).toHaveBeenCalledWith([
      { command: 'switch_scene', payload: { sceneId: 'S1' } },
      { command: 'spawn_entity', payload: { entityType: 'cube', name: 'Deco' } },
    ]);
    expect(ctx.dispatchCommand).not.toHaveBeenCalled();
  });

  it('returns failure when batch command fails', async () => {
    const batch = vi.fn().mockReturnValue({ success: false });
    const ctx = makeCtx({ dispatchCommandBatch: batch });

    const result = await entitySetupExecutor.execute({
      entity: { name: 'NPC', role: 'npc' },
      scene: 'S1',
      projectType: '3d',
    }, ctx);

    expect(result.success).toBe(false);
    expect(result.error?.code).toBe('COMMAND_FAILED');
  });

  it('rejects missing entity name', async () => {
    const ctx = makeCtx();
    const result = await entitySetupExecutor.execute({
      entity: { name: '', role: 'player' },
      scene: 'S1',
      projectType: '3d',
    }, ctx);

    expect(result.success).toBe(false);
    expect(result.error?.code).toBe('INVALID_INPUT');
  });

  it('rejects invalid role', async () => {
    const ctx = makeCtx();
    const result = await entitySetupExecutor.execute({
      entity: { name: 'Test', role: 'boss' },
      scene: 'S1',
      projectType: '3d',
    }, ctx);

    expect(result.success).toBe(false);
    expect(result.error?.code).toBe('INVALID_INPUT');
  });

  it('rejects missing scene', async () => {
    const ctx = makeCtx();
    const result = await entitySetupExecutor.execute({
      entity: { name: 'Test', role: 'player' },
      scene: '',
      projectType: '3d',
    }, ctx);

    expect(result.success).toBe(false);
    expect(result.error?.code).toBe('INVALID_INPUT');
  });

  it('rejects missing projectType', async () => {
    const ctx = makeCtx();
    const result = await entitySetupExecutor.execute({
      entity: { name: 'Test', role: 'player' },
      scene: 'S1',
    }, ctx);

    expect(result.success).toBe(false);
    expect(result.error?.code).toBe('INVALID_INPUT');
  });

  it('handles all role-to-entity-type mappings', async () => {
    const mappings: Record<string, string> = {
      player: 'capsule',
      enemy: 'cube',
      npc: 'cube',
      decoration: 'cube',
      trigger: 'cube',
      interactable: 'cube',
      projectile: 'sphere',
    };

    for (const [role, expectedType] of Object.entries(mappings)) {
      const ctx = makeCtx();
      const result = await entitySetupExecutor.execute({
        entity: { name: `${role}_entity`, role },
        scene: 'S1',
        projectType: '3d',
      }, ctx);

      expect(result.success).toBe(true);
      expect(result.output?.entityType).toBe(expectedType);
    }
  });

  it('clamps entity name to 200 characters', async () => {
    const ctx = makeCtx();
    const result = await entitySetupExecutor.execute({
      entity: { name: 'A'.repeat(201), role: 'player' },
      scene: 'S1',
      projectType: '3d',
    }, ctx);

    expect(result.success).toBe(false);
    expect(result.error?.code).toBe('INVALID_INPUT');
  });
});
