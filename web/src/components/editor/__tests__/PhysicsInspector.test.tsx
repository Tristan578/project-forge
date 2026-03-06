import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup } from '@/test/utils/componentTestUtils';
import { PhysicsInspector } from '../PhysicsInspector';

vi.mock('@/stores/editorStore', () => ({
  useEditorStore: vi.fn(),
}));

vi.mock('@/stores/workspaceStore', () => ({
  useWorkspaceStore: vi.fn((selector: (s: unknown) => unknown) => selector({
    navigateDocs: vi.fn(),
  })),
}));

vi.mock('lucide-react', () => {
  const stub = () => null;
  return new Proxy({ __esModule: true }, {
    get: (target, name) => (name in target ? (target as Record<string, unknown>)[name] : stub),
  });
});

vi.mock('@/components/ui/InfoTooltip', () => ({
  InfoTooltip: () => null,
}));

import { useEditorStore } from '@/stores/editorStore';

function mockEditorStore(overrides: Record<string, unknown> = {}) {
  const state: Record<string, unknown> = {
    primaryId: 'ent-1',
    primaryPhysics: null,
    physicsEnabled: false,
    updatePhysics: vi.fn(),
    togglePhysics: vi.fn(),
    ...overrides,
  };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  vi.mocked(useEditorStore).mockImplementation((selector: any) => selector(state));
}

describe('PhysicsInspector', () => {
  beforeEach(() => vi.clearAllMocks());
  afterEach(() => cleanup());

  it('renders physics heading with enabled toggle', () => {
    mockEditorStore();
    render(<PhysicsInspector />);
    expect(screen.getByText('Physics')).toBeDefined();
    expect(screen.getByText('Enabled')).toBeDefined();
  });

  it('shows detailed settings when physics is enabled', () => {
    mockEditorStore({
      physicsEnabled: true,
      primaryPhysics: {
        bodyType: 'dynamic',
        colliderShape: 'auto',
        restitution: 0.3,
        friction: 0.5,
        density: 1.0,
        gravityScale: 1.0,
        lockTranslationX: false,
        lockTranslationY: false,
        lockTranslationZ: false,
        lockRotationX: false,
        lockRotationY: false,
        lockRotationZ: false,
        isSensor: false,
      },
    });
    render(<PhysicsInspector />);
    expect(screen.getByText('Body Type')).toBeDefined();
    expect(screen.getByText('Collider')).toBeDefined();
    expect(screen.getByText('Restitution')).toBeDefined();
    expect(screen.getByText('Friction')).toBeDefined();
  });

  it('hides detailed settings when physics is disabled', () => {
    mockEditorStore({ physicsEnabled: false });
    render(<PhysicsInspector />);
    expect(screen.queryByText('Body Type')).toBeNull();
  });
});
