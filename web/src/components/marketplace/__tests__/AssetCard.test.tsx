/**
 * Render tests for AssetCard component.
 *
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@/test/utils/componentTestUtils';
import { AssetCard } from '../AssetCard';

vi.mock('../AssetDetailModal', () => ({
  AssetDetailModal: ({ assetId, onClose }: { assetId: string; onClose: () => void }) => (
    <div data-testid="asset-detail-modal" data-asset-id={assetId}>
      <button onClick={onClose}>Close</button>
    </div>
  ),
}));

vi.mock('lucide-react', () => ({
  Star: (props: Record<string, unknown>) => <span data-testid="star-icon" {...props} />,
  Download: (props: Record<string, unknown>) => <span data-testid="download-icon" {...props} />,
  Sparkles: (props: Record<string, unknown>) => <span data-testid="sparkles-icon" {...props} />,
}));

const baseAsset = {
  id: 'asset-1',
  name: 'Stone Wall Texture',
  description: 'A nice stone wall',
  category: 'texture',
  priceTokens: 50,
  license: 'MIT',
  previewUrl: null,
  sellerName: 'TextureArtist',
  sellerId: 'seller-1',
  downloadCount: 42,
  avgRating: 4.5,
  ratingCount: 12,
  tags: ['stone', 'wall'],
  aiGenerated: false,
  createdAt: '2024-01-01',
};

describe('AssetCard', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    cleanup();
  });

  it('renders asset name', () => {
    render(<AssetCard asset={baseAsset} />);
    expect(screen.getByText('Stone Wall Texture')).toBeDefined();
  });

  it('renders seller name', () => {
    render(<AssetCard asset={baseAsset} />);
    expect(screen.getByText('by TextureArtist')).toBeDefined();
  });

  it('renders price in tokens', () => {
    render(<AssetCard asset={baseAsset} />);
    expect(screen.getByText('50 tokens')).toBeDefined();
  });

  it('renders Free for zero-price assets', () => {
    render(<AssetCard asset={{ ...baseAsset, priceTokens: 0 }} />);
    expect(screen.getByText('Free')).toBeDefined();
  });

  it('renders rating', () => {
    render(<AssetCard asset={baseAsset} />);
    expect(screen.getByText('4.5')).toBeDefined();
  });

  it('renders rating count', () => {
    render(<AssetCard asset={baseAsset} />);
    expect(screen.getByText('(12)')).toBeDefined();
  });

  it('renders download count', () => {
    render(<AssetCard asset={baseAsset} />);
    expect(screen.getByText('42')).toBeDefined();
  });

  it('renders category badge', () => {
    render(<AssetCard asset={baseAsset} />);
    // Category badge shows "texture" (replaces _ with space)
    const badges = screen.getAllByText('texture');
    expect(badges.length).toBeGreaterThanOrEqual(1);
  });

  it('renders AI badge for AI-generated assets', () => {
    render(<AssetCard asset={{ ...baseAsset, aiGenerated: true }} />);
    expect(screen.getByText('AI')).toBeDefined();
  });

  it('does not render AI badge for non-AI assets', () => {
    render(<AssetCard asset={baseAsset} />);
    expect(screen.queryByText('AI')).toBeNull();
  });

  it('shows AssetDetailModal when card clicked', () => {
    render(<AssetCard asset={baseAsset} />);
    fireEvent.click(screen.getByText('Stone Wall Texture'));
    expect(screen.getByTestId('asset-detail-modal')).toBeDefined();
  });

  it('hides AssetDetailModal when closed', () => {
    render(<AssetCard asset={baseAsset} />);
    fireEvent.click(screen.getByText('Stone Wall Texture'));
    fireEvent.click(screen.getByText('Close'));
    expect(screen.queryByTestId('asset-detail-modal')).toBeNull();
  });
});
