import { describe, it, expect } from 'vitest';
import { ONBOARDING_TASKS, getTasksForProjectType } from '../onboardingTasks';

describe('onboardingTasks', () => {
  it('exports a non-empty list of tasks', () => {
    expect(ONBOARDING_TASKS.length).toBeGreaterThan(0);
  });

  it('every task has required fields', () => {
    for (const task of ONBOARDING_TASKS) {
      expect(task.id).not.toBeNull();
      expect(task.label).not.toBeNull();
      expect(task.description).not.toBeNull();
      expect(['basic', 'advanced']).toContain(task.category);
    }
  });

  describe('getTasksForProjectType', () => {
    it('filters out 2D-only tasks for 3D projects', () => {
      const tasks3d = getTasksForProjectType(ONBOARDING_TASKS, '3d');
      const has2dOnly = tasks3d.some((t) => t.projectType === '2d');
      expect(has2dOnly).toBe(false);
    });

    it('filters out 3D-only tasks for 2D projects', () => {
      const tasks2d = getTasksForProjectType(ONBOARDING_TASKS, '2d');
      const has3dOnly = tasks2d.some((t) => t.projectType === '3d');
      expect(has3dOnly).toBe(false);
    });

    it('includes shared tasks (no projectType) for both types', () => {
      const tasks3d = getTasksForProjectType(ONBOARDING_TASKS, '3d');
      const tasks2d = getTasksForProjectType(ONBOARDING_TASKS, '2d');

      const sharedTasks = ONBOARDING_TASKS.filter((t) => !t.projectType);
      for (const shared of sharedTasks) {
        expect(tasks3d.find((t) => t.id === shared.id)).not.toBeUndefined();
        expect(tasks2d.find((t) => t.id === shared.id)).not.toBeUndefined();
      }
    });

    it('3D tasks include create-entity but not create-sprite', () => {
      const tasks3d = getTasksForProjectType(ONBOARDING_TASKS, '3d');
      expect(tasks3d.find((t) => t.id === 'create-entity')).not.toBeUndefined();
      expect(tasks3d.find((t) => t.id === 'create-sprite')).toBeUndefined();
    });

    it('2D tasks include create-sprite but not create-entity', () => {
      const tasks2d = getTasksForProjectType(ONBOARDING_TASKS, '2d');
      expect(tasks2d.find((t) => t.id === 'create-sprite')).not.toBeUndefined();
      expect(tasks2d.find((t) => t.id === 'create-entity')).toBeUndefined();
    });

    it('2D tasks include create-tilemap but not add-particles', () => {
      const tasks2d = getTasksForProjectType(ONBOARDING_TASKS, '2d');
      expect(tasks2d.find((t) => t.id === 'create-tilemap')).not.toBeUndefined();
      expect(tasks2d.find((t) => t.id === 'add-particles')).toBeUndefined();
    });
  });
});
