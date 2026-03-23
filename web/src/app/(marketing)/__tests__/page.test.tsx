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

vi.mock('@/components/marketing/AiShowcaseSection', () => ({
  AiShowcaseSection: () => (
    <section id="demo" aria-labelledby="ai-showcase-heading">
      <h2 id="ai-showcase-heading">From Prompt to Playable</h2>
    </section>
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
    expect(heroLink).not.toBeNull();
    expect(heroLink?.getAttribute('href')).toBe('/sign-up');
  });

  it('renders all 8 feature cards with updated titles', () => {
    render(<LandingPage />);
    const expectedFeatures = [
      'AI Game Design',
      '2D & 3D Engine',
      'Visual Scripting',
      '25+ AI Modules',
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
    expect(screen.getByText('Coming Soon').textContent).toBe('Coming Soon');
  });

  it('renders the 3-step how-it-works flow', () => {
    render(<LandingPage />);
    expect(screen.getByText('Describe').textContent).toBe('Describe');
    expect(screen.getByText('Generate').textContent).toBe('Generate');
    expect(screen.getByText('Play').textContent).toBe('Play');
    expect(screen.getByText('Step 1').textContent).toBe('Step 1');
    expect(screen.getByText('Step 2').textContent).toBe('Step 2');
    expect(screen.getByText('Step 3').textContent).toBe('Step 3');
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
    expect(screen.getByText('Browser-native (no install)').textContent).toBe('Browser-native (no install)');
    expect(screen.getByText('AI-first game creation').textContent).toBe('AI-first game creation');
    expect(screen.getByText('WebGPU rendering').textContent).toBe('WebGPU rendering');
    expect(screen.getByText('One-click web publish').textContent).toBe('One-click web publish');
  });

  it('renders all 4 pricing tiers with correct prices per spec', () => {
    render(<LandingPage />);
    expect(screen.getByText('$0').textContent).toBe('$0');
    expect(screen.getByText('$9').textContent).toBe('$9');
    expect(screen.getByText('$29').textContent).toBe('$29');
    expect(screen.getByText('$99').textContent).toBe('$99');

    expect(screen.getByText('Starter').textContent).toBe('Starter');
    expect(screen.getByText('Hobbyist').textContent).toBe('Hobbyist');
    expect(screen.getByText('Creator').textContent).toBe('Creator');
    expect(screen.getByText('Pro').textContent).toBe('Pro');
  });

  it('highlights the Creator tier as "Most Popular"', () => {
    render(<LandingPage />);
    expect(screen.getByText('Most Popular').textContent).toBe('Most Popular');
  });

  it('renders the footer CTA section', () => {
    render(<LandingPage />);
    expect(
      screen.getByRole('heading', { name: /ready to create your first game/i })
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
    // The primary feature grid container should have responsive grid classes
    const featureHeading = screen.getByText('AI Game Design');
    const grid = featureHeading.closest('.grid');
    expect(grid).not.toBeNull();
    expect(grid?.className).toContain('sm:grid-cols-2');
    expect(grid?.className).toContain('lg:grid-cols-3');
  });

  it('renders testimonials social proof section', () => {
    render(<LandingPage />);
    expect(
      screen.getByRole('heading', { name: /trusted by game creators/i })
    ).toBeDefined();
  });

  it('renders testimonials with realistic content (not placeholders)', () => {
    render(<LandingPage />);
    // Should have figure/blockquote elements with real quotes
    const blockquotes = document.querySelectorAll('blockquote');
    expect(blockquotes.length).toBeGreaterThanOrEqual(3);
    // Each blockquote should have meaningful text, not "placeholder"
    for (const bq of blockquotes) {
      expect(bq.textContent?.toLowerCase()).not.toContain('placeholder');
    }
  });

  it('renders the AI showcase section', () => {
    render(<LandingPage />);
    expect(
      screen.getByRole('heading', { name: /from prompt to playable/i })
    ).toBeDefined();
  });

  it('"See How It Works" CTA links to the demo section', () => {
    render(<LandingPage />);
    const link = screen.getByText('See How It Works').closest('a');
    expect(link?.getAttribute('href')).toBe('#demo');
  });

  it('renders footer links', () => {
    render(<LandingPage />);
    const footer = screen.getByRole('contentinfo');
    expect(within(footer).getByText('Pricing')).toBeDefined();
    expect(within(footer).getByText('Terms')).toBeDefined();
    expect(within(footer).getByText('Privacy')).toBeDefined();
  });
});
