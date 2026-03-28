import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { ThemeImportExport } from '../ThemeImportExport';

vi.mock('../../utils/themeStorage', () => ({
  saveCustomTheme: vi.fn().mockResolvedValue(undefined),
  loadCustomTheme: vi.fn().mockResolvedValue(null),
  listCustomThemes: vi.fn().mockResolvedValue([]),
  deleteCustomTheme: vi.fn().mockResolvedValue(undefined),
}));

describe('ThemeImportExport', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('shows empty state when no custom themes', () => {
    render(<ThemeImportExport />);
    expect(screen.getByText('No custom themes yet.')).not.toBeNull();
  });

  it('shows Import button', () => {
    render(<ThemeImportExport />);
    expect(screen.getByRole('button', { name: /import/i })).not.toBeNull();
  });

  it('shows file-too-large error without parsing the file', async () => {
    render(<ThemeImportExport />);
    const file = new File([new ArrayBuffer(60_001)], 'huge.json', { type: 'application/json' });
    const input = document.querySelector('input[type="file"]') as HTMLInputElement;
    Object.defineProperty(input, 'files', { value: [file], configurable: true });
    fireEvent.change(input);
    await waitFor(() => expect(screen.getByText(/too large/i)).not.toBeNull());
  });

  it('shows specific error for invalid JSON', async () => {
    render(<ThemeImportExport />);
    const file = new File(['not json {'], 'bad.json', { type: 'application/json' });
    const input = document.querySelector('input[type="file"]') as HTMLInputElement;
    Object.defineProperty(input, 'files', { value: [file], configurable: true });
    fireEvent.change(input);
    await waitFor(() => expect(screen.getByText(/could not parse/i)).not.toBeNull());
  });

  it('shows success message after valid import', async () => {
    const { listCustomThemes, saveCustomTheme } = await import('../../utils/themeStorage');
    vi.mocked(listCustomThemes).mockResolvedValue([]);
    vi.mocked(saveCustomTheme).mockResolvedValue(undefined);

    render(<ThemeImportExport />);
    const validTheme = JSON.stringify({
      schemaVersion: 1, name: 'My Theme', author: 'test', description: '', tokens: {},
    });
    const file = new File([validTheme], 'theme.json', { type: 'application/json' });
    const input = document.querySelector('input[type="file"]') as HTMLInputElement;
    Object.defineProperty(input, 'files', { value: [file], configurable: true });
    fireEvent.change(input);
    await waitFor(() => expect(screen.getByText(/imported successfully/i)).not.toBeNull());
  });

  it('shows validation error for invalid theme JSON', async () => {
    render(<ThemeImportExport />);
    const badTheme = JSON.stringify({ name: 'Bad', tokens: {} }); // missing schemaVersion
    const file = new File([badTheme], 'bad-theme.json', { type: 'application/json' });
    const input = document.querySelector('input[type="file"]') as HTMLInputElement;
    Object.defineProperty(input, 'files', { value: [file], configurable: true });
    fireEvent.change(input);
    await waitFor(() => expect(screen.getByText(/invalid theme/i)).not.toBeNull());
  });

  it('renders hidden file input', () => {
    render(<ThemeImportExport />);
    const input = document.querySelector('input[type="file"]');
    expect(input).not.toBeNull();
    expect(input?.getAttribute('accept')).toContain('.json');
  });
});
