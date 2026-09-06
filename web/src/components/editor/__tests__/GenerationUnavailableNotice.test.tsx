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

  // The server's reason for a merely unconfigured capability is actionable
  // ("Configure Meshy API key in Settings..."), so the notice carries the user
  // there. This is the payoff for keeping such entry points clickable: the
  // dialog is where the fix lives (#9725 p7).
  it('offers a Settings link when the capability is merely unconfigured', () => {
    render(
      <GenerationUnavailableNotice
        id="x"
        reason="Configure Meshy API key in Settings to enable 3D Model Generation."
        unprovisionable={false}
      />,
    );
    expect(screen.getByRole('link', { name: /settings/i })).toHaveAttribute('href', '/settings');
  });

  // Nothing the user can do in Settings enables an unprovisionable capability,
  // so sending them there would be a dead end of its own.
  it('omits the Settings link when no key can enable the capability', () => {
    render(
      <GenerationUnavailableNotice
        id="x"
        reason="Music generation is not available yet."
        unprovisionable={true}
      />,
    );
    expect(screen.queryByRole('link')).toBeNull();
  });
});
