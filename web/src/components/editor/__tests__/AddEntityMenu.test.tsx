import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@/test/utils/componentTestUtils';
import { AddEntityMenu } from '../AddEntityMenu';
import { useEditorStore } from '@/stores/editorStore';

vi.mock('@/stores/editorStore', () => ({
  useEditorStore: vi.fn(() => ({})),
}));

describe('AddEntityMenu', () => {
  const mockSpawnEntity = vi.fn();
  const mockSetGizmoMode = vi.fn();
  const mockSetCoordinateMode = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    vi.mocked(useEditorStore).mockImplementation((selector: any) => {
      const state = {
        spawnEntity: mockSpawnEntity,
        setGizmoMode: mockSetGizmoMode,
        setCoordinateMode: mockSetCoordinateMode,
        gizmoMode: 'translate',
        coordinateMode: 'world',
        selection: { selectedIds: [] },
      };
      return selector(state);
    });
  });

  afterEach(() => {
    cleanup();
  });

  it('renders correctly', () => {
    render(<AddEntityMenu onSpawn={mockSpawnEntity} />);
    expect(screen.getByRole('button', { name: /Add Entity/i })).toBeDefined();
  });

  it('opens menu when clicked', async () => {
    render(<AddEntityMenu onSpawn={mockSpawnEntity} />);
    const buttons = screen.getAllByRole('button', { name: /Add Entity/i });
    fireEvent.click(buttons[0]);

    // Should show Meshes and other groups (using findBy to wait for render)
    expect(await screen.findByText('Meshes')).toBeDefined();
    expect(screen.getAllByText('Cube').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Sphere').length).toBeGreaterThan(0);
  });

  it('spawns entity when menu item is clicked', async () => {
    render(<AddEntityMenu onSpawn={mockSpawnEntity} />);
    const buttons = screen.getAllByRole('button', { name: /Add Entity/i });
    fireEvent.click(buttons[0]);
    
    const cubeOption = (await screen.findAllByText('Cube'))[0];
    fireEvent.click(cubeOption);

    expect(mockSpawnEntity).toHaveBeenCalledWith('cube');
  });
});
