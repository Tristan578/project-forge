/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@/test/utils/componentTestUtils';
import { GDDPanel } from '../GDDPanel';
import { generateGDD } from '@/lib/ai/gddGenerator';

vi.mock('@/lib/ai/gddGenerator', () => ({
  generateGDD: vi.fn().mockResolvedValue({}),
  gddToMarkdown: vi.fn(() => ''),
  estimateScope: vi.fn(() => 'small'),
}));
vi.mock('@/lib/ai/systemDecomposer', () => ({
  decomposeIntoSystems: vi.fn(() => []),
  getSystemLabel: vi.fn(() => ''),
}));

describe('GDDPanel', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    cleanup();
  });

  it('announces a generation failure with the error notice and allows retry', async () => {
    vi.mocked(generateGDD).mockRejectedValueOnce(new Error('Generation service unavailable'));
    render(<GDDPanel />);
    fireEvent.change(screen.getByLabelText('Game Idea'), { target: { value: 'A puzzle game' } });
    fireEvent.click(screen.getByRole('button', { name: /Generate GDD/i }));
    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('Generation service unavailable');
    expect(alert).toHaveClass('bg-[color-mix(in_srgb,var(--sf-destructive)_12%,var(--sf-bg-surface))]', 'text-[var(--sf-text)]');
    expect(screen.queryByRole('status')).toBeNull();
    expect(screen.getByRole('button', { name: /Generate GDD/i })).toBeEnabled();
  });

  it('renders without crashing', () => {
    const { container } = render(<GDDPanel />);
    expect(container.firstChild).not.toBeNull();
  });
});
