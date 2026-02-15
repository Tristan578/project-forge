'use client';

import { useEditorStore } from '@/stores/editorStore';

export function SpriteAnimationInspector() {
  const primaryId = useEditorStore((s) => s.primaryId);
  const spriteSheets = useEditorStore((s) => s.spriteSheets);
  const spriteAnimators = useEditorStore((s) => s.spriteAnimators);
  const animationStateMachines = useEditorStore((s) => s.animationStateMachines);

  if (!primaryId) return null;

  const spriteSheet = spriteSheets[primaryId];
  const animator = spriteAnimators[primaryId];
  const stateMachine = animationStateMachines[primaryId];

  if (!spriteSheet && !animator && !stateMachine) return null;

  const clipNames = spriteSheet ? Object.keys(spriteSheet.clips) : [];

  const handlePlayClip = (clipName: string) => {
    // TODO: Implement command dispatch when Rust engine is ready
    console.log('Play clip:', clipName);
  };

  const handleStop = () => {
    // TODO: Implement command dispatch when Rust engine is ready
    console.log('Stop animation');
  };

  const handleSpeedChange = (speed: number) => {
    // TODO: Implement command dispatch when Rust engine is ready
    console.log('Set speed:', speed);
  };

  const handleSetAnimParam = (paramName: string, value: number | boolean) => {
    // TODO: Implement command dispatch when Rust engine is ready
    console.log('Set param:', paramName, value);
  };

  return (
    <div className="space-y-4">
      {/* Sprite Sheet Info */}
      {spriteSheet && (
        <div className="space-y-2">
          <h3 className="text-sm font-semibold text-white">Sprite Sheet</h3>
          <div className="space-y-1 text-xs text-gray-300">
            <div>Asset: {spriteSheet.assetId}</div>
            <div>Frames: {spriteSheet.frames.length}</div>
            <div>
              Mode: {spriteSheet.sliceMode.type === 'grid'
                ? `Grid (${spriteSheet.sliceMode.columns}x${spriteSheet.sliceMode.rows})`
                : 'Manual'}
            </div>
            <div>Clips: {Object.keys(spriteSheet.clips).length}</div>
          </div>
        </div>
      )}

      {/* Animation Clips */}
      {spriteSheet && clipNames.length > 0 && (
        <div className="space-y-2">
          <h3 className="text-sm font-semibold text-white">Animation Clips</h3>
          <div className="space-y-1">
            {clipNames.map((clipName) => {
              const clip = spriteSheet.clips[clipName];
              return (
                <div
                  key={clipName}
                  className="flex items-center justify-between rounded bg-gray-700/50 px-2 py-1.5"
                >
                  <div className="flex flex-col">
                    <span className="text-xs font-medium text-white">{clipName}</span>
                    <span className="text-xs text-gray-400">
                      {clip.frames.length} frames
                      {clip.looping && ' • Loop'}
                      {clip.pingPong && ' • Ping-Pong'}
                    </span>
                  </div>
                  <button
                    onClick={() => handlePlayClip(clipName)}
                    className="rounded bg-blue-600 px-2 py-1 text-xs text-white hover:bg-blue-700"
                  >
                    Play
                  </button>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Playback Controls */}
      {animator && (
        <div className="space-y-2">
          <h3 className="text-sm font-semibold text-white">Playback</h3>
          <div className="space-y-2">
            <div>
              <label className="mb-1 block text-xs text-gray-300">Current Clip</label>
              <select
                value={animator.currentClip ?? ''}
                onChange={(e) => handlePlayClip(e.target.value)}
                className="w-full rounded bg-gray-700 px-2 py-1 text-xs text-white"
              >
                <option value="">None</option>
                {clipNames.map((name) => (
                  <option key={name} value={name}>
                    {name}
                  </option>
                ))}
              </select>
            </div>
            <div className="flex items-center gap-2">
              <button
                onClick={() => handlePlayClip(animator.currentClip ?? '')}
                disabled={!animator.currentClip}
                className="rounded bg-green-600 px-3 py-1 text-xs text-white hover:bg-green-700 disabled:opacity-50"
              >
                Play
              </button>
              <button
                onClick={handleStop}
                className="rounded bg-red-600 px-3 py-1 text-xs text-white hover:bg-red-700"
              >
                Stop
              </button>
            </div>
            <div>
              <label className="mb-1 block text-xs text-gray-300">
                Speed: {animator.speed.toFixed(2)}x
              </label>
              <input
                type="range"
                min="0.1"
                max="3.0"
                step="0.1"
                value={animator.speed}
                onChange={(e) => handleSpeedChange(parseFloat(e.target.value))}
                className="w-full"
              />
            </div>
            <div className="text-xs text-gray-400">
              Frame: {animator.frameIndex} {animator.playing ? '(Playing)' : '(Stopped)'}
            </div>
          </div>
        </div>
      )}

      {/* State Machine */}
      {stateMachine && (
        <div className="space-y-2">
          <h3 className="text-sm font-semibold text-white">State Machine</h3>
          <div className="space-y-2">
            <div className="text-xs text-gray-300">
              Current State: <span className="font-medium text-white">{stateMachine.currentState}</span>
            </div>

            {/* States */}
            <div>
              <h4 className="mb-1 text-xs font-medium text-gray-300">States</h4>
              <div className="space-y-1">
                {Object.entries(stateMachine.states).map(([stateName, clipName]) => (
                  <div key={stateName} className="flex items-center justify-between rounded bg-gray-700/50 px-2 py-1 text-xs">
                    <span className="text-white">{stateName}</span>
                    <span className="text-gray-400">{clipName}</span>
                  </div>
                ))}
              </div>
            </div>

            {/* Transitions */}
            {stateMachine.transitions.length > 0 && (
              <div>
                <h4 className="mb-1 text-xs font-medium text-gray-300">Transitions</h4>
                <div className="space-y-1">
                  {stateMachine.transitions.map((transition, i) => (
                    <div key={i} className="rounded bg-gray-700/50 px-2 py-1 text-xs text-gray-400">
                      {transition.fromState} → {transition.toState}
                      {transition.condition.type === 'always' && ' (Always)'}
                      {transition.condition.type === 'paramBool' && ` (${transition.condition.name} = ${transition.condition.value})`}
                      {transition.condition.type === 'paramFloat' && ` (${transition.condition.name} ${transition.condition.op} ${transition.condition.threshold})`}
                      {transition.condition.type === 'paramTrigger' && ` (Trigger: ${transition.condition.name})`}
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Parameters */}
            {Object.keys(stateMachine.parameters).length > 0 && (
              <div>
                <h4 className="mb-1 text-xs font-medium text-gray-300">Parameters</h4>
                <div className="space-y-1">
                  {Object.entries(stateMachine.parameters).map(([paramName, param]) => (
                    <div key={paramName} className="flex items-center justify-between rounded bg-gray-700/50 px-2 py-1">
                      <span className="text-xs text-white">{paramName}</span>
                      {param.type === 'bool' && (
                        <input
                          type="checkbox"
                          checked={param.value}
                          onChange={(e) => handleSetAnimParam(paramName, e.target.checked)}
                          className="h-4 w-4"
                        />
                      )}
                      {param.type === 'float' && (
                        <input
                          type="number"
                          value={param.value}
                          onChange={(e) => handleSetAnimParam(paramName, parseFloat(e.target.value))}
                          step="0.1"
                          className="w-20 rounded bg-gray-600 px-2 py-1 text-xs text-white"
                        />
                      )}
                      {param.type === 'trigger' && (
                        <button
                          onClick={() => handleSetAnimParam(paramName, true)}
                          className="rounded bg-blue-600 px-2 py-1 text-xs text-white hover:bg-blue-700"
                        >
                          Trigger
                        </button>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
