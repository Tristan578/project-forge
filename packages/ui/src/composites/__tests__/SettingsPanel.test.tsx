import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { SettingsPanel } from '../SettingsPanel';
import { THEME_NAMES } from '../../tokens';

describe('SettingsPanel', () => {
  const defaultProps = {
    currentTheme: 'dark' as const,
    onThemeChange: vi.fn(),
    effectsEnabled: true,
    onEffectsChange: vi.fn(),
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders all 7 theme cards', () => {
    render(<SettingsPanel {...defaultProps} />);
    for (const theme of THEME_NAMES) {
      expect(screen.getByRole('radio', { name: new RegExp(theme, 'i') })).not.toBeNull();
    }
  });

  it('marks active theme as aria-checked=true', () => {
    render(<SettingsPanel {...defaultProps} currentTheme="ember" />);
    const emberCard = screen.getByRole('radio', { name: /ember/i });
    expect(emberCard.getAttribute('aria-checked')).toBe('true');
  });

  it('marks inactive themes as aria-checked=false', () => {
    render(<SettingsPanel {...defaultProps} currentTheme="dark" />);
    const lightCard = screen.getByRole('radio', { name: /light/i });
    expect(lightCard.getAttribute('aria-checked')).toBe('false');
  });

  it('calls onThemeChange when a card is clicked', () => {
    const onThemeChange = vi.fn();
    render(<SettingsPanel {...defaultProps} onThemeChange={onThemeChange} />);
    const iceCard = screen.getByRole('radio', { name: /ice/i });
    fireEvent.click(iceCard);
    expect(onThemeChange).toHaveBeenCalledWith('ice');
  });

  it('supports ArrowRight keyboard navigation', () => {
    const onThemeChange = vi.fn();
    render(<SettingsPanel {...defaultProps} onThemeChange={onThemeChange} />);
    const grid = screen.getByRole('radiogroup');
    fireEvent.keyDown(grid, { key: 'ArrowRight' });
    fireEvent.keyDown(grid, { key: 'Enter' });
    expect(onThemeChange).toHaveBeenCalled();
  });

  it('supports ArrowLeft keyboard navigation', () => {
    const onThemeChange = vi.fn();
    render(<SettingsPanel {...defaultProps} onThemeChange={onThemeChange} />);
    const grid = screen.getByRole('radiogroup');
    // Focus first, then go left (wraps around)
    fireEvent.keyDown(grid, { key: 'ArrowLeft' });
    fireEvent.keyDown(grid, { key: 'Enter' });
    expect(onThemeChange).toHaveBeenCalled();
  });

  it('renders effects toggle', () => {
    render(<SettingsPanel {...defaultProps} />);
    // getAllByText because Switch also renders a label with matching text
    const matches = screen.getAllByText(/ambient effects/i);
    expect(matches.length).toBeGreaterThan(0);
  });

  it('shows per-project checkboxes when showPerProjectCheckbox=true', () => {
    render(<SettingsPanel {...defaultProps} showPerProjectCheckbox />);
    const projectCheckboxes = screen.getAllByLabelText(/set .* as project theme/i);
    expect(projectCheckboxes).toHaveLength(THEME_NAMES.length);
  });

  it('does not show per-project checkboxes by default', () => {
    render(<SettingsPanel {...defaultProps} />);
    const projectCheckboxes = screen.queryAllByLabelText(/set .* as project theme/i);
    expect(projectCheckboxes).toHaveLength(0);
  });

  it('calls onProjectThemeChange when per-project checkbox is clicked', () => {
    const onProjectThemeChange = vi.fn();
    render(
      <SettingsPanel
        {...defaultProps}
        showPerProjectCheckbox
        onProjectThemeChange={onProjectThemeChange}
      />,
    );
    const checkboxes = screen.getAllByLabelText(/set .* as project theme/i);
    fireEvent.click(checkboxes[0]);
    expect(onProjectThemeChange).toHaveBeenCalled();
  });

  it('radiogroup has correct aria-label', () => {
    render(<SettingsPanel {...defaultProps} />);
    const grid = screen.getByRole('radiogroup');
    expect(grid.getAttribute('aria-label')).toBe('Select theme');
  });
});
