'use client';

import { MousePointer2, Move, RotateCw, Scaling, Grid3X3, Globe, Box, Settings, MessageSquare, SlidersHorizontal, Plus, Minus, CircleDot, Merge } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useEditorStore } from '@/stores/editorStore';
import { useChatStore } from '@/stores/chatStore';
import { useWorkspaceStore } from '@/stores/workspaceStore';
import { AddEntityMenu, EntityType } from './AddEntityMenu';
import { SettingsPanel } from '../settings/SettingsPanel';

interface ToolButtonProps {
  icon: React.ReactNode;
  active?: boolean;
  onClick?: () => void;
  title?: string;
}

function ToolButton({ icon, active, onClick, title }: ToolButtonProps) {
  return (
    <button
      onClick={onClick}
      title={title}
      className={`flex h-10 w-10 items-center justify-center rounded-lg transition-colors ${
        active
          ? 'bg-zinc-800 text-white'
          : 'text-zinc-500 hover:bg-zinc-800 hover:text-zinc-300'
      }`}
    >
      {icon}
    </button>
  );
}

export function Sidebar() {
  const [showSettings, setShowSettings] = useState(false);
  const gizmoMode = useEditorStore((s) => s.gizmoMode);
  const setGizmoMode = useEditorStore((s) => s.setGizmoMode);
  const spawnEntity = useEditorStore((s) => s.spawnEntity);
  const deleteSelectedEntities = useEditorStore((s) => s.deleteSelectedEntities);
  const duplicateSelectedEntity = useEditorStore((s) => s.duplicateSelectedEntity);
  const primaryId = useEditorStore((s) => s.primaryId);
  const selectedIds = useEditorStore((s) => s.selectedIds);
  const undo = useEditorStore((s) => s.undo);
  const redo = useEditorStore((s) => s.redo);
  const toggleGrid = useEditorStore((s) => s.toggleGrid);
  const gridVisible = useEditorStore((s) => s.snapSettings.gridVisible);
  const setCameraPreset = useEditorStore((s) => s.setCameraPreset);
  const coordinateMode = useEditorStore((s) => s.coordinateMode);
  const toggleCoordinateMode = useEditorStore((s) => s.toggleCoordinateMode);
  const engineMode = useEditorStore((s) => s.engineMode);
  const play = useEditorStore((s) => s.play);
  const stop = useEditorStore((s) => s.stop);
  const openPanel = useWorkspaceStore((s) => s.openPanel);
  const rightPanelTab = useChatStore((s) => s.rightPanelTab);
  const setRightPanelTab = useChatStore((s) => s.setRightPanelTab);
  const chatOverlayOpen = useWorkspaceStore((s) => s.chatOverlayOpen);
  const toggleChatOverlay = useWorkspaceStore((s) => s.toggleChatOverlay);
  const csgUnion = useEditorStore((s) => s.csgUnion);
  const csgSubtract = useEditorStore((s) => s.csgSubtract);
  const csgIntersect = useEditorStore((s) => s.csgIntersect);
  const combineMeshes = useEditorStore((s) => s.combineMeshes);

  // Keyboard shortcuts for gizmo modes, delete, duplicate, undo, and redo
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Don't trigger if typing in an input
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) {
        return;
      }

      // Toggle Inspector/Chat panel: Ctrl+Shift+I
      if (e.key === 'I' && (e.ctrlKey || e.metaKey) && e.shiftKey) {
        e.preventDefault();
        setRightPanelTab(rightPanelTab === 'inspector' ? 'chat' : 'inspector');
        return;
      }

      // Play/Stop toggle: Ctrl+P
      if (e.key === 'p' && (e.ctrlKey || e.metaKey) && !e.shiftKey) {
        e.preventDefault();
        if (engineMode === 'edit') {
          play();
        } else {
          stop();
        }
        return;
      }

      // Undo: Ctrl+Z / Cmd+Z
      if (e.key === 'z' && (e.ctrlKey || e.metaKey) && !e.shiftKey) {
        e.preventDefault();
        undo();
        return;
      }

      // Redo: Ctrl+Shift+Z / Cmd+Shift+Z or Ctrl+Y
      if (
        (e.key === 'z' && (e.ctrlKey || e.metaKey) && e.shiftKey) ||
        (e.key === 'y' && e.ctrlKey)
      ) {
        e.preventDefault();
        redo();
        return;
      }

      // Delete selected entities
      if (e.key === 'Delete' || e.key === 'Backspace') {
        e.preventDefault();
        deleteSelectedEntities();
        return;
      }

      // Duplicate selected entity (Ctrl+D or Cmd+D)
      if (e.key === 'd' && (e.ctrlKey || e.metaKey)) {
        e.preventDefault();
        if (primaryId) {
          duplicateSelectedEntity();
        }
        return;
      }

      // Camera preset shortcuts (Alt+1/3/5/7)
      if (e.altKey && !e.ctrlKey && !e.metaKey) {
        switch (e.key) {
          case '7':
            e.preventDefault();
            setCameraPreset('top');
            return;
          case '1':
            e.preventDefault();
            setCameraPreset('front');
            return;
          case '3':
            e.preventDefault();
            setCameraPreset('right');
            return;
          case '5':
            e.preventDefault();
            setCameraPreset('perspective');
            return;
        }
      }

      switch (e.key.toLowerCase()) {
        case 'w':
          setGizmoMode('translate');
          break;
        case 'e':
          setGizmoMode('rotate');
          break;
        case 'r':
          setGizmoMode('scale');
          break;
        case 'g':
          e.preventDefault();
          toggleGrid();
          break;
        case 'x':
          e.preventDefault();
          toggleCoordinateMode();
          break;
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [setGizmoMode, deleteSelectedEntities, duplicateSelectedEntity, primaryId, undo, redo, toggleGrid, setCameraPreset, toggleCoordinateMode, rightPanelTab, setRightPanelTab, engineMode, play, stop]);

  const handleSpawnEntity = (type: EntityType) => {
    spawnEntity(type);
  };

  // Check if exactly 2 entities are selected for CSG operations
  const selectedArray = Array.from(selectedIds);
  const showCsgButtons = selectedArray.length === 2;
  // Show Combine button when 2 or more entities are selected
  const showCombineButton = selectedArray.length >= 2;

  return (
    <aside className="flex h-full w-14 flex-col items-center gap-1 border-r border-zinc-800 bg-zinc-900 py-3">
      {/* Add Entity Menu */}
      <AddEntityMenu onSpawn={handleSpawnEntity} />

      <div className="my-2 h-px w-8 bg-zinc-800" />

      {/* Selection tool (placeholder - always visible) */}
      <ToolButton
        icon={<MousePointer2 size={20} />}
        active={false}
        title="Select"
      />

      <div className="my-2 h-px w-8 bg-zinc-800" />

      {/* Gizmo mode buttons */}
      <ToolButton
        icon={<Move size={20} />}
        active={gizmoMode === 'translate'}
        onClick={() => setGizmoMode('translate')}
        title="Translate (W)"
      />
      <ToolButton
        icon={<RotateCw size={20} />}
        active={gizmoMode === 'rotate'}
        onClick={() => setGizmoMode('rotate')}
        title="Rotate (E)"
      />
      <ToolButton
        icon={<Scaling size={20} />}
        active={gizmoMode === 'scale'}
        onClick={() => setGizmoMode('scale')}
        title="Scale (R)"
      />

      <div className="my-2 h-px w-8 bg-zinc-800" />

      {/* Coordinate Mode Toggle */}
      <ToolButton
        icon={coordinateMode === 'local' ? <Box size={20} /> : <Globe size={20} />}
        active={coordinateMode === 'local'}
        onClick={toggleCoordinateMode}
        title={coordinateMode === 'local' ? 'Local Coordinates (X)' : 'World Coordinates (X)'}
      />

      <div className="my-2 h-px w-8 bg-zinc-800" />

      <ToolButton
        icon={<Grid3X3 size={20} />}
        active={gridVisible}
        onClick={toggleGrid}
        title="Toggle Grid (G)"
      />

      {/* CSG Boolean Operations (only visible when 2 entities selected) */}
      {showCsgButtons && (
        <>
          <div className="my-2 h-px w-8 bg-zinc-800" />
          <ToolButton
            icon={<Plus size={20} />}
            onClick={() => csgUnion(selectedArray[0], selectedArray[1])}
            title="CSG Union"
          />
          <ToolButton
            icon={<Minus size={20} />}
            onClick={() => csgSubtract(selectedArray[0], selectedArray[1])}
            title="CSG Subtract (A - B)"
          />
          <ToolButton
            icon={<CircleDot size={20} />}
            onClick={() => csgIntersect(selectedArray[0], selectedArray[1])}
            title="CSG Intersect"
          />
        </>
      )}

      {/* Combine Meshes (only visible when 2+ entities selected) */}
      {showCombineButton && (
        <>
          <div className="my-2 h-px w-8 bg-zinc-800" />
          <ToolButton
            icon={<Merge size={20} />}
            onClick={() => combineMeshes(selectedArray)}
            title="Combine Meshes"
          />
        </>
      )}

      {/* Spacer to push bottom tools */}
      <div className="flex-1" />

      {/* Audio Mixer toggle */}
      <ToolButton
        icon={<SlidersHorizontal size={20} />}
        onClick={() => openPanel('audio-mixer')}
        title="Audio Mixer"
      />

      {/* AI Chat toggle */}
      <ToolButton
        icon={<MessageSquare size={20} />}
        active={chatOverlayOpen}
        onClick={toggleChatOverlay}
        title="AI Chat (Ctrl+K)"
      />

      {/* Settings */}
      <ToolButton
        icon={<Settings size={20} />}
        onClick={() => setShowSettings(true)}
        title="Settings"
      />
      {showSettings && <SettingsPanel onClose={() => setShowSettings(false)} />}
    </aside>
  );
}
