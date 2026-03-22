/**
 * Unit tests for lib/i18n/useTranslation.ts
 *
 * Verifies that useT delegates to next-intl's useTranslations and passes
 * the namespace argument through correctly.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

// ---------------------------------------------------------------------------
// Mock next-intl before importing the module under test.
// ---------------------------------------------------------------------------
const mockUseTranslations = vi.fn();

vi.mock('next-intl', () => ({
  useTranslations: mockUseTranslations,
}));

describe('useT', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('calls useTranslations with the given namespace', async () => {
    const mockT = vi.fn();
    mockUseTranslations.mockReturnValue(mockT);

    const { useT } = await import('@/lib/i18n/useTranslation');
    const result = useT('common');

    expect(mockUseTranslations).toHaveBeenCalledWith('common');
    expect(result).toBe(mockT);
  });

  it('calls useTranslations with editor namespace', async () => {
    const mockT = vi.fn();
    mockUseTranslations.mockReturnValue(mockT);

    const { useT } = await import('@/lib/i18n/useTranslation');
    const result = useT('editor');

    expect(mockUseTranslations).toHaveBeenCalledWith('editor');
    expect(result).toBe(mockT);
  });

  it('calls useTranslations with auth namespace', async () => {
    const mockT = vi.fn();
    mockUseTranslations.mockReturnValue(mockT);

    const { useT } = await import('@/lib/i18n/useTranslation');
    const result = useT('auth');

    expect(mockUseTranslations).toHaveBeenCalledWith('auth');
    expect(result).toBe(mockT);
  });

  it('calls useTranslations with undefined when no namespace given', async () => {
    const mockT = vi.fn();
    mockUseTranslations.mockReturnValue(mockT);

    const { useT } = await import('@/lib/i18n/useTranslation');
    const result = useT();

    expect(mockUseTranslations).toHaveBeenCalledWith(undefined);
    expect(result).toBe(mockT);
  });

  it('returns the translation function from useTranslations', async () => {
    const mockT = vi.fn().mockReturnValue('translated text');
    mockUseTranslations.mockReturnValue(mockT);

    const { useT } = await import('@/lib/i18n/useTranslation');
    const t = useT('common');

    expect(t).toBe(mockT);
  });

  it('passes through arbitrary namespace strings', async () => {
    const mockT = vi.fn();
    mockUseTranslations.mockReturnValue(mockT);

    const { useT } = await import('@/lib/i18n/useTranslation');
    useT('my.custom.namespace');

    expect(mockUseTranslations).toHaveBeenCalledWith('my.custom.namespace');
  });
});
