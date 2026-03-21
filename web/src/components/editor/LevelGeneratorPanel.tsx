'use client';

import { useState, useCallback, useMemo } from 'react';
import { Map, Sparkles, Play, RotateCcw } from 'lucide-react';
import {
  LEVEL_TEMPLATES,
  validateLayout,
  generateLevel,
  applyConstraints,
  levelToCommands,
  type LevelLayout,
  type LevelConstraint,
  type TemplateId,
  type RoomType,
} from '@/lib/ai/levelGenerator';
import { getCommandDispatcher } from '@/stores/editorStore';

// ===== Room type colors for minimap =====

const ROOM_COLORS: Record<RoomType, string> = {
  start: '#22c55e',
  combat: '#ef4444',
  puzzle: '#3b82f6',
  treasure: '#eab308',
  boss: '#a855f7',
  corridor: '#71717a',
  hub: '#06b6d4',
};

// ===== Minimap Component =====

function LevelMinimap({ layout }: { layout: LevelLayout }) {
  const rooms = layout.rooms;
  if (rooms.length === 0) return null;

  // Calculate bounds
  const minX = Math.min(...rooms.map((r) => r.position.x - r.width / 2));
  const maxX = Math.max(...rooms.map((r) => r.position.x + r.width / 2));
  const minY = Math.min(...rooms.map((r) => r.position.y - r.height / 2));
  const maxY = Math.max(...rooms.map((r) => r.position.y + r.height / 2));

  const padding = 10;
  const viewBox = `${minX - padding} ${minY - padding} ${maxX - minX + padding * 2} ${maxY - minY + padding * 2}`;

  return (
    <svg
      viewBox={viewBox}
      className="w-full h-40 bg-zinc-950 rounded border border-zinc-700"
      aria-label={`Level minimap: ${layout.name}`}
    >
      {/* Connection lines */}
      {rooms.map((room) =>
        room.connections
          .filter((connId) => connId > room.id)
          .map((connId) => {
            const target = rooms.find((r) => r.id === connId);
            if (!target) return null;
            return (
              <line
                key={`${room.id}-${connId}`}
                x1={room.position.x}
                y1={room.position.y}
                x2={target.position.x}
                y2={target.position.y}
                stroke="#525252"
                strokeWidth={2}
                strokeDasharray="4,2"
              />
            );
          }),
      )}
      {/* Room rectangles */}
      {rooms.map((room) => (
        <g key={room.id}>
          <rect
            x={room.position.x - room.width / 2}
            y={room.position.y - room.height / 2}
            width={room.width}
            height={room.height}
            fill={ROOM_COLORS[room.type]}
            fillOpacity={0.3}
            stroke={ROOM_COLORS[room.type]}
            strokeWidth={1.5}
            rx={1}
          />
          <text
            x={room.position.x}
            y={room.position.y}
            textAnchor="middle"
            dominantBaseline="central"
            fill="white"
            fontSize={Math.max(3, Math.min(5, room.width / 3))}
            className="select-none"
          >
            {room.name.length > 10 ? room.name.slice(0, 8) + '..' : room.name}
          </text>
        </g>
      ))}
    </svg>
  );
}

// ===== Room List =====

function RoomList({ layout }: { layout: LevelLayout }) {
  return (
    <div className="space-y-1 max-h-40 overflow-y-auto">
      {layout.rooms.map((room) => (
        <div
          key={room.id}
          className="flex items-center justify-between px-2 py-1 rounded bg-zinc-800 text-xs"
        >
          <div className="flex items-center gap-2">
            <span
              className="w-2 h-2 rounded-full"
              style={{ backgroundColor: ROOM_COLORS[room.type] }}
            />
            <span className="text-zinc-200">{room.name}</span>
          </div>
          <span className="text-zinc-400">{room.entities.length} entities</span>
        </div>
      ))}
    </div>
  );
}

// ===== Main Panel =====

export function LevelGeneratorPanel() {
  const [description, setDescription] = useState('');
  const [layout, setLayout] = useState<LevelLayout | null>(null);
  const [generating, setGenerating] = useState(false);
  const [errors, setErrors] = useState<string[]>([]);
  const [roomCount, setRoomCount] = useState(5);
  const [enemyDensity, setEnemyDensity] = useState(0.5);
  const [difficulty, setDifficulty] = useState(5);

  const templateEntries = useMemo(
    () => Object.entries(LEVEL_TEMPLATES) as Array<[TemplateId, (typeof LEVEL_TEMPLATES)[TemplateId]]>,
    [],
  );

  const handleGenerate = useCallback(async () => {
    if (!description.trim()) return;
    setGenerating(true);
    setErrors([]);
    try {
      const constraints: LevelConstraint[] = [
        { type: 'room_count', value: roomCount },
        { type: 'enemy_density', value: enemyDensity },
      ];
      const result = await generateLevel(description, constraints);
      result.difficulty = difficulty;
      const validationErrors = validateLayout(result);
      if (validationErrors.length > 0) {
        setErrors(validationErrors);
      }
      setLayout(result);
    } catch (err) {
      setErrors([err instanceof Error ? err.message : 'Generation failed']);
    } finally {
      setGenerating(false);
    }
  }, [description, roomCount, enemyDensity, difficulty]);

  const handleTemplateSelect = useCallback(
    (templateId: TemplateId) => {
      let result = LEVEL_TEMPLATES[templateId].generate();
      const constraints: LevelConstraint[] = [
        { type: 'room_count', value: roomCount },
        { type: 'enemy_density', value: enemyDensity },
      ];
      result = applyConstraints(result, constraints);
      result.difficulty = difficulty;
      setLayout(result);
      setErrors([]);
      setDescription(result.name);
    },
    [roomCount, enemyDensity, difficulty],
  );

  const handleApplyToScene = useCallback(() => {
    if (!layout) return;
    const dispatch = getCommandDispatcher();
    if (!dispatch) return;

    // Use levelToCommands to generate all engine commands, then dispatch them
    // sequentially. This avoids the race condition of reading primaryId
    // synchronously after an async spawnEntity call.
    const commands = levelToCommands(layout);
    for (const cmd of commands) {
      dispatch(cmd.command, cmd.payload);
    }
  }, [layout]);

  const handleReset = useCallback(() => {
    setLayout(null);
    setErrors([]);
    setDescription('');
  }, []);

  return (
    <div className="flex flex-col h-full overflow-y-auto">
      <div className="space-y-3 p-3">
        {/* Header */}
        <div className="flex items-center gap-2">
          <Map className="w-4 h-4 text-cyan-400" />
          <h3 className="text-xs font-semibold uppercase text-zinc-400">
            Level Generator
          </h3>
        </div>

        {/* Description input */}
        <div>
          <label htmlFor="level-desc" className="block text-xs text-zinc-400 mb-1">
            Describe your level
          </label>
          <textarea
            id="level-desc"
            className="w-full rounded bg-zinc-800 border border-zinc-700 px-2 py-1.5 text-sm text-zinc-200 placeholder-zinc-500 focus:outline-none focus:ring-2 focus:ring-blue-500 resize-none"
            rows={3}
            placeholder="e.g. Underground cave with 3 rooms connected by tunnels, treasure in the deepest room"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
          />
        </div>

        {/* Constraint sliders */}
        <div className="space-y-2">
          <div>
            <label htmlFor="room-count" className="flex items-center justify-between text-xs text-zinc-400 mb-1">
              <span>Room Count</span>
              <span className="text-zinc-400">{roomCount}</span>
            </label>
            <input
              id="room-count"
              type="range"
              min={1}
              max={15}
              value={roomCount}
              onChange={(e) => setRoomCount(Number(e.target.value))}
              className="w-full accent-cyan-500"
            />
          </div>
          <div>
            <label htmlFor="enemy-density" className="flex items-center justify-between text-xs text-zinc-400 mb-1">
              <span>Enemy Density</span>
              <span className="text-zinc-400">{Math.round(enemyDensity * 100)}%</span>
            </label>
            <input
              id="enemy-density"
              type="range"
              min={0}
              max={100}
              value={Math.round(enemyDensity * 100)}
              onChange={(e) => setEnemyDensity(Number(e.target.value) / 100)}
              className="w-full accent-cyan-500"
            />
          </div>
          <div>
            <label htmlFor="difficulty" className="flex items-center justify-between text-xs text-zinc-400 mb-1">
              <span>Difficulty</span>
              <span className="text-zinc-400">{difficulty}/10</span>
            </label>
            <input
              id="difficulty"
              type="range"
              min={1}
              max={10}
              value={difficulty}
              onChange={(e) => setDifficulty(Number(e.target.value))}
              className="w-full accent-cyan-500"
            />
          </div>
        </div>

        {/* Generate button */}
        <button
          type="button"
          onClick={handleGenerate}
          disabled={generating || !description.trim()}
          className="w-full flex items-center justify-center gap-2 rounded bg-cyan-600 hover:bg-cyan-500 disabled:bg-zinc-700 disabled:text-zinc-400 px-3 py-2 text-sm font-medium text-white transition-colors duration-150"
          aria-label="Generate level from description"
        >
          <Sparkles className="w-4 h-4" />
          {generating ? 'Generating...' : 'Generate'}
        </button>

        {/* Template quick-start */}
        <div>
          <p className="text-xs text-zinc-400 mb-1.5">Quick Templates</p>
          <div className="flex flex-wrap gap-1.5">
            {templateEntries.map(([id, template]) => (
              <button
                key={id}
                type="button"
                onClick={() => handleTemplateSelect(id)}
                className="rounded bg-zinc-800 hover:bg-zinc-700 border border-zinc-700 px-2 py-1 text-xs text-zinc-300 transition-colors duration-150"
                title={template.description}
                aria-label={`Use ${template.name} template: ${template.description}`}
              >
                {template.name}
              </button>
            ))}
          </div>
        </div>

        {/* Errors */}
        {errors.length > 0 && (
          <div className="rounded bg-red-900/30 border border-red-800 p-2 text-xs text-red-300">
            <p className="font-semibold mb-1">Validation Issues:</p>
            <ul className="list-disc list-inside space-y-0.5">
              {errors.map((err, i) => (
                <li key={i}>{err}</li>
              ))}
            </ul>
          </div>
        )}

        {/* Generated layout preview */}
        {layout && (
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <p className="text-xs font-semibold text-zinc-300">{layout.name}</p>
              <span className="text-xs text-zinc-400">
                {layout.rooms.length} rooms | ~{layout.estimatedPlaytime}
              </span>
            </div>

            <LevelMinimap layout={layout} />
            <RoomList layout={layout} />

            <div className="flex gap-2">
              <button
                type="button"
                onClick={handleApplyToScene}
                className="flex-1 flex items-center justify-center gap-2 rounded bg-green-600 hover:bg-green-500 px-3 py-2 text-sm font-medium text-white transition-colors duration-150"
                aria-label="Apply generated level to scene"
              >
                <Play className="w-4 h-4" />
                Apply to Scene
              </button>
              <button
                type="button"
                onClick={handleReset}
                className="flex items-center justify-center gap-2 rounded bg-zinc-700 hover:bg-zinc-600 px-3 py-2 text-sm text-zinc-300 transition-colors duration-150"
                aria-label="Reset level generator"
              >
                <RotateCcw className="w-4 h-4" />
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
