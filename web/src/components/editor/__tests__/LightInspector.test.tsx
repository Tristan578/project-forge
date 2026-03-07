import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup } from '@/test/utils/componentTestUtils';
import { LightInspector } from '../LightInspector';

vi.mock('@/stores/editorStore', () => ({
  useEditorStore: vi.fn(),
}));

vi.mock('lucide-react', () => {
  const stub = () => null;
  return new Proxy({ __esModule: true }, {
    get: (target, name) => (name in target ? (target as Record<string, unknown>)[name as string] : stub),
  });
});

vi.mock('@/components/ui/InfoTooltip', () => ({
  InfoTooltip: () => null,
}));

vi.mock('@/lib/colorUtils', () => ({
  linearToHex: () => '#ffffff',
  hexToLinear: () => [1, 1, 1],
  radToDeg: (v: number) => v * (180 / Math.PI),
  degToRad: (v: number) => v * (Math.PI / 180),
}));

import { useEditorStore } from '@/stores/editorStore';

function mockEditorStore(overrides: Record<string, unknown> = {}) {
  const state: Record<string, unknown> = {
    primaryId: null,
    primaryLight: null,
    updateLight: vi.fn(),
    ...overrides,
  };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  vi.mocked(useEditorStore).mockImplementation((selector: any) => selector(state));
}

describe('LightInspector', () => {
  beforeEach(() => vi.clearAllMocks());
  afterEach(() => cleanup());

  it('returns null when no light data exists', () => {
    mockEditorStore();
    const { container } = render(<LightInspector />);
    expect(container.innerHTML).toBe('');
  });

  it('renders point light heading and controls', () => {
    mockEditorStore({
      primaryId: 'light-1',
      primaryLight: {
        lightType: 'point',
        color: [1, 1, 1],
        intensity: 800,
        range: 20,
        radius: 0.1,
        innerAngle: 0,
        outerAngle: 0.78,
        shadowsEnabled: false,
        shadowDepthBias: 0.02,
        shadowNormalBias: 1.8,
      },
    });
    render(<LightInspector />);
    expect(screen.getByText('Light (Point)')).toBeDefined();
    expect(screen.getByText('Shadows')).toBeDefined();
  });

  it('renders directional light with illuminance label', () => {
    mockEditorStore({
      primaryId: 'light-1',
      primaryLight: {
        lightType: 'directional',
        color: [1, 1, 1],
        intensity: 50000,
        range: 0,
        radius: 0,
        innerAngle: 0,
        outerAngle: 0,
        shadowsEnabled: true,
        shadowDepthBias: 0.02,
        shadowNormalBias: 1.8,
      },
    });
    render(<LightInspector />);
    expect(screen.getByText('Light (Directional)')).toBeDefined();
    expect(screen.getByText('Illuminance')).toBeDefined();
    // Shadows enabled shows bias controls
    expect(screen.getByText('Depth Bias')).toBeDefined();
  });
});
