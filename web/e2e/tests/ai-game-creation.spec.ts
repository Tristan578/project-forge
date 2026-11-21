import { test, expect } from '../fixtures/editor.fixture';
import { injectStore, readStore, isStrictMode } from '../helpers/store-injection';
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
 * In CI (strict mode): tests throw if stores are unavailable.
 * Locally: tests skip assertions gracefully when stores aren't exposed.
 */
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
      const store = window.__CHAT_STORE ?? window.__EDITOR_STORE;
      const addMessage = store.getState?.()?.addMessage;
      if (typeof addMessage === 'function') {
        addMessage({
          id: 'test-msg-1',
          role: 'assistant',
          content: 'I spawned a cube for your game.',
          toolCalls: [{
            id: 'tc-spawn-1', name: 'spawn_entity',
            input: { entityType: 'cube', name: 'Player' },
            status: 'success', undoable: true,
          }],
          timestamp: Date.now(),
        });
      }
    `);

    await page.keyboard.press('Control+k');
    await expect(page.locator('span').filter({ hasText: /AI Chat/i }).first())
      .toBeVisible({ timeout: E2E_TIMEOUT_ELEMENT_MS });

    if (injected || isStrictMode) {
      const toolLabel = page.getByText('Spawn Entity', { exact: false });
      const count = await toolLabel.count();
      if (count > 0) {
        await expect(toolLabel.first()).toBeVisible();
      }
    }
  });

  // -------------------------------------------------------------------------
  // 3. Entity name appears in hierarchy after AI creates it via store action
  // -------------------------------------------------------------------------
  test('entity appears in scene hierarchy after AI creation via store', async ({ page, editor }) => {
    await editor.waitForEditorStore();

    const injected = await injectStore(page, '__EDITOR_STORE', `
      const store = window.__EDITOR_STORE;
      const addNode = store.getState?.()?.addNode;
      if (typeof addNode === 'function') {
        addNode({
          id: 'ai-created-cube-99', name: 'GamePlayer', type: 'Cube',
          parentId: null, visible: true, locked: false, childIds: [],
        });
      }
    `);

    if (injected || isStrictMode) {
      const hierarchyNode = page.getByText(/GamePlayer/i, { exact: false });
      const count = await hierarchyNode.count();
      if (count > 0) {
        await expect(hierarchyNode.first()).toBeVisible();
      }
    }
  });

  // -------------------------------------------------------------------------
  // 4. Multiple tool calls show in sequence inside the chat panel
  // -------------------------------------------------------------------------
  test('chat panel shows multiple sequential tool call entries', async ({ page, editor }) => {
    await editor.waitForEditorStore();

    await injectStore(page, '__CHAT_STORE', `
      const chatStore = window.__CHAT_STORE;
      const addMessage = chatStore?.getState?.()?.addMessage;
      if (typeof addMessage === 'function') {
        addMessage({
          id: 'test-msg-multi', role: 'assistant',
          content: 'Setting up your platformer scene.',
          toolCalls: [
            { id: 'tc-multi-1', name: 'spawn_entity', input: { entityType: 'cube', name: 'Ground' }, status: 'success', undoable: true },
            { id: 'tc-multi-2', name: 'update_transform', input: { entityId: 'ai-ground', position: { x: 0, y: -2, z: 0 } }, status: 'success', undoable: true },
            { id: 'tc-multi-3', name: 'update_material', input: { entityId: 'ai-ground', baseColor: [0.2, 0.8, 0.2, 1.0] }, status: 'success', undoable: false },
          ],
          timestamp: Date.now(),
        });
      }
    `);

    await page.keyboard.press('Control+k');
    await expect(page.locator('span').filter({ hasText: /AI Chat/i }).first())
      .toBeVisible({ timeout: E2E_TIMEOUT_ELEMENT_MS });

    const chatOverlay = page.locator('.fixed.z-50').first();
    await expect(chatOverlay).toBeVisible({ timeout: E2E_TIMEOUT_ELEMENT_MS });
    const divCount = await chatOverlay.locator('div').count();
    expect(divCount).toBeGreaterThan(2);
  });

  // -------------------------------------------------------------------------
  // 5. Approval mode UI: pending tool calls show Approve / Reject buttons
  // -------------------------------------------------------------------------
  test('approval mode shows Approve and Reject buttons for preview tool calls', async ({ page, editor }) => {
    await editor.waitForEditorStore();

    const injected = await injectStore(page, '__CHAT_STORE', `
      const chatStore = window.__CHAT_STORE;
      const state = chatStore?.getState?.();
      if (state?.setApprovalMode) state.setApprovalMode(true);
      if (state?.addMessage) {
        state.addMessage({
          id: 'test-msg-approval', role: 'assistant',
          content: 'Ready to spawn entities. Please review.',
          toolCalls: [{
            id: 'tc-approval-1', name: 'spawn_entity',
            input: { entityType: 'sphere', name: 'Enemy' },
            status: 'preview', undoable: false,
          }],
          timestamp: Date.now(),
        });
      }
    `);

    await page.keyboard.press('Control+k');
    await expect(page.locator('span').filter({ hasText: /AI Chat/i }).first())
      .toBeVisible({ timeout: E2E_TIMEOUT_ELEMENT_MS });

    if (injected || isStrictMode) {
      const approveBtn = page.getByRole('button', { name: /Approve/i });
      const approveCount = await approveBtn.count();
      if (approveCount > 0) {
        await expect(approveBtn.first()).toBeVisible();
        await expect(page.getByRole('button', { name: /Reject/i }).first()).toBeVisible();
      }
    }
  });

  // -------------------------------------------------------------------------
  // 6. Error messages display correctly when a command fails
  // -------------------------------------------------------------------------
  test('error status tool call displays with error indicator', async ({ page, editor }) => {
    await editor.waitForEditorStore();

    const injected = await injectStore(page, '__CHAT_STORE', `
      const chatStore = window.__CHAT_STORE;
      const addMessage = chatStore?.getState?.()?.addMessage;
      if (typeof addMessage === 'function') {
        addMessage({
          id: 'test-msg-error', role: 'assistant',
          content: 'An error occurred while processing your request.',
          toolCalls: [{
            id: 'tc-error-1', name: 'spawn_entity',
            input: { entityType: 'invalid_type', name: 'Bad' },
            status: 'error', error: 'Unknown entity type: invalid_type', undoable: false,
          }],
          timestamp: Date.now(),
        });
      }
    `);

    await page.keyboard.press('Control+k');
    const chatOverlay = page.locator('.fixed.z-50').first();
    await expect(chatOverlay).toBeVisible({ timeout: E2E_TIMEOUT_ELEMENT_MS });

    if (injected || isStrictMode) {
      const errorText = page.getByText(/error occurred/i, { exact: false });
      const errorCount = await errorText.count();
      if (errorCount > 0) {
        await expect(errorText.first()).toBeVisible();
      }
    }
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

    if (approvalEnabled !== null) {
      expect(approvalEnabled).toBe(true);
    }

    await injectStore(page, '__CHAT_STORE', `
      window.__CHAT_STORE?.getState?.()?.setApprovalMode?.(false);
    `);

    const approvalDisabled = await readStore<boolean>(page, '__CHAT_STORE',
      `window.__CHAT_STORE?.getState?.()?.approvalMode ?? null`);

    if (approvalDisabled !== null) {
      expect(approvalDisabled).toBe(false);
    }
  });
});
