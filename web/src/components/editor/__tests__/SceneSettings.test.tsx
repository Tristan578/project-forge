/**
 * Tests for SceneSettings — quality presets, ambient light, environment,
 * fog, bloom, chromatic aberration, color grading, sharpening, DOF,
 * motion blur, mobile controls.
 *
 * @vitest-environment jsdom
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@/test/utils/componentTestUtils';
import { SceneSettings } from '../SceneSettings';
import { useEditorStore } from '@/stores/editorStore';
import { useWorkspaceStore } from '@/stores/workspaceStore';

vi.mock('@/stores/editorStore', () => ({
  useEditorStore: vi.fn(),
}));

vi.mock('@/stores/workspaceStore', () => ({
  useWorkspaceStore: vi.fn(),
}));

vi.mock('../GenerateSkyboxDialog', () => ({
  GenerateSkyboxDialog: () => null,
}));

vi.mock('../SceneStatistics', () => ({
  SceneStatistics: () => <div data-testid="scene-statistics">Stats</div>,
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

const mockUpdateAmbientLight = vi.fn();
const mockUpdateEnvironment = vi.fn();
const mockSetSkybox = vi.fn();
const mockRemoveSkybox = vi.fn();
const mockUpdateSkybox = vi.fn();
const mockUpdateBloom = vi.fn();
const mockUpdateChromaticAberration = vi.fn();
const mockUpdateColorGrading = vi.fn();
const mockUpdateSharpening = vi.fn();
const mockUpdateSsao = vi.fn();
const mockUpdateDepthOfField = vi.fn();
const mockUpdateMotionBlur = vi.fn();
const mockSetQualityPreset = vi.fn();
const mockSetMobileTouchConfig = vi.fn();
const mockUpdateMobileTouchConfig = vi.fn();
const mockSetCustomSkybox = vi.fn();
const mockNavigateDocs = vi.fn();

const defaultState = {
  ambientLight: { color: [1, 1, 1], brightness: 500 },
  environment: {
    clearColor: [0.1, 0.1, 0.1],
    fogEnabled: false,
    fogColor: [0.5, 0.5, 0.5],
    fogStart: 10,
    fogEnd: 100,
    skyboxPreset: null as string | null,
    skyboxAssetId: null as string | null,
    skyboxBrightness: 1000,
    iblIntensity: 1000,
    iblRotationDegrees: 0,
  },
  postProcessing: {
    bloom: { enabled: false, intensity: 0.15, lowFrequencyBoost: 0.7, highPassFrequency: 0.5, prefilterThreshold: 0, prefilterThresholdSoftness: 0.6, compositeMode: 'energy_conserving' },
    chromaticAberration: { enabled: false, intensity: 0.02, maxSamples: 8 },
    colorGrading: {
      enabled: false,
      global: { exposure: 0, temperature: 0, tint: 0, hue: 0, postSaturation: 1 },
      shadows: { saturation: 1, contrast: 1, gamma: 1, gain: 1, lift: 0 },
      midtones: { saturation: 1, contrast: 1, gamma: 1, gain: 1, lift: 0 },
      highlights: { saturation: 1, contrast: 1, gamma: 1, gain: 1, lift: 0 },
    },
    sharpening: { enabled: false, sharpeningStrength: 0.3, denoise: false },
    ssao: null as Record<string, unknown> | null,
    depthOfField: null as Record<string, unknown> | null,
    motionBlur: null as Record<string, unknown> | null,
  },
  qualityPreset: 'medium',
  mobileTouchConfig: {
    enabled: false,
    preset: 'platformer',
    joystick: { position: 'bottom-left', size: 120, opacity: 0.7 },
    buttons: [{ id: 'jump', icon: '⬆', action: 'jump', size: 60 }],
    autoReduceQuality: true,
    preferredOrientation: 'any' as const,
  },
};

function setupStore() {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  vi.mocked(useEditorStore).mockImplementation((selector: any) => {
    const state = {
      ...defaultState,
      bridgeTools: {},
      setBridgeTool: vi.fn(),
      removeBridgeTool: vi.fn(),
      updateAmbientLight: mockUpdateAmbientLight,
      updateEnvironment: mockUpdateEnvironment,
      setSkybox: mockSetSkybox,
      removeSkybox: mockRemoveSkybox,
      updateSkybox: mockUpdateSkybox,
      updateBloom: mockUpdateBloom,
      updateChromaticAberration: mockUpdateChromaticAberration,
      updateColorGrading: mockUpdateColorGrading,
      updateSharpening: mockUpdateSharpening,
      updateSsao: mockUpdateSsao,
      updateDepthOfField: mockUpdateDepthOfField,
      updateMotionBlur: mockUpdateMotionBlur,
      setQualityPreset: mockSetQualityPreset,
      setMobileTouchConfig: mockSetMobileTouchConfig,
      updateMobileTouchConfig: mockUpdateMobileTouchConfig,
      setCustomSkybox: mockSetCustomSkybox,
    };
    return selector(state);
  });

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  vi.mocked(useWorkspaceStore).mockImplementation((selector: any) => {
    const state = { navigateDocs: mockNavigateDocs };
    return selector(state);
  });
}

describe('SceneSettings', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    cleanup();
  });

  // ── Basic rendering ───────────────────────────────────────────────────

  it('renders SceneStatistics', () => {
    setupStore();
    render(<SceneSettings />);
    expect(screen.getByTestId('scene-statistics')).toBeDefined();
  });

  it('renders Quality Preset section', () => {
    setupStore();
    render(<SceneSettings />);
    expect(screen.getByText('Quality Preset')).toBeDefined();
  });

  it('renders Ambient Light section', () => {
    setupStore();
    render(<SceneSettings />);
    expect(screen.getByText('Ambient Light')).toBeDefined();
  });

  it('renders Environment section', () => {
    setupStore();
    render(<SceneSettings />);
    expect(screen.getByText('Environment')).toBeDefined();
  });

  it('renders Fog section', () => {
    setupStore();
    render(<SceneSettings />);
    expect(screen.getByText('Fog')).toBeDefined();
  });

  it('renders Bloom section', () => {
    setupStore();
    render(<SceneSettings />);
    expect(screen.getByText('Bloom')).toBeDefined();
  });

  it('renders Chromatic Aberration section', () => {
    setupStore();
    render(<SceneSettings />);
    expect(screen.getByText('Chromatic Aberration')).toBeDefined();
  });

  it('renders Color Grading section', () => {
    setupStore();
    render(<SceneSettings />);
    expect(screen.getByText('Color Grading')).toBeDefined();
  });

  it('renders Sharpening section', () => {
    setupStore();
    render(<SceneSettings />);
    expect(screen.getByText('Sharpening')).toBeDefined();
  });

  it('renders Depth of Field section', () => {
    setupStore();
    render(<SceneSettings />);
    expect(screen.getByText('Depth of Field')).toBeDefined();
  });

  it('renders Motion Blur section', () => {
    setupStore();
    render(<SceneSettings />);
    expect(screen.getByText('Motion Blur')).toBeDefined();
  });

  it('renders Mobile Controls section', () => {
    setupStore();
    render(<SceneSettings />);
    expect(screen.getByText('Mobile Controls')).toBeDefined();
  });

  // ── Quality Preset ────────────────────────────────────────────────────

  it('changes quality preset', () => {
    setupStore();
    render(<SceneSettings />);
    const presetSelect = document.querySelector('select') as HTMLSelectElement;
    fireEvent.change(presetSelect, { target: { value: 'ultra' } });
    expect(mockSetQualityPreset).toHaveBeenCalledWith('ultra');
  });

  // ── Ambient Light ─────────────────────────────────────────────────────

  it('updates ambient color', () => {
    setupStore();
    render(<SceneSettings />);
    const colorInputs = document.querySelectorAll('input[type="color"]');
    // First color input is ambient color
    fireEvent.change(colorInputs[0], { target: { value: '#ff0000' } });
    expect(mockUpdateAmbientLight).toHaveBeenCalledWith(
      expect.objectContaining({ color: [1, 0, 0] }),
    );
  });

  it('updates ambient brightness', () => {
    setupStore();
    render(<SceneSettings />);
    const label = screen.getByText('Brightness');
    const slider = label.closest('.flex')?.querySelector('input[type="range"]');
    fireEvent.change(slider!, { target: { value: '1000' } });
    expect(mockUpdateAmbientLight).toHaveBeenCalledWith(
      expect.objectContaining({ brightness: 1000 }),
    );
  });

  // ── Skybox ────────────────────────────────────────────────────────────

  it('sets skybox preset to studio', () => {
    setupStore();
    render(<SceneSettings />);
    const skyboxSelect = screen.getByText('None').closest('select') as HTMLSelectElement;
    fireEvent.change(skyboxSelect, { target: { value: 'studio' } });
    expect(mockSetSkybox).toHaveBeenCalledWith('studio');
  });

  it('removes skybox when set to none', () => {
    setupStore();
    render(<SceneSettings />);
    const skyboxSelect = screen.getByText('None').closest('select') as HTMLSelectElement;
    fireEvent.change(skyboxSelect, { target: { value: 'none' } });
    expect(mockRemoveSkybox).toHaveBeenCalled();
  });

  // ── Fog ───────────────────────────────────────────────────────────────

  it('enables fog and shows fog controls', () => {
    setupStore();
    render(<SceneSettings />);
    // Find Fog section's enabled checkbox
    const fogHeading = screen.getByText('Fog');
    const fogSection = fogHeading.closest('.border-t');
    const checkbox = fogSection?.querySelector('input[type="checkbox"]');
    expect(checkbox).not.toBeNull();
    fireEvent.click(checkbox!);
    expect(mockUpdateEnvironment).toHaveBeenCalledWith(
      expect.objectContaining({ fogEnabled: true }),
    );
  });

  // ── Bloom ─────────────────────────────────────────────────────────────

  it('enables bloom', () => {
    setupStore();
    render(<SceneSettings />);
    const bloomHeading = screen.getByText('Bloom');
    const bloomSection = bloomHeading.closest('.border-t');
    const checkbox = bloomSection?.querySelector('input[type="checkbox"]');
    fireEvent.click(checkbox!);
    expect(mockUpdateBloom).toHaveBeenCalledWith(
      expect.objectContaining({ enabled: true }),
    );
  });

  // ── Chromatic Aberration ──────────────────────────────────────────────

  it('enables chromatic aberration', () => {
    setupStore();
    render(<SceneSettings />);
    const heading = screen.getByText('Chromatic Aberration');
    const section = heading.closest('.border-t');
    const checkbox = section?.querySelector('input[type="checkbox"]');
    fireEvent.click(checkbox!);
    expect(mockUpdateChromaticAberration).toHaveBeenCalledWith(
      expect.objectContaining({ enabled: true }),
    );
  });

  // ── Color Grading ─────────────────────────────────────────────────────

  it('enables color grading', () => {
    setupStore();
    render(<SceneSettings />);
    const heading = screen.getByText('Color Grading');
    const section = heading.closest('.border-t');
    const checkbox = section?.querySelector('input[type="checkbox"]');
    fireEvent.click(checkbox!);
    expect(mockUpdateColorGrading).toHaveBeenCalledWith(
      expect.objectContaining({ enabled: true }),
    );
  });

  // ── Sharpening ────────────────────────────────────────────────────────

  it('enables sharpening', () => {
    setupStore();
    render(<SceneSettings />);
    const heading = screen.getByText('Sharpening');
    const section = heading.closest('.border-t');
    const checkbox = section?.querySelector('input[type="checkbox"]');
    fireEvent.click(checkbox!);
    expect(mockUpdateSharpening).toHaveBeenCalledWith(
      expect.objectContaining({ enabled: true }),
    );
  });

  // ── Depth of Field ────────────────────────────────────────────────────

  it('enables depth of field', () => {
    setupStore();
    render(<SceneSettings />);
    const heading = screen.getByText('Depth of Field');
    const section = heading.closest('.border-t');
    const checkbox = section?.querySelector('input[type="checkbox"]');
    fireEvent.click(checkbox!);
    expect(mockUpdateDepthOfField).toHaveBeenCalledWith(
      expect.objectContaining({ mode: 'gaussian', focalDistance: 10.0 }),
    );
  });

  // ── Motion Blur ───────────────────────────────────────────────────────

  it('enables motion blur', () => {
    setupStore();
    render(<SceneSettings />);
    const heading = screen.getByText('Motion Blur');
    const section = heading.closest('.border-t');
    const checkbox = section?.querySelector('input[type="checkbox"]');
    fireEvent.click(checkbox!);
    expect(mockUpdateMotionBlur).toHaveBeenCalledWith(
      expect.objectContaining({ shutterAngle: 0.5, samples: 4 }),
    );
  });

  // ── Mobile Controls ───────────────────────────────────────────────────

  it('enables mobile controls', () => {
    setupStore();
    render(<SceneSettings />);
    const heading = screen.getByText('Mobile Controls');
    const section = heading.closest('.border-t');
    const checkbox = section?.querySelector('input[type="checkbox"]');
    fireEvent.click(checkbox!);
    expect(mockUpdateMobileTouchConfig).toHaveBeenCalledWith(
      expect.objectContaining({ enabled: true }),
    );
  });

  // ── Upload / Generate buttons ─────────────────────────────────────────

  it('renders Upload and Generate buttons in Environment', () => {
    setupStore();
    render(<SceneSettings />);
    expect(screen.getByText('Upload')).toBeDefined();
    expect(screen.getByText('Generate')).toBeDefined();
  });

  it('opens docs on help button', () => {
    setupStore();
    render(<SceneSettings />);
    fireEvent.click(screen.getByTitle('Documentation'));
    expect(mockNavigateDocs).toHaveBeenCalledWith('features/scene-management');
  });
});
