/**
 * Render tests for ThemeEditor component.
 *
 * Tests cover preset picker visibility, applying presets, editing individual
 * theme fields (color inputs, font family select, numeric inputs), and
 * the "Apply to All Widgets" button.
 *
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@/test/utils/componentTestUtils';
import { ThemeEditor } from '../ThemeEditor';
import { useUIBuilderStore } from '@/stores/uiBuilderStore';
import type { UITheme } from '@/stores/uiBuilderStore';

vi.mock('@/stores/uiBuilderStore', () => ({
  useUIBuilderStore: vi.fn(() => ({})),
}));

const DARK_THEME: UITheme = {
  primaryColor: '#3b82f6',
  secondaryColor: '#8b5cf6',
  backgroundColor: '#18181b',
  textColor: '#ffffff',
  fontFamily: 'system-ui',
  fontSize: 16,
  borderRadius: 4,
};

describe('ThemeEditor', () => {
  const mockApplyTheme = vi.fn();

  function setupStore(globalTheme: UITheme | null = null) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    vi.mocked(useUIBuilderStore).mockImplementation((selector: any) => {
      const state = {
        globalTheme,
        applyTheme: mockApplyTheme,
      };
      return typeof selector === 'function' ? selector(state) : state;
    });
  }

  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    cleanup();
  });

  it('renders the Theme Presets button', () => {
    setupStore();
    render(<ThemeEditor />);
    expect(screen.getByText('Theme Presets')).toBeDefined();
  });

  it('renders the Apply to All Widgets button', () => {
    setupStore();
    render(<ThemeEditor />);
    expect(screen.getByText('Apply to All Widgets')).toBeDefined();
  });

  it('preset list is hidden initially', () => {
    setupStore();
    render(<ThemeEditor />);
    expect(screen.queryByText('Dark')).toBeNull();
  });

  it('shows preset list when Theme Presets is clicked', () => {
    setupStore();
    render(<ThemeEditor />);
    fireEvent.click(screen.getByText('Theme Presets'));
    expect(screen.getByText('Dark')).toBeDefined();
    expect(screen.getByText('Light')).toBeDefined();
    expect(screen.getByText('Sci-Fi')).toBeDefined();
    expect(screen.getByText('Fantasy')).toBeDefined();
    expect(screen.getByText('Retro')).toBeDefined();
  });

  it('hides preset list when Theme Presets is clicked again', () => {
    setupStore();
    render(<ThemeEditor />);
    fireEvent.click(screen.getByText('Theme Presets'));
    fireEvent.click(screen.getByText('Theme Presets'));
    expect(screen.queryByText('Dark')).toBeNull();
  });

  it('calls applyTheme with Dark preset and closes list when Dark is selected', () => {
    setupStore();
    render(<ThemeEditor />);
    fireEvent.click(screen.getByText('Theme Presets'));
    fireEvent.click(screen.getByText('Dark'));
    expect(mockApplyTheme).toHaveBeenCalledWith(
      expect.objectContaining({
        primaryColor: '#3b82f6',
        fontFamily: 'system-ui',
      })
    );
    // Preset list should close after selection
    expect(screen.queryByText('Light')).toBeNull();
  });

  it('calls applyTheme with Sci-Fi preset', () => {
    setupStore();
    render(<ThemeEditor />);
    fireEvent.click(screen.getByText('Theme Presets'));
    fireEvent.click(screen.getByText('Sci-Fi'));
    expect(mockApplyTheme).toHaveBeenCalledWith(
      expect.objectContaining({
        primaryColor: '#00ffff',
        fontFamily: 'monospace',
      })
    );
  });

  it('calls applyTheme with Fantasy preset', () => {
    setupStore();
    render(<ThemeEditor />);
    fireEvent.click(screen.getByText('Theme Presets'));
    fireEvent.click(screen.getByText('Fantasy'));
    expect(mockApplyTheme).toHaveBeenCalledWith(
      expect.objectContaining({
        primaryColor: '#d97706',
        fontFamily: 'serif',
      })
    );
  });

  it('renders font family select with all options', () => {
    setupStore();
    render(<ThemeEditor />);
    expect(screen.getByRole('option', { name: 'System UI' })).toBeDefined();
    expect(screen.getByRole('option', { name: 'Monospace' })).toBeDefined();
    expect(screen.getByRole('option', { name: 'Serif' })).toBeDefined();
    expect(screen.getByRole('option', { name: 'Sans-serif' })).toBeDefined();
  });

  it('calls applyTheme when font family is changed', () => {
    setupStore(DARK_THEME);
    render(<ThemeEditor />);
    const fontSelect = screen.getByDisplayValue('System UI');
    fireEvent.change(fontSelect, { target: { value: 'monospace' } });
    expect(mockApplyTheme).toHaveBeenCalledWith({
      ...DARK_THEME,
      fontFamily: 'monospace',
    });
  });

  it('calls applyTheme when font size is changed', () => {
    setupStore(DARK_THEME);
    render(<ThemeEditor />);
    const fontSizeInput = screen.getByDisplayValue('16');
    fireEvent.change(fontSizeInput, { target: { value: '20' } });
    expect(mockApplyTheme).toHaveBeenCalledWith({
      ...DARK_THEME,
      fontSize: 20,
    });
  });

  it('calls applyTheme when border radius is changed', () => {
    setupStore(DARK_THEME);
    render(<ThemeEditor />);
    const borderRadiusInput = screen.getByDisplayValue('4');
    fireEvent.change(borderRadiusInput, { target: { value: '8' } });
    expect(mockApplyTheme).toHaveBeenCalledWith({
      ...DARK_THEME,
      borderRadius: 8,
    });
  });

  it('calls applyTheme with current theme when Apply to All Widgets is clicked', () => {
    setupStore(DARK_THEME);
    render(<ThemeEditor />);
    fireEvent.click(screen.getByText('Apply to All Widgets'));
    expect(mockApplyTheme).toHaveBeenCalledWith(DARK_THEME);
  });

  it('falls back to Dark preset values when globalTheme is null', () => {
    // When globalTheme is null, component uses the built-in Dark preset
    setupStore(null);
    render(<ThemeEditor />);
    // The font select should show the Dark preset default (system-ui -> "System UI")
    expect(screen.getByDisplayValue('System UI')).toBeDefined();
  });
});
