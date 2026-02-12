'use client';

import { useState, useRef, useCallback } from 'react';
import { Copy, ClipboardPaste } from 'lucide-react';
import { useEditorStore } from '@/stores/editorStore';
import { useChatStore } from '@/stores/chatStore';
import { Vec3Input } from './Vec3Input';
import { LightInspector } from './LightInspector';
import { MaterialInspector } from './MaterialInspector';
import { SceneSettings } from './SceneSettings';
import { InputBindingsPanel } from './InputBindingsPanel';
import { PhysicsInspector } from './PhysicsInspector';
import { AudioInspector } from './AudioInspector';
import { ParticleInspector } from './ParticleInspector';
import {
  copyTransformProperty,
  copyFullTransform,
  getPropertyFromClipboard,
  readTransformFromClipboard,
} from '@/lib/transformClipboard';

// Convert radians to degrees
function radToDeg(rad: number): number {
  return (rad * 180) / Math.PI;
}

// Convert degrees to radians
function degToRad(deg: number): number {
  return (deg * Math.PI) / 180;
}

export function InspectorPanel() {
  const primaryId = useEditorStore((s) => s.primaryId);
  const primaryName = useEditorStore((s) => s.primaryName);
  const primaryTransform = useEditorStore((s) => s.primaryTransform);
  const primaryLight = useEditorStore((s) => s.primaryLight);
  const updateTransform = useEditorStore((s) => s.updateTransform);
  const renameEntity = useEditorStore((s) => s.renameEntity);
  const allScripts = useEditorStore((s) => s.allScripts);
  const setRightPanelTab = useChatStore((s) => s.setRightPanelTab);
  const hasScript = primaryId ? !!allScripts[primaryId] : false;

  const [localName, setLocalName] = useState(primaryName ?? '');
  const [trackedPrimaryId, setTrackedPrimaryId] = useState(primaryId);
  const nameInputRef = useRef<HTMLInputElement>(null);

  // Reset local name when selection changes (avoiding useEffect with setState)
  if (primaryId !== trackedPrimaryId) {
    setTrackedPrimaryId(primaryId);
    setLocalName(primaryName ?? '');
  }

  const handleNameBlur = () => {
    if (primaryId && localName !== primaryName) {
      renameEntity(primaryId, localName);
    }
  };

  const handleNameKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      nameInputRef.current?.blur();
    } else if (e.key === 'Escape') {
      setLocalName(primaryName ?? '');
      nameInputRef.current?.blur();
    }
  };

  const handlePositionChange = useCallback(
    (value: [number, number, number]) => {
      if (primaryId) {
        updateTransform(primaryId, 'position', value);
      }
    },
    [primaryId, updateTransform]
  );

  const handleRotationChange = useCallback(
    (valueDeg: [number, number, number]) => {
      if (primaryId) {
        // Convert from degrees to radians before sending
        const valueRad: [number, number, number] = [
          degToRad(valueDeg[0]),
          degToRad(valueDeg[1]),
          degToRad(valueDeg[2]),
        ];
        updateTransform(primaryId, 'rotation', valueRad);
      }
    },
    [primaryId, updateTransform]
  );

  const handleScaleChange = useCallback(
    (value: [number, number, number]) => {
      if (primaryId) {
        updateTransform(primaryId, 'scale', value);
      }
    },
    [primaryId, updateTransform]
  );

  // Copy handlers
  const handleCopyPosition = useCallback(() => {
    if (primaryTransform) {
      copyTransformProperty('position', primaryTransform.position);
    }
  }, [primaryTransform]);

  const handleCopyRotation = useCallback(() => {
    if (primaryTransform) {
      const rotationDeg: [number, number, number] = [
        radToDeg(primaryTransform.rotation[0]),
        radToDeg(primaryTransform.rotation[1]),
        radToDeg(primaryTransform.rotation[2]),
      ];
      copyTransformProperty('rotation', rotationDeg);
    }
  }, [primaryTransform]);

  const handleCopyScale = useCallback(() => {
    if (primaryTransform) {
      copyTransformProperty('scale', primaryTransform.scale);
    }
  }, [primaryTransform]);

  const handleCopyAll = useCallback(() => {
    if (primaryTransform) {
      const rotationDeg: [number, number, number] = [
        radToDeg(primaryTransform.rotation[0]),
        radToDeg(primaryTransform.rotation[1]),
        radToDeg(primaryTransform.rotation[2]),
      ];
      copyFullTransform(primaryTransform.position, rotationDeg, primaryTransform.scale);
    }
  }, [primaryTransform]);

  // Paste handlers
  const handlePastePosition = useCallback(async () => {
    const value = await getPropertyFromClipboard('position');
    if (value) {
      handlePositionChange(value);
    }
  }, [handlePositionChange]);

  const handlePasteRotation = useCallback(async () => {
    const value = await getPropertyFromClipboard('rotation');
    if (value) {
      handleRotationChange(value);
    }
  }, [handleRotationChange]);

  const handlePasteScale = useCallback(async () => {
    const value = await getPropertyFromClipboard('scale');
    if (value) {
      handleScaleChange(value);
    }
  }, [handleScaleChange]);

  const handlePasteAll = useCallback(async () => {
    const data = await readTransformFromClipboard();
    if (!data) return;

    if (data.position) {
      handlePositionChange(data.position);
    }
    if (data.rotation) {
      handleRotationChange(data.rotation);
    }
    if (data.scale) {
      handleScaleChange(data.scale);
    }
  }, [handlePositionChange, handleRotationChange, handleScaleChange]);

  // No selection — show Scene Settings
  if (!primaryId) {
    return (
      <div className="flex h-full flex-col bg-zinc-900 p-4 overflow-y-auto">
        <h2 className="mb-4 text-sm font-semibold text-zinc-300">Scene Settings</h2>
        <SceneSettings />
        <InputBindingsPanel />
      </div>
    );
  }

  // Get rotation in degrees for display
  const rotationDeg: [number, number, number] = primaryTransform
    ? [
        radToDeg(primaryTransform.rotation[0]),
        radToDeg(primaryTransform.rotation[1]),
        radToDeg(primaryTransform.rotation[2]),
      ]
    : [0, 0, 0];

  const buttonClass = `
    p-1 rounded transition-opacity duration-150
    text-zinc-400 hover:text-zinc-200 hover:bg-zinc-700
    opacity-60 hover:opacity-100
  `;

  return (
    <div className="flex h-full flex-col bg-zinc-900 p-4 overflow-y-auto">
      <h2 className="mb-4 text-sm font-semibold text-zinc-300">Inspector</h2>

      {/* Name field */}
      <div className="mb-4">
        <label className="mb-1 block text-xs font-medium text-zinc-400">
          Name
        </label>
        <input
          ref={nameInputRef}
          type="text"
          value={localName}
          onChange={(e) => setLocalName(e.target.value)}
          onBlur={handleNameBlur}
          onKeyDown={handleNameKeyDown}
          className="w-full rounded bg-zinc-800 px-2 py-1.5 text-sm text-zinc-200 outline-none
            focus:ring-1 focus:ring-blue-500"
        />
      </div>

      {/* Transform section */}
      {primaryTransform && (
        <div className="space-y-4">
          <div className="border-t border-zinc-800 pt-4">
            {/* Transform header with Copy All / Paste All */}
            <div className="mb-3 flex items-center justify-between">
              <h3 className="text-xs font-semibold uppercase tracking-wide text-zinc-500">
                Transform
              </h3>
              <div className="flex items-center gap-1">
                <button
                  type="button"
                  onClick={handleCopyAll}
                  title="Copy transform"
                  className={buttonClass}
                >
                  <Copy className="w-3.5 h-3.5" />
                </button>
                <button
                  type="button"
                  onClick={handlePasteAll}
                  title="Paste transform"
                  className={buttonClass}
                >
                  <ClipboardPaste className="w-3.5 h-3.5" />
                </button>
              </div>
            </div>

            <div className="space-y-3">
              <Vec3Input
                label="Position"
                value={primaryTransform.position}
                onChange={handlePositionChange}
                onReset={() => handlePositionChange([0, 0, 0])}
                defaultValue={[0, 0, 0]}
                onCopy={handleCopyPosition}
                onPaste={handlePastePosition}
                step={0.1}
                precision={3}
              />

              <Vec3Input
                label="Rotation"
                value={rotationDeg}
                onChange={handleRotationChange}
                onReset={() => handleRotationChange([0, 0, 0])}
                defaultValue={[0, 0, 0]}
                onCopy={handleCopyRotation}
                onPaste={handlePasteRotation}
                step={1}
                precision={1}
              />

              <Vec3Input
                label="Scale"
                value={primaryTransform.scale}
                onChange={handleScaleChange}
                onReset={() => handleScaleChange([1, 1, 1])}
                defaultValue={[1, 1, 1]}
                onCopy={handleCopyScale}
                onPaste={handlePasteScale}
                step={0.1}
                precision={3}
                min={0.001}
              />
            </div>
          </div>
        </div>
      )}

      {/* Light section (only for light entities) */}
      {primaryLight && <LightInspector />}

      {/* Material section (only for mesh entities — mutually exclusive with light) */}
      {!primaryLight && <MaterialInspector />}

      {/* Physics section (for all entities) */}
      <PhysicsInspector />

      {/* Audio section (for all entities) */}
      <AudioInspector />

      {/* Particle section (for all entities) */}
      <ParticleInspector />

      {/* Script section */}
      <div className="border-t border-zinc-800 pt-4 mt-4">
        <div className="flex items-center justify-between">
          <h3 className="text-xs font-semibold uppercase tracking-wide text-zinc-500">Script</h3>
          {hasScript && (
            <span className="rounded bg-green-900/30 px-1.5 py-0.5 text-[10px] text-green-400">
              Active
            </span>
          )}
        </div>
        <button
          onClick={() => setRightPanelTab('script')}
          className="mt-2 w-full rounded bg-zinc-800 px-2 py-1.5 text-xs text-zinc-400 hover:bg-zinc-700 hover:text-zinc-300"
        >
          {hasScript ? 'Edit Script' : 'Add Script'}
        </button>
      </div>

      {/* Show loading state if we have selection but no transform yet */}
      {!primaryTransform && (
        <p className="text-xs text-zinc-500">Loading transform...</p>
      )}

      {/* Input bindings section */}
      <InputBindingsPanel />
    </div>
  );
}
