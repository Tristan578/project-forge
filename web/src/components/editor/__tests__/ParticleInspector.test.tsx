import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup } from '@/test/utils/componentTestUtils';
import { ParticleInspector } from '../ParticleInspector';

vi.mock('@/stores/editorStore', () => ({
  useEditorStore: vi.fn(),
}));

vi.mock('@/stores/workspaceStore', () => ({
  useWorkspaceStore: vi.fn((selector: (s: unknown) => unknown) => selector({
    navigateDocs: vi.fn(),
  })),
}));

vi.mock('lucide-react', () => new Proxy({}, {
  get: (_, name) => {
    if (name === '__esModule') return true;
    return vi.fn(() => null);
  },
}));

vi.mock('@/components/ui/InfoTooltip', () => ({
  InfoTooltip: () => null,
}));

import { useEditorStore } from '@/stores/editorStore';

function mockEditorStore(overrides: Record<string, unknown> = {}) {
  const state: Record<string, unknown> = {
    primaryId: 'ent-1',
    primaryParticle: null,
    particleEnabled: false,
    setParticle: vi.fn(),
    removeParticle: vi.fn(),
    toggleParticle: vi.fn(),
    setParticlePreset: vi.fn(),
    playParticle: vi.fn(),
    stopParticle: vi.fn(),
    burstParticle: vi.fn(),
    ...overrides,
  };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  vi.mocked(useEditorStore).mockImplementation((selector: any) => selector(state));
}

describe('ParticleInspector', () => {
  beforeEach(() => vi.clearAllMocks());
  afterEach(() => cleanup());

  it('shows Add Particles button when no particle data exists', () => {
    mockEditorStore();
    render(<ParticleInspector />);
    expect(screen.getByText('Particles')).toBeDefined();
    expect(screen.getByText('Add Particles')).toBeDefined();
  });

  it('shows particle controls when particle data exists', () => {
    mockEditorStore({
      primaryParticle: {
        preset: 'fire',
        spawnerMode: { type: 'continuous', rate: 50 },
        maxParticles: 5000,
        lifetimeMin: 0.5,
        lifetimeMax: 2.0,
        emissionShape: { type: 'point' },
        velocityMin: [0, 1, 0],
        velocityMax: [0, 3, 0],
        acceleration: [0, -9.8, 0],
        linearDrag: 0,
        sizeStart: 0.1,
        sizeEnd: 0.01,
        colorGradient: [
          { position: 0, color: [1, 0.5, 0, 1] },
          { position: 1, color: [1, 0, 0, 0] },
        ],
        blendMode: 'additive',
        orientation: 'billboard',
        worldSpace: true,
      },
      particleEnabled: true,
    });
    render(<ParticleInspector />);
    expect(screen.getByText('Spawner')).toBeDefined();
    expect(screen.getByText('Lifetime')).toBeDefined();
    expect(screen.getByText('Play')).toBeDefined();
    expect(screen.getByText('Burst')).toBeDefined();
    expect(screen.getByText('Remove Particles')).toBeDefined();
  });
});
