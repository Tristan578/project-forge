/**
 * Capture invalidation signals, independent of the editor store and recorder.
 * A listener latches the first change: editing and then undoing must not make
 * a mixed-workload capture appear stable again. Runtime script/physics ticks
 * do not pass through the authoring dispatcher.
 */
const listeners = new Set<() => void>();

/** Observe authoring, scene replacement and engine lifecycle changes. */
export function onCaptureWorkloadChange(listener: () => void): () => void {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

/** Notify before a capture can publish a report for an obsolete workload. */
export function notifyCaptureWorkloadChange(): void {
  for (const listener of [...listeners]) listener();
}

const READ_ONLY_COMMANDS = new Set([
  'export_scene', 'export_scene_json', 'validate_scene',
  'list_assets', 'list_scene_assets', 'list_script_templates', 'list_shaders',
  'list_joints', 'list_animations', 'list_game_component_types',
]);

/** Accepted authoring commands invalidate, except known side-effect-free reads. */
export function observeCaptureCommand(command: string): void {
  if (/^(get_|query_)/.test(command) || READ_ONLY_COMMANDS.has(command)) return;
  notifyCaptureWorkloadChange();
}
