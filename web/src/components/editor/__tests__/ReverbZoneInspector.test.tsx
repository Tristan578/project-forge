/**
 * Render tests for ReverbZoneInspector component.
 *
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup, within } from '@/test/utils/componentTestUtils';
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
  const mockSetReverbZone = vi.fn();
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
        setReverbZone: mockSetReverbZone,
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
    expect(screen.getByText('Reverb Zone')).toBeInTheDocument();
  });

  it('shows Add Reverb Zone button when not enabled', () => {
    setupStore({ enabled: false });
    render(<ReverbZoneInspector entityId="entity-1" />);
    expect(screen.getByText('Add Reverb Zone')).toBeInTheDocument();
  });

  it('enables the zone it adds when Add Reverb Zone is clicked', () => {
    setupStore({ enabled: false });
    render(<ReverbZoneInspector entityId="entity-1" />);
    fireEvent.click(screen.getByText('Add Reverb Zone'));

    // Full payload, and `enabled: true` as the third argument. The editing
    // controls below are gated on that flag, so adding a zone without it left
    // this panel showing "Add Reverb Zone" over a configured zone — the edit UI
    // was unreachable, and the zone was silent in the engine besides.
    expect(mockSetReverbZone.mock.calls).toEqual([
      [
        'entity-1',
        {
          shape: { type: 'box', size: [10, 5, 10] },
          preset: 'hall',
          wetMix: 0.5,
          decayTime: 2.0,
          preDelay: 20,
          blendRadius: 2.0,
          priority: 0,
        },
        true,
      ],
    ]);
    expect(mockUpdateReverbZone).not.toHaveBeenCalled();
  });

  it('reveals the editing controls once the added zone is enabled', () => {
    // The reveal is the whole point of the flag: this is the state the store
    // lands in after `setReverbZone(..., true)`.
    setupStore({ reverbZone: baseReverbZone, enabled: true });
    render(<ReverbZoneInspector entityId="entity-1" />);

    expect(screen.queryByText('Add Reverb Zone')).not.toBeInTheDocument();
    expect(screen.getByText('Shape')).toBeInTheDocument();
    expect(screen.getByText('Remove Reverb Zone')).toBeInTheDocument();
  });

  it('shows controls when enabled with reverbZone', () => {
    setupStore({ reverbZone: baseReverbZone, enabled: true });
    render(<ReverbZoneInspector entityId="entity-1" />);
    expect(screen.getByText('Shape')).toBeInTheDocument();
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
    expect(screen.getByText('Size')).toBeInTheDocument();
  });

  it('exposes the three Size axis inputs as one named group', () => {
    // The shared Vec3Input composite wraps X/Y/Z under a labelled group so the
    // "Size" label is announced once for the trio rather than being inert on a
    // role="generic" div (which the ARIA spec forbids from taking an author name).
    // getByRole('group', { name: 'Size' }) resolves only through role="group" +
    // aria-labelledby, so dropping either fails here.
    setupStore({ reverbZone: baseReverbZone, enabled: true });
    render(<ReverbZoneInspector entityId="entity-1" />);
    const group = screen.getByRole('group', { name: 'Size' });
    expect(within(group).getByLabelText('Size X')).toHaveAttribute('type', 'number');
    expect(within(group).getByLabelText('Size Y')).toHaveAttribute('type', 'number');
    expect(within(group).getByLabelText('Size Z')).toHaveAttribute('type', 'number');
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
    expect(screen.getByText('Radius')).toBeInTheDocument();
  });

  it('bounds a negative sphere radius before updating the reverb zone', () => {
    setupStore({ reverbZone: { ...baseReverbZone, shape: { type: 'sphere', radius: 5 } }, enabled: true });
    render(<ReverbZoneInspector entityId="entity-1" />);
    fireEvent.change(screen.getByLabelText('Radius'), { target: { value: '-5' } });
    expect(mockUpdateReverbZone).toHaveBeenCalledExactlyOnceWith('entity-1', {
      ...baseReverbZone,
      shape: { type: 'sphere', radius: 0.1 },
    });
  });

  it('shows Type (preset) select', () => {
    setupStore({ reverbZone: baseReverbZone, enabled: true });
    render(<ReverbZoneInspector entityId="entity-1" />);
    expect(screen.getByText('Type')).toBeInTheDocument();
    expect(screen.getByRole('option', { name: 'Hall' })).toBeInTheDocument();
    expect(screen.getByRole('option', { name: 'Room' })).toBeInTheDocument();
    expect(screen.getByRole('option', { name: 'Cave' })).toBeInTheDocument();
  });

  it.each([
    { label: 'Wet Mix', raw: '75', field: 'wetMix', expected: 0.75 },
    { label: 'Decay Time', raw: '3.5', field: 'decayTime', expected: 3.5 },
    { label: 'Pre-Delay', raw: '40', field: 'preDelay', expected: 40 },
    { label: 'Priority', raw: '4', field: 'priority', expected: 4 },
  ])('forwards a migrated $label edit with its exact value', ({ label, raw, field, expected }) => {
    setupStore({ reverbZone: baseReverbZone, enabled: true });
    render(<ReverbZoneInspector entityId="entity-1" />);
    fireEvent.change(screen.getByLabelText(label), { target: { value: raw } });
    expect(mockUpdateReverbZone).toHaveBeenCalledExactlyOnceWith('entity-1', {
      ...baseReverbZone, [field]: expected,
    });
  });

  it.each(['X', 'Y', 'Z'])('forwards a migrated Size %s edit and preserves other axes', (axis) => {
    setupStore({ reverbZone: baseReverbZone, enabled: true });
    render(<ReverbZoneInspector entityId="entity-1" />);
    fireEvent.change(screen.getByLabelText('Size ' + axis), { target: { value: '12.5' } });
    const size = [10, 5, 10];
    size[['X', 'Y', 'Z'].indexOf(axis)] = 12.5;
    expect(mockUpdateReverbZone).toHaveBeenCalledExactlyOnceWith('entity-1', {
      ...baseReverbZone, shape: { type: 'box', size },
    });
  });

  it('shows Wet Mix slider', () => {
    setupStore({ reverbZone: baseReverbZone, enabled: true });
    render(<ReverbZoneInspector entityId="entity-1" />);
    expect(screen.getByText('Wet Mix')).toBeInTheDocument();
  });

  it('shows Decay Time slider', () => {
    setupStore({ reverbZone: baseReverbZone, enabled: true });
    render(<ReverbZoneInspector entityId="entity-1" />);
    expect(screen.getByText('Decay Time')).toBeInTheDocument();
  });

  it('shows Pre-Delay slider', () => {
    setupStore({ reverbZone: baseReverbZone, enabled: true });
    render(<ReverbZoneInspector entityId="entity-1" />);
    expect(screen.getByText('Pre-Delay')).toBeInTheDocument();
  });

  it('shows Priority field', () => {
    setupStore({ reverbZone: baseReverbZone, enabled: true });
    render(<ReverbZoneInspector entityId="entity-1" />);
    expect(screen.getByText('Priority')).toBeInTheDocument();
  });

  it('gives every editing control an accessible name', () => {
    // This surface was unreachable dead code until the enable fix landed, so the
    // missing label association had no live user impact and nothing caught it.
    // `getByLabelText` resolves only through htmlFor/id or aria-*, so a visual
    // label sitting next to an unassociated input fails this.
    setupStore({ reverbZone: baseReverbZone, enabled: true });
    render(<ReverbZoneInspector entityId="entity-1" />);

    for (const name of ['Shape', 'Type', 'Wet Mix', 'Decay Time', 'Pre-Delay', 'Priority']) {
      expect(screen.getByLabelText(name)).toBeInTheDocument();
    }
    // The three sliders now come from the shared @spawnforge/ui SliderInput
    // composite; pin that each still resolves to a real range input through its
    // own htmlFor label, so a regression in the composite's label wiring fails
    // here rather than silently shipping unlabelled sliders.
    for (const name of ['Wet Mix', 'Decay Time', 'Pre-Delay']) {
      expect(screen.getByLabelText(name)).toHaveAttribute('type', 'range');
    }
    // Three inputs under one "Size" label — each axis needs its own name, or all
    // three announce identically. These are the shared Vec3Input composite's
    // per-axis number inputs.
    for (const axis of ['Size X', 'Size Y', 'Size Z']) {
      expect(screen.getByLabelText(axis)).toHaveAttribute('type', 'number');
    }
  });

  it('gives the sphere radius input an accessible name', () => {
    setupStore({
      reverbZone: { ...baseReverbZone, shape: { type: 'sphere' as const, radius: 5 } },
      enabled: true,
    });
    render(<ReverbZoneInspector entityId="entity-1" />);
    expect(screen.getByLabelText('Radius')).toBeInTheDocument();
  });

  it('renders the Size axes at their raw magnitude without gaining decimals', () => {
    // Routing Size through the shared Vec3Input at its default precision of 3
    // displayed the integer size [10, 5, 10] as "10.000"/"5.000". The call site
    // pins precision={1} and the composite drops trailing zeros, so an integer
    // size reads exactly as the prior bespoke control did.
    setupStore({ reverbZone: baseReverbZone, enabled: true });
    render(<ReverbZoneInspector entityId="entity-1" />);
    expect((screen.getByLabelText('Size X') as HTMLInputElement).value).toBe('10');
    expect((screen.getByLabelText('Size Y') as HTMLInputElement).value).toBe('5');
    expect((screen.getByLabelText('Size Z') as HTMLInputElement).value).toBe('10');
  });

  it('lets a Size axis be cleared without dispatching a non-finite size to the store', () => {
    // The Size edit path (handleSizeChange -> updateReverbZone -> set_reverb_zone
    // dispatch) must never see a NaN axis. Clearing the field produces an empty
    // intermediate state the draft buffer keeps local until a finite value is
    // typed, so no update is dispatched for the bare clear.
    setupStore({ reverbZone: baseReverbZone, enabled: true });
    render(<ReverbZoneInspector entityId="entity-1" />);
    const x = screen.getByLabelText('Size X') as HTMLInputElement;

    fireEvent.change(x, { target: { value: '' } });

    expect(x.value).toBe('');
    expect(mockUpdateReverbZone).not.toHaveBeenCalled();
    for (const call of mockUpdateReverbZone.mock.calls) {
      const shape = call[1]?.shape;
      if (shape?.type === 'box') {
        expect(shape.size.every((n: number) => Number.isFinite(n))).toBe(true);
      }
    }
  });

  it('shows Remove Reverb Zone button', () => {
    setupStore({ reverbZone: baseReverbZone, enabled: true });
    render(<ReverbZoneInspector entityId="entity-1" />);
    expect(screen.getByText('Remove Reverb Zone')).toBeInTheDocument();
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
