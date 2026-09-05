/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, afterEach } from 'vitest';
import { render, screen, cleanup } from '@/test/utils/componentTestUtils';
import { GenerationUnavailableNotice } from '../GenerationUnavailableNotice';

describe('GenerationUnavailableNotice', () => {
  afterEach(() => cleanup());

  it('renders the server reason under the given id', () => {
    render(<GenerationUnavailableNotice id="x-unavailable" reason="Music generation is not available yet." />);
    const el = screen.getByRole('status');
    expect(el).toHaveAttribute('id', 'x-unavailable');
    expect(el).toHaveTextContent('Unavailable. Music generation is not available yet.');
  });

  it('falls back to a generic sentence when no reason is supplied', () => {
    render(<GenerationUnavailableNotice id="x" reason={undefined} />);
    expect(screen.getByRole('status')).toHaveTextContent('This generation feature is not available yet.');
  });
});
