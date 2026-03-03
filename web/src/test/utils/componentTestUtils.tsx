import React from 'react';
import { render, type RenderOptions } from '@testing-library/react';

/**
 * Custom render function that wraps components with shared providers.
 *
 * Currently a thin wrapper around @testing-library/react render.
 * Components that require Clerk auth or other context are tested with mocked
 * providers at the store level (Zustand) rather than via a real provider tree.
 * Extend this wrapper when integration-level provider wrapping is needed.
 */
function renderWithProviders(
  ui: React.ReactElement,
  options?: Omit<RenderOptions, 'wrapper'>
) {
  return render(ui, { ...options });
}

export * from '@testing-library/react';
export { renderWithProviders as render };
