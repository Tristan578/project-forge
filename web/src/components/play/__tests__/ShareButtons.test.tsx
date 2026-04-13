/**
 * Tests for ShareButtons component.
 *
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent } from '@/test/utils/componentTestUtils';
import { ShareButtons } from '../ShareButtons';

vi.mock('lucide-react', () => ({
  Share2: (props: Record<string, unknown>) => <span data-testid="share-icon" {...props} />,
  X: (props: Record<string, unknown>) => <span data-testid="x-icon" {...props} />,
}));

const defaultProps = {
  gameTitle: 'My Platformer',
  gameUrl: 'https://spawnforge.ai/play/user-1/my-platformer',
};

describe('ShareButtons', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    cleanup();
  });

  it('renders share buttons', () => {
    render(<ShareButtons {...defaultProps} />);
    expect(screen.getByTitle('Share on X')).toBeDefined();
    expect(screen.getByTitle('Share on Reddit')).toBeDefined();
    expect(screen.getByTitle('Copy link')).toBeDefined();
  });

  it('Twitter/X share URL includes game title and UTM params', () => {
    render(<ShareButtons {...defaultProps} />);
    const twitterLink = screen.getByTitle('Share on X');
    const href = twitterLink.getAttribute('href') ?? '';
    expect(href).toContain('twitter.com/intent/tweet');
    expect(href).toContain(encodeURIComponent('My Platformer'));
    // UTM params are inside the encoded URL parameter
    const decodedUrl = decodeURIComponent(href);
    expect(decodedUrl).toContain('utm_source=twitter');
  });

  it('Reddit share URL includes game title and UTM params', () => {
    render(<ShareButtons {...defaultProps} />);
    const redditLink = screen.getByTitle('Share on Reddit');
    const href = redditLink.getAttribute('href') ?? '';
    expect(href).toContain('reddit.com/submit');
    expect(href).toContain(encodeURIComponent('My Platformer'));
    const decodedUrl = decodeURIComponent(href);
    expect(decodedUrl).toContain('utm_source=reddit');
  });

  it('copy link button copies URL to clipboard', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.assign(navigator, {
      clipboard: { writeText },
    });

    render(<ShareButtons {...defaultProps} />);
    const copyButton = screen.getByTitle('Copy link');
    fireEvent.click(copyButton);

    // Wait for async clipboard write
    await vi.waitFor(() => {
      expect(writeText).toHaveBeenCalledWith(
        expect.stringContaining('my-platformer')
      );
    });
  });
});
