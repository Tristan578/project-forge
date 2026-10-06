/**
 * Render tests for TemplateGallery component.
 *
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup, waitFor } from '@/test/utils/componentTestUtils';
import { TemplateGallery } from '../TemplateGallery';
import { useEditorStore } from '@/stores/editorStore';
import { AnalyticsEvent } from '@/lib/analytics/posthog';
import { EngineDispatchThrewError, ENGINE_THREW_RELOAD_GUIDANCE } from '@/lib/scenes/engineDispatchThrew';

vi.mock('@/stores/editorStore', () => ({
  useEditorStore: vi.fn(() => ({})),
}));

vi.mock('lucide-react', () => ({
  Gamepad2: (props: Record<string, unknown>) => <span data-testid="gamepad-icon" {...props} />,
  Zap: (props: Record<string, unknown>) => <span data-testid="zap-icon" {...props} />,
  Crosshair: (props: Record<string, unknown>) => <span data-testid="crosshair-icon" {...props} />,
  Puzzle: (props: Record<string, unknown>) => <span data-testid="puzzle-icon" {...props} />,
  Compass: (props: Record<string, unknown>) => <span data-testid="compass-icon" {...props} />,
  X: (props: Record<string, unknown>) => <span data-testid="x-icon" {...props} />,
  AlertTriangle: (props: Record<string, unknown>) => <span data-testid="alert-icon" {...props} />,
  Loader2: (props: Record<string, unknown>) => <span data-testid="loader-icon" {...props} />,
}));

const mockTrackEvent = vi.fn();
vi.mock('@/lib/analytics/posthog', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/analytics/posthog')>()),
  trackEvent: (...args: unknown[]) => mockTrackEvent(...args),
}));

// The toast's own behaviour (draft + reveal, never a send) is pinned in
// customizeWithAi.test.ts; here only WHEN the gallery offers it (#10172).
const mockOfferCustomizeWithAi = vi.fn();
vi.mock('@/lib/chat/customizeWithAi', () => ({
  offerCustomizeWithAi: (...args: unknown[]) => mockOfferCustomizeWithAi(...args),
}));

vi.mock('@/data/templates', () => ({
  TEMPLATE_REGISTRY: [
    {
      id: 'platformer',
      name: 'Platformer',
      description: 'Side-scrolling platformer game',
      difficulty: 'beginner',
      entityCount: 5,
      tags: ['2d', 'platformer'],
      thumbnail: { gradient: 'linear-gradient()', icon: 'Gamepad2', accentColor: '#ff0000' },
    },
  ],
}));

describe('TemplateGallery', () => {
  const mockOnClose = vi.fn();
  const mockLoadTemplate = vi
    .fn()
    .mockResolvedValue({ success: true, entityCount: 5, skippedEntityIds: [] });
  const mockNewScene = vi.fn();
  // `newScene()` returns false for two unrelated facts — the engine REFUSED, or
  // there is no dispatcher yet and the call was DEFERRED — and this is what
  // separates them. Defaults to an attached engine, the state every other test
  // in this file describes.
  const mockIsEngineAttached = vi.fn(() => true);

  function setupStore() {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    vi.mocked(useEditorStore).mockImplementation((selector: any) => {
      const state = {
        loadTemplate: mockLoadTemplate,
        newScene: mockNewScene,
        isEngineAttached: mockIsEngineAttached,
      };
      return typeof selector === 'function' ? selector(state) : state;
    });
  }

  beforeEach(() => {
    vi.clearAllMocks();
    mockLoadTemplate.mockResolvedValue({ success: true, entityCount: 5, skippedEntityIds: [] });
    mockIsEngineAttached.mockReturnValue(true);
    setupStore();
  });

  afterEach(() => {
    cleanup();
  });

  it('returns null when not open', () => {
    const { container } = render(<TemplateGallery isOpen={false} onClose={mockOnClose} />);
    expect(container.firstChild).toBeNull();
  });

  it('renders Choose a Template heading when open', () => {
    render(<TemplateGallery isOpen={true} onClose={mockOnClose} />);
    expect(screen.getByText('Choose a Template')).toBeInTheDocument();
  });

  it('renders subtitle text', () => {
    render(<TemplateGallery isOpen={true} onClose={mockOnClose} />);
    expect(screen.getByText('Start with a pre-built game or a blank project')).toBeInTheDocument();
  });

  it('renders Blank Project card', () => {
    render(<TemplateGallery isOpen={true} onClose={mockOnClose} />);
    expect(screen.getByText('Blank Project')).toBeInTheDocument();
  });

  it('renders close button with aria-label', () => {
    render(<TemplateGallery isOpen={true} onClose={mockOnClose} />);
    expect(screen.getByLabelText('Close template gallery')).toBeInTheDocument();
  });

  it('calls onClose when close button clicked', () => {
    render(<TemplateGallery isOpen={true} onClose={mockOnClose} />);
    fireEvent.click(screen.getByLabelText('Close template gallery'));
    expect(mockOnClose).toHaveBeenCalled();
  });

  it('calls newScene and onClose when Blank Project selected', () => {
    render(<TemplateGallery isOpen={true} onClose={mockOnClose} />);
    fireEvent.click(screen.getByText('Blank Project').closest('button')!);
    expect(mockNewScene).toHaveBeenCalled();
    expect(mockOnClose).toHaveBeenCalled();
  });

  // #10056: the blank-project branch fired GAME_CREATED and closed the dialog
  // no matter what `newScene()` returned, reporting a blank project the engine
  // never accepted — the same false success the template branch already guards.
  it('Blank Project when the engine rejects keeps the gallery open and shows the reason', () => {
    mockNewScene.mockReturnValueOnce(false);
    render(<TemplateGallery isOpen={true} onClose={mockOnClose} />);
    fireEvent.click(screen.getByText('Blank Project').closest('button')!);
    expect(mockNewScene).toHaveBeenCalled();
    expect(mockOnClose).not.toHaveBeenCalled();
    expect(mockTrackEvent).not.toHaveBeenCalledWith(AnalyticsEvent.GAME_CREATED, expect.anything());
    expect(screen.getByRole('alert')).toHaveTextContent('The engine did not accept a new scene. Please try again.');
  });

  // The other half of the same boolean. `newScene()` is ALSO false when there is
  // no dispatcher yet — the ordinary cold open, since the engine mounts after
  // the editor page — and the first fix for the line above read that as a
  // refusal, so picking Blank Project on a still-loading editor put an error
  // banner up and trapped the user in the dialog. Nothing was cleared because
  // nothing needed to be: the editor is already blank.
  it('Blank Project with no dispatcher starts the project (deferral is not an error)', () => {
    mockNewScene.mockReturnValueOnce(false);
    mockIsEngineAttached.mockReturnValue(false);
    render(<TemplateGallery isOpen={true} onClose={mockOnClose} />);
    fireEvent.click(screen.getByText('Blank Project').closest('button')!);
    expect(mockNewScene).toHaveBeenCalled();
    expect(screen.queryByRole('alert')).toBeNull();
    expect(mockTrackEvent).toHaveBeenCalledWith(AnalyticsEvent.GAME_CREATED, { source: 'blank' });
    expect(mockOnClose).toHaveBeenCalled();
  });

  // #10202 review, M1: `newScene()` re-raises a dispatch the engine threw on,
  // after locking saving (#10079, #10202). This path had no catch, so the
  // throw became an unhandled rejection (the card's `onClick` drops the
  // promise): the gallery stayed open with no explanation, `setError` never
  // ran, and nothing said to reload.
  describe('Blank Project when newScene throws (#10202)', () => {
    /** A Node-level listener: with no catch, the dropped promise rejects and this fires. */
    function watchUnhandledRejections() {
      const unhandled = vi.fn();
      process.on('unhandledRejection', unhandled);
      return {
        unhandled,
        async settle() {
          // Node reports an unhandled rejection once the microtask queue has
          // drained, before the next check-phase callback runs.
          await new Promise((resolve) => setImmediate(resolve));
          process.off('unhandledRejection', unhandled);
        },
      };
    }

    it('stays open, tells the user to reload in the shared sentence, fires nothing and rejects nothing', async () => {
      const watch = watchUnhandledRejections();
      mockNewScene.mockImplementationOnce(() => { throw new EngineDispatchThrewError('new_scene', 'JsValue("serialize failed")'); });
      render(<TemplateGallery isOpen={true} onClose={mockOnClose} />);

      fireEvent.click(screen.getByText('Blank Project').closest('button')!);

      const alert = await screen.findByRole('alert');
      expect(alert).toHaveTextContent(ENGINE_THREW_RELOAD_GUIDANCE);
      expect(alert).toHaveTextContent('JsValue("serialize failed")');
      expect(alert).not.toHaveTextContent('try again');
      expect(screen.getByRole('dialog')).toBeInTheDocument();
      expect(mockOnClose).not.toHaveBeenCalled();
      expect(mockTrackEvent).not.toHaveBeenCalledWith(AnalyticsEvent.GAME_CREATED, expect.anything());
      await watch.settle();
      expect(watch.unhandled).not.toHaveBeenCalled();
    });

    // #10202 review, M3: only the typed engine throw carries a lockout. A
    // plain error out of the store set none, so the banner must not claim one.
    it('reports a non-engine throw as a plain failure, never as an engine error with a lockout', async () => {
      const watch = watchUnhandledRejections();
      mockNewScene.mockImplementationOnce(() => { throw new Error('hydrate failed'); });
      render(<TemplateGallery isOpen={true} onClose={mockOnClose} />);

      fireEvent.click(screen.getByText('Blank Project').closest('button')!);

      const alert = await screen.findByRole('alert');
      expect(alert).toHaveTextContent('A new scene could not be created: hydrate failed');
      expect(alert).not.toHaveTextContent('engine error');
      expect(alert).not.toHaveTextContent(ENGINE_THREW_RELOAD_GUIDANCE);
      expect(mockOnClose).not.toHaveBeenCalled();
      await watch.settle();
      expect(watch.unhandled).not.toHaveBeenCalled();
    });
  });

  it('has role="dialog" on the modal', () => {
    render(<TemplateGallery isOpen={true} onClose={mockOnClose} />);
    expect(screen.getByRole('dialog')).toBeInTheDocument();
  });

  it('calls onClose when Escape key pressed', () => {
    render(<TemplateGallery isOpen={true} onClose={mockOnClose} />);
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(mockOnClose).toHaveBeenCalled();
  });

  it('calls onClose when backdrop clicked', () => {
    render(<TemplateGallery isOpen={true} onClose={mockOnClose} />);
    // The outer fixed div has onClick={onClose}
    const backdrop = screen.getByRole('dialog').parentElement!;
    fireEvent.click(backdrop);
    expect(mockOnClose).toHaveBeenCalled();
  });

  // The gallery used to close and fire TEMPLATE_USED / TEMPLATE_APPLIED for any
  // outcome, so a failed load looked identical to a successful one: the dialog
  // went away, the funnel counted an activation, and the canvas stayed empty.
  describe('when the template load fails', () => {
    beforeEach(() => {
      mockLoadTemplate.mockResolvedValue({ success: false, error: 'Engine is not ready yet' });
    });

    it('stays open and shows the reason', async () => {
      render(<TemplateGallery isOpen={true} onClose={mockOnClose} />);

      fireEvent.click((await screen.findByText('Platformer')).closest('button')!);

      expect(await screen.findByRole('alert')).toHaveTextContent('Engine is not ready yet');
      expect(mockOnClose).not.toHaveBeenCalled();
      expect(screen.getByRole('dialog')).toBeInTheDocument();
    });

    it('does not report the template as used or applied', async () => {
      render(<TemplateGallery isOpen={true} onClose={mockOnClose} />);

      fireEvent.click((await screen.findByText('Platformer')).closest('button')!);
      await screen.findByRole('alert');

      expect(mockTrackEvent).not.toHaveBeenCalled();
    });

    it('offers no "Customize with AI" for a load that failed', async () => {
      render(<TemplateGallery isOpen={true} onClose={mockOnClose} />);

      fireEvent.click((await screen.findByText('Platformer')).closest('button')!);
      await screen.findByRole('alert');

      expect(mockOfferCustomizeWithAi).not.toHaveBeenCalled();
    });

    it('clears the error when the retry succeeds', async () => {
      render(<TemplateGallery isOpen={true} onClose={mockOnClose} />);
      fireEvent.click((await screen.findByText('Platformer')).closest('button')!);
      await screen.findByRole('alert');

      mockLoadTemplate.mockResolvedValue({ success: true, entityCount: 5, skippedEntityIds: [] });
      fireEvent.click((await screen.findByText('Platformer')).closest('button')!);

      await waitFor(() => expect(mockOnClose).toHaveBeenCalled());
      expect(screen.queryByRole('alert')).toBeNull();
    });
  });

  describe('when the template load succeeds', () => {
    it('closes and reports the template as used and applied', async () => {
      render(<TemplateGallery isOpen={true} onClose={mockOnClose} />);

      fireEvent.click((await screen.findByText('Platformer')).closest('button')!);

      await waitFor(() => expect(mockOnClose).toHaveBeenCalled());
      expect(mockTrackEvent).toHaveBeenCalledWith(AnalyticsEvent.TEMPLATE_USED, {
        templateId: 'platformer',
      });
      expect(mockTrackEvent).toHaveBeenCalledWith(AnalyticsEvent.TEMPLATE_APPLIED, {
        templateId: 'platformer',
        source: 'gallery',
      });
      expect(screen.queryByRole('alert')).toBeNull();
    });

    it('offers "Customize with AI" once, naming the template that loaded', async () => {
      render(<TemplateGallery isOpen={true} onClose={mockOnClose} />);

      fireEvent.click((await screen.findByText('Platformer')).closest('button')!);

      await waitFor(() => expect(mockOnClose).toHaveBeenCalled());
      expect(mockOfferCustomizeWithAi).toHaveBeenCalledTimes(1);
      expect(mockOfferCustomizeWithAi).toHaveBeenCalledWith('Platformer');
    });

    it('blocks a second selection while a load is in flight', async () => {
      let settle: (value: { success: boolean; entityCount: number; skippedEntityIds: string[] }) => void = () => {};
      mockLoadTemplate.mockReturnValue(new Promise((resolve) => { settle = resolve; }));

      render(<TemplateGallery isOpen={true} onClose={mockOnClose} />);
      fireEvent.click((await screen.findByText('Platformer')).closest('button')!);

      const card = screen.getByText('Platformer').closest('button')!;
      await waitFor(() => expect(card).toBeDisabled());
      expect(card).toHaveAttribute('aria-busy', 'true');
      expect(screen.getByText('Blank Project').closest('button')!).toBeDisabled();

      settle({ success: true, entityCount: 5, skippedEntityIds: [] });
      await waitFor(() => expect(mockOnClose).toHaveBeenCalled());
      expect(mockLoadTemplate).toHaveBeenCalledTimes(1);
    });
  });
});
