/**
 * The plan's cost as both plan surfaces show it (#6831).
 *
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup } from '@/test/utils/componentTestUtils';
import { TokenCostBar, TokenCostTotal } from '../TokenCostBar';
import type { TokenEstimate } from '@/lib/game-creation/types';

// The Buy tokens link sits on the plan review itself: a plain <a> would be a
// full page load, dropping the plan waiting to be built.
vi.mock('next/link', () => ({
  default: ({ href, children, ...rest }: { href: string; children: React.ReactNode } & Record<string, unknown>) => (
    <a href={href} data-next-link="" {...rest}>
      {children}
    </a>
  ),
}));

const ESTIMATE: TokenEstimate = {
  breakdown: [{ category: 'Asset generation', estimatedTokens: 340, variance: 60 }],
  totalEstimated: 340,
  totalVarianceHigh: 400,
  totalVarianceLow: 280,
  userTier: 'hobbyist',
  sufficientBalance: true,
};

afterEach(() => cleanup());

describe('TokenCostBar', () => {
  it('shows the estimate and the upper bound the build holds', () => {
    render(<TokenCostBar estimate={ESTIMATE} />);

    expect(screen.getAllByText('340')).not.toHaveLength(0);
    expect(screen.getByText(/tokens are held while/).textContent).toContain('Up to 400 tokens');
    expect(screen.queryByRole('link')).toBeNull();
  });

  it('warns of a short balance with a client-side Buy tokens link', () => {
    render(<TokenCostBar estimate={{ ...ESTIMATE, sufficientBalance: false }} />);

    expect(screen.getByText(/may cost more than your token balance/).textContent).toContain(
      'before any build tokens are spent',
    );
    const link = screen.getByRole('link', { name: 'Buy tokens' });
    expect(link.getAttribute('href')).toBe('/settings?tab=tokens');
    expect(link.hasAttribute('data-next-link')).toBe(true);
  });

  it('drops the warning while a short-balance refusal says it instead', () => {
    render(<TokenCostBar estimate={{ ...ESTIMATE, sufficientBalance: false }} hideBalanceWarning />);

    expect(screen.queryByText(/may cost more than your token balance/)).toBeNull();
    expect(screen.queryByRole('link')).toBeNull();
  });
});

// The one-line total the quick-start plan review shows beside "Build it" in
// the Dialog footer (PR #10294 board round 3). The footer takes its height
// from the scrolling body, so it must stay short and hold nothing focusable.
describe('TokenCostTotal', () => {
  it('states the estimate and the upper bound the build holds, on one line with nothing focusable', () => {
    render(<TokenCostTotal estimate={ESTIMATE} />);
    const total = screen.getByTestId('token-cost-total');
    expect(total.textContent).toBe('Cost: 340 tokens, up to 400 held');
    expect(total.querySelectorAll('a, button, [tabindex]')).toHaveLength(0);
  });

  it('leaves out the held amount when there is no upper bound', () => {
    render(<TokenCostTotal estimate={{ ...ESTIMATE, totalVarianceHigh: 0 }} />);
    expect(screen.getByTestId('token-cost-total').textContent).toBe('Cost: 340 tokens');
  });

  it('says briefly, with no link, when the cost may exceed the cached balance', () => {
    render(<TokenCostTotal estimate={{ ...ESTIMATE, sufficientBalance: false }} />);
    const total = screen.getByTestId('token-cost-total');
    expect(total.textContent).toBe('Cost: 340 tokens, up to 400 heldMay exceed your balance');
    expect(screen.queryByRole('link')).toBeNull();
  });
});
