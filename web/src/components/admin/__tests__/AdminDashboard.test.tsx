/**
 * Render tests for AdminDashboard component.
 *
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup } from '@/test/utils/componentTestUtils';
import { waitFor } from '@testing-library/react';
import { AdminDashboard } from '../AdminDashboard';

const mockDashboardData = {
  userStats: {
    totalUsers: 150,
    starterCount: 90,
    hobbyistCount: 35,
    creatorCount: 18,
    proCount: 7,
  },
  costSummary: [
    {
      actionType: 'generate_model',
      provider: 'meshy',
      totalCost: '12.50',
      totalTokens: '500',
      count: 25,
    },
  ],
  recentTransactions: [],
  tokenConfigs: [
    {
      id: 'tc-1',
      actionType: 'generate_model',
      tokenCost: 20,
      estimatedCostCents: 50,
      active: true,
    },
  ],
  tierConfigs: [
    {
      id: 'tier-starter',
      name: 'starter',
      monthlyTokens: 100,
      maxProjects: 3,
      maxPublished: 0,
      priceCentsMonthly: 0,
    },
  ],
};

describe('AdminDashboard', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve(mockDashboardData),
    });
  });

  afterEach(() => {
    cleanup();
  });

  it('shows loading spinner initially', () => {
    global.fetch = vi.fn().mockReturnValue(new Promise(() => {}));
    render(<AdminDashboard />);
    expect(screen.getByText('Loading dashboard...')).not.toBeNull();
  });

  it('renders Admin Economics Dashboard heading', async () => {
    render(<AdminDashboard />);
    await waitFor(() => {
      expect(screen.getByText('Admin Economics Dashboard')).not.toBeNull();
    });
  });

  it('renders User Statistics section', async () => {
    render(<AdminDashboard />);
    await waitFor(() => {
      expect(screen.getByText('User Statistics')).not.toBeNull();
    }, { timeout: 5000 });
  });

  it('renders total user count', async () => {
    render(<AdminDashboard />);
    await waitFor(() => {
      expect(screen.getByText('150')).not.toBeNull();
    }, { timeout: 5000 });
  });

  it('renders tier counts', async () => {
    render(<AdminDashboard />);
    await waitFor(() => {
      expect(screen.getByText('90')).not.toBeNull(); // starterCount
      expect(screen.getByText('35')).not.toBeNull(); // hobbyistCount
    }, { timeout: 5000 });
  });

  it('renders Cost by Action section', async () => {
    render(<AdminDashboard />);
    await waitFor(() => {
      expect(screen.getByText(/Cost by Action/)).not.toBeNull();
    }, { timeout: 5000 });
  });

  it('renders Token Pricing Config section', async () => {
    render(<AdminDashboard />);
    await waitFor(() => {
      expect(screen.getByText('Token Pricing Config')).not.toBeNull();
    }, { timeout: 5000 });
  });

  it('renders Tier Config section', async () => {
    render(<AdminDashboard />);
    await waitFor(() => {
      expect(screen.getByText('Tier Config')).not.toBeNull();
    }, { timeout: 5000 });
  });

  it('shows error state when fetch fails', async () => {
    global.fetch = vi.fn().mockResolvedValue({ ok: false, status: 403 });
    render(<AdminDashboard />);
    await waitFor(() => {
      expect(screen.getByText('Error')).not.toBeNull();
      expect(screen.getByText('Retry')).not.toBeNull();
    }, { timeout: 5000 });
  });

  it('renders token cost input field from config data', async () => {
    render(<AdminDashboard />);
    await waitFor(() => {
      expect(screen.getByText('Token Pricing Config')).not.toBeNull();
      // tokenConfig with actionType 'generate_model' and tokenCost 20
      const inputs = document.querySelectorAll('input[type="number"]');
      expect(inputs.length).toBeGreaterThanOrEqual(1);
    }, { timeout: 5000 });
  });
});
