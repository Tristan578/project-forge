/**
 * Render tests for CollapsibleSection component.
 *
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@/test/utils/componentTestUtils';
import { CollapsibleSection } from '../CollapsibleSection';

vi.mock('lucide-react', () => ({
  ChevronDown: (props: Record<string, unknown>) => <span data-testid="chevron-down" {...props} />,
  ChevronRight: (props: Record<string, unknown>) => <span data-testid="chevron-right" {...props} />,
}));

describe('CollapsibleSection', () => {
  beforeEach(() => vi.clearAllMocks());

  afterEach(() => {
    cleanup();
    localStorage.clear();
  });

  it('renders the section title', () => {
    render(
      <CollapsibleSection id="test-section" title="Transform">
        <div>Content</div>
      </CollapsibleSection>
    );
    expect(screen.getByText('Transform')).toBeInTheDocument();
  });

  it('renders children when expanded (default)', () => {
    render(
      <CollapsibleSection id="test-section" title="Transform">
        <div>My Content</div>
      </CollapsibleSection>
    );
    expect(screen.getByText('My Content')).toBeInTheDocument();
  });

  it('shows ChevronDown when expanded', () => {
    render(
      <CollapsibleSection id="test-section" title="Transform">
        <div>Content</div>
      </CollapsibleSection>
    );
    expect(screen.getByTestId('chevron-down')).toBeInTheDocument();
  });

  it('collapses content when header is clicked', () => {
    render(
      <CollapsibleSection id="test-section" title="Transform">
        <div>My Content</div>
      </CollapsibleSection>
    );
    fireEvent.click(screen.getByText('Transform'));
    expect(screen.queryByText('My Content')).toBeNull();
  });

  it('shows ChevronRight when collapsed', () => {
    render(
      <CollapsibleSection id="test-section" title="Transform">
        <div>Content</div>
      </CollapsibleSection>
    );
    fireEvent.click(screen.getByText('Transform'));
    expect(screen.getByTestId('chevron-right')).toBeInTheDocument();
  });

  it('expands again after second click', () => {
    render(
      <CollapsibleSection id="test-section" title="Transform">
        <div>My Content</div>
      </CollapsibleSection>
    );
    fireEvent.click(screen.getByText('Transform'));
    fireEvent.click(screen.getByText('Transform'));
    expect(screen.getByText('My Content')).toBeInTheDocument();
  });

  it('renders headerRight when provided', () => {
    render(
      <CollapsibleSection id="test-section" title="Transform" headerRight={<span>Badge</span>}>
        <div>Content</div>
      </CollapsibleSection>
    );
    expect(screen.getByText('Badge')).toBeInTheDocument();
  });

  it('starts collapsed when localStorage has the id', () => {
    localStorage.setItem('forge-inspector-collapsed', JSON.stringify(['my-section']));
    render(
      <CollapsibleSection id="my-section" title="Material">
        <div>Hidden Content</div>
      </CollapsibleSection>
    );
    expect(screen.queryByText('Hidden Content')).toBeNull();
  });

  it('aria-expanded is true when expanded', () => {
    render(
      <CollapsibleSection id="test-section" title="Transform">
        <div>Content</div>
      </CollapsibleSection>
    );
    const button = screen.getByRole('button');
    expect(button.getAttribute('aria-expanded')).toBe('true');
  });

  it('aria-expanded is false when collapsed', () => {
    render(
      <CollapsibleSection id="test-section" title="Transform">
        <div>Content</div>
      </CollapsibleSection>
    );
    fireEvent.click(screen.getByText('Transform'));
    const button = screen.getByRole('button');
    expect(button.getAttribute('aria-expanded')).toBe('false');
  });
});
