import type { ExecutorName, ExecutorDefinition } from '../types';
import { sceneCreateExecutor } from './sceneCreateExecutor';
import { physicsEnableExecutor } from './physicsEnableExecutor';
import { physicsProfileExecutor } from './physicsProfileExecutor';
import { cameraSetupExecutor } from './cameraSetupExecutor';
import { characterSetupExecutor } from './characterSetupExecutor';
import { gameComponentExecutor } from './gameComponentExecutor';
import { behaviorScriptExecutor } from './behaviorScriptExecutor';
import { entitySetupExecutor } from './entitySetupExecutor';
import { worldBuildExecutor } from './worldBuildExecutor';
import { assetGenerateExecutor } from './assetGenerateExecutor';
import { customScriptExecutor } from './customScriptExecutor';
import { verifyExecutor } from './verifyExecutor';
import { autoPolishExecutor } from './autoPolishExecutor';
import { planPresentExecutor } from './planPresentExecutor';

export const EXECUTOR_REGISTRY = new Map<ExecutorName, ExecutorDefinition>([
  [planPresentExecutor.name, planPresentExecutor],
  [sceneCreateExecutor.name, sceneCreateExecutor],
  [physicsEnableExecutor.name, physicsEnableExecutor],
  [physicsProfileExecutor.name, physicsProfileExecutor],
  [cameraSetupExecutor.name, cameraSetupExecutor],
  [characterSetupExecutor.name, characterSetupExecutor],
  [gameComponentExecutor.name, gameComponentExecutor],
  [behaviorScriptExecutor.name, behaviorScriptExecutor],
  [entitySetupExecutor.name, entitySetupExecutor],
  [worldBuildExecutor.name, worldBuildExecutor],
  [assetGenerateExecutor.name, assetGenerateExecutor],
  [customScriptExecutor.name, customScriptExecutor],
  [verifyExecutor.name, verifyExecutor],
  [autoPolishExecutor.name, autoPolishExecutor],
]);

export function registerExecutor(def: ExecutorDefinition): void {
  EXECUTOR_REGISTRY.set(def.name, def);
}
