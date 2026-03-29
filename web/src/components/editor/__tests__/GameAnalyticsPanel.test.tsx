/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, cleanup } from '@/test/utils/componentTestUtils';
import { GameAnalyticsPanel } from '../GameAnalyticsPanel';

describe('GameAnalyticsPanel', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    cleanup();
  });

  it('renders without crashing when no sessions provided', () => {
    const { container } = render(<GameAnalyticsPanel />);
    expect(container.firstChild).not.toBeNull();
  });

  it('renders with empty sessions array', () => {
    const { container } = render(<GameAnalyticsPanel sessions={[]} />);
    expect(container.firstChild).not.toBeNull();
  });
});
