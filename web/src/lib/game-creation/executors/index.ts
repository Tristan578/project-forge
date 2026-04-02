import type { ExecutorName, ExecutorDefinition } from '../types';
import { sceneCreateExecutor } from './sceneCreateExecutor';
import { physicsProfileExecutor } from './physicsProfileExecutor';
import { characterSetupExecutor } from './characterSetupExecutor';
import { entitySetupExecutor } from './entitySetupExecutor';
import { assetGenerateExecutor } from './assetGenerateExecutor';
import { customScriptExecutor } from './customScriptExecutor';
import { verifyExecutor } from './verifyExecutor';
import { autoPolishExecutor } from './autoPolishExecutor';
import { planPresentExecutor } from './planPresentExecutor';

export const EXECUTOR_REGISTRY = new Map<ExecutorName, ExecutorDefinition>([
  [planPresentExecutor.name, planPresentExecutor],
  [sceneCreateExecutor.name, sceneCreateExecutor],
  [physicsProfileExecutor.name, physicsProfileExecutor],
  [characterSetupExecutor.name, characterSetupExecutor],
  [entitySetupExecutor.name, entitySetupExecutor],
  [assetGenerateExecutor.name, assetGenerateExecutor],
  [customScriptExecutor.name, customScriptExecutor],
  [verifyExecutor.name, verifyExecutor],
  [autoPolishExecutor.name, autoPolishExecutor],
]);

export function registerExecutor(def: ExecutorDefinition): void {
  EXECUTOR_REGISTRY.set(def.name, def);
}
