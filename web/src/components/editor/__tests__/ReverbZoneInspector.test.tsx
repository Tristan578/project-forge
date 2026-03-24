/**
 * Render tests for ReverbZoneInspector component.
 *
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@/test/utils/componentTestUtils';
import { ReverbZoneInspector } from '../ReverbZoneInspector';
import { useEditorStore } from '@/stores/editorStore';
import { useWorkspaceStore } from '@/stores/workspaceStore';
import type { ReverbZoneData } from '@/stores/slices/types';

vi.mock('@/stores/editorStore', () => ({
  useEditorStore: vi.fn(() => ({})),
}));

vi.mock('@/stores/workspaceStore', () => ({
  useWorkspaceStore: vi.fn(() => ({})),
}));

vi.mock('@/components/ui/InfoTooltip', () => ({
  InfoTooltip: () => null,
}));

vi.mock('lucide-react', () => ({
  HelpCircle: (props: Record<string, unknown>) => <span data-testid="help-circle" {...props} />,
}));

const baseReverbZone: ReverbZoneData = {
  shape: { type: 'box', size: [10, 5, 10] },
  preset: 'hall',
  wetMix: 0.5,
  decayTime: 2.0,
  preDelay: 20,
  blendRadius: 2.0,
  priority: 0,
};

describe('ReverbZoneInspector', () => {
  const mockUpdateReverbZone = vi.fn();
  const mockRemoveReverbZone = vi.fn();
  const mockNavigateDocs = vi.fn();

  function setupStore({
    reverbZone = null as ReverbZoneData | null,
    enabled = false,
  } = {}) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    vi.mocked(useEditorStore).mockImplementation((selector: any) => {
      const state = {
        reverbZones: reverbZone ? { 'entity-1': reverbZone } : {},
        reverbZonesEnabled: { 'entity-1': enabled },
        updateReverbZone: mockUpdateReverbZone,
        removeReverbZone: mockRemoveReverbZone,
      };
      return typeof selector === 'function' ? selector(state) : state;
    });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    vi.mocked(useWorkspaceStore).mockImplementation((selector: any) => {
      const state = { navigateDocs: mockNavigateDocs };
      return typeof selector === 'function' ? selector(state) : state;
    });
  }

  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    cleanup();
  });

  it('renders Reverb Zone heading', () => {
    setupStore();
    render(<ReverbZoneInspector entityId="entity-1" />);
    expect(screen.getByText('Reverb Zone')).not.toBeNull();
  });

  it('shows Add Reverb Zone button when not enabled', () => {
    setupStore({ enabled: false });
    render(<ReverbZoneInspector entityId="entity-1" />);
    expect(screen.getByText('Add Reverb Zone')).not.toBeNull();
  });

  it('calls updateReverbZone with defaults when Add Reverb Zone clicked', () => {
    setupStore({ enabled: false });
    render(<ReverbZoneInspector entityId="entity-1" />);
    fireEvent.click(screen.getByText('Add Reverb Zone'));
    expect(mockUpdateReverbZone).toHaveBeenCalledWith(
      'entity-1',
      expect.objectContaining({ preset: 'hall', wetMix: 0.5 })
    );
  });

  it('shows controls when enabled with reverbZone', () => {
    setupStore({ reverbZone: baseReverbZone, enabled: true });
    render(<ReverbZoneInspector entityId="entity-1" />);
    expect(screen.getByText('Shape')).not.toBeNull();
  });

  it('shows Shape select with Box option selected', () => {
    setupStore({ reverbZone: baseReverbZone, enabled: true });
    render(<ReverbZoneInspector entityId="entity-1" />);
    const selects = screen.getAllByRole('combobox');
    const shapeSelect = selects.find(
      (s) => (s as HTMLSelectElement).value === 'box'
    ) as HTMLSelectElement;
    expect(shapeSelect?.value).toBe('box');
  });

  it('shows Size inputs for box shape', () => {
    setupStore({ reverbZone: baseReverbZone, enabled: true });
    render(<ReverbZoneInspector entityId="entity-1" />);
    expect(screen.getByText('Size')).not.toBeNull();
  });

  it('shows Radius input for sphere shape', () => {
    setupStore({
      reverbZone: {
        ...baseReverbZone,
        shape: { type: 'sphere' as const, radius: 5 },
      },
      enabled: true,
    });
    render(<ReverbZoneInspector entityId="entity-1" />);
    expect(screen.getByText('Radius')).not.toBeNull();
  });

  it('shows Type (preset) select', () => {
    setupStore({ reverbZone: baseReverbZone, enabled: true });
    render(<ReverbZoneInspector entityId="entity-1" />);
    expect(screen.getByText('Type')).not.toBeNull();
    expect(screen.getByRole('option', { name: 'Hall' })).not.toBeNull();
    expect(screen.getByRole('option', { name: 'Room' })).not.toBeNull();
    expect(screen.getByRole('option', { name: 'Cave' })).not.toBeNull();
  });

  it('shows Wet Mix slider', () => {
    setupStore({ reverbZone: baseReverbZone, enabled: true });
    render(<ReverbZoneInspector entityId="entity-1" />);
    expect(screen.getByText('Wet Mix')).not.toBeNull();
  });

  it('shows Decay Time slider', () => {
    setupStore({ reverbZone: baseReverbZone, enabled: true });
    render(<ReverbZoneInspector entityId="entity-1" />);
    expect(screen.getByText('Decay Time')).not.toBeNull();
  });

  it('shows Pre-Delay slider', () => {
    setupStore({ reverbZone: baseReverbZone, enabled: true });
    render(<ReverbZoneInspector entityId="entity-1" />);
    expect(screen.getByText('Pre-Delay')).not.toBeNull();
  });

  it('shows Priority field', () => {
    setupStore({ reverbZone: baseReverbZone, enabled: true });
    render(<ReverbZoneInspector entityId="entity-1" />);
    expect(screen.getByText('Priority')).not.toBeNull();
  });

  it('shows Remove Reverb Zone button', () => {
    setupStore({ reverbZone: baseReverbZone, enabled: true });
    render(<ReverbZoneInspector entityId="entity-1" />);
    expect(screen.getByText('Remove Reverb Zone')).not.toBeNull();
  });

  it('calls removeReverbZone when Remove clicked', () => {
    setupStore({ reverbZone: baseReverbZone, enabled: true });
    render(<ReverbZoneInspector entityId="entity-1" />);
    fireEvent.click(screen.getByText('Remove Reverb Zone'));
    expect(mockRemoveReverbZone).toHaveBeenCalledWith('entity-1');
  });

  it('calls updateReverbZone when shape type changed', () => {
    setupStore({ reverbZone: baseReverbZone, enabled: true });
    render(<ReverbZoneInspector entityId="entity-1" />);
    const selects = screen.getAllByRole('combobox');
    const shapeSelect = selects.find(
      (s) => (s as HTMLSelectElement).value === 'box'
    )!;
    fireEvent.change(shapeSelect, { target: { value: 'sphere' } });
    expect(mockUpdateReverbZone).toHaveBeenCalledWith(
      'entity-1',
      expect.objectContaining({ shape: { type: 'sphere', radius: 5 } })
    );
  });
});
