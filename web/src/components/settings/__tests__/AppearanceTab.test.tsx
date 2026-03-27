/**
 * Tests for AppearanceTab — theme select and effects toggle.
 *
 * @vitest-environment jsdom
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@/test/utils/componentTestUtils';
import { AppearanceTab } from '../AppearanceTab';

// ── @spawnforge/ui mock ────────────────────────────────────────────────────

const mockSetTheme = vi.fn();
const mockSetEffectsEnabled = vi.fn();

vi.mock('@spawnforge/ui', () => ({
  useTheme: () => ({
    theme: 'dark',
    setTheme: mockSetTheme,
    effectsEnabled: true,
    setEffectsEnabled: mockSetEffectsEnabled,
  }),
  THEME_NAMES: ['dark', 'light', 'ember', 'ice', 'leaf', 'rust', 'mech'],
}));

// ── Tests ──────────────────────────────────────────────────────────────────

describe('AppearanceTab', () => {
  beforeEach(() => {
    mockSetTheme.mockClear();
    mockSetEffectsEnabled.mockClear();
  });

  afterEach(() => {
    cleanup();
  });

  it('renders theme select with 7 options', () => {
    render(<AppearanceTab />);
    const select = screen.getByRole('combobox');
    expect(select).toBeDefined();
    const options = screen.getAllByRole('option');
    expect(options).toHaveLength(7);
  });

  it('renders effects checkbox', () => {
    render(<AppearanceTab />);
    const checkbox = screen.getByLabelText('Ambient effects');
    expect(checkbox).toBeDefined();
    expect((checkbox as HTMLInputElement).checked).toBe(true);
  });

  it('calls setTheme when select value changes', () => {
    render(<AppearanceTab />);
    const select = screen.getByRole('combobox');
    fireEvent.change(select, { target: { value: 'ember' } });
    expect(mockSetTheme).toHaveBeenCalledWith('ember');
    expect(mockSetTheme).toHaveBeenCalledTimes(1);
  });

  it('calls setEffectsEnabled when checkbox changes', () => {
    render(<AppearanceTab />);
    const checkbox = screen.getByLabelText('Ambient effects');
    fireEvent.click(checkbox);
    expect(mockSetEffectsEnabled).toHaveBeenCalledTimes(1);
  });
});
