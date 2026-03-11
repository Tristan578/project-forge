/**
 * Render tests for AssetDetailModal component.
 *
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@/test/utils/componentTestUtils';
import { waitFor } from '@testing-library/react';
import { AssetDetailModal } from '../AssetDetailModal';

vi.mock('@/stores/marketplaceStore', () => ({
  useMarketplaceStore: vi.fn(() => ({
    purchasedAssetIds: new Set<string>(),
    purchaseAsset: vi.fn(),
    reviewAsset: vi.fn(),
  })),
}));

vi.mock('lucide-react', () => ({
  X: (props: Record<string, unknown>) => <span data-testid="x-icon" {...props} />,
  Star: (props: Record<string, unknown>) => <span data-testid="star-icon" {...props} />,
  Download: (props: Record<string, unknown>) => <span data-testid="download-icon" {...props} />,
  ExternalLink: (props: Record<string, unknown>) => <span data-testid="external-link-icon" {...props} />,
  Sparkles: (props: Record<string, unknown>) => <span data-testid="sparkles-icon" {...props} />,
  ShoppingCart: (props: Record<string, unknown>) => <span data-testid="shopping-cart-icon" {...props} />,
}));

const baseAsset = {
  id: 'asset-1',
  name: 'Stone Wall Texture',
  description: 'A beautiful stone wall texture for game environments.',
  category: 'texture',
  priceTokens: 50,
  license: 'MIT',
  previewUrl: null,
  assetFileSize: null,
  downloadCount: 42,
  avgRating: 4.5,
  ratingCount: 12,
  tags: ['stone', 'wall'],
  aiGenerated: false,
  aiProvider: null,
  metadata: null,
  createdAt: '2024-01-01',
  seller: {
    id: 'seller-1',
    name: 'TextureArtist',
    bio: 'Professional texture artist.',
    portfolioUrl: null,
  },
};

describe('AssetDetailModal', () => {
  const mockOnClose = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ asset: baseAsset, reviews: [] }),
    });
  });

  afterEach(() => {
    cleanup();
  });

  it('shows loading state initially', () => {
    // fetch will not resolve immediately so loading renders first
    global.fetch = vi.fn().mockReturnValue(new Promise(() => {}));
    render(<AssetDetailModal assetId="asset-1" onClose={mockOnClose} />);
    expect(screen.getByText('Loading...')).toBeDefined();
  });

  it('renders asset name after loading', async () => {
    render(<AssetDetailModal assetId="asset-1" onClose={mockOnClose} />);
    await waitFor(() => {
      expect(screen.getByText('Stone Wall Texture')).toBeDefined();
    });
  });

  it('renders asset description', async () => {
    render(<AssetDetailModal assetId="asset-1" onClose={mockOnClose} />);
    await waitFor(() => {
      expect(screen.getByText('A beautiful stone wall texture for game environments.')).toBeDefined();
    });
  });

  it('renders price in tokens', async () => {
    render(<AssetDetailModal assetId="asset-1" onClose={mockOnClose} />);
    await waitFor(() => {
      expect(screen.getByText('50 tokens')).toBeDefined();
    });
  });

  it('renders Free for zero-price assets', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ asset: { ...baseAsset, priceTokens: 0 }, reviews: [] }),
    });
    render(<AssetDetailModal assetId="asset-1" onClose={mockOnClose} />);
    await waitFor(() => {
      expect(screen.getAllByText('Free').length).toBeGreaterThanOrEqual(1);
    });
  });

  it('renders seller name', async () => {
    render(<AssetDetailModal assetId="asset-1" onClose={mockOnClose} />);
    await waitFor(() => {
      expect(screen.getByText('TextureArtist')).toBeDefined();
    });
  });

  it('renders tags', async () => {
    render(<AssetDetailModal assetId="asset-1" onClose={mockOnClose} />);
    await waitFor(() => {
      expect(screen.getByText('stone')).toBeDefined();
      expect(screen.getByText('wall')).toBeDefined();
    });
  });

  it('renders Purchase button when not purchased', async () => {
    render(<AssetDetailModal assetId="asset-1" onClose={mockOnClose} />);
    await waitFor(() => {
      expect(screen.getByText('Purchase')).toBeDefined();
    });
  });

  it('renders Download button when already purchased', async () => {
    const { useMarketplaceStore } = await import('@/stores/marketplaceStore');
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    vi.mocked(useMarketplaceStore).mockImplementation((selector?: any) => {
      const state = {
        purchasedAssetIds: new Set(['asset-1']),
        purchaseAsset: vi.fn(),
        reviewAsset: vi.fn(),
      };
      return typeof selector === 'function' ? selector(state) : state;
    });
    render(<AssetDetailModal assetId="asset-1" onClose={mockOnClose} />);
    await waitFor(() => {
      expect(screen.getByText('Download')).toBeDefined();
    });
  });

  it('renders AI badge for AI-generated assets', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () =>
        Promise.resolve({
          asset: { ...baseAsset, aiGenerated: true, aiProvider: 'Meshy' },
          reviews: [],
        }),
    });
    render(<AssetDetailModal assetId="asset-1" onClose={mockOnClose} />);
    await waitFor(() => {
      expect(screen.getByText(/AI-generated/)).toBeDefined();
    });
  });

  it('renders review list when reviews present', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () =>
        Promise.resolve({
          asset: baseAsset,
          reviews: [
            {
              id: 'r1',
              rating: 5,
              content: 'Great asset!',
              createdAt: '2024-02-01',
              userName: 'PlayerOne',
            },
          ],
        }),
    });
    render(<AssetDetailModal assetId="asset-1" onClose={mockOnClose} />);
    await waitFor(() => {
      expect(screen.getByText('Great asset!')).toBeDefined();
      expect(screen.getByText('PlayerOne')).toBeDefined();
    });
  });

  it('shows Asset not found on fetch error', async () => {
    global.fetch = vi.fn().mockResolvedValue({ ok: false });
    render(<AssetDetailModal assetId="bad-id" onClose={mockOnClose} />);
    await waitFor(() => {
      expect(screen.getByText('Asset not found')).toBeDefined();
    });
  });

  it('calls onClose when X button clicked', async () => {
    render(<AssetDetailModal assetId="asset-1" onClose={mockOnClose} />);
    await waitFor(() => {
      expect(screen.getByText('Stone Wall Texture')).toBeDefined();
    });
    fireEvent.click(screen.getByTestId('x-icon'));
    expect(mockOnClose).toHaveBeenCalled();
  });
});
