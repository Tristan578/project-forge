/** @vitest-environment jsdom */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { GenerateSpriteDialog } from '../GenerateSpriteDialog';
import { _resetCapabilitiesCache } from '@/hooks/useFeatureGating';

vi.mock('@/stores/userStore', () => ({
  useUserStore: (selector: (state: { tokenBalance: { total: number } }) => unknown) => selector({ tokenBalance: { total: 1000 } }),
}));
vi.mock('@/stores/generationStore', () => ({
  useGenerationStore: (selector: (state: { addJob: () => void }) => unknown) => selector({ addJob: vi.fn() }),
}));

afterEach(() => { cleanup(); _resetCapabilitiesCache(); vi.restoreAllMocks(); });

describe('sprite provider selection with real capability gating', () => {
  it.each(['openai', 'replicate'])('keeps working paths reachable with only %s', async (provider) => {
    _resetCapabilitiesCache();
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({
      capabilities: [{ capability: 'sprite', available: true, label: 'Sprite Generation', providerAvailability: { openai: provider === 'openai', replicate: provider === 'replicate' } }],
      available: ['sprite'], unavailable: [], degraded: false,
    })));
    await act(async () => { render(<GenerateSpriteDialog isOpen onClose={vi.fn()} />); });
    await waitFor(() => expect(fetch).toHaveBeenCalled());
    const prompt = screen.getByRole('textbox');
    if (provider === 'openai') {
      await screen.findByRole('status');
      expect(prompt).toBeDisabled();
      expect(screen.getByRole('status')).toHaveTextContent('Replicate');
    } else {
      await waitFor(() => expect(prompt).toBeEnabled());
    }
    const style = screen.getAllByRole('combobox')[0];
    expect(style).toBeEnabled();
    fireEvent.change(style, { target: { value: 'hand-drawn' } });
    if (provider === 'openai') {
      expect(prompt).toBeEnabled();
      fireEvent.change(prompt, { target: { value: 'A wizard' } });
      expect(screen.getByText('Generate').closest('button')).toBeEnabled();
    } else {
      expect(prompt).toBeDisabled();
      expect(screen.getByRole('status')).toHaveTextContent('OpenAI');
    }
    fireEvent.click(screen.getByText('Sprite Sheet'));
    expect((prompt as HTMLTextAreaElement).disabled).toBe(provider === 'openai');
    fireEvent.click(screen.getByText('Tileset'));
    expect((prompt as HTMLTextAreaElement).disabled).toBe(provider === 'openai');
  });
});
