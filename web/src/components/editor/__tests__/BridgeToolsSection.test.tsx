/**
 * Render tests for BridgeToolsSection component.
 *
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@/test/utils/componentTestUtils';
import { BridgeToolsSection } from '../BridgeToolsSection';
import { useEditorStore } from '@/stores/editorStore';

vi.mock('@/stores/editorStore', () => ({
  useEditorStore: vi.fn(() => ({})),
}));

const mockFetch = vi.fn();
global.fetch = mockFetch;

describe('BridgeToolsSection', () => {
  const mockSetBridgeTool = vi.fn();

  function setupStore({
    bridgeTools = {} as Record<string, { id: string; name: string; status: string; activeVersion?: string }>,
  } = {}) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    vi.mocked(useEditorStore).mockImplementation((selector: any) => {
      const state = {
        bridgeTools,
        setBridgeTool: mockSetBridgeTool,
      };
      return typeof selector === 'function' ? selector(state) : state;
    });
  }

  beforeEach(() => {
    vi.clearAllMocks();
    setupStore();
  });

  afterEach(() => {
    cleanup();
  });

  it('renders Bridge Tools heading', () => {
    render(<BridgeToolsSection />);
    expect(screen.getByText('Bridge Tools')).toBeInTheDocument();
  });

  it('shows "No tools discovered yet" when empty', () => {
    render(<BridgeToolsSection />);
    expect(screen.getByText('No tools discovered yet.')).toBeInTheDocument();
  });

  it('renders Discover Aseprite button', () => {
    render(<BridgeToolsSection />);
    expect(screen.getByText('Discover Aseprite')).toBeInTheDocument();
  });

  it('renders tool name when bridgeTools exist', () => {
    setupStore({
      bridgeTools: {
        aseprite: { id: 'aseprite', name: 'Aseprite', status: 'connected', activeVersion: '1.3' },
      },
    });
    render(<BridgeToolsSection />);
    expect(screen.getByText('Aseprite')).toBeInTheDocument();
  });

  it('shows Connected status for connected tool', () => {
    setupStore({
      bridgeTools: {
        aseprite: { id: 'aseprite', name: 'Aseprite', status: 'connected' },
      },
    });
    render(<BridgeToolsSection />);
    expect(screen.getByText('Connected')).toBeInTheDocument();
  });

  it('shows Not Found status for not_found tool', () => {
    setupStore({
      bridgeTools: {
        aseprite: { id: 'aseprite', name: 'Aseprite', status: 'not_found' },
      },
    });
    render(<BridgeToolsSection />);
    expect(screen.getByText('Not Found')).toBeInTheDocument();
  });

  it('shows version when activeVersion provided', () => {
    setupStore({
      bridgeTools: {
        aseprite: { id: 'aseprite', name: 'Aseprite', status: 'connected', activeVersion: '1.3' },
      },
    });
    render(<BridgeToolsSection />);
    expect(screen.getByText('v1.3')).toBeInTheDocument();
  });

  it('shows Discovering... during discovery', async () => {
    // Mock fetch to return a pending promise so discovering state persists
    mockFetch.mockReturnValue(new Promise(() => {}));
    render(<BridgeToolsSection />);
    fireEvent.click(screen.getByText('Discover Aseprite'));
    expect(screen.getByText('Discovering...')).toBeInTheDocument();
  });

  it('shows error message on failed discovery', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      json: async () => ({ error: 'Aseprite not found in PATH' }),
    });
    render(<BridgeToolsSection />);
    fireEvent.click(screen.getByText('Discover Aseprite'));
    // Wait for async update
    await vi.waitFor(() => {
      expect(screen.getByText('Aseprite not found in PATH')).toBeInTheDocument();
    });
  });

  it('calls setBridgeTool on successful discovery', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ id: 'aseprite', name: 'Aseprite', status: 'connected' }),
    });
    render(<BridgeToolsSection />);
    fireEvent.click(screen.getByText('Discover Aseprite'));
    await vi.waitFor(() => {
      expect(mockSetBridgeTool).toHaveBeenCalledWith(
        expect.objectContaining({ id: 'aseprite' })
      );
    });
  });
});
