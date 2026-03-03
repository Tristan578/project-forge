import React from 'react';
import { render, type RenderOptions } from '@testing-library/react';

/**
 * Custom render function that can be extended with providers (Clerk, etc.)
 */
function renderWithProviders(
  ui: React.ReactElement,
  options?: Omit<RenderOptions, 'wrapper'>
) {
  return render(ui, { ...options });
}

export * from '@testing-library/react';
export { renderWithProviders as render };
