/**
 * Tests for MaterialInspector — rendering, slider/color/checkbox updates,
 * preset selection, shader effects, collapsible sections, texture slots.
 *
 * @vitest-environment jsdom
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@/test/utils/componentTestUtils';
import { MaterialInspector } from '../MaterialInspector';
import { useEditorStore } from '@/stores/editorStore';
import { useWorkspaceStore } from '@/stores/workspaceStore';
import { useShaderEditorStore } from '@/stores/shaderEditorStore';

vi.mock('@/stores/editorStore', () => ({
  useEditorStore: vi.fn(),
}));

vi.mock('@/stores/workspaceStore', () => ({
  useWorkspaceStore: vi.fn(),
}));

vi.mock('@/stores/shaderEditorStore', () => ({
  useShaderEditorStore: vi.fn(),
}));

vi.mock('@/lib/materialPresets', () => ({
  MATERIAL_PRESETS: [
    { id: 'gold', name: 'Gold', category: 'metals', data: { metallic: 1, perceptualRoughness: 0.3 } },
    { id: 'glass', name: 'Glass', category: 'transparent', data: { metallic: 0, perceptualRoughness: 0.05 } },
  ],
  ALL_CATEGORIES: ['metals', 'transparent'],
  getPresetById: vi.fn((id: string) => {
    if (id === 'gold') return { id: 'gold', name: 'Gold', category: 'metals', data: { metallic: 1, perceptualRoughness: 0.3 } };
    if (id === 'glass') return { id: 'glass', name: 'Glass', category: 'transparent', data: { metallic: 0, perceptualRoughness: 0.05 } };
    return null;
  }),
  saveCustomMaterial: vi.fn(),
}));

vi.mock('../GenerateTextureDialog', () => ({
  GenerateTextureDialog: () => null,
}));

vi.mock('@/components/ui/InfoTooltip', () => ({
  InfoTooltip: ({ term, text }: { term?: string; text?: string }) => (
    <span data-testid={`tooltip-${term || 'text'}`}>{text}</span>
  ),
}));

vi.mock('@/lib/colorUtils', () => ({
  linearToHex: (r: number, g: number, b: number) => {
    const toHex = (c: number) => Math.round(Math.min(1, Math.max(0, c)) * 255).toString(16).padStart(2, '0');
    return '#' + toHex(r) + toHex(g) + toHex(b);
  },
  hexToLinear: (hex: string) => {
    const r = parseInt(hex.slice(1, 3), 16) / 255;
    const g = parseInt(hex.slice(3, 5), 16) / 255;
    const b = parseInt(hex.slice(5, 7), 16) / 255;
    return [r, g, b];
  },
}));

const mockUpdateMaterial = vi.fn();
const mockUpdateShaderEffect = vi.fn();
const mockRemoveShaderEffect = vi.fn();
const mockNavigateDocs = vi.fn();
const mockOpenShaderEditor = vi.fn();
const mockLoadTexture = vi.fn();
const mockRemoveTexture = vi.fn();

const defaultMaterial = {
  baseColor: [1, 0, 0, 1] as [number, number, number, number],
  metallic: 0.5,
  perceptualRoughness: 0.5,
  reflectance: 0.5,
  emissive: [0, 0, 0, 1] as [number, number, number, number],
  doubleSided: false,
  unlit: false,
  alphaMode: 'opaque' as const,
  baseColorTexture: null as string | null,
  normalMapTexture: null as string | null,
  metallicRoughnessTexture: null as string | null,
  emissiveTexture: null as string | null,
  occlusionTexture: null as string | null,
  depthMapTexture: null as string | null,
  clearcoatTexture: null as string | null,
  clearcoatRoughnessTexture: null as string | null,
  clearcoatNormalTexture: null as string | null,
  uvOffset: [0, 0] as [number, number],
  uvScale: [1, 1] as [number, number],
  uvRotation: 0,
  parallaxDepthScale: 0.1,
  parallaxMappingMethod: 'occlusion' as const,
  maxParallaxLayerCount: 16,
  parallaxReliefMaxSteps: 5,
  clearcoat: 0,
  clearcoatPerceptualRoughness: 0.5,
  specularTransmission: 0,
  diffuseTransmission: 0,
  ior: 1.5,
  thickness: 0,
  attenuationDistance: null as number | null,
  attenuationColor: [1, 1, 1] as [number, number, number],
};

function setupStore(overrides: {
  primaryId?: string | null;
  primaryMaterial?: typeof defaultMaterial | null;
  primaryShaderEffect?: Record<string, unknown> | null;
} = {}) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  vi.mocked(useEditorStore).mockImplementation((selector: any) => {
    const state = {
      primaryId: 'primaryId' in overrides ? overrides.primaryId : 'ent-1',
      primaryMaterial: 'primaryMaterial' in overrides ? overrides.primaryMaterial : defaultMaterial,
      updateMaterial: mockUpdateMaterial,
      primaryShaderEffect: overrides.primaryShaderEffect ?? null,
      updateShaderEffect: mockUpdateShaderEffect,
      removeShaderEffect: mockRemoveShaderEffect,
      loadTexture: mockLoadTexture,
      removeTexture: mockRemoveTexture,
      assetRegistry: {},
    };
    return selector(state);
  });

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  vi.mocked(useWorkspaceStore).mockImplementation((selector: any) => {
    const state = { navigateDocs: mockNavigateDocs };
    return selector(state);
  });

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  vi.mocked(useShaderEditorStore).mockImplementation((selector: any) => {
    const state = { openShaderEditor: mockOpenShaderEditor };
    return selector(state);
  });
}

describe('MaterialInspector', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    cleanup();
  });

  // ── Null guard ────────────────────────────────────────────────────────

  it('renders nothing when no entity is selected', () => {
    setupStore({ primaryId: null });
    const { container } = render(<MaterialInspector />);
    expect(container.innerHTML).toBe('');
  });

  it('renders nothing when no material data', () => {
    setupStore({ primaryMaterial: null });
    const { container } = render(<MaterialInspector />);
    expect(container.innerHTML).toBe('');
  });

  // ── Header ────────────────────────────────────────────────────────────

  it('renders Material heading and Shader Editor button', () => {
    setupStore();
    render(<MaterialInspector />);
    expect(screen.getByText('Material')).toBeDefined();
    expect(screen.getByText('Shader Editor')).toBeDefined();
  });

  it('opens shader editor on button click', () => {
    setupStore();
    render(<MaterialInspector />);
    fireEvent.click(screen.getByText('Shader Editor'));
    expect(mockOpenShaderEditor).toHaveBeenCalledOnce();
  });

  it('opens docs on help click', () => {
    setupStore();
    render(<MaterialInspector />);
    fireEvent.click(screen.getByTitle('Documentation'));
    expect(mockNavigateDocs).toHaveBeenCalledWith('features/materials');
  });

  // ── Base color ────────────────────────────────────────────────────────

  it('renders base color picker with hex value', () => {
    setupStore();
    const { container } = render(<MaterialInspector />);
    // Red base color → #ff0000
    expect(container.textContent).toContain('#ff0000');
  });

  it('updates base color when color picker changes', () => {
    setupStore();
    render(<MaterialInspector />);
    const colorInputs = document.querySelectorAll('input[type="color"]');
    // First color input is for base color
    fireEvent.change(colorInputs[0], { target: { value: '#00ff00' } });
    expect(mockUpdateMaterial).toHaveBeenCalledWith(
      'ent-1',
      expect.objectContaining({
        baseColor: expect.arrayContaining([0, 1, 0]),
      }),
    );
  });

  // ── Metallic / Roughness / Reflectance sliders ────────────────────────

  it('updates metallic when slider changes', () => {
    setupStore();
    render(<MaterialInspector />);
    const metallicLabel = screen.getByText('Metallic');
    const slider = metallicLabel.closest('.flex')?.querySelector('input[type="range"]');
    expect(slider).not.toBeNull();
    fireEvent.change(slider!, { target: { value: '0.8' } });
    expect(mockUpdateMaterial).toHaveBeenCalledWith(
      'ent-1',
      expect.objectContaining({ metallic: 0.8 }),
    );
  });

  it('updates roughness when slider changes', () => {
    setupStore();
    render(<MaterialInspector />);
    const label = screen.getByText('Roughness');
    const slider = label.closest('.flex')?.querySelector('input[type="range"]');
    fireEvent.change(slider!, { target: { value: '0.2' } });
    expect(mockUpdateMaterial).toHaveBeenCalledWith(
      'ent-1',
      expect.objectContaining({ perceptualRoughness: 0.2 }),
    );
  });

  it('updates reflectance when slider changes', () => {
    setupStore();
    render(<MaterialInspector />);
    const label = screen.getByText('Reflectance');
    const slider = label.closest('.flex')?.querySelector('input[type="range"]');
    fireEvent.change(slider!, { target: { value: '0.9' } });
    expect(mockUpdateMaterial).toHaveBeenCalledWith(
      'ent-1',
      expect.objectContaining({ reflectance: 0.9 }),
    );
  });

  // ── Opacity ───────────────────────────────────────────────────────────

  it('updates opacity and switches alphaMode to blend when < 1', () => {
    setupStore();
    render(<MaterialInspector />);
    const label = screen.getByText('Opacity');
    const slider = label.closest('.flex')?.querySelector('input[type="range"]');
    fireEvent.change(slider!, { target: { value: '0.5' } });
    expect(mockUpdateMaterial).toHaveBeenCalledWith(
      'ent-1',
      expect.objectContaining({
        baseColor: [1, 0, 0, 0.5],
        alphaMode: 'blend',
      }),
    );
  });

  // ── Emissive ──────────────────────────────────────────────────────────

  it('renders emissive color picker', () => {
    setupStore();
    const { container } = render(<MaterialInspector />);
    expect(container.textContent).toContain('#000000'); // black emissive
  });

  // ── Checkboxes ────────────────────────────────────────────────────────

  it('toggles double sided', () => {
    setupStore();
    render(<MaterialInspector />);
    const label = screen.getByText('Double Sided');
    const checkbox = label.closest('.flex')?.querySelector('input[type="checkbox"]');
    fireEvent.click(checkbox!);
    expect(mockUpdateMaterial).toHaveBeenCalledWith(
      'ent-1',
      expect.objectContaining({ doubleSided: true }),
    );
  });

  it('toggles unlit', () => {
    setupStore();
    render(<MaterialInspector />);
    const label = screen.getByText('Unlit');
    const checkbox = label.closest('.flex')?.querySelector('input[type="checkbox"]');
    fireEvent.click(checkbox!);
    expect(mockUpdateMaterial).toHaveBeenCalledWith(
      'ent-1',
      expect.objectContaining({ unlit: true }),
    );
  });

  // ── Preset selector ───────────────────────────────────────────────────

  it('renders preset selector with categories', () => {
    setupStore();
    render(<MaterialInspector />);
    expect(screen.getByText('Apply Preset')).toBeDefined();
  });

  it('apply preset button is disabled when no preset selected', () => {
    setupStore();
    render(<MaterialInspector />);
    const btn = screen.getByText('Apply Preset');
    expect(btn.hasAttribute('disabled')).toBe(true);
  });

  it('applies gold preset when selected and clicked', () => {
    setupStore();
    render(<MaterialInspector />);
    // Select gold preset
    const select = document.querySelector('select') as HTMLSelectElement;
    fireEvent.change(select, { target: { value: 'gold' } });
    fireEvent.click(screen.getByText('Apply Preset'));
    expect(mockUpdateMaterial).toHaveBeenCalledWith(
      'ent-1',
      expect.objectContaining({ metallic: 1, perceptualRoughness: 0.3 }),
    );
  });

  // ── Texture slots ─────────────────────────────────────────────────────

  it('renders texture slot labels', () => {
    setupStore();
    render(<MaterialInspector />);
    expect(screen.getByText('Textures')).toBeDefined();
  });

  it('shows Generate button for AI texture', () => {
    setupStore();
    render(<MaterialInspector />);
    expect(screen.getByText('Generate')).toBeDefined();
  });

  // ── Collapsible sections ──────────────────────────────────────────────

  it('UV Transform section expands on click', () => {
    setupStore();
    render(<MaterialInspector />);
    const btn = screen.getByText('UV Transform');
    fireEvent.click(btn);
    expect(screen.getByText('Offset X')).toBeDefined();
    expect(screen.getByText('Scale X')).toBeDefined();
    expect(screen.getByText('Rotation')).toBeDefined();
  });

  it('Clearcoat section expands on click', () => {
    setupStore();
    render(<MaterialInspector />);
    const btn = screen.getByText('Clearcoat');
    fireEvent.click(btn);
    expect(screen.getByText('Intensity')).toBeDefined();
  });

  it('Transmission section expands on click and shows IOR hints', () => {
    setupStore();
    render(<MaterialInspector />);
    const btn = screen.getByText('Transmission');
    fireEvent.click(btn);
    expect(screen.getByText('IOR')).toBeDefined();
  });

  it('Parallax Mapping section expands on click', () => {
    setupStore();
    render(<MaterialInspector />);
    const btn = screen.getByText('Parallax Mapping');
    fireEvent.click(btn);
    expect(screen.getByText('Depth Scale')).toBeDefined();
    expect(screen.getByText('Method')).toBeDefined();
  });

  // ── Shader effect ─────────────────────────────────────────────────────

  it('renders Shader Effect section', () => {
    setupStore();
    render(<MaterialInspector />);
    const btn = screen.getByText('Shader Effect');
    fireEvent.click(btn);
    expect(screen.getByText('Standard PBR')).toBeDefined();
  });

  it('calls updateShaderEffect when shader type changes from none', () => {
    setupStore();
    render(<MaterialInspector />);
    // Open shader section
    fireEvent.click(screen.getByText('Shader Effect'));
    // Find the shader type select (the one with 'Standard PBR')
    const selects = document.querySelectorAll('select');
    const shaderSelect = Array.from(selects).find((s) =>
      Array.from(s.options).some((o) => o.textContent === 'Standard PBR')
    );
    expect(shaderSelect).toBeDefined();
    fireEvent.change(shaderSelect!, { target: { value: 'dissolve' } });
    expect(mockUpdateShaderEffect).toHaveBeenCalledWith(
      'ent-1',
      expect.objectContaining({ shaderType: 'dissolve' }),
    );
  });

  it('calls removeShaderEffect when shader type set to none', () => {
    setupStore({
      primaryShaderEffect: {
        shaderType: 'dissolve',
        customColor: [1, 0.5, 0.2, 1],
        noiseScale: 5.0,
        emissionStrength: 2.0,
        dissolveThreshold: 0.5,
        dissolveEdgeWidth: 0.05,
        scanLineFrequency: 50.0,
        scanLineSpeed: 2.0,
        scrollSpeed: [0.1, 0.2],
        distortionStrength: 0.1,
        toonBands: 4,
        fresnelPower: 3.0,
      },
    });
    render(<MaterialInspector />);
    // The shader section should be open by default (defaultOpen=true when shaderType !== 'none')
    const selects = document.querySelectorAll('select');
    const shaderSelect = Array.from(selects).find((s) =>
      Array.from(s.options).some((o) => o.textContent === 'Dissolve')
    );
    expect(shaderSelect).toBeDefined();
    fireEvent.change(shaderSelect!, { target: { value: 'none' } });
    expect(mockRemoveShaderEffect).toHaveBeenCalledWith('ent-1');
  });

  it('shows dissolve-specific sliders when shader type is dissolve', () => {
    setupStore({
      primaryShaderEffect: {
        shaderType: 'dissolve',
        customColor: [1, 0.5, 0.2, 1],
        noiseScale: 5.0,
        emissionStrength: 2.0,
        dissolveThreshold: 0.5,
        dissolveEdgeWidth: 0.05,
        scanLineFrequency: 50.0,
        scanLineSpeed: 2.0,
        scrollSpeed: [0.1, 0.2],
        distortionStrength: 0.1,
        toonBands: 4,
        fresnelPower: 3.0,
      },
    });
    render(<MaterialInspector />);
    expect(screen.getByText('Threshold')).toBeDefined();
    expect(screen.getByText('Edge Width')).toBeDefined();
  });

  // ── Transmission alpha mode tip ───────────────────────────────────────

  it('shows alpha mode tip when specularTransmission > 0 and alphaMode is opaque', () => {
    setupStore({
      primaryMaterial: {
        ...defaultMaterial,
        specularTransmission: 0.5,
        alphaMode: 'opaque' as const,
      },
    });
    render(<MaterialInspector />);
    // Expand transmission section
    fireEvent.click(screen.getByText('Transmission'));
    expect(screen.getByText(/Set alpha mode to Blend/)).toBeDefined();
  });
});
