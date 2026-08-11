import { describe, it, expect } from 'vitest';
import { EXECUTOR_REGISTRY, registerExecutor } from '../index';

describe('EXECUTOR_REGISTRY', () => {
  it('contains all 10 built-in executors', () => {
    // Full-set equality, not per-name `has()` plus a size count: an executor
    // registered under an unexpected name satisfies both of those and is
    // invisible. A new executor belongs here explicitly — the registry entry is
    // one of three wiring points (`ExecutorName`, this map, `PLAN_COST_ESTIMATES`)
    // and a step naming an unregistered executor fails at run time.
    expect([...EXECUTOR_REGISTRY.keys()]).toEqual([
      'plan_present',
      'scene_create',
      'physics_profile',
      'camera_setup',
      'character_setup',
      'entity_setup',
      'asset_generate',
      'custom_script_generate',
      'verify_all_scenes',
      'auto_polish',
    ]);
  });

  it('each executor has name, inputSchema, execute, and userFacingErrorMessage', () => {
    for (const [name, def] of EXECUTOR_REGISTRY) {
      expect(def.name).toBe(name);
      expect(def.inputSchema).toBeDefined();
      expect(typeof def.execute).toBe('function');
      expect(typeof def.userFacingErrorMessage).toBe('string');
      expect(def.userFacingErrorMessage.length).toBeGreaterThan(0);
    }
  });
});

describe('registerExecutor', () => {
  it('adds a custom executor to the registry', () => {
    const testName = '_test_executor' as never;

    registerExecutor({
      name: testName,
      inputSchema: {} as never,
      execute: async () => ({ success: true }),
      userFacingErrorMessage: 'Test failed.',
    });

    expect(EXECUTOR_REGISTRY.has(testName)).toBe(true);

    // Clean up
    EXECUTOR_REGISTRY.delete(testName);
  });
});
