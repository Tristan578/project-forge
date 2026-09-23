import type { Page } from '@playwright/test';
import { test, expect } from '../fixtures/editor.fixture';
import { injectStore, readStore } from '../helpers/store-injection';
import {
  E2E_TIMEOUT_SHORT_MS,
  E2E_TIMEOUT_ELEMENT_MS,
} from '../constants';

/**
 * E2E tests for the AI-driven game creation flow.
 *
 * These tests verify the UI states and interactions for the AI chat panel —
 * they do NOT make real AI API calls. Instead, they inject synthetic chat
 * messages and tool call states directly into the Zustand store via
 * the store-injection helper.
 *
 * chatStore has no addMessage action, so messages are appended through the
 * store's own setState. Every injected subject is asserted unconditionally
 * (#10160): a test fails when the stores are not exposed or the subject does
 * not render, instead of skipping its assertion.
 */

/**
 * Why an injection can come back false: `injectStore` returns false (outside
 * E2E_STRICT_STORES) when the store is not on window, which only happens in a
 * build without the E2E hooks.
 */
const HOOKS_BUILD_REQUIRED =
  'is not on window: run against `next dev` or a NEXT_PUBLIC_E2E_HOOKS=true build';

/** The chat transcript: ChatPanel's `aria-label="Chat messages"` scroll region. */
function chatMessages(page: Page) {
  return page.locator('[aria-label="Chat messages"]');
}

test.describe('AI Game Creation Flow @ui @dev', () => {
  test.beforeEach(async ({ editor }) => {
    await editor.loadPage();
  });

  // -------------------------------------------------------------------------
  // 1. Chat panel opens and accepts a game creation prompt
  // -------------------------------------------------------------------------
  test('chat panel opens and accepts a game creation prompt', async ({ page }) => {
    await page.keyboard.press('Control+k');

    const chatInput = page.getByRole('textbox', { name: 'Chat message' });
    await expect(chatInput).toBeVisible({ timeout: E2E_TIMEOUT_ELEMENT_MS });

    await chatInput.click();
    await chatInput.fill('Create a simple platformer game with a player character');

    const value = await chatInput.inputValue();
    expect(value).toContain('platformer');
  });

  // -------------------------------------------------------------------------
  // 2. Tool call cards appear in chat when AI executes commands
  // -------------------------------------------------------------------------
  test('tool call card renders for a spawn_entity command', async ({ page, editor }) => {
    await editor.waitForEditorStore();

    const injected = await injectStore(page, '__CHAT_STORE', `
      window.__CHAT_STORE.setState((s) => ({
        messages: [...s.messages, {
          id: 'test-msg-1',
          role: 'assistant',
          content: 'I spawned a cube for your game.',
          toolCalls: [{
            id: 'tc-spawn-1', name: 'spawn_entity',
            input: { entityType: 'cube', name: 'Player' },
            status: 'success', undoable: true,
          }],
          timestamp: Date.now(),
        }],
      }));
    `);
    expect(injected, `__CHAT_STORE ${HOOKS_BUILD_REQUIRED}`).toBe(true);

    await page.keyboard.press('Control+k');
    await expect(page.locator('span').filter({ hasText: /AI Chat/i }).first())
      .toBeVisible({ timeout: E2E_TIMEOUT_ELEMENT_MS });

    await expect(chatMessages(page).getByText('Spawn Entity', { exact: true })).toBeVisible();
  });

  // -------------------------------------------------------------------------
  // 3. Entity name appears in hierarchy after AI creates it via store action
  // -------------------------------------------------------------------------
  test('entity appears in scene hierarchy after AI creation via store', async ({ page, editor }) => {
    await editor.waitForEditorStore();

    // The store's SceneNode shape (sceneGraphSlice.addNode). SceneNode reads
    // `children.length`; the old `{ id, childIds }` payload crashed the editor
    // to its error page.
    const injected = await injectStore(page, '__EDITOR_STORE', `
      window.__EDITOR_STORE.getState().addNode({
        entityId: 'ai-created-cube-99', name: 'GamePlayer',
        parentId: null, children: [], components: ['Mesh3d'], visible: true,
      });
    `);
    expect(injected, `__EDITOR_STORE ${HOOKS_BUILD_REQUIRED}`).toBe(true);

    // SceneNode sets aria-label={node.name} on its treeitem.
    await expect(
      page
        .getByRole('tree', { name: 'Scene hierarchy' })
        .getByRole('treeitem', { name: 'GamePlayer', exact: true }),
    ).toBeVisible({ timeout: E2E_TIMEOUT_ELEMENT_MS });
  });

  // -------------------------------------------------------------------------
  // 4. Multiple tool calls show in sequence inside the chat panel
  // -------------------------------------------------------------------------
  test('chat panel shows multiple sequential tool call entries', async ({ page, editor }) => {
    await editor.waitForEditorStore();

    const injected = await injectStore(page, '__CHAT_STORE', `
      window.__CHAT_STORE.setState((s) => ({
        messages: [...s.messages, {
          id: 'test-msg-multi', role: 'assistant',
          content: 'Setting up your platformer scene.',
          toolCalls: [
            { id: 'tc-multi-1', name: 'spawn_entity', input: { entityType: 'cube', name: 'Ground' }, status: 'success', undoable: true },
            { id: 'tc-multi-2', name: 'update_transform', input: { entityId: 'ai-ground', position: { x: 0, y: -2, z: 0 } }, status: 'success', undoable: true },
            { id: 'tc-multi-3', name: 'update_material', input: { entityId: 'ai-ground', baseColor: [0.2, 0.8, 0.2, 1.0] }, status: 'success', undoable: false },
          ],
          timestamp: Date.now(),
        }],
      }));
    `);
    expect(injected, `__CHAT_STORE ${HOOKS_BUILD_REQUIRED}`).toBe(true);

    await page.keyboard.press('Control+k');
    await expect(page.locator('span').filter({ hasText: /AI Chat/i }).first())
      .toBeVisible({ timeout: E2E_TIMEOUT_ELEMENT_MS });

    // One ToolCallCard per call, each with its own label. (This used to count
    // the overlay's <div>s, which an empty chat already satisfies.)
    const chat = chatMessages(page);
    await expect(chat.getByText('Spawn Entity', { exact: true })).toBeVisible();
    await expect(chat.getByText('Transform', { exact: true })).toBeVisible();
    await expect(chat.getByText('Material', { exact: true })).toBeVisible();
  });

  // -------------------------------------------------------------------------
  // 5. Approval mode UI: pending tool calls show Approve / Reject buttons
  // -------------------------------------------------------------------------
  test('approval mode shows Approve and Reject buttons for preview tool calls', async ({ page, editor }) => {
    await editor.waitForEditorStore();

    const injected = await injectStore(page, '__CHAT_STORE', `
      const chatStore = window.__CHAT_STORE;
      chatStore.getState().setApprovalMode(true);
      chatStore.setState((s) => ({
        messages: [...s.messages, {
          id: 'test-msg-approval', role: 'assistant',
          content: 'Ready to spawn entities. Please review.',
          toolCalls: [{
            id: 'tc-approval-1', name: 'spawn_entity',
            input: { entityType: 'sphere', name: 'Enemy' },
            status: 'preview', undoable: false,
          }],
          timestamp: Date.now(),
        }],
      }));
    `);
    expect(injected, `__CHAT_STORE ${HOOKS_BUILD_REQUIRED}`).toBe(true);

    await page.keyboard.press('Control+k');
    await expect(page.locator('span').filter({ hasText: /AI Chat/i }).first())
      .toBeVisible({ timeout: E2E_TIMEOUT_ELEMENT_MS });

    // The preview card's own buttons. `exact` keeps ChatMessage's batch
    // "Approve All (1)" / "Reject All" from satisfying these on their own.
    const chat = chatMessages(page);
    await expect(chat.getByRole('button', { name: 'Approve', exact: true })).toBeVisible();
    await expect(chat.getByRole('button', { name: 'Reject', exact: true })).toBeVisible();
  });

  // -------------------------------------------------------------------------
  // 6. Error messages display correctly when a command fails
  // -------------------------------------------------------------------------
  test('error status tool call displays with error indicator', async ({ page, editor }) => {
    await editor.waitForEditorStore();

    const injected = await injectStore(page, '__CHAT_STORE', `
      window.__CHAT_STORE.setState((s) => ({
        messages: [...s.messages, {
          id: 'test-msg-error', role: 'assistant',
          content: 'An error occurred while processing your request.',
          toolCalls: [{
            id: 'tc-error-1', name: 'spawn_entity',
            input: { entityType: 'invalid_type', name: 'Bad' },
            status: 'error', error: 'Unknown entity type: invalid_type', undoable: false,
          }],
          timestamp: Date.now(),
        }],
      }));
    `);
    expect(injected, `__CHAT_STORE ${HOOKS_BUILD_REQUIRED}`).toBe(true);

    await page.keyboard.press('Control+k');
    const chatOverlay = page.locator('.fixed.z-50').first();
    await expect(chatOverlay).toBeVisible({ timeout: E2E_TIMEOUT_ELEMENT_MS });

    const chat = chatMessages(page);
    await expect(chat.getByText(/error occurred/i)).toBeVisible();
    // The failed call's own error sits behind the card's disclosure button.
    await chat.getByRole('button', { name: /Spawn Entity/ }).click();
    await expect(chat.getByText('Unknown entity type: invalid_type')).toBeVisible();
  });

  // -------------------------------------------------------------------------
  // 7. Chat sends prompt on Enter key press
  // -------------------------------------------------------------------------
  test('pressing Enter submits the chat input', async ({ page }) => {
    await page.keyboard.press('Control+k');

    const chatInput = page.getByRole('textbox', { name: 'Chat message' });
    await expect(chatInput).toBeVisible({ timeout: E2E_TIMEOUT_ELEMENT_MS });

    await chatInput.click();
    await chatInput.fill('Build me a shooter game');

    // Pressing Enter should attempt to submit (field clears or error boundary
    // activates — either way, the field value should be cleared or unchanged
    // depending on whether the AI API is available)
    await chatInput.press('Enter');

    // After submission attempt, input is typically cleared
    // We just verify the panel stays open (no crash)
    const chatHeader = page.locator('span').filter({ hasText: /AI Chat/i }).first();
    await expect(chatHeader).toBeVisible({ timeout: E2E_TIMEOUT_SHORT_MS });
  });

  // -------------------------------------------------------------------------
  // 8. Approval mode toggle is reflected in the store
  // -------------------------------------------------------------------------
  test('approval mode can be toggled on and off', async ({ page, editor }) => {
    await editor.waitForEditorStore();

    await injectStore(page, '__CHAT_STORE', `
      window.__CHAT_STORE?.getState?.()?.setApprovalMode?.(true);
    `);

    const approvalEnabled = await readStore<boolean>(page, '__CHAT_STORE',
      `window.__CHAT_STORE?.getState?.()?.approvalMode ?? null`);

    expect(approvalEnabled).toBe(true);

    await injectStore(page, '__CHAT_STORE', `
      window.__CHAT_STORE?.getState?.()?.setApprovalMode?.(false);
    `);

    const approvalDisabled = await readStore<boolean>(page, '__CHAT_STORE',
      `window.__CHAT_STORE?.getState?.()?.approvalMode ?? null`);

    expect(approvalDisabled).toBe(false);
  });
});
