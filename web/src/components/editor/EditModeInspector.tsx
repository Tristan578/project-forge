'use client';

/**
 * Inspector panel for polygon edit mode.
 */

import { useEditorStore } from '@/stores/editorStore';
import { X, Box, Circle, Square } from 'lucide-react';
import { useState } from 'react';

export function EditModeInspector() {
  const {
    editModeActive,
    editModeEntityId,
    selectionMode,
    selectedIndices,
    wireframeVisible,
    xrayMode,
    vertexCount,
    edgeCount,
    faceCount,
    exitEditMode,
    setSelectionMode,
    performMeshOperation,
    recalcNormals,
    toggleWireframe,
    toggleXray,
  } = useEditorStore();

  const [extrudeDistance, setExtrudeDistance] = useState(1.0);
  const [insetAmount, setInsetAmount] = useState(0.1);
  const [subdivideLevel, setSubdivideLevel] = useState(1);

  if (!editModeActive || !editModeEntityId) {
    return null;
  }

  const handleExtrude = () => {
    if (selectedIndices.length === 0) return;
    performMeshOperation('extrude', {
      indices: selectedIndices,
      distance: extrudeDistance,
      direction: [0, 1, 0],
    });
  };

  const handleInset = () => {
    if (selectedIndices.length === 0) return;
    performMeshOperation('inset', {
      indices: selectedIndices,
      amount: insetAmount,
    });
  };

  const handleSubdivide = () => {
    performMeshOperation('subdivide', {
      indices: selectedIndices,
      level: subdivideLevel,
    });
  };

  const handleDelete = () => {
    if (selectedIndices.length === 0) return;
    performMeshOperation('delete', {
      indices: selectedIndices,
      mode: selectionMode,
    });
  };

  return (
    <div className="space-y-3 border-t border-zinc-800 px-3 py-3">
      {/* Header */}
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-medium text-zinc-200">Edit Mode</h3>
        <button
          onClick={exitEditMode}
          className="flex h-7 items-center gap-1 rounded px-2 text-xs text-zinc-400 hover:bg-zinc-800 hover:text-zinc-200"
        >
          <X className="h-3 w-3" />
          Exit
        </button>
      </div>

      {/* Selection Mode */}
      <div className="space-y-2">
        <label className="block text-xs font-medium text-zinc-400">Selection Mode</label>
        <div className="flex gap-1">
          <button
            onClick={() => setSelectionMode('vertex')}
            className={`flex h-8 flex-1 items-center justify-center gap-1 rounded text-xs ${
              selectionMode === 'vertex'
                ? 'bg-blue-600 text-white'
                : 'bg-zinc-800 text-zinc-400 hover:bg-zinc-700'
            }`}
          >
            <Circle className="h-3 w-3" />
            Vertex
          </button>
          <button
            onClick={() => setSelectionMode('edge')}
            className={`flex h-8 flex-1 items-center justify-center gap-1 rounded text-xs ${
              selectionMode === 'edge'
                ? 'bg-blue-600 text-white'
                : 'bg-zinc-800 text-zinc-400 hover:bg-zinc-700'
            }`}
          >
            <Box className="h-3 w-3" />
            Edge
          </button>
          <button
            onClick={() => setSelectionMode('face')}
            className={`flex h-8 flex-1 items-center justify-center gap-1 rounded text-xs ${
              selectionMode === 'face'
                ? 'bg-blue-600 text-white'
                : 'bg-zinc-800 text-zinc-400 hover:bg-zinc-700'
            }`}
          >
            <Square className="h-3 w-3" />
            Face
          </button>
        </div>
      </div>

      {/* Mesh Stats */}
      <div className="rounded-md border border-zinc-800 bg-zinc-900/50 p-2 text-xs">
        <div className="grid grid-cols-3 gap-2 text-center">
          <div>
            <div className="text-zinc-500">Vertices</div>
            <div className="font-medium text-zinc-200">{vertexCount}</div>
          </div>
          <div>
            <div className="text-zinc-500">Edges</div>
            <div className="font-medium text-zinc-200">{edgeCount}</div>
          </div>
          <div>
            <div className="text-zinc-500">Faces</div>
            <div className="font-medium text-zinc-200">{faceCount}</div>
          </div>
        </div>
      </div>

      {/* Selected Count */}
      <div className="text-xs text-zinc-400">
        Selected: {selectedIndices.length} {selectionMode}
        {selectedIndices.length !== 1 ? 's' : ''}
      </div>

      {/* Operations */}
      <div className="space-y-2">
        <label className="block text-xs font-medium text-zinc-400">Operations</label>

        {/* Extrude */}
        <div className="space-y-1">
          <button
            onClick={handleExtrude}
            disabled={selectedIndices.length === 0}
            className="h-8 w-full rounded bg-blue-600 text-xs text-white hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-50"
          >
            Extrude
          </button>
          <input
            type="range"
            min="0.1"
            max="5"
            step="0.1"
            value={extrudeDistance}
            onChange={(e) => setExtrudeDistance(parseFloat(e.target.value))}
            className="w-full"
          />
          <div className="text-right text-xs text-zinc-500">Distance: {extrudeDistance.toFixed(1)}</div>
        </div>

        {/* Inset */}
        <div className="space-y-1">
          <button
            onClick={handleInset}
            disabled={selectedIndices.length === 0 || selectionMode !== 'face'}
            className="h-8 w-full rounded bg-blue-600 text-xs text-white hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-50"
          >
            Inset
          </button>
          <input
            type="range"
            min="0.01"
            max="1"
            step="0.01"
            value={insetAmount}
            onChange={(e) => setInsetAmount(parseFloat(e.target.value))}
            className="w-full"
          />
          <div className="text-right text-xs text-zinc-500">Amount: {insetAmount.toFixed(2)}</div>
        </div>

        {/* Subdivide */}
        <div className="space-y-1">
          <button
            onClick={handleSubdivide}
            className="h-8 w-full rounded bg-blue-600 text-xs text-white hover:bg-blue-700"
          >
            Subdivide
          </button>
          <input
            type="range"
            min="1"
            max="4"
            step="1"
            value={subdivideLevel}
            onChange={(e) => setSubdivideLevel(parseInt(e.target.value))}
            className="w-full"
          />
          <div className="text-right text-xs text-zinc-500">Level: {subdivideLevel}</div>
        </div>

        {/* Delete */}
        <button
          onClick={handleDelete}
          disabled={selectedIndices.length === 0}
          className="h-8 w-full rounded bg-red-600 text-xs text-white hover:bg-red-700 disabled:cursor-not-allowed disabled:opacity-50"
        >
          Delete Selected
        </button>
      </div>

      {/* Display Options */}
      <div className="space-y-2 border-t border-zinc-800 pt-2">
        <label className="block text-xs font-medium text-zinc-400">Display</label>
        <div className="flex gap-2">
          <button
            onClick={toggleWireframe}
            className={`h-8 flex-1 rounded text-xs ${
              wireframeVisible
                ? 'bg-blue-600 text-white'
                : 'bg-zinc-800 text-zinc-400 hover:bg-zinc-700'
            }`}
          >
            Wireframe
          </button>
          <button
            onClick={toggleXray}
            className={`h-8 flex-1 rounded text-xs ${
              xrayMode
                ? 'bg-blue-600 text-white'
                : 'bg-zinc-800 text-zinc-400 hover:bg-zinc-700'
            }`}
          >
            X-Ray
          </button>
        </div>
      </div>

      {/* Normals */}
      <div className="space-y-2 border-t border-zinc-800 pt-2">
        <label className="block text-xs font-medium text-zinc-400">Normals</label>
        <div className="flex gap-2">
          <button
            onClick={() => recalcNormals(true)}
            className="h-8 flex-1 rounded bg-zinc-800 text-xs text-zinc-400 hover:bg-zinc-700"
          >
            Smooth
          </button>
          <button
            onClick={() => recalcNormals(false)}
            className="h-8 flex-1 rounded bg-zinc-800 text-xs text-zinc-400 hover:bg-zinc-700"
          >
            Flat
          </button>
        </div>
      </div>
    </div>
  );
}
