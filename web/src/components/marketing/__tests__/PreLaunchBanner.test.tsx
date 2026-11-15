/** @vitest-environment jsdom */

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { PreLaunchBanner } from '../PreLaunchBanner';

const framedRoutes = [
  'about',
  'api-docs',
  'blog',
  'changelog',
  'community',
  'compare',
  'faq',
  'pricing',
  'privacy',
  'terms',
  'use-cases',
] as const;

describe('PreLaunchBanner', () => {
  it('exposes consistent pre-launch framing as a named landmark without adding focus targets', () => {
    const { container } = render(<PreLaunchBanner />);

    expect(screen.getByRole('complementary', { name: 'Pre-launch notice' })).toHaveTextContent(
      'Features described here are planned or in active development',
    );
    expect(container.querySelectorAll('a, button, input, select, textarea, [tabindex]')).toHaveLength(0);
  });

  it.each(framedRoutes)('frames the /%s marketing route through the shared component', (route) => {
    const source = readFileSync(resolve(process.cwd(), 'src', 'app', route, 'layout.tsx'), 'utf8');
    expect(source).toContain("@/components/marketing/MarketingPageFrame");
    expect(source).toContain('export default MarketingPageFrame');
  });

  it('renders the same indicator before the landing-page navigation', () => {
    const source = readFileSync(resolve(process.cwd(), 'src/components/marketing/LandingPage.tsx'), 'utf8');
    expect(source.indexOf('<PreLaunchBanner />')).toBeGreaterThan(-1);
    expect(source.indexOf('<PreLaunchBanner />')).toBeLessThan(source.indexOf('<nav'));
  });
});
