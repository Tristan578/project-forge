import { describe, it, expect } from 'vitest';
import { EXECUTOR_REGISTRY, registerExecutor } from '../index';

describe('EXECUTOR_REGISTRY', () => {
  it('contains all 9 built-in executors', () => {
    const expected = [
      'plan_present',
      'scene_create',
      'physics_profile',
      'character_setup',
      'entity_setup',
      'asset_generate',
      'custom_script_generate',
      'verify_all_scenes',
      'auto_polish',
    ];

    for (const name of expected) {
      expect(EXECUTOR_REGISTRY.has(name as never)).toBe(true);
    }
    expect(EXECUTOR_REGISTRY.size).toBe(9);
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
