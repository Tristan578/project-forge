'use client';

import { useId, useRef, useState } from 'react';

export interface CommandFilterProps {
  /** All available categories from the MCP manifest */
  categories: string[];
  /** All available scopes (e.g. "scene:read", "query:*") */
  scopes: string[];
  /** Total unfiltered command count — displayed in the status region */
  totalCommands: number;
  /** Visible command count after filters are applied (controlled by parent) */
  visibleCount?: number;
  /**
   * Optional callback fired when filters change.
   * Safe to omit when rendered from a Server Component — the filter state is
   * managed internally. Pass this only when the parent needs to respond to
   * filter changes (e.g. updating URL search params from a Client Component).
   */
  onFilterChange?: (filters: CommandFilters) => void;
}

export interface CommandFilters {
  categories: Set<string>;
  scopes: Set<string>;
}

/**
 * Accessible faceted filtering component for the MCP command index.
 *
 * Accessibility contract (per spec Section 7.2):
 * - Filter groups use role="group" with aria-labelledby pointing to each heading
 * - Checkboxes are native <input type="checkbox"> — built-in keyboard + SR support
 * - Tab moves through each checkbox in DOM order (browser default for native inputs)
 * - Space toggles the focused checkbox (browser default for native inputs)
 * - aria-live="polite" region announces "Showing {N} commands" on change
 * - "Clear filters" button has aria-label="Clear all filters" and receives focus after activation
 * - All controls have visible 2px solid focus indicators using the --sf-accent color
 */
export function CommandFilter({
  categories,
  scopes,
  totalCommands,
  visibleCount,
  onFilterChange,
}: CommandFilterProps) {
  const categoryGroupId = useId();
  const scopeGroupId = useId();
  const clearButtonRef = useRef<HTMLButtonElement>(null);

  const [selectedCategories, setSelectedCategories] = useState<Set<string>>(new Set());
  const [selectedScopes, setSelectedScopes] = useState<Set<string>>(new Set());

  const hasActiveFilters = selectedCategories.size > 0 || selectedScopes.size > 0;
  const displayCount = hasActiveFilters && visibleCount !== undefined ? visibleCount : totalCommands;

  function handleCategoryChange(category: string, checked: boolean) {
    const next = new Set(selectedCategories);
    if (checked) {
      next.add(category);
    } else {
      next.delete(category);
    }
    setSelectedCategories(next);
    onFilterChange?.({ categories: next, scopes: selectedScopes });
  }

  function handleScopeChange(scope: string, checked: boolean) {
    const next = new Set(selectedScopes);
    if (checked) {
      next.add(scope);
    } else {
      next.delete(scope);
    }
    setSelectedScopes(next);
    onFilterChange?.({ categories: selectedCategories, scopes: next });
  }

  function handleClearFilters() {
    setSelectedCategories(new Set());
    setSelectedScopes(new Set());
    onFilterChange?.({ categories: new Set(), scopes: new Set() });
    // Return focus to the clear button so keyboard users stay oriented
    clearButtonRef.current?.focus();
  }

  return (
    <div
      className="command-filter"
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: '1.25rem',
        padding: '1rem',
        background: 'var(--muted, #18181b)',
        border: '1px solid var(--border, #27272a)',
        borderRadius: '0.5rem',
        fontFamily: "'Geist Sans', system-ui, sans-serif",
      }}
    >
      {/* Category filter group */}
      <div role="group" aria-labelledby={categoryGroupId}>
        <h3
          id={categoryGroupId}
          style={{
            margin: '0 0 0.5rem',
            fontSize: '0.75rem',
            fontWeight: 600,
            textTransform: 'uppercase',
            letterSpacing: '0.05em',
            color: 'var(--foreground, #fafafa)',
          }}
        >
          Category
        </h3>
        <ul
          style={{
            listStyle: 'none',
            padding: 0,
            margin: 0,
            display: 'flex',
            flexDirection: 'column',
            gap: '0.25rem',
            maxHeight: '12rem',
            overflowY: 'auto',
          }}
        >
          {[...categories].sort().map((category) => (
            <li key={category}>
              <label
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '0.5rem',
                  cursor: 'pointer',
                  fontSize: '0.875rem',
                  color: 'var(--foreground, #fafafa)',
                }}
              >
                <input
                  type="checkbox"
                  checked={selectedCategories.has(category)}
                  onChange={(e) => handleCategoryChange(category, e.target.checked)}
                  style={checkboxStyle}
                />
                {category}
              </label>
            </li>
          ))}
        </ul>
      </div>

      {/* Scope filter group — only rendered when scopes are available */}
      {scopes.length > 0 && (
        <div role="group" aria-labelledby={scopeGroupId}>
          <h3
            id={scopeGroupId}
            style={{
              margin: '0 0 0.5rem',
              fontSize: '0.75rem',
              fontWeight: 600,
              textTransform: 'uppercase',
              letterSpacing: '0.05em',
              color: 'var(--foreground, #fafafa)',
            }}
          >
            Scope
          </h3>
          <ul
            style={{
              listStyle: 'none',
              padding: 0,
              margin: 0,
              display: 'flex',
              flexDirection: 'column',
              gap: '0.25rem',
            }}
          >
            {[...scopes].sort().map((scope) => (
              <li key={scope}>
                <label
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: '0.5rem',
                    cursor: 'pointer',
                    fontSize: '0.875rem',
                    color: 'var(--foreground, #fafafa)',
                  }}
                >
                  <input
                    type="checkbox"
                    checked={selectedScopes.has(scope)}
                    onChange={(e) => handleScopeChange(scope, e.target.checked)}
                    style={checkboxStyle}
                  />
                  {scope}
                </label>
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Status region + clear button */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: '0.5rem',
          borderTop: '1px solid var(--border, #27272a)',
          paddingTop: '0.75rem',
        }}
      >
        {/*
         * aria-live="polite" — screen readers announce this region when it changes.
         * aria-atomic="true" — the full text is read, not just the changed portion.
         * Content: "Showing {N} commands" per spec Section 7.2.
         */}
        <span
          aria-live="polite"
          aria-atomic="true"
          style={{
            fontSize: '0.75rem',
            color: 'var(--sf-text-muted, #71717a)',
          }}
        >
          Showing {displayCount} {displayCount === 1 ? 'command' : 'commands'}
        </span>

        {hasActiveFilters && (
          <button
            ref={clearButtonRef}
            type="button"
            aria-label="Clear all filters"
            onClick={handleClearFilters}
            style={clearButtonStyle}
          >
            Clear filters
          </button>
        )}
      </div>

      {/* Zero-results message — filter controls remain visible per spec */}
      {hasActiveFilters && displayCount === 0 && (
        <div
          role="status"
          aria-live="polite"
          style={{
            padding: '0.75rem',
            background: 'rgba(59,130,246,0.08)',
            border: '1px solid rgba(59,130,246,0.2)',
            borderRadius: '0.375rem',
            fontSize: '0.875rem',
            color: 'var(--foreground, #fafafa)',
          }}
        >
          No public commands match these filters.{' '}
          <button
            type="button"
            aria-label="Clear all filters"
            onClick={handleClearFilters}
            style={inlineTextButtonStyle}
          >
            Clear filters
          </button>
        </div>
      )}
    </div>
  );
}

// Shared checkbox style — accentColor applies brand colour to native checkboxes
const checkboxStyle: React.CSSProperties = {
  accentColor: 'var(--accent, #3b82f6)',
  width: '1rem',
  height: '1rem',
  cursor: 'pointer',
};

// Clear filters button — 2px solid focus outline via global CSS (see globals.css)
const clearButtonStyle: React.CSSProperties = {
  background: 'transparent',
  border: '1px solid var(--accent, #3b82f6)',
  borderRadius: '0.25rem',
  color: 'var(--accent, #3b82f6)',
  cursor: 'pointer',
  fontSize: '0.75rem',
  fontWeight: 500,
  padding: '0.25rem 0.625rem',
};

const inlineTextButtonStyle: React.CSSProperties = {
  background: 'none',
  border: 'none',
  color: 'var(--accent, #3b82f6)',
  cursor: 'pointer',
  textDecoration: 'underline',
  padding: 0,
  fontSize: 'inherit',
};
