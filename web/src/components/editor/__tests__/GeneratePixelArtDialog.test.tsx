/**
 * Tests for GeneratePixelArtDialog — rendering, form controls,
 * submit behavior, token display, close behavior.
 *
 * @vitest-environment jsdom
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@/test/utils/componentTestUtils';
import { GeneratePixelArtDialog } from '../GeneratePixelArtDialog';
import { useGenerationStore } from '@/stores/generationStore';
import { useUserStore } from '@/stores/userStore';

vi.mock('@/stores/generationStore', () => ({
  useGenerationStore: vi.fn(() => ({})),
}));

vi.mock('@/stores/userStore', () => ({
  useUserStore: vi.fn(() => ({})),
}));

const mockAddJob = vi.fn();

function setupStores(overrides: { tokenBalance?: number } = {}) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  vi.mocked(useGenerationStore).mockImplementation((selector: any) => {
    const state = { addJob: mockAddJob };
    return selector(state);
  });

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  vi.mocked(useUserStore).mockImplementation((selector: any) => {
    const state = {
      tokenBalance: { total: overrides.tokenBalance ?? 100 },
    };
    return selector(state);
  });
}

const defaultProps = {
  isOpen: true,
  onClose: vi.fn(),
};

describe('GeneratePixelArtDialog', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setupStores();
  });

  afterEach(() => {
    cleanup();
  });

  // ── Visibility ────────────────────────────────────────────────────────

  it('should not render when closed', () => {
    const { container } = render(
      <GeneratePixelArtDialog isOpen={false} onClose={vi.fn()} />,
    );
    expect(container.innerHTML).toBe('');
  });

  it('should render when open', () => {
    render(<GeneratePixelArtDialog {...defaultProps} />);
    expect(screen.getByText('Generate Pixel Art')).not.toBeNull();
  });

  // ── Form controls ─────────────────────────────────────────────────────

  it('should show prompt input', () => {
    render(<GeneratePixelArtDialog {...defaultProps} />);
    expect(
      screen.getByPlaceholderText(/describe your pixel art/i),
    ).not.toBeNull();
  });

  it('should show style selector', () => {
    render(<GeneratePixelArtDialog {...defaultProps} />);
    expect(screen.getByText('Style')).not.toBeNull();
    expect(screen.getByText('Character')).not.toBeNull();
  });

  it('should show size options', () => {
    render(<GeneratePixelArtDialog {...defaultProps} />);
    expect(screen.getByText('16px')).not.toBeNull();
    expect(screen.getByText('32px')).not.toBeNull();
    expect(screen.getByText('64px')).not.toBeNull();
    expect(screen.getByText('128px')).not.toBeNull();
  });

  it('should show palette selector with preview swatches', () => {
    render(<GeneratePixelArtDialog {...defaultProps} />);
    expect(screen.getByText('Palette')).not.toBeNull();
  });

  it('should show dithering selector', () => {
    render(<GeneratePixelArtDialog {...defaultProps} />);
    expect(screen.getByText('Dithering')).not.toBeNull();
  });

  it('should show token cost and balance', () => {
    render(<GeneratePixelArtDialog {...defaultProps} />);
    expect(screen.getByText(/Cost: 10 tokens/)).not.toBeNull();
    expect(screen.getByText(/Balance: 100/)).not.toBeNull();
  });

  // ── Submit button state ───────────────────────────────────────────────

  it('should disable submit with empty prompt', () => {
    render(<GeneratePixelArtDialog {...defaultProps} />);
    const button = screen.getByRole('button', { name: /generate/i });
    expect(button).toHaveProperty('disabled', true);
  });

  it('should disable submit with short prompt', () => {
    render(<GeneratePixelArtDialog {...defaultProps} />);
    const input = screen.getByPlaceholderText(/describe your pixel art/i);
    fireEvent.change(input, { target: { value: 'ab' } });
    const button = screen.getByRole('button', { name: /generate/i });
    expect(button).toHaveProperty('disabled', true);
  });

  it('should enable submit with valid prompt', () => {
    render(<GeneratePixelArtDialog {...defaultProps} />);
    const input = screen.getByPlaceholderText(/describe your pixel art/i);
    fireEvent.change(input, { target: { value: 'a warrior knight with sword' } });
    const button = screen.getByRole('button', { name: /generate/i });
    expect(button).toHaveProperty('disabled', false);
  });

  it('should disable submit when token balance is too low', () => {
    setupStores({ tokenBalance: 5 });
    render(<GeneratePixelArtDialog {...defaultProps} />);
    const input = screen.getByPlaceholderText(/describe your pixel art/i);
    fireEvent.change(input, { target: { value: 'a warrior knight' } });
    const button = screen.getByRole('button', { name: /generate/i });
    expect(button).toHaveProperty('disabled', true);
  });

  // ── Close behavior ────────────────────────────────────────────────────

  it('should call onClose when X button is clicked', () => {
    const onClose = vi.fn();
    render(<GeneratePixelArtDialog isOpen={true} onClose={onClose} />);
    const headerButtons = document.querySelectorAll(
      '.flex.items-center.justify-between button',
    );
    fireEvent.click(headerButtons[0]);
    expect(onClose).toHaveBeenCalledOnce();
  });

  // ── Size selection ────────────────────────────────────────────────────

  it('should highlight selected size', () => {
    render(<GeneratePixelArtDialog {...defaultProps} />);
    const btn32 = screen.getByText('32px');
    expect(btn32.className).toContain('bg-blue-600');
  });

  it('should change selected size on click', () => {
    render(<GeneratePixelArtDialog {...defaultProps} />);
    const btn64 = screen.getByText('64px');
    fireEvent.click(btn64);
    expect(btn64.className).toContain('bg-blue-600');
  });

  // ── Dithering intensity ───────────────────────────────────────────────

  it('should not show intensity slider when dithering is none', () => {
    render(<GeneratePixelArtDialog {...defaultProps} />);
    expect(screen.queryByText(/Intensity:/)).toBeNull();
  });
});
