/**
 * A format refusal (`<command> refused: <reason>`) is the person's input being
 * turned away, not the engine failing. assetSlice shows it with the file name
 * and the reason on every refused file; the tracked dispatcher's generic
 * "Couldn't … The engine rejected the change." report (and its Sentry
 * exception) is for engine faults and must not fire alongside it, or the
 * first refused file shows two toasts and a false issue is filed (#10396).
 *
 * Runs the REAL tracked dispatcher together with the real slice, as the editor
 * does, so the pin is on the two working together rather than on either in
 * isolation.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('@/lib/monitoring/sentry-client', () => ({
  addBreadcrumb: vi.fn(),
  captureException: vi.fn(),
  captureMessage: vi.fn(),
  setTag: vi.fn(),
  withScope: vi.fn(),
  startSpan: vi.fn((_opts: unknown, cb: () => unknown) => cb()),
  initSentryClient: vi.fn(),
}));

vi.mock('@/lib/analytics/events', () => ({
  trackCommandDispatched: vi.fn(),
}));

vi.mock('@/lib/toast', () => ({
  showError: vi.fn(),
  showPersistentError: vi.fn(),
  showSuccess: vi.fn(),
  showInfo: vi.fn(),
}));

const PNG_DATA_URL = 'data:image/png;base64,iVBORw0KGgo=';
const REASON = "unsupported texture format 'image/webp'; accepted formats are image/png, image/jpeg";

async function loadStore() {
  vi.resetModules();
  const store = await import('../editorStore');
  const sentry = await import('@/lib/monitoring/sentry-client');
  const notifications = await import('@/lib/toast');
  return { store, sentry, notifications };
}

describe('a format refusal is reported once, by the slice, not as an engine fault', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('load_texture: the refusal toast is shown with the file name, and nothing generic fires', async () => {
    const { store, sentry, notifications } = await loadStore();
    // What the engine answers for a format it has no decoder for.
    store.setCommandDispatcher(() => ({ success: false, error: `load_texture refused: ${REASON}` }));

    const outcome = store.useEditorStore.getState().loadTexture(PNG_DATA_URL, 'photo.png', 'ent-1', 'base_color');

    expect(outcome).toEqual({ success: false, error: REASON });
    expect(notifications.showPersistentError).toHaveBeenCalledTimes(1);
    expect(notifications.showPersistentError).toHaveBeenCalledWith(
      `Couldn't load "photo.png" as a texture: ${REASON}`,
      { id: 'load_texture-refused:photo.png' },
    );
    expect(notifications.showError).not.toHaveBeenCalled();
    expect(sentry.captureException).not.toHaveBeenCalled();
    expect(console.error).not.toHaveBeenCalled();
    // Still observable in a session's breadcrumb trail.
    expect(sentry.addBreadcrumb).toHaveBeenCalledWith(expect.objectContaining({
      category: 'engine.command.refused',
      message: expect.stringContaining('load_texture'),
    }));
  });

  it('import_gltf: the same, for a model the engine inspected and turned away', async () => {
    const { store, sentry, notifications } = await loadStore();
    const reason = 'image #0 is a KTX2 texture (declared by its mimeType); KTX2 textures are not supported, convert the model\'s textures to PNG or JPEG and import again';
    store.setCommandDispatcher(() => ({ success: false, error: `import_gltf refused: ${reason}` }));

    const outcome = store.useEditorStore.getState().importGltf('Z2xURg==', 'crafted.glb');

    expect(outcome).toEqual({ success: false, error: reason });
    expect(notifications.showPersistentError).toHaveBeenCalledTimes(1);
    expect(notifications.showPersistentError).toHaveBeenCalledWith(
      `Couldn't import "crafted.glb": ${reason}`,
      { id: 'import_gltf-refused:crafted.glb' },
    );
    expect(notifications.showError).not.toHaveBeenCalled();
    expect(sentry.captureException).not.toHaveBeenCalled();
  });

  it('any other rejection of the same command still gets the generic report', async () => {
    const { store, sentry, notifications } = await loadStore();
    store.setCommandDispatcher(() => ({ success: false, error: 'PendingCommands resource not initialized' }));

    const outcome = store.useEditorStore.getState().loadTexture(PNG_DATA_URL, 'photo.png', 'ent-1', 'base_color');

    expect(outcome).toEqual({ success: false, error: 'PendingCommands resource not initialized' });
    expect(notifications.showPersistentError).not.toHaveBeenCalled();
    expect(notifications.showError).toHaveBeenCalledWith("Couldn't load the texture. The engine rejected the change.");
    expect(sentry.captureException).toHaveBeenCalledTimes(1);
    expect(console.error).toHaveBeenCalledTimes(1);
  });

  it("a refusal prefix for a DIFFERENT command is not this command's refusal", async () => {
    // The contract is `<this command> refused: `; an answer that merely
    // contains the word is an engine fault like any other.
    const { store, sentry, notifications } = await loadStore();
    store.setCommandDispatcher(() => ({ success: false, error: 'import_gltf refused: x' }));

    store.useEditorStore.getState().loadTexture(PNG_DATA_URL, 'photo.png', 'ent-1', 'base_color');

    expect(notifications.showPersistentError).not.toHaveBeenCalled();
    expect(notifications.showError).toHaveBeenCalledTimes(1);
    expect(sentry.captureException).toHaveBeenCalledTimes(1);
  });
});
