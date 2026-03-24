/**
 * Tests for ShaderNodeBase — renders known and unknown node types,
 * displays correct labels, handles selected state.
 *
 * @vitest-environment jsdom
 */

import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup } from '@/test/utils/componentTestUtils';
import { ShaderNodeBase } from '../ShaderNodeBase';

// Mock @xyflow/react to avoid the canvas / ResizeObserver environment
vi.mock('@xyflow/react', () => ({
  Handle: ({ id, type }: { id: string; type: string }) => (
    <div data-testid={`handle-${type}-${id}`} />
  ),
  Position: { Left: 'left', Right: 'right' },
}));

// Minimal NodeProps shape required by the component
function makeNodeProps(
  nodeType: string,
  options: { selected?: boolean } = {}
// eslint-disable-next-line @typescript-eslint/no-explicit-any
): any {
  return {
    id: 'node-1',
    type: 'shader',
    selected: options.selected ?? false,
    dragging: false,
    zIndex: 0,
    isConnectable: true,
    positionAbsoluteX: 0,
    positionAbsoluteY: 0,
    data: { nodeType },
  };
}

describe('ShaderNodeBase', () => {
  afterEach(() => cleanup());

  // ── Known node type ────────────────────────────────────────────────────

  it('renders the label for a known node type (multiply)', () => {
    render(<ShaderNodeBase {...makeNodeProps('multiply')} />);
    // 'Multiply' is the label defined in SHADER_NODE_DEFINITIONS
    expect(screen.getByText('Multiply')).not.toBeNull();
  });

  it('renders input and output handle placeholders', () => {
    const { container } = render(<ShaderNodeBase {...makeNodeProps('multiply')} />);
    // Should have at least one target and one source handle
    const targetHandles = container.querySelectorAll('[data-testid^="handle-target-"]');
    const sourceHandles = container.querySelectorAll('[data-testid^="handle-source-"]');
    expect(targetHandles.length).toBeGreaterThan(0);
    expect(sourceHandles.length).toBeGreaterThan(0);
  });

  // ── Unknown node type ──────────────────────────────────────────────────

  it('renders an error state for unknown node types', () => {
    const { container } = render(<ShaderNodeBase {...makeNodeProps('nonexistent_node_xyz')} />);
    expect(container.textContent).toContain('Unknown');
    expect(container.textContent).toContain('nonexistent_node_xyz');
  });

  it('applies red border to unknown node', () => {
    const { container } = render(<ShaderNodeBase {...makeNodeProps('nonexistent_node_xyz')} />);
    expect(container.querySelector('.border-red-500')).not.toBeNull();
  });

  // ── Selected state ────────────────────────────────────────────────────

  it('applies blue border when selected=true', () => {
    const { container } = render(
      <ShaderNodeBase {...makeNodeProps('multiply', { selected: true })} />
    );
    expect(container.querySelector('.border-blue-500')).not.toBeNull();
  });

  it('applies zinc border when not selected', () => {
    const { container } = render(
      <ShaderNodeBase {...makeNodeProps('multiply', { selected: false })} />
    );
    expect(container.querySelector('.border-zinc-700')).not.toBeNull();
  });

  // ── PBR output node ───────────────────────────────────────────────────

  it('renders pbr_output node with its label', () => {
    render(<ShaderNodeBase {...makeNodeProps('pbr_output')} />);
    expect(screen.getByText('PBR Output')).not.toBeNull();
  });

  // ── Time node (no inputs) ─────────────────────────────────────────────

  it('renders time node (input-only source) without target handles', () => {
    const { container } = render(<ShaderNodeBase {...makeNodeProps('time')} />);
    const targetHandles = container.querySelectorAll('[data-testid^="handle-target-"]');
    expect(targetHandles.length).toBe(0);
  });
});
