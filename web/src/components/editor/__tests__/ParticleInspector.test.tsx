/**
 * Tests for ParticleInspector — add/remove particles, preset, enable/disable,
 * spawner mode, emission shape, playback controls, gradient stops, rendering options.
 *
 * @vitest-environment jsdom
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@/test/utils/componentTestUtils';
import { ParticleInspector } from '../ParticleInspector';
import { useEditorStore } from '@/stores/editorStore';
import { useWorkspaceStore } from '@/stores/workspaceStore';

vi.mock('@/stores/editorStore', () => ({
  useEditorStore: vi.fn(() => ({})),
}));

vi.mock('@/stores/workspaceStore', () => ({
  useWorkspaceStore: vi.fn(() => ({})),
}));

vi.mock('@/components/ui/InfoTooltip', () => ({
  InfoTooltip: () => null,
}));

const mockSetParticle = vi.fn();
const mockRemoveParticle = vi.fn();
const mockToggleParticle = vi.fn();
const mockSetParticlePreset = vi.fn();
const mockPlayParticle = vi.fn();
const mockStopParticle = vi.fn();
const mockBurstParticle = vi.fn();
const mockNavigateDocs = vi.fn();

const defaultParticle = {
  preset: 'fire' as const,
  spawnerMode: { type: 'continuous' as const, rate: 50 },
  maxParticles: 1000,
  lifetimeMin: 0.5,
  lifetimeMax: 2.0,
  emissionShape: { type: 'point' as const },
  velocityMin: [0, 1, 0] as [number, number, number],
  velocityMax: [0, 3, 0] as [number, number, number],
  acceleration: [0, -9.8, 0] as [number, number, number],
  linearDrag: 0.1,
  sizeStart: 0.5,
  sizeEnd: 0.0,
  colorGradient: [
    { position: 0, color: [1, 0.5, 0, 1] as [number, number, number, number] },
    { position: 1, color: [1, 0, 0, 0] as [number, number, number, number] },
  ],
  blendMode: 'additive' as const,
  orientation: 'billboard' as const,
  worldSpace: false,
};

function setupStore(overrides: {
  primaryId?: string | null;
  primaryParticle?: typeof defaultParticle | null;
  particleEnabled?: boolean;
} = {}) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  vi.mocked(useEditorStore).mockImplementation((selector: any) => {
    const state = {
      primaryId: overrides.primaryId ?? 'ent-1',
      primaryParticle: overrides.primaryParticle !== undefined ? overrides.primaryParticle : defaultParticle,
      particleEnabled: overrides.particleEnabled ?? true,
      setParticle: mockSetParticle,
      removeParticle: mockRemoveParticle,
      toggleParticle: mockToggleParticle,
      setParticlePreset: mockSetParticlePreset,
      playParticle: mockPlayParticle,
      stopParticle: mockStopParticle,
      burstParticle: mockBurstParticle,
    };
    return selector(state);
  });

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  vi.mocked(useWorkspaceStore).mockImplementation((selector: any) => {
    const state = { navigateDocs: mockNavigateDocs };
    return selector(state);
  });
}

describe('ParticleInspector', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    cleanup();
  });

  // ── No particle state ─────────────────────────────────────────────────

  it('shows Add Particles button when no particle data', () => {
    setupStore({ primaryParticle: null });
    render(<ParticleInspector />);
    expect(screen.getByText('Add Particles')).toBeDefined();
  });

  it('adds particles with fire preset on click', () => {
    setupStore({ primaryParticle: null });
    render(<ParticleInspector />);
    fireEvent.click(screen.getByText('Add Particles'));
    expect(mockSetParticlePreset).toHaveBeenCalledWith('ent-1', 'fire');
  });

  // ── With particle data ────────────────────────────────────────────────

  it('renders Particles header', () => {
    setupStore();
    render(<ParticleInspector />);
    expect(screen.getByText('Particles')).toBeDefined();
  });

  it('renders preset dropdown with fire selected', () => {
    setupStore();
    render(<ParticleInspector />);
    const presetSelect = document.querySelector('select') as HTMLSelectElement;
    expect(presetSelect.value).toBe('fire');
  });

  it('changes preset on select', () => {
    setupStore();
    render(<ParticleInspector />);
    const presetSelect = document.querySelector('select') as HTMLSelectElement;
    fireEvent.change(presetSelect, { target: { value: 'snow' } });
    expect(mockSetParticlePreset).toHaveBeenCalledWith('ent-1', 'snow');
  });

  it('renders enabled checkbox as checked', () => {
    setupStore();
    render(<ParticleInspector />);
    const checkbox = document.querySelector('input[type="checkbox"]') as HTMLInputElement;
    expect(checkbox.checked).toBe(true);
  });

  it('toggles particle enabled', () => {
    setupStore();
    render(<ParticleInspector />);
    const checkbox = document.querySelector('input[type="checkbox"]') as HTMLInputElement;
    fireEvent.click(checkbox);
    expect(mockToggleParticle).toHaveBeenCalledWith('ent-1', false);
  });

  // ── Spawner section ───────────────────────────────────────────────────

  it('renders spawner mode dropdown', () => {
    setupStore();
    render(<ParticleInspector />);
    expect(screen.getByText('Spawner')).toBeDefined();
    const selects = document.querySelectorAll('select');
    const modeSelect = Array.from(selects).find((s) =>
      Array.from(s.options).some((o) => o.textContent === 'Burst'),
    ) as HTMLSelectElement;
    expect(modeSelect).toBeDefined();
    expect(modeSelect.value).toBe('continuous');
  });

  it('switches spawner mode to burst', () => {
    setupStore();
    render(<ParticleInspector />);
    const selects = document.querySelectorAll('select');
    const modeSelect = Array.from(selects).find((s) =>
      Array.from(s.options).some((o) => o.textContent === 'Burst'),
    ) as HTMLSelectElement;
    fireEvent.change(modeSelect, { target: { value: 'burst' } });
    expect(mockSetParticle).toHaveBeenCalledWith('ent-1', {
      spawnerMode: { type: 'burst', count: 100 },
    });
  });

  it('renders rate slider for continuous mode', () => {
    setupStore();
    render(<ParticleInspector />);
    expect(screen.getByText('Rate')).toBeDefined();
  });

  it('renders count slider for burst mode', () => {
    setupStore({
      primaryParticle: { ...defaultParticle, spawnerMode: { type: 'burst', count: 100 } as unknown as typeof defaultParticle.spawnerMode },
    });
    render(<ParticleInspector />);
    expect(screen.getByText('Count')).toBeDefined();
  });

  // ── Emission shape ────────────────────────────────────────────────────

  it('renders emission shape section', () => {
    setupStore();
    render(<ParticleInspector />);
    expect(screen.getByText('Emission Shape')).toBeDefined();
  });

  it('changes emission shape to sphere', () => {
    setupStore();
    render(<ParticleInspector />);
    const selects = document.querySelectorAll('select');
    const shapeSelect = Array.from(selects).find((s) =>
      Array.from(s.options).some((o) => o.textContent === 'Sphere'),
    ) as HTMLSelectElement;
    fireEvent.change(shapeSelect, { target: { value: 'sphere' } });
    expect(mockSetParticle).toHaveBeenCalledWith('ent-1', {
      emissionShape: { type: 'sphere', radius: 0.5 },
    });
  });

  it('shows radius slider for sphere shape', () => {
    setupStore({
      primaryParticle: { ...defaultParticle, emissionShape: { type: 'sphere', radius: 0.5 } as unknown as typeof defaultParticle.emissionShape },
    });
    render(<ParticleInspector />);
    // Should have a Radius slider specific to sphere shape
    expect(screen.getByText('Radius')).toBeDefined();
  });

  it('shows half extents for box shape', () => {
    setupStore({
      primaryParticle: {
        ...defaultParticle,
        emissionShape: { type: 'box', halfExtents: [0.5, 0.5, 0.5] as [number, number, number] } as unknown as typeof defaultParticle.emissionShape,
      },
    });
    render(<ParticleInspector />);
    expect(screen.getByText('Half Extents')).toBeDefined();
  });

  // ── Velocity / Forces / Size sections ─────────────────────────────────

  it('renders velocity section', () => {
    setupStore();
    render(<ParticleInspector />);
    expect(screen.getByText('Velocity')).toBeDefined();
  });

  it('renders forces section', () => {
    setupStore();
    render(<ParticleInspector />);
    expect(screen.getByText('Forces')).toBeDefined();
  });

  it('renders size section', () => {
    setupStore();
    render(<ParticleInspector />);
    expect(screen.getByText('Size')).toBeDefined();
  });

  // ── Color gradient ────────────────────────────────────────────────────

  it('renders color gradient section with stops', () => {
    setupStore();
    render(<ParticleInspector />);
    expect(screen.getByText('Color Gradient')).toBeDefined();
    expect(screen.getByText('Stop 1')).toBeDefined();
    expect(screen.getByText('Stop 2')).toBeDefined();
  });

  it('does not show remove button when only 2 stops', () => {
    setupStore();
    render(<ParticleInspector />);
    // With exactly 2 gradient stops, remove buttons should not appear
    const removeButtons = document.querySelectorAll('[title="Remove stop"]');
    expect(removeButtons.length).toBe(0);
  });

  it('shows remove buttons when more than 2 stops', () => {
    setupStore({
      primaryParticle: {
        ...defaultParticle,
        colorGradient: [
          { position: 0, color: [1, 1, 0, 1] as [number, number, number, number] },
          { position: 0.5, color: [1, 0, 0, 1] as [number, number, number, number] },
          { position: 1, color: [0, 0, 0, 0] as [number, number, number, number] },
        ],
      },
    });
    render(<ParticleInspector />);
    const removeButtons = document.querySelectorAll('[title="Remove stop"]');
    expect(removeButtons.length).toBe(3);
  });

  // ── Rendering section ─────────────────────────────────────────────────

  it('renders blend mode dropdown', () => {
    setupStore();
    render(<ParticleInspector />);
    expect(screen.getByText('Rendering')).toBeDefined();
    const selects = document.querySelectorAll('select');
    const blendSelect = Array.from(selects).find((s) =>
      Array.from(s.options).some((o) => o.textContent === 'Alpha Blend'),
    ) as HTMLSelectElement;
    expect(blendSelect).toBeDefined();
    expect(blendSelect.value).toBe('additive');
  });

  it('changes blend mode', () => {
    setupStore();
    render(<ParticleInspector />);
    const selects = document.querySelectorAll('select');
    const blendSelect = Array.from(selects).find((s) =>
      Array.from(s.options).some((o) => o.textContent === 'Alpha Blend'),
    ) as HTMLSelectElement;
    fireEvent.change(blendSelect, { target: { value: 'alpha_blend' } });
    expect(mockSetParticle).toHaveBeenCalledWith('ent-1', { blendMode: 'alpha_blend' });
  });

  // ── Playback controls ─────────────────────────────────────────────────

  it('renders Play, Stop, and Burst buttons', () => {
    setupStore();
    render(<ParticleInspector />);
    const buttons = document.querySelectorAll('button');
    const buttonTexts = Array.from(buttons).map((b) => b.textContent);
    expect(buttonTexts.some((t) => t?.includes('Play'))).toBe(true);
    expect(buttonTexts.some((t) => t?.includes('Stop'))).toBe(true);
    expect(buttonTexts.some((t) => t?.includes('Burst'))).toBe(true);
  });

  it('calls playParticle on Play click', () => {
    setupStore();
    render(<ParticleInspector />);
    fireEvent.click(screen.getByText('Play'));
    expect(mockPlayParticle).toHaveBeenCalledWith('ent-1');
  });

  it('calls stopParticle on Stop click', () => {
    setupStore();
    render(<ParticleInspector />);
    fireEvent.click(screen.getByText('Stop'));
    expect(mockStopParticle).toHaveBeenCalledWith('ent-1');
  });

  it('calls burstParticle on Burst click', () => {
    setupStore();
    render(<ParticleInspector />);
    const buttons = document.querySelectorAll('button');
    const burstBtn = Array.from(buttons).find((b) => b.textContent?.includes('Burst'))!;
    fireEvent.click(burstBtn);
    expect(mockBurstParticle).toHaveBeenCalledWith('ent-1', 100);
  });

  // ── Remove particles ──────────────────────────────────────────────────

  it('renders Remove Particles button', () => {
    setupStore();
    render(<ParticleInspector />);
    expect(screen.getByText('Remove Particles')).toBeDefined();
  });

  it('calls removeParticle on Remove click', () => {
    setupStore();
    render(<ParticleInspector />);
    fireEvent.click(screen.getByText('Remove Particles'));
    expect(mockRemoveParticle).toHaveBeenCalledWith('ent-1');
  });

  // ── Docs link ─────────────────────────────────────────────────────────

  it('navigates docs on help button click', () => {
    setupStore();
    render(<ParticleInspector />);
    fireEvent.click(screen.getByTitle('Documentation'));
    expect(mockNavigateDocs).toHaveBeenCalledWith('features/particles');
  });
});
