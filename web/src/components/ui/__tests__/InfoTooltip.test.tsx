/**
 * Render tests for InfoTooltip component.
 *
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup } from '@/test/utils/componentTestUtils';
import { InfoTooltip } from '../InfoTooltip';

vi.mock('@/lib/workspace/tooltipDictionary', () => ({
  TOOLTIP_DICTIONARY: {
    bloom: 'A post-processing effect that makes bright areas glow.',
    msaa: 'Multi-sample anti-aliasing reduces jagged edges.',
    physics: 'Simulates real-world physical interactions.',
  },
}));

vi.mock('lucide-react', () => ({
  HelpCircle: (props: Record<string, unknown>) => <span data-testid="help-circle-icon" {...props} />,
}));

describe('InfoTooltip', () => {
  afterEach(() => {
    cleanup();
  });

  it('renders icon when term exists in dictionary', () => {
    render(<InfoTooltip term="bloom" />);
    expect(screen.getByTestId('help-circle-icon')).not.toBeNull();
  });

  it('renders icon when text override provided', () => {
    render(<InfoTooltip text="Custom tooltip text" />);
    expect(screen.getByTestId('help-circle-icon')).not.toBeNull();
  });

  it('returns null when term not in dictionary', () => {
    const { container } = render(<InfoTooltip term="unknown_term" />);
    expect(container.firstChild).toBeNull();
  });

  it('returns null when neither term nor text provided', () => {
    const { container } = render(<InfoTooltip />);
    expect(container.firstChild).toBeNull();
  });

  it('sets title attribute from dictionary lookup', () => {
    render(<InfoTooltip term="bloom" />);
    // The outer span has the title; the icon is a child
    const outerSpan = screen.getByTestId('help-circle-icon').parentElement;
    expect(outerSpan?.getAttribute('title')).toBe('A post-processing effect that makes bright areas glow.');
  });

  it('sets title attribute from text override', () => {
    render(<InfoTooltip text="Custom tooltip text" />);
    const outerSpan = screen.getByTestId('help-circle-icon').parentElement;
    expect(outerSpan?.getAttribute('title')).toBe('Custom tooltip text');
  });

  it('prefers text override over term dictionary lookup', () => {
    render(<InfoTooltip term="bloom" text="Override text" />);
    const outerSpan = screen.getByTestId('help-circle-icon').parentElement;
    expect(outerSpan?.getAttribute('title')).toBe('Override text');
  });
});
