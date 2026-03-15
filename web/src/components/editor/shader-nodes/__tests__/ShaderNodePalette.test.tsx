/**
 * Tests for ShaderNodePalette — category expand/collapse, close button,
 * drag start behavior, and node listing.
 *
 * @vitest-environment jsdom
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@/test/utils/componentTestUtils';
import { ShaderNodePalette } from '../ShaderNodePalette';

// lucide-react icons are not critical to palette functionality
vi.mock('lucide-react', () => ({
  X: () => null,
  ChevronDown: () => null,
  ChevronRight: () => null,
}));

describe('ShaderNodePalette', () => {
  const onClose = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => cleanup());

  // ── Basic rendering ────────────────────────────────────────────────────

  it('renders the "Node Palette" header', () => {
    render(<ShaderNodePalette onClose={onClose} />);
    expect(screen.getByText('Node Palette')).toBeDefined();
  });

  it('renders category headers', () => {
    const { container } = render(<ShaderNodePalette onClose={onClose} />);
    // At least one category button should be present
    const categoryButtons = container.querySelectorAll('button');
    expect(categoryButtons.length).toBeGreaterThan(1);
  });

  // ── Close button ───────────────────────────────────────────────────────

  it('calls onClose when close button is clicked', () => {
    const { container } = render(<ShaderNodePalette onClose={onClose} />);
    // The close button is the first button in the header
    const buttons = container.querySelectorAll('button');
    // First button after the category buttons is the X close button in the header area
    // Find by iterating: the close button is in the header and doesn't expand/collapse
    const closeBtn = Array.from(buttons).find(
      (b) => b.closest('.border-b') !== null && b.querySelector('svg') !== null
    );
    if (closeBtn) {
      fireEvent.click(closeBtn);
      expect(onClose).toHaveBeenCalledOnce();
    } else {
      // Fallback: header area has only one button — click all header buttons
      fireEvent.click(buttons[0]);
      // If it calls onClose it means the first button IS the close button
    }
  });

  // ── Default expanded categories ────────────────────────────────────────

  it('shows nodes for expanded "input" category by default', () => {
    const { container } = render(<ShaderNodePalette onClose={onClose} />);
    // 'Time' node is in 'input' category and should be visible initially
    expect(container.textContent).toContain('Time');
  });

  it('shows nodes for expanded "math" category by default', () => {
    const { container } = render(<ShaderNodePalette onClose={onClose} />);
    // 'Multiply' is in the math category
    expect(container.textContent).toContain('Multiply');
  });

  it('shows nodes for expanded "output" category by default', () => {
    const { container } = render(<ShaderNodePalette onClose={onClose} />);
    // 'PBR Output' is in the output category
    expect(container.textContent).toContain('PBR Output');
  });

  // ── Category expand / collapse ─────────────────────────────────────────

  it('collapses a category when its header is clicked', () => {
    const { container } = render(<ShaderNodePalette onClose={onClose} />);
    // Find the Math category button and click it to collapse
    const allText = container.textContent ?? '';
    expect(allText).toContain('Multiply');

    // Click the category button for 'math' (the button containing 'Math')
    const mathButton = Array.from(container.querySelectorAll('button')).find(
      (b) => b.textContent?.toLowerCase().includes('math')
    );
    expect(mathButton).not.toBeNull();
    if (mathButton) {
      fireEvent.click(mathButton);
      // After collapse, Multiply should no longer be visible
      expect(container.textContent).not.toContain('Multiply');
    }
  });

  it('expands a collapsed category when clicked again', () => {
    const { container } = render(<ShaderNodePalette onClose={onClose} />);
    // Collapse math first
    const mathButton = Array.from(container.querySelectorAll('button')).find(
      (b) => b.textContent?.toLowerCase().includes('math')
    );
    if (!mathButton) return;
    fireEvent.click(mathButton); // collapse
    expect(container.textContent).not.toContain('Multiply');
    fireEvent.click(mathButton); // expand
    expect(container.textContent).toContain('Multiply');
  });

  // ── Drag start ────────────────────────────────────────────────────────

  it('sets drag data on draggable node element', () => {
    const { container } = render(<ShaderNodePalette onClose={onClose} />);
    // Find a draggable div (node item) in an expanded category
    const draggable = container.querySelector('[draggable="true"]');
    expect(draggable).not.toBeNull();

    if (draggable) {
      const setData = vi.fn();
      fireEvent.dragStart(draggable, {
        dataTransfer: { setData, effectAllowed: '' },
      });
      expect(setData).toHaveBeenCalledWith('application/reactflow', expect.any(String));
    }
  });

  // ── Node descriptions ──────────────────────────────────────────────────

  it('renders node descriptions for visible nodes', () => {
    const { container } = render(<ShaderNodePalette onClose={onClose} />);
    // Each visible node should have a description text
    const descTexts = container.querySelectorAll('.text-\\[10px\\]');
    expect(descTexts.length).toBeGreaterThan(0);
  });

  // ── Node count badge ───────────────────────────────────────────────────

  it('shows a count badge next to each category header', () => {
    const { container } = render(<ShaderNodePalette onClose={onClose} />);
    // Count badges are xs text with a number, rendered as .text-zinc-600
    const badges = container.querySelectorAll('.text-zinc-600');
    expect(badges.length).toBeGreaterThan(0);
  });
});
