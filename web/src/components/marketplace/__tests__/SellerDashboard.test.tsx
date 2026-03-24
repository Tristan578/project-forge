/**
 * Render tests for SellerDashboard component.
 *
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@/test/utils/componentTestUtils';
import { waitFor } from '@testing-library/react';
import { SellerDashboard } from '../SellerDashboard';

vi.mock('../AssetUploadDialog', () => ({
  AssetUploadDialog: ({ onClose }: { onClose: () => void; onSuccess: () => void }) => (
    <div data-testid="asset-upload-dialog">
      <button onClick={onClose}>Close Upload</button>
    </div>
  ),
}));

vi.mock('lucide-react', () => ({
  Plus: (props: Record<string, unknown>) => <span data-testid="plus-icon" {...props} />,
  Edit: (props: Record<string, unknown>) => <span data-testid="edit-icon" {...props} />,
  Trash2: (props: Record<string, unknown>) => <span data-testid="trash-icon" {...props} />,
  Eye: (props: Record<string, unknown>) => <span data-testid="eye-icon" {...props} />,
  TrendingUp: (props: Record<string, unknown>) => <span data-testid="trending-up-icon" {...props} />,
}));

const mockProfile = {
  profile: {
    displayName: 'ArtisticDev',
    bio: 'Indie game asset creator',
    totalEarnings: 250,
    totalSales: 10,
  },
};

const mockAssets = {
  assets: [
    {
      id: 'a1',
      name: 'Pixel Knight',
      category: 'sprite',
      status: 'published',
      priceTokens: 30,
      downloadCount: 7,
      avgRating: 4.8,
      ratingCount: 3,
    },
    {
      id: 'a2',
      name: 'Forest Tileset',
      category: 'texture',
      status: 'draft',
      priceTokens: 0,
      downloadCount: 0,
      avgRating: 0,
      ratingCount: 0,
    },
  ],
};

describe('SellerDashboard', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    global.fetch = vi.fn().mockImplementation((url: string) => {
      if (url === '/api/marketplace/seller') {
        return Promise.resolve({ ok: true, json: () => Promise.resolve(mockProfile) });
      }
      if (url === '/api/marketplace/seller/assets') {
        return Promise.resolve({ ok: true, json: () => Promise.resolve(mockAssets) });
      }
      return Promise.resolve({ ok: true, json: () => Promise.resolve({}) });
    });
  });

  afterEach(() => {
    cleanup();
  });

  it('renders Seller Dashboard heading', async () => {
    render(<SellerDashboard />);
    await waitFor(() => {
      expect(screen.getByText('Seller Dashboard')).not.toBeNull();
    });
  });

  it('renders Create Listing button', async () => {
    render(<SellerDashboard />);
    await waitFor(() => {
      expect(screen.getByText('Create Listing')).not.toBeNull();
    });
  });

  it('renders Total Earnings stats', async () => {
    render(<SellerDashboard />);
    await waitFor(() => {
      expect(screen.getByText('Total Earnings')).not.toBeNull();
      expect(screen.getByText('250 tokens')).not.toBeNull();
    });
  });

  it('renders Total Sales stats', async () => {
    render(<SellerDashboard />);
    await waitFor(() => {
      expect(screen.getByText('Total Sales')).not.toBeNull();
      expect(screen.getByText('10')).not.toBeNull();
    });
  });

  it('renders Seller Profile section', async () => {
    render(<SellerDashboard />);
    await waitFor(() => {
      expect(screen.getByText('Seller Profile')).not.toBeNull();
    });
  });

  it('renders asset names', async () => {
    render(<SellerDashboard />);
    await waitFor(() => {
      expect(screen.getByText('Pixel Knight')).not.toBeNull();
      expect(screen.getByText('Forest Tileset')).not.toBeNull();
    });
  });

  it('renders Your Listings section heading', async () => {
    render(<SellerDashboard />);
    await waitFor(() => {
      expect(screen.getByText('Your Listings')).not.toBeNull();
    });
  });

  it('shows AssetUploadDialog when Create Listing clicked', async () => {
    render(<SellerDashboard />);
    await waitFor(() => {
      expect(screen.getByText('Create Listing')).not.toBeNull();
    });
    fireEvent.click(screen.getByText('Create Listing'));
    expect(screen.getByTestId('asset-upload-dialog')).not.toBeNull();
  });

  it('hides AssetUploadDialog when closed', async () => {
    render(<SellerDashboard />);
    await waitFor(() => {
      expect(screen.getByText('Create Listing')).not.toBeNull();
    });
    fireEvent.click(screen.getByText('Create Listing'));
    fireEvent.click(screen.getByText('Close Upload'));
    expect(screen.queryByTestId('asset-upload-dialog')).toBeNull();
  });

  it('shows edit form when Edit button clicked', async () => {
    render(<SellerDashboard />);
    await waitFor(() => {
      expect(screen.getByText('Seller Profile')).not.toBeNull();
    });
    fireEvent.click(screen.getByText('Edit'));
    expect(screen.getByText('Save Profile')).not.toBeNull();
  });
});
