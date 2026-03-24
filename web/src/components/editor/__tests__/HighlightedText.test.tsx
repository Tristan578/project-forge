/**
 * Render tests for HighlightedText component.
 *
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup } from '@/test/utils/componentTestUtils';
import { HighlightedText } from '../HighlightedText';

vi.mock('@/lib/hierarchyFilter', () => ({
  escapeRegExp: (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'),
}));

describe('HighlightedText', () => {
  afterEach(() => {
    cleanup();
  });

  it('renders plain text when no highlight', () => {
    render(<HighlightedText text="Player Entity" />);
    expect(screen.getByText('Player Entity')).not.toBeNull();
  });

  it('renders plain text when highlight is empty string', () => {
    render(<HighlightedText text="Player Entity" highlight="" />);
    expect(screen.getByText('Player Entity')).not.toBeNull();
  });

  it('renders plain text when highlight is whitespace', () => {
    render(<HighlightedText text="Player Entity" highlight="   " />);
    expect(screen.getByText('Player Entity')).not.toBeNull();
  });

  it('highlights the matching substring', () => {
    const { container } = render(<HighlightedText text="Player Entity" highlight="Player" />);
    const highlighted = container.querySelector('.bg-yellow-500\\/30');
    expect(highlighted).not.toBeNull();
    expect(highlighted?.textContent).toBe('Player');
  });

  it('renders text around the highlighted part', () => {
    const { container } = render(<HighlightedText text="Player Entity" highlight="Player" />);
    // The full text should still appear in the DOM
    expect(container.textContent).toContain('Entity');
  });

  it('is case-insensitive in matching', () => {
    const { container } = render(<HighlightedText text="Player Entity" highlight="player" />);
    const highlighted = container.querySelector('.bg-yellow-500\\/30');
    expect(highlighted).not.toBeNull();
  });

  it('highlights match in the middle of text', () => {
    const { container } = render(<HighlightedText text="My Enemy Prefab" highlight="Enemy" />);
    const highlighted = container.querySelector('.bg-yellow-500\\/30');
    expect(highlighted?.textContent).toBe('Enemy');
  });

  it('applies custom className to container', () => {
    const { container } = render(<HighlightedText text="Test" className="custom-class" />);
    const span = container.querySelector('.custom-class');
    expect(span).not.toBeNull();
  });
});
