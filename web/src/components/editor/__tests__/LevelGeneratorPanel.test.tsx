/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup, waitFor } from '@/test/utils/componentTestUtils';
import { LevelGeneratorPanel } from '../LevelGeneratorPanel';
import { getCommandDispatcher } from '@/stores/editorStore';
import { levelToCommands } from '@/lib/ai/levelGenerator';

const mockDispatch = vi.fn();

vi.mock('@/stores/editorStore', () => ({
  useEditorStore: vi.fn(() => ({})),
  getCommandDispatcher: vi.fn(),
}));

const MOCK_LAYOUT = {
  name: 'Test Layout',
  theme: 'dungeon',
  rooms: [
    {
      id: 'r1',
      name: 'Start',
      type: 'start' as const,
      width: 10,
      height: 10,
      position: { x: 0, y: 0 },
      entities: [],
      connections: [],
    },
  ],
  startRoom: 'r1',
  exitRoom: 'r1',
  difficulty: 5,
  estimatedPlaytime: '5 min',
};

const MOCK_COMMANDS = [
  { command: 'spawn_entity', payload: { entityType: 'cube', name: 'Root', position: [0, 0, 0] } },
  { command: 'spawn_entity', payload: { entityType: 'plane', name: 'Start Floor', position: [0, 0, 0] } },
];

vi.mock('@/lib/ai/levelGenerator', () => ({
  LEVEL_TEMPLATES: {
    linear: {
      name: 'Linear',
      description: 'A linear level',
      generate: () => ({
        name: 'Test Layout',
        theme: 'dungeon',
        rooms: [{ id: 'r1', name: 'Start', type: 'start', width: 10, height: 10, position: { x: 0, y: 0 }, entities: [], connections: [] }],
        startRoom: 'r1',
        exitRoom: 'r1',
        difficulty: 5,
        estimatedPlaytime: '5 min',
      }),
    },
  },
  validateLayout: vi.fn(() => []),
  generateLevel: vi.fn().mockResolvedValue({
    name: 'Test Layout',
    theme: 'dungeon',
    rooms: [{ id: 'r1', name: 'Start', type: 'start', width: 10, height: 10, position: { x: 0, y: 0 }, entities: [], connections: [] }],
    startRoom: 'r1',
    exitRoom: 'r1',
    difficulty: 5,
    estimatedPlaytime: '5 min',
  }),
  applyConstraints: vi.fn((l: unknown) => l),
  levelToCommands: vi.fn(() => [
    { command: 'spawn_entity', payload: { entityType: 'cube', name: 'Root', position: [0, 0, 0] } },
    { command: 'spawn_entity', payload: { entityType: 'plane', name: 'Start Floor', position: [0, 0, 0] } },
  ]),
}));

describe('LevelGeneratorPanel', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(getCommandDispatcher).mockReturnValue(mockDispatch);
  });

  afterEach(() => {
    cleanup();
  });

  it('renders without crashing', () => {
    const { container } = render(<LevelGeneratorPanel />);
    expect(container.firstChild).not.toBeNull();
  });

  // Regression: #7096 — applyToScene must use levelToCommands to dispatch all
  // commands synchronously rather than reading primaryId from store after async
  // spawnEntity calls (race condition).
  it('applies layout to scene using levelToCommands batch dispatch (regression #7096)', async () => {
    render(<LevelGeneratorPanel />);

    // Select a template to get a layout
    const templateBtn = screen.getByRole('button', { name: /use linear template/i });
    fireEvent.click(templateBtn);

    // Click Apply to Scene
    const applyBtn = await screen.findByRole('button', { name: /apply generated level to scene/i });
    fireEvent.click(applyBtn);

    await waitFor(() => {
      // levelToCommands should have been called — not reading primaryId from store
      expect(vi.mocked(levelToCommands)).toHaveBeenCalledWith(MOCK_LAYOUT);
      // All commands dispatched synchronously without async gaps
      expect(mockDispatch).toHaveBeenCalledTimes(MOCK_COMMANDS.length);
      expect(mockDispatch).toHaveBeenCalledWith(
        MOCK_COMMANDS[0].command,
        MOCK_COMMANDS[0].payload,
      );
    });
  });
});
