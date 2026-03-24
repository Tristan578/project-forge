/**
 * Render tests for AssetUploadDialog component.
 *
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@/test/utils/componentTestUtils';

vi.mock('lucide-react', () => ({
  X: (props: Record<string, unknown>) => <span data-testid="x-icon" {...props} />,
}));

import { AssetUploadDialog } from '../AssetUploadDialog';

describe('AssetUploadDialog', () => {
  const mockOnClose = vi.fn();
  const mockOnSuccess = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    cleanup();
  });

  it('renders Create Asset Listing heading', () => {
    render(<AssetUploadDialog onClose={mockOnClose} onSuccess={mockOnSuccess} />);
    expect(screen.getByText('Create Asset Listing')).not.toBeNull();
  });

  it('renders Name input field', () => {
    render(<AssetUploadDialog onClose={mockOnClose} onSuccess={mockOnSuccess} />);
    expect(screen.getByPlaceholderText('My Awesome Asset')).not.toBeNull();
  });

  it('renders Description textarea', () => {
    render(<AssetUploadDialog onClose={mockOnClose} onSuccess={mockOnSuccess} />);
    expect(screen.getByPlaceholderText('Describe your asset, its features, and usage...')).not.toBeNull();
  });

  it('renders Category select with 3D Model as default', () => {
    render(<AssetUploadDialog onClose={mockOnClose} onSuccess={mockOnSuccess} />);
    const selects = screen.getAllByRole('combobox');
    const categorySelect = selects[0] as HTMLSelectElement;
    expect(categorySelect).toBeDefined();
    expect(categorySelect.value).toBe('model_3d');
  });

  it('renders all category options', () => {
    render(<AssetUploadDialog onClose={mockOnClose} onSuccess={mockOnSuccess} />);
    expect(screen.getByText('3D Model')).not.toBeNull();
    expect(screen.getByText('Sprite')).not.toBeNull();
    expect(screen.getByText('Texture')).not.toBeNull();
    expect(screen.getByText('Audio')).not.toBeNull();
    expect(screen.getByText('Script')).not.toBeNull();
  });

  it('renders License options', () => {
    render(<AssetUploadDialog onClose={mockOnClose} onSuccess={mockOnSuccess} />);
    expect(screen.getByText(/Standard/)).not.toBeNull();
    expect(screen.getByText(/Extended/)).not.toBeNull();
  });

  it('renders Create Listing and Cancel buttons', () => {
    render(<AssetUploadDialog onClose={mockOnClose} onSuccess={mockOnSuccess} />);
    expect(screen.getByText('Create Listing')).not.toBeNull();
    expect(screen.getByText('Cancel')).not.toBeNull();
  });

  it('calls onClose when Cancel clicked', () => {
    render(<AssetUploadDialog onClose={mockOnClose} onSuccess={mockOnSuccess} />);
    fireEvent.click(screen.getByText('Cancel'));
    expect(mockOnClose).toHaveBeenCalled();
  });

  it('calls onClose when X clicked', () => {
    render(<AssetUploadDialog onClose={mockOnClose} onSuccess={mockOnSuccess} />);
    fireEvent.click(screen.getByTestId('x-icon'));
    expect(mockOnClose).toHaveBeenCalled();
  });

  it('allows typing in name field', () => {
    render(<AssetUploadDialog onClose={mockOnClose} onSuccess={mockOnSuccess} />);
    const nameInput = screen.getByPlaceholderText('My Awesome Asset') as HTMLInputElement;
    fireEvent.change(nameInput, { target: { value: 'My Texture Pack' } });
    expect(nameInput.value).toBe('My Texture Pack');
  });

  it('renders AI-generated checkbox', () => {
    render(<AssetUploadDialog onClose={mockOnClose} onSuccess={mockOnSuccess} />);
    expect(screen.getByText(/AI-generated/)).not.toBeNull();
  });

  it('renders Tags input field', () => {
    render(<AssetUploadDialog onClose={mockOnClose} onSuccess={mockOnSuccess} />);
    expect(screen.getByPlaceholderText('fantasy, low-poly, environment')).not.toBeNull();
  });

  it('renders Price input with default 0', () => {
    render(<AssetUploadDialog onClose={mockOnClose} onSuccess={mockOnSuccess} />);
    // Price field has type number with value 0
    const priceInput = screen.getByDisplayValue('0') as HTMLInputElement;
    expect(priceInput).toBeDefined();
    expect(priceInput.type).toBe('number');
  });
});
