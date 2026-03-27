import { describe, it, expect } from 'vitest';
import { validateCustomTheme, type ValidatedTheme } from '../themeValidator';

describe('themeValidator', () => {
  const VALID_THEME = {
    schemaVersion: 1,
    name: 'Test',
    author: 'dev',
    description: 'A test theme',
    tokens: { '--sf-accent': '#ff00ff' },
  };

  // Happy path
  it('accepts valid complete theme', () => {
    const result = validateCustomTheme(VALID_THEME);
    expect(result.ok).toBe(true);
  });

  it('accepts empty tokens (inherits Dark)', () => {
    const result = validateCustomTheme({ ...VALID_THEME, tokens: {} });
    expect(result.ok).toBe(true);
  });

  // schemaVersion
  it('rejects missing schemaVersion', () => {
    const { schemaVersion: _sv, ...rest } = VALID_THEME;
    const result = validateCustomTheme(rest as unknown);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain('schemaVersion');
  });

  it.each([0, -1, 'latest', 2.5])('rejects invalid schemaVersion: %s', (v) => {
    const result = validateCustomTheme({ ...VALID_THEME, schemaVersion: v });
    expect(result.ok).toBe(false);
  });

  it('rejects future schemaVersion with specific message', () => {
    const result = validateCustomTheme({ ...VALID_THEME, schemaVersion: 2 });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toContain('This theme requires SpawnForge v2');
      expect(result.error).toContain('Your version supports v1');
    }
  });

  it('rejects JSON exceeding 50KB via byteSize parameter', () => {
    const result = validateCustomTheme(VALID_THEME, { byteSize: 60_000 });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain('50KB');
  });

  // Token value validation
  it('rejects CSS injection in color token', () => {
    const result = validateCustomTheme({
      ...VALID_THEME,
      tokens: { '--sf-accent': 'red; --x: url(evil)' },
    });
    expect(result.ok).toBe(false);
  });

  it('rejects url() in color token', () => {
    const result = validateCustomTheme({
      ...VALID_THEME,
      tokens: { '--sf-accent': 'url(javascript:alert(1))' },
    });
    expect(result.ok).toBe(false);
  });

  it('rejects null token value', () => {
    const result = validateCustomTheme({
      ...VALID_THEME,
      tokens: { '--sf-accent': null as unknown as string },
    });
    expect(result.ok).toBe(false);
  });

  it('rejects font not in allowlist', () => {
    const result = validateCustomTheme({
      ...VALID_THEME,
      tokens: { '--sf-font-ui': 'Comic Sans' },
    });
    expect(result.ok).toBe(false);
  });

  it('rejects font with url injection', () => {
    const result = validateCustomTheme({
      ...VALID_THEME,
      tokens: { '--sf-font-mono': "'x', url(//evil)" },
    });
    expect(result.ok).toBe(false);
  });

  it('rejects s unit in duration (ms only)', () => {
    const result = validateCustomTheme({
      ...VALID_THEME,
      tokens: { '--sf-transition': '3s' },
    });
    expect(result.ok).toBe(false);
  });

  // Minimum 50ms enforced
  it('rejects 0ms duration (minimum is 50ms)', () => {
    const result = validateCustomTheme({
      ...VALID_THEME,
      tokens: { '--sf-transition': '0ms' },
    });
    expect(result.ok).toBe(false);
  });

  it('rejects 1ms duration (minimum is 50ms)', () => {
    const result = validateCustomTheme({
      ...VALID_THEME,
      tokens: { '--sf-transition': '1ms' },
    });
    expect(result.ok).toBe(false);
  });

  it('rejects 49ms duration (minimum is 50ms)', () => {
    const result = validateCustomTheme({
      ...VALID_THEME,
      tokens: { '--sf-transition': '49ms' },
    });
    expect(result.ok).toBe(false);
  });

  it('accepts 50ms duration (minimum boundary)', () => {
    const result = validateCustomTheme({
      ...VALID_THEME,
      tokens: { '--sf-transition': '50ms' },
    });
    expect(result.ok).toBe(true);
  });

  it('accepts 150ms duration (typical transition)', () => {
    const result = validateCustomTheme({
      ...VALID_THEME,
      tokens: { '--sf-transition': '150ms' },
    });
    expect(result.ok).toBe(true);
  });

  it('rejects duration exceeding 2000ms', () => {
    const result = validateCustomTheme({
      ...VALID_THEME,
      tokens: { '--sf-transition': '5000ms' },
    });
    expect(result.ok).toBe(false);
  });

  it('rejects radius exceeding 64px', () => {
    const result = validateCustomTheme({
      ...VALID_THEME,
      tokens: { '--sf-radius-md': '100px' },
    });
    expect(result.ok).toBe(false);
  });

  it('drops unknown token keys', () => {
    const result = validateCustomTheme({
      ...VALID_THEME,
      tokens: { '--sf-accent': '#ff00ff', '--sf-custom-foo': '#000' },
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect((result.theme.tokens as Record<string, unknown>)['--sf-custom-foo']).toBeUndefined();
    }
  });

  // Metadata
  it('rejects name exceeding 64 chars', () => {
    const result = validateCustomTheme({ ...VALID_THEME, name: 'x'.repeat(200) });
    expect(result.ok).toBe(false);
  });

  it('rejects description exceeding 256 chars', () => {
    const result = validateCustomTheme({ ...VALID_THEME, description: 'x'.repeat(300) });
    expect(result.ok).toBe(false);
  });

  // Type check — ValidatedTheme is the branded return type
  it('returned theme has correct metadata', () => {
    const result = validateCustomTheme(VALID_THEME);
    expect(result.ok).toBe(true);
    if (result.ok) {
      const theme: ValidatedTheme = result.theme;
      expect(theme.name).toBe('Test');
      expect(theme.author).toBe('dev');
      expect(theme.schemaVersion).toBe(1);
    }
  });
});
