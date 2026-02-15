'use client';

import { useRef, useEffect, useCallback, useState, memo, useMemo } from 'react';
import { Play, Pause, Square, ZoomIn, ZoomOut, Circle } from 'lucide-react';
import { useEditorStore } from '@/stores/editorStore';

const PROPERTY_TARGETS = [
  { value: 'position_x', label: 'Position X', group: 'Transform', color: '#3b82f6' },
  { value: 'position_y', label: 'Position Y', group: 'Transform', color: '#3b82f6' },
  { value: 'position_z', label: 'Position Z', group: 'Transform', color: '#3b82f6' },
  { value: 'rotation_x', label: 'Rotation X', group: 'Transform', color: '#10b981' },
  { value: 'rotation_y', label: 'Rotation Y', group: 'Transform', color: '#10b981' },
  { value: 'rotation_z', label: 'Rotation Z', group: 'Transform', color: '#10b981' },
  { value: 'scale_x', label: 'Scale X', group: 'Transform', color: '#ef4444' },
  { value: 'scale_y', label: 'Scale Y', group: 'Transform', color: '#ef4444' },
  { value: 'scale_z', label: 'Scale Z', group: 'Transform', color: '#ef4444' },
  { value: 'material_base_color_r', label: 'Base Color R', group: 'Material', color: '#f59e0b' },
  { value: 'material_base_color_g', label: 'Base Color G', group: 'Material', color: '#f59e0b' },
  { value: 'material_base_color_b', label: 'Base Color B', group: 'Material', color: '#f59e0b' },
  { value: 'material_base_color_a', label: 'Base Color A', group: 'Material', color: '#f59e0b' },
  { value: 'material_emissive_r', label: 'Emissive R', group: 'Material', color: '#f59e0b' },
  { value: 'material_emissive_g', label: 'Emissive G', group: 'Material', color: '#f59e0b' },
  { value: 'material_emissive_b', label: 'Emissive B', group: 'Material', color: '#f59e0b' },
  { value: 'material_metallic', label: 'Metallic', group: 'Material', color: '#f59e0b' },
  { value: 'material_roughness', label: 'Roughness', group: 'Material', color: '#f59e0b' },
  { value: 'material_opacity', label: 'Opacity', group: 'Material', color: '#f59e0b' },
  { value: 'light_intensity', label: 'Intensity', group: 'Light', color: '#8b5cf6' },
  { value: 'light_color_r', label: 'Color R', group: 'Light', color: '#8b5cf6' },
  { value: 'light_color_g', label: 'Color G', group: 'Light', color: '#8b5cf6' },
  { value: 'light_color_b', label: 'Color B', group: 'Light', color: '#8b5cf6' },
  { value: 'light_range', label: 'Range', group: 'Light', color: '#8b5cf6' },
];

const TRACK_HEIGHT = 32;
const RULER_HEIGHT = 30;
const FPS = 60;
const FRAME_DURATION = 1 / FPS;

interface TimelineViewState {
  zoom: number; // 0.1 to 100
  offsetSeconds: number;
  selectedKeyframes: Set<string>; // "target:time"
  playheadTime: number;
  isPlaying: boolean;
  recordingEnabled: boolean;
}

function timeToPixels(time: number, zoom: number, pixelsPerSecond: number): number {
  return time * pixelsPerSecond * zoom;
}

function pixelsToTime(pixels: number, zoom: number, pixelsPerSecond: number): number {
  return pixels / (pixelsPerSecond * zoom);
}

function snapToFrame(time: number): number {
  return Math.round(time / FRAME_DURATION) * FRAME_DURATION;
}

export const TimelinePanel = memo(function TimelinePanel() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [viewState, setViewState] = useState<TimelineViewState>({
    zoom: 1.0,
    offsetSeconds: 0,
    selectedKeyframes: new Set(),
    playheadTime: 0,
    isPlaying: false,
    recordingEnabled: false,
  });
  const [isDraggingPlayhead, setIsDraggingPlayhead] = useState(false);
  const [isDraggingKeyframe, setIsDraggingKeyframe] = useState(false);
  const [dragStartX, setDragStartX] = useState(0);
  const [dragStartTime, setDragStartTime] = useState(0);

  const primaryId = useEditorStore((s) => s.primaryId);
  const primaryAnimationClip = useEditorStore((s) => s.primaryAnimationClip);
  const primaryName = useEditorStore((s) => s.primaryName);
  const updateClipKeyframe = useEditorStore((s) => s.updateClipKeyframe);
  const setClipProperty = useEditorStore((s) => s.setClipProperty);

  const pixelsPerSecond = 100; // Base scale: 100px = 1 second at 1x zoom

  // Compute track list from animation clip
  const tracks = useMemo(() => primaryAnimationClip?.tracks || [], [primaryAnimationClip?.tracks]);

  // Helper functions for drawing
  const drawTimeRuler = useCallback(
    (ctx: CanvasRenderingContext2D, width: number, zoom: number, offsetSeconds: number, pps: number) => {
      ctx.fillStyle = '#09090b'; // zinc-950
      ctx.fillRect(0, 0, width, RULER_HEIGHT);

      ctx.strokeStyle = '#3f3f46'; // zinc-700
      ctx.fillStyle = '#a1a1aa'; // zinc-400
      ctx.font = '10px sans-serif';

      const tickInterval = zoom > 5 ? 0.1 : zoom > 1 ? 0.5 : 1.0; // Adaptive tick spacing
      const startTime = Math.floor(offsetSeconds / tickInterval) * tickInterval;
      const endTime = offsetSeconds + width / (pps * zoom);

      for (let t = startTime; t <= endTime; t += tickInterval) {
        const x = timeToPixels(t - offsetSeconds, zoom, pps);
        if (x < 0 || x > width) continue;

        const isMajor = Math.abs(t % 1.0) < 0.001;
        ctx.beginPath();
        ctx.moveTo(x, RULER_HEIGHT - (isMajor ? 10 : 5));
        ctx.lineTo(x, RULER_HEIGHT);
        ctx.stroke();

        if (isMajor) {
          ctx.fillText(`${t.toFixed(1)}s`, x + 2, RULER_HEIGHT - 12);
        }
      }
    },
    []
  );

  const drawKeyframeDiamond = useCallback(
    (ctx: CanvasRenderingContext2D, x: number, y: number, color: string, selected: boolean) => {
      const size = 6;
      ctx.fillStyle = color;
      ctx.strokeStyle = selected ? '#ffffff' : color;
      ctx.lineWidth = selected ? 2 : 1;

      ctx.beginPath();
      ctx.moveTo(x, y - size);
      ctx.lineTo(x + size, y);
      ctx.lineTo(x, y + size);
      ctx.lineTo(x - size, y);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
    },
    []
  );

  // Render timeline
  const renderTimeline = useCallback(() => {
    const canvas = canvasRef.current;
    const container = containerRef.current;
    if (!canvas || !container) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const width = container.clientWidth;
    const height = container.clientHeight;

    // Set canvas size with device pixel ratio
    const dpr = window.devicePixelRatio || 1;
    canvas.width = width * dpr;
    canvas.height = height * dpr;
    canvas.style.width = `${width}px`;
    canvas.style.height = `${height}px`;
    ctx.scale(dpr, dpr);

    // Clear
    ctx.fillStyle = '#18181b'; // zinc-900
    ctx.fillRect(0, 0, width, height);

    // Draw time ruler
    drawTimeRuler(ctx, width, viewState.zoom, viewState.offsetSeconds, pixelsPerSecond);

    // Draw playhead
    const playheadX = timeToPixels(viewState.playheadTime - viewState.offsetSeconds, viewState.zoom, pixelsPerSecond);
    if (playheadX >= 0 && playheadX <= width) {
      ctx.strokeStyle = viewState.recordingEnabled ? '#ef4444' : '#dc2626'; // red
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(playheadX, 0);
      ctx.lineTo(playheadX, height);
      ctx.stroke();

      // Playhead handle at top
      ctx.fillStyle = viewState.recordingEnabled ? '#ef4444' : '#dc2626';
      ctx.beginPath();
      ctx.arc(playheadX, 15, 6, 0, Math.PI * 2);
      ctx.fill();
    }

    // Draw tracks and keyframes
    let yOffset = RULER_HEIGHT;
    for (const track of tracks) {
      const trackInfo = PROPERTY_TARGETS.find((t) => t.value === track.target);
      const trackColor = trackInfo?.color || '#9ca3af';

      // Draw track background
      ctx.fillStyle = '#27272a'; // zinc-800
      ctx.fillRect(0, yOffset, width, TRACK_HEIGHT);

      // Draw keyframes
      for (const keyframe of track.keyframes) {
        const kfX = timeToPixels(keyframe.time - viewState.offsetSeconds, viewState.zoom, pixelsPerSecond);
        if (kfX >= 0 && kfX <= width) {
          const isSelected = viewState.selectedKeyframes.has(`${track.target}:${keyframe.time}`);
          drawKeyframeDiamond(ctx, kfX, yOffset + TRACK_HEIGHT / 2, trackColor, isSelected);
        }
      }

      yOffset += TRACK_HEIGHT;
    }
  }, [viewState, tracks, pixelsPerSecond, drawTimeRuler, drawKeyframeDiamond]);

  // Render on state change
  useEffect(() => {
    renderTimeline();
  }, [renderTimeline]);

  // Sync playhead with clip currentTime using useState prev-value pattern
  const [prevCurrentTime, setPrevCurrentTime] = useState<number | null>(null);
  if (primaryAnimationClip && primaryAnimationClip.currentTime !== prevCurrentTime) {
    setPrevCurrentTime(primaryAnimationClip.currentTime);
    setViewState((prev) => ({ ...prev, playheadTime: primaryAnimationClip.currentTime }));
  }

  // Sync playing state using useState prev-value pattern
  const [prevPlaying, setPrevPlaying] = useState<boolean | null>(null);
  if (primaryAnimationClip && primaryAnimationClip.playing !== prevPlaying) {
    setPrevPlaying(primaryAnimationClip.playing);
    setViewState((prev) => ({ ...prev, isPlaying: primaryAnimationClip.playing }));
  }

  // Playback loop
  useEffect(() => {
    if (!viewState.isPlaying || !primaryId || !primaryAnimationClip) return;

    const interval = setInterval(() => {
      const newTime = viewState.playheadTime + FRAME_DURATION * primaryAnimationClip.speed;
      const clampedTime = Math.min(newTime, primaryAnimationClip.duration);

      setViewState((prev) => ({ ...prev, playheadTime: clampedTime }));

      // Update clip in store (this will trigger evaluation)
      if (primaryAnimationClip) {
        setClipProperty(primaryId, undefined, undefined, undefined, undefined);
      }

      // Stop at end if mode is 'once'
      if (clampedTime >= primaryAnimationClip.duration && primaryAnimationClip.playMode === 'once') {
        setViewState((prev) => ({ ...prev, isPlaying: false }));
      }
    }, FRAME_DURATION * 1000);

    return () => clearInterval(interval);
  }, [viewState.isPlaying, viewState.playheadTime, primaryId, primaryAnimationClip, setClipProperty]);

  // Mouse handlers
  const handleMouseDown = useCallback(
    (e: React.MouseEvent<HTMLCanvasElement>) => {
      const canvas = canvasRef.current;
      if (!canvas) return;

      const rect = canvas.getBoundingClientRect();
      const x = e.clientX - rect.left;
      const y = e.clientY - rect.top;

      // Check if clicking playhead handle
      const playheadX = timeToPixels(viewState.playheadTime - viewState.offsetSeconds, viewState.zoom, pixelsPerSecond);
      if (Math.abs(x - playheadX) < 10 && y < RULER_HEIGHT) {
        setIsDraggingPlayhead(true);
        return;
      }

      // Check if clicking ruler (jump playhead)
      if (y < RULER_HEIGHT) {
        const time = pixelsToTime(x, viewState.zoom, pixelsPerSecond) + viewState.offsetSeconds;
        setViewState((prev) => ({ ...prev, playheadTime: Math.max(0, time) }));
        return;
      }

      // Check if clicking keyframe
      let yOffset = RULER_HEIGHT;
      for (const track of tracks) {
        if (y >= yOffset && y < yOffset + TRACK_HEIGHT) {
          for (const keyframe of track.keyframes) {
            const kfX = timeToPixels(keyframe.time - viewState.offsetSeconds, viewState.zoom, pixelsPerSecond);
            if (Math.abs(x - kfX) < 8) {
              // Select keyframe
              const key = `${track.target}:${keyframe.time}`;
              if (e.shiftKey) {
                setViewState((prev) => {
                  const newSet = new Set(prev.selectedKeyframes);
                  if (newSet.has(key)) {
                    newSet.delete(key);
                  } else {
                    newSet.add(key);
                  }
                  return { ...prev, selectedKeyframes: newSet };
                });
              } else {
                setViewState((prev) => ({ ...prev, selectedKeyframes: new Set([key]) }));
              }

              // Start dragging
              setIsDraggingKeyframe(true);
              setDragStartX(x);
              setDragStartTime(keyframe.time);
              return;
            }
          }
        }
        yOffset += TRACK_HEIGHT;
      }
    },
    [viewState, tracks, pixelsPerSecond]
  );

  const handleMouseMove = useCallback(
    (e: React.MouseEvent<HTMLCanvasElement>) => {
      const canvas = canvasRef.current;
      if (!canvas) return;

      const rect = canvas.getBoundingClientRect();
      const x = e.clientX - rect.left;

      if (isDraggingPlayhead) {
        const time = pixelsToTime(x, viewState.zoom, pixelsPerSecond) + viewState.offsetSeconds;
        setViewState((prev) => ({ ...prev, playheadTime: Math.max(0, time) }));
      } else if (isDraggingKeyframe && primaryId) {
        // Calculate time delta
        const deltaPixels = x - dragStartX;
        const deltaTime = pixelsToTime(deltaPixels, viewState.zoom, pixelsPerSecond);
        const newTime = e.shiftKey ? snapToFrame(dragStartTime + deltaTime) : dragStartTime + deltaTime;

        // Update all selected keyframes (for now, just update the one being dragged)
        // In a full implementation, we'd batch update all selected keyframes
        const [firstKey] = Array.from(viewState.selectedKeyframes);
        if (firstKey) {
          const [target, oldTimeStr] = firstKey.split(':');
          const oldTime = parseFloat(oldTimeStr);
          if (newTime !== oldTime && newTime >= 0) {
            updateClipKeyframe(primaryId, target, oldTime, undefined, undefined, newTime);
          }
        }
      }
    },
    [isDraggingPlayhead, isDraggingKeyframe, viewState, dragStartX, dragStartTime, pixelsPerSecond, primaryId, updateClipKeyframe]
  );

  const handleMouseUp = useCallback(() => {
    setIsDraggingPlayhead(false);
    setIsDraggingKeyframe(false);
  }, []);

  const handleWheel = useCallback((e: React.WheelEvent<HTMLCanvasElement>) => {
    e.preventDefault();
    const delta = e.deltaY > 0 ? 0.9 : 1.1;
    setViewState((prev) => ({
      ...prev,
      zoom: Math.max(0.1, Math.min(100, prev.zoom * delta)),
    }));
  }, []);

  // Playback controls
  const handlePlayPause = useCallback(() => {
    if (!primaryId || !primaryAnimationClip) return;
    const newPlaying = !viewState.isPlaying;
    setViewState((prev) => ({ ...prev, isPlaying: newPlaying }));
    setClipProperty(primaryId, undefined, undefined, undefined, undefined);
  }, [primaryId, primaryAnimationClip, viewState.isPlaying, setClipProperty]);

  const handleStop = useCallback(() => {
    setViewState((prev) => ({ ...prev, isPlaying: false, playheadTime: 0 }));
  }, []);

  const handleZoomIn = useCallback(() => {
    setViewState((prev) => ({ ...prev, zoom: Math.min(100, prev.zoom * 1.5) }));
  }, []);

  const handleZoomOut = useCallback(() => {
    setViewState((prev) => ({ ...prev, zoom: Math.max(0.1, prev.zoom / 1.5) }));
  }, []);

  const toggleRecording = useCallback(() => {
    setViewState((prev) => ({ ...prev, recordingEnabled: !prev.recordingEnabled }));
  }, []);

  if (!primaryId || !primaryAnimationClip) {
    return (
      <div className="flex h-full items-center justify-center bg-zinc-900 text-sm text-zinc-500">
        Select an entity with an animation clip to view timeline
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col bg-zinc-900">
      {/* Header */}
      <div className="flex items-center gap-2 border-b border-zinc-800 px-3 py-2">
        <button
          onClick={handlePlayPause}
          className="flex items-center gap-1.5 rounded bg-zinc-800 px-2 py-1 text-xs text-zinc-300 hover:bg-zinc-700 transition-colors"
          title={viewState.isPlaying ? 'Pause' : 'Play'}
        >
          {viewState.isPlaying ? <Pause className="h-3.5 w-3.5" /> : <Play className="h-3.5 w-3.5" />}
        </button>
        <button
          onClick={handleStop}
          className="flex items-center gap-1.5 rounded bg-zinc-800 px-2 py-1 text-xs text-zinc-300 hover:bg-zinc-700 transition-colors"
          title="Stop"
        >
          <Square className="h-3.5 w-3.5" />
        </button>
        <div className="mx-2 h-4 w-px bg-zinc-700" />
        <button
          onClick={toggleRecording}
          className={`flex items-center gap-1.5 rounded px-2 py-1 text-xs transition-colors ${
            viewState.recordingEnabled
              ? 'bg-red-900/50 text-red-300 hover:bg-red-900/70'
              : 'bg-zinc-800 text-zinc-300 hover:bg-zinc-700'
          }`}
          title="Toggle Recording"
        >
          <Circle className={`h-3.5 w-3.5 ${viewState.recordingEnabled ? 'fill-red-400' : ''}`} />
          {viewState.recordingEnabled && 'Recording'}
        </button>
        <div className="mx-2 h-4 w-px bg-zinc-700" />
        <span className="text-xs text-zinc-500">
          {primaryName} | {viewState.playheadTime.toFixed(2)}s / {primaryAnimationClip.duration.toFixed(2)}s
        </span>
        <div className="flex-1" />
        <button
          onClick={handleZoomOut}
          className="rounded bg-zinc-800 p-1 text-zinc-300 hover:bg-zinc-700 transition-colors"
          title="Zoom Out"
        >
          <ZoomOut className="h-3.5 w-3.5" />
        </button>
        <span className="text-xs text-zinc-500">{viewState.zoom.toFixed(1)}x</span>
        <button
          onClick={handleZoomIn}
          className="rounded bg-zinc-800 p-1 text-zinc-300 hover:bg-zinc-700 transition-colors"
          title="Zoom In"
        >
          <ZoomIn className="h-3.5 w-3.5" />
        </button>
      </div>

      {/* Track list (left) */}
      <div className="flex flex-1 overflow-hidden">
        <div className="w-48 border-r border-zinc-800 bg-zinc-900">
          <div
            className="h-[30px] border-b border-zinc-800 bg-zinc-950 px-2 text-[10px] font-medium text-zinc-500 flex items-center"
          >
            PROPERTY
          </div>
          <div className="overflow-y-auto" style={{ height: `calc(100% - ${RULER_HEIGHT}px)` }}>
            {tracks.map((track) => {
              const trackInfo = PROPERTY_TARGETS.find((t) => t.value === track.target);
              const label = trackInfo?.label || track.target;
              const color = trackInfo?.color || '#9ca3af';

              return (
                <div
                  key={track.target}
                  className="flex items-center gap-2 border-b border-zinc-800 px-2"
                  style={{ height: `${TRACK_HEIGHT}px` }}
                >
                  <div className="h-2 w-2 rounded-full" style={{ backgroundColor: color }} />
                  <span className="text-xs text-zinc-300">{label}</span>
                  <span className="ml-auto text-[10px] text-zinc-600">{track.keyframes.length}</span>
                </div>
              );
            })}
          </div>
        </div>

        {/* Canvas (right) */}
        <div ref={containerRef} className="flex-1 overflow-hidden">
          <canvas
            ref={canvasRef}
            className="cursor-crosshair"
            onMouseDown={handleMouseDown}
            onMouseMove={handleMouseMove}
            onMouseUp={handleMouseUp}
            onMouseLeave={handleMouseUp}
            onWheel={handleWheel}
          />
        </div>
      </div>
    </div>
  );
});
