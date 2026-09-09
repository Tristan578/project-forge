/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, afterEach, beforeEach } from 'vitest';
import { render, screen, cleanup, fireEvent } from '@/test/utils/componentTestUtils';
import { GenerationUnavailableNotice } from '../GenerationUnavailableNotice';
import { useWorkspaceStore } from '@/stores/workspaceStore';

describe('GenerationUnavailableNotice', () => {
  beforeEach(() => useWorkspaceStore.setState({ settingsTab: null }));
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
  // dialog is where the fix lives (#9725 p7). It opens the editor's OWN
  // Settings modal on the keys tab -- an `<a href="/settings">` was a full
  // document load that tore down the WASM session, unloaded the scene and
  // discarded the prompt just typed, with no route back (#9725 p8).
  it('opens the in-editor Settings keys tab when the capability is merely unconfigured', () => {
    render(
      <GenerationUnavailableNotice
        id="x"
        reason="Configure Meshy API key in Settings to enable 3D Model Generation."
        unprovisionable={false}
        byokConfigurable={true}
      />,
    );
    expect(screen.queryByRole('link')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: /settings/i }));
    expect(useWorkspaceStore.getState().settingsTab).toBe('keys');
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
    expect(screen.queryByRole('button')).toBeNull();
    expect(screen.queryByRole('link')).toBeNull();
  });

  // Settings can only store a BYOK_PROVIDERS key. `sprite` needs Replicate and
  // OpenAI, `image` and `bg_removal` need OpenAI / remove.bg -- none of which
  // `/api/keys/[provider]` accepts or ApiKeyManager renders a field for, so
  // the link led to a page where the named key cannot be added: the exact dead
  // end this notice exists to remove (#9725 p8).
  it('omits the Settings link when the missing key cannot be added in Settings', () => {
    render(
      <GenerationUnavailableNotice
        id="x"
        reason="Sprite Generation needs Replicate and OpenAI API keys, which only this deployment can configure."
        unprovisionable={false}
        byokConfigurable={false}
      />,
    );
    expect(screen.getByRole('status')).toHaveTextContent('only this deployment can configure');
    expect(screen.queryByRole('button')).toBeNull();
    expect(screen.queryByRole('link')).toBeNull();
  });
});
