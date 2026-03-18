/**
 * Tests for the marketing landing page.
 *
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup, within } from '@/test/utils/componentTestUtils';
import LandingPage from '../page';

vi.mock('next/link', () => ({
  default: ({
    children,
    href,
    ...props
  }: {
    children: React.ReactNode;
    href: string;
    className?: string;
  }) => (
    <a href={href} {...props}>
      {children}
    </a>
  ),
}));

vi.mock('lucide-react', () => {
  const icon = ({ className, ...props }: Record<string, unknown>) => (
    <span className={className as string} {...props} />
  );
  return {
    Bot: icon,
    Blocks: icon,
    Cpu: icon,
    Code2: icon,
    Globe: icon,
    Users: icon,
    Sparkles: icon,
    Paintbrush: icon,
    Rocket: icon,
    ArrowRight: icon,
    Check: icon,
    Minus: icon,
    Zap: icon,
    Shield: icon,
    Gamepad2: icon,
  };
});

describe('LandingPage', () => {
  afterEach(() => {
    cleanup();
  });

  it('renders the hero section with headline', () => {
    render(<LandingPage />);
    expect(
      screen.getByRole('heading', { name: /create games with ai/i })
    ).toBeDefined();
  });

  it('renders the primary CTA button linking to sign-up', () => {
    render(<LandingPage />);
    const ctas = screen.getAllByText('Start Creating Free');
    // At least the hero CTA should link to /sign-up
    const heroLink = ctas[0].closest('a');
    expect(heroLink).toBeDefined();
    expect(heroLink?.getAttribute('href')).toBe('/sign-up');
  });

  it('renders all 8 feature cards', () => {
    render(<LandingPage />);
    const expectedFeatures = [
      'AI Game Studio',
      '327+ MCP Commands',
      'Bevy Engine (WebGPU)',
      'Visual Scripting + TypeScript',
      'One-Click Publish',
      'Real-Time Collaboration',
      '2D & 3D Game Support',
      'Secure by Default',
    ];
    for (const title of expectedFeatures) {
      expect(screen.getByText(title)).toBeDefined();
    }
  });

  it('shows "Coming Soon" badge on collaboration feature', () => {
    render(<LandingPage />);
    expect(screen.getByText('Coming Soon')).toBeDefined();
  });

  it('renders the 3-step how-it-works flow', () => {
    render(<LandingPage />);
    expect(screen.getByText('Describe')).toBeDefined();
    expect(screen.getByText('Create')).toBeDefined();
    expect(screen.getByText('Publish')).toBeDefined();
    expect(screen.getByText('Step 1')).toBeDefined();
    expect(screen.getByText('Step 2')).toBeDefined();
    expect(screen.getByText('Step 3')).toBeDefined();
  });

  it('renders comparison table with all 4 competitors', () => {
    render(<LandingPage />);
    const table = screen.getByRole('table');
    const headers = within(table).getAllByRole('columnheader');
    const headerTexts = headers.map((h) => h.textContent);
    expect(headerTexts).toContain('SpawnForge');
    expect(headerTexts).toContain('Unity');
    expect(headerTexts).toContain('Godot');
    expect(headerTexts).toContain('GameMaker');
  });

  it('renders all comparison rows', () => {
    render(<LandingPage />);
    expect(screen.getByText('Browser-native (no install)')).toBeDefined();
    expect(screen.getByText('AI-first game creation')).toBeDefined();
    expect(screen.getByText('WebGPU rendering')).toBeDefined();
    expect(screen.getByText('One-click web publish')).toBeDefined();
  });

  it('renders all 4 pricing tiers with correct prices', () => {
    render(<LandingPage />);
    expect(screen.getByText('$9')).toBeDefined();
    expect(screen.getByText('$19')).toBeDefined();
    expect(screen.getByText('$29')).toBeDefined();
    expect(screen.getByText('$79')).toBeDefined();

    expect(screen.getByText('Starter')).toBeDefined();
    expect(screen.getByText('Hobbyist')).toBeDefined();
    expect(screen.getByText('Creator')).toBeDefined();
    expect(screen.getByText('Studio')).toBeDefined();
  });

  it('highlights the Creator tier as "Most Popular"', () => {
    render(<LandingPage />);
    expect(screen.getByText('Most Popular')).toBeDefined();
  });

  it('renders the footer CTA section', () => {
    render(<LandingPage />);
    expect(
      screen.getByRole('heading', { name: /ready to build your game/i })
    ).toBeDefined();
  });

  it('has proper heading hierarchy (h1 -> h2)', () => {
    render(<LandingPage />);
    const h1s = screen.getAllByRole('heading', { level: 1 });
    const h2s = screen.getAllByRole('heading', { level: 2 });
    expect(h1s.length).toBe(1);
    expect(h2s.length).toBeGreaterThanOrEqual(5);
  });

  it('renders navigation with section links', () => {
    render(<LandingPage />);
    const nav = screen.getByRole('navigation', { name: /main navigation/i });
    expect(within(nav).getByText('Features')).toBeDefined();
    expect(within(nav).getByText('How It Works')).toBeDefined();
    expect(within(nav).getByText('Compare')).toBeDefined();
    expect(within(nav).getByText('Pricing')).toBeDefined();
  });

  it('renders responsive classes on feature grid', () => {
    render(<LandingPage />);
    // The feature grid container should have responsive grid classes
    const featureHeading = screen.getByText('AI Game Studio');
    const grid = featureHeading.closest('.grid');
    expect(grid).toBeDefined();
    expect(grid?.className).toContain('sm:grid-cols-2');
    expect(grid?.className).toContain('lg:grid-cols-4');
  });

  it('renders social proof placeholder section', () => {
    render(<LandingPage />);
    expect(
      screen.getByRole('heading', { name: /trusted by game creators/i })
    ).toBeDefined();
  });

  it('renders footer links', () => {
    render(<LandingPage />);
    const footer = screen.getByRole('contentinfo');
    expect(within(footer).getByText('Pricing')).toBeDefined();
    expect(within(footer).getByText('Terms')).toBeDefined();
    expect(within(footer).getByText('Privacy')).toBeDefined();
  });
});
