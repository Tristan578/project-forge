'use client';

import { useCallback, useState, useEffect, useRef } from 'react';
import { THEME_NAMES, THEME_DEFINITIONS, type ThemeName } from '../tokens';
import { Switch } from '../primitives/Switch';
import { cn } from '../utils/cn';

export interface SettingsPanelProps {
  currentTheme: ThemeName;
  onThemeChange: (theme: ThemeName) => void;
  effectsEnabled: boolean;
  onEffectsChange: (enabled: boolean) => void;
  /** If true, shows per-project theme override checkbox per card */
  showPerProjectCheckbox?: boolean;
  /** The per-project theme override (if any) */
  projectTheme?: ThemeName | null;
  onProjectThemeChange?: (theme: ThemeName | null) => void;
  className?: string;
}

interface ThemeCardProps {
  theme: ThemeName;
  isActive: boolean;
  isProjectTheme: boolean;
  showPerProjectCheckbox: boolean;
  onSelect: () => void;
  onProjectToggle: (checked: boolean) => void;
  tabIndex: number;
  isFocused: boolean;
}

function ThemeCard({
  theme,
  isActive,
  isProjectTheme,
  showPerProjectCheckbox,
  onSelect,
  onProjectToggle,
  tabIndex,
  isFocused,
}: ThemeCardProps) {
  const tokens = THEME_DEFINITIONS[theme];
  const bg = tokens['--sf-bg-app'];
  const accent = tokens['--sf-accent'];
  const text = tokens['--sf-text'];

  return (
    <div
      role="radio"
      aria-checked={isActive}
      tabIndex={tabIndex}
      aria-label={theme}
      data-sf-theme-card={theme}
      className={cn(
        'relative flex flex-col gap-2 rounded-[var(--sf-radius-lg)] border p-3',
        'cursor-pointer select-none transition-colors duration-[var(--sf-transition)]',
        isActive
          ? 'border-[var(--sf-accent)] ring-2 ring-[var(--sf-accent)] ring-offset-1 ring-offset-[var(--sf-bg-app)]'
          : 'border-[var(--sf-border)] hover:border-[var(--sf-border-strong)]',
        isFocused && 'outline-none ring-2 ring-[var(--sf-accent)]',
      )}
      onClick={onSelect}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          onSelect();
        }
      }}
    >
      {/* Mini preview: 3 color swatches */}
      <div
        className="flex gap-1 rounded-[var(--sf-radius-sm)] overflow-hidden h-8"
        aria-hidden="true"
      >
        <div className="flex-1" style={{ background: bg }} />
        <div className="flex-1" style={{ background: accent }} />
        <div className="flex-1" style={{ background: text }} />
      </div>

      {/* Theme name */}
      <span className="text-[var(--sf-text)] text-xs font-medium capitalize">{theme}</span>

      {/* Active checkmark */}
      {isActive && (
        <div
          className="absolute top-2 right-2 flex h-4 w-4 items-center justify-center rounded-full bg-[var(--sf-accent)]"
          aria-hidden="true"
        >
          <svg width="8" height="6" viewBox="0 0 8 6" fill="none">
            <path
              d="M1 3L3 5L7 1"
              stroke="white"
              strokeWidth="1.5"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        </div>
      )}

      {/* Per-project checkbox */}
      {showPerProjectCheckbox && (
        <label
          className="flex items-center gap-1.5 text-[var(--sf-text-muted)] text-xs cursor-pointer"
          onClick={(e) => e.stopPropagation()}
        >
          <input
            type="checkbox"
            checked={isProjectTheme}
            onChange={(e) => onProjectToggle(e.target.checked)}
            className="rounded border-[var(--sf-border)] accent-[var(--sf-accent)]"
            aria-label={`Set ${theme} as project theme`}
          />
          Project
        </label>
      )}
    </div>
  );
}

export function SettingsPanel({
  currentTheme,
  onThemeChange,
  effectsEnabled,
  onEffectsChange,
  showPerProjectCheckbox = false,
  projectTheme,
  onProjectThemeChange,
  className,
}: SettingsPanelProps) {
  const [focusedIndex, setFocusedIndex] = useState<number>(-1);
  const [reducedMotion, setReducedMotion] = useState(false);
  const gridRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const mql = window.matchMedia('(prefers-reduced-motion: reduce)');
    setReducedMotion(mql.matches);
    const handler = (e: MediaQueryListEvent) => setReducedMotion(e.matches);
    mql.addEventListener('change', handler);
    return () => mql.removeEventListener('change', handler);
  }, []);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLDivElement>) => {
      const count = THEME_NAMES.length;
      if (e.key === 'ArrowRight' || e.key === 'ArrowDown') {
        e.preventDefault();
        setFocusedIndex((prev) => (prev + 1) % count);
      } else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') {
        e.preventDefault();
        setFocusedIndex((prev) => (prev - 1 + count) % count);
      } else if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        if (focusedIndex >= 0 && focusedIndex < count) {
          onThemeChange(THEME_NAMES[focusedIndex]);
        }
      }
    },
    [focusedIndex, onThemeChange],
  );

  return (
    <section className={cn('space-y-4', className)} aria-labelledby="theme-switcher-label">
      <h3
        id="theme-switcher-label"
        className="text-[var(--sf-text-secondary)] text-xs font-semibold uppercase tracking-wide"
      >
        Theme
      </h3>

      {/* Swatch grid — keyboard navigable as radiogroup */}
      <div
        ref={gridRef}
        role="radiogroup"
        aria-label="Select theme"
        className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4"
        onKeyDown={handleKeyDown}
      >
        {THEME_NAMES.map((theme, i) => (
          <ThemeCard
            key={theme}
            theme={theme}
            isActive={currentTheme === theme}
            isProjectTheme={projectTheme === theme}
            showPerProjectCheckbox={showPerProjectCheckbox}
            onSelect={() => {
              setFocusedIndex(i);
              onThemeChange(theme);
            }}
            onProjectToggle={(checked) => {
              onProjectThemeChange?.(checked ? theme : null);
            }}
            tabIndex={i === 0 ? 0 : -1}
            isFocused={focusedIndex === i}
          />
        ))}
      </div>

      {/* Effects toggle */}
      <div className="flex items-center justify-between">
        <label className="text-[var(--sf-text)] text-sm">
          Ambient effects
          {reducedMotion && (
            <span className="ml-2 text-[var(--sf-text-muted)] text-xs">(disabled by system)</span>
          )}
        </label>
        <Switch
          checked={effectsEnabled && !reducedMotion}
          onChange={onEffectsChange}
          disabled={reducedMotion}
          label="Toggle ambient effects"
        />
      </div>
    </section>
  );
}
