/**
 * PF-8860 — the server-side tool-approval gate, end to end through the store.
 *
 * The invariant these tests exist for: a destructive tool call the SERVER
 * blocked must never reach `executeToolCall` before the user answers, and the
 * resume must carry a message array the SDK can correlate — assistant
 * `tool-call` + `tool-approval-request` parts, and a `role:'tool'` message LAST.
 *
 * @vitest-environment jsdom
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  mockSSEResponse,
  makeApprovalRequestSSEEvents,
  makeApprovalResumeSSEEvents,
  makeChatSSEEvents,
} from '@/test/utils/streamingTestUtils';

const INITIAL = {
  messages: [],
  isStreaming: false,
  activeModel: 'claude-sonnet-4-6' as const,
  rightPanelTab: 'chat' as const,
  error: null,
  abortController: null,
  thinkingEnabled: false,
  loopIteration: 0,
  sessionTokens: { input: 0, output: 0 },
  hasUnreadMessages: false,
  approvalMode: false,
  showEntityPicker: false,
  entityPickerFilter: '',
  pendingEntityRefs: {},
  pausedTurnState: null,
};

const mockEditorState = {
  getState: () => ({
    sceneGraph: { nodes: {}, rootIds: [] },
    selectedIds: new Set<string>(),
    primaryId: null,
    primaryTransform: null,
    primaryMaterial: null,
    primaryLight: null,
    ambientLight: { color: [1, 1, 1], brightness: 1 },
    environment: {},
    canUndo: false,
    canRedo: false,
    undoDescription: null,
    redoDescription: null,
  }),
};

/** Body of the Nth `fetch('/api/chat')` call, parsed. */
function requestBody(spy: ReturnType<typeof vi.spyOn>, n: number) {
  const init = spy.mock.calls[n][1] as RequestInit;
  return JSON.parse(init.body as string) as {
    messages: Array<{ role: string; content: unknown }>;
  };
}

describe('chatStore — server-side tool approval (PF-8860)', () => {
  let executeToolCall: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.resetModules();
    localStorage.clear();

    executeToolCall = vi.fn(() => Promise.resolve({ success: true, result: 'Deleted 1 entity' }));

    // Specifiers resolve relative to THIS file, and must land on the same
    // modules chatStore imports from src/stores/ — see the note in
    // chatStore.test.ts about a doMock that silently never matched.
    vi.doMock('../editorStore', () => ({ useEditorStore: mockEditorState }));
    vi.doMock('../../lib/chat/context', () => ({ buildSceneContext: vi.fn(() => '## Scene\nEmpty') }));
    vi.doMock('../../lib/chat/executor', () => ({ executeToolCall }));
  });

  afterEach(() => {
    vi.restoreAllMocks();
    localStorage.clear();
  });

  const gatedTurn = (overrides: Record<string, unknown> = {}) =>
    makeApprovalRequestSSEEvents({
      toolCallId: 'tc-del',
      approvalId: 'ap-1',
      toolName: 'delete_entities',
      input: { entityIds: ['4294967299'] },
      text: 'Deleting those now.',
      inputTokens: 40,
      outputTokens: 8,
      ...overrides,
    });

  // -------------------------------------------------------------------------
  // Pause
  // -------------------------------------------------------------------------
  it('marks a gated call approval-required and does NOT execute it', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(mockSSEResponse(gatedTurn()));

    const { useChatStore: store } = await import('../chatStore');
    store.setState(INITIAL);

    await store.getState().sendMessage('delete the enemies');

    const assistant = store.getState().messages[1];
    const call = assistant.toolCalls?.find((t) => t.id === 'tc-del');
    expect(call?.status).toBe('approval-required');
    expect(call?.approvalId).toBe('ap-1');
    // The materialized input must be on the card — a gate that shows only the
    // tool name lets a user approve something other than what runs.
    expect(call?.input).toEqual({ entityIds: ['4294967299'] });

    expect(executeToolCall).not.toHaveBeenCalled();
    expect(store.getState().pausedTurnState?.assistantMsgId).toBe(assistant.id);
    expect(store.getState().isStreaming).toBe(false);
  });

  it('resolves the same way when tool-approval-request precedes tool-input-available', async () => {
    // The wire gives no ordering guarantee between the two chunks — guards the
    // #8746 protocol-drift family for the new chunk types.
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      mockSSEResponse(gatedTurn({ approvalRequestFirst: true })),
    );

    const { useChatStore: store } = await import('../chatStore');
    store.setState(INITIAL);

    await store.getState().sendMessage('delete the enemies');

    const call = store.getState().messages[1].toolCalls?.find((t) => t.id === 'tc-del');
    expect(call?.status).toBe('approval-required');
    expect(call?.approvalId).toBe('ap-1');
    expect(executeToolCall).not.toHaveBeenCalled();
  });

  it('executes an UNGATED call in the same turn exactly as before', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      mockSSEResponse(
        gatedTurn({ ungatedToolCall: { id: 'tc-q', name: 'get_scene_graph', input: {} } }),
      ),
    );

    const { useChatStore: store } = await import('../chatStore');
    store.setState(INITIAL);

    await store.getState().sendMessage('what is here, then delete the enemies');

    expect(executeToolCall).toHaveBeenCalledTimes(1);
    expect(executeToolCall).toHaveBeenCalledWith('get_scene_graph', {}, expect.any(Object));

    const toolCalls = store.getState().messages[1].toolCalls ?? [];
    expect(toolCalls.find((t) => t.id === 'tc-q')?.status).toBe('success');
    expect(toolCalls.find((t) => t.id === 'tc-del')?.status).toBe('approval-required');
  });

  it('leaves an entirely ungated turn on the pre-existing path', async () => {
    vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(
        mockSSEResponse(
          makeChatSSEEvents({ toolCalls: [{ id: 'tc-1', name: 'spawn_entity', input: { entityType: 'cube' } }] }),
        ),
      )
      .mockResolvedValue(mockSSEResponse(makeChatSSEEvents({ text: 'Done.' })));

    const { useChatStore: store } = await import('../chatStore');
    store.setState(INITIAL);

    await store.getState().sendMessage('spawn a cube');

    expect(executeToolCall).toHaveBeenCalledWith('spawn_entity', { entityType: 'cube' }, expect.any(Object));
    expect(store.getState().pausedTurnState).toBeNull();
    expect(store.getState().messages[1].toolCalls?.[0].status).toBe('success');
  });

  // -------------------------------------------------------------------------
  // Approve
  // -------------------------------------------------------------------------
  it('approving executes locally and resumes with a correlatable history', async () => {
    const fetchSpy = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(mockSSEResponse(gatedTurn()))
      .mockResolvedValue(
        mockSSEResponse(
          makeApprovalResumeSSEEvents({
            approvalId: 'ap-1',
            toolCallId: 'tc-del',
            approved: true,
            text: 'Deleted them.',
            echoResponse: true,
          }),
        ),
      );

    const { useChatStore: store } = await import('../chatStore');
    store.setState(INITIAL);

    await store.getState().sendMessage('delete the enemies');
    const msgId = store.getState().messages[1].id;

    await store.getState().resumeAfterApproval(msgId, [{ toolCallId: 'tc-del', approved: true }]);

    // The approved call ran on the client — the SDK cannot run it, these tools
    // have no server-side `execute`.
    expect(executeToolCall).toHaveBeenCalledWith(
      'delete_entities',
      { entityIds: ['4294967299'] },
      expect.any(Object),
    );

    expect(fetchSpy).toHaveBeenCalledTimes(2);
    const { messages } = requestBody(fetchSpy, 1);

    const assistant = messages.at(-2) as { role: string; content: Array<Record<string, unknown>> };
    expect(assistant.role).toBe('assistant');
    expect(assistant.content).toContainEqual({
      type: 'tool-call',
      toolCallId: 'tc-del',
      toolName: 'delete_entities',
      input: { entityIds: ['4294967299'] },
    });
    expect(assistant.content).toContainEqual({
      type: 'tool-approval-request',
      approvalId: 'ap-1',
      toolCallId: 'tc-del',
    });

    // `collectToolApprovals` returns nothing unless the LAST message is a tool
    // message — every approval would be silently dropped.
    const toolMessage = messages.at(-1) as { role: string; content: Array<Record<string, unknown>> };
    expect(toolMessage.role).toBe('tool');
    expect(toolMessage.content).toContainEqual({
      type: 'tool-approval-response',
      approvalId: 'ap-1',
      approved: true,
    });
    expect(toolMessage.content).toContainEqual({
      type: 'tool-result',
      toolCallId: 'tc-del',
      toolName: 'delete_entities',
      output: { type: 'text', value: 'Deleted 1 entity' },
    });

    expect(store.getState().messages[1].toolCalls?.[0].status).toBe('success');
    expect(store.getState().pausedTurnState).toBeNull();
  });

  // -------------------------------------------------------------------------
  // Deny
  // -------------------------------------------------------------------------
  it('denying never executes, sends approved:false, and ends the call denied', async () => {
    const fetchSpy = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(mockSSEResponse(gatedTurn()))
      .mockResolvedValue(
        mockSSEResponse(
          makeApprovalResumeSSEEvents({
            approvalId: 'ap-1',
            toolCallId: 'tc-del',
            approved: false,
            text: 'Understood, leaving them alone.',
          }),
        ),
      );

    const { useChatStore: store } = await import('../chatStore');
    store.setState(INITIAL);

    await store.getState().sendMessage('delete the enemies');
    const msgId = store.getState().messages[1].id;

    await store.getState().resumeAfterApproval(msgId, [{ toolCallId: 'tc-del', approved: false }]);

    expect(executeToolCall).not.toHaveBeenCalled();

    const toolMessage = requestBody(fetchSpy, 1).messages.at(-1) as {
      role: string;
      content: Array<Record<string, unknown>>;
    };
    expect(toolMessage.role).toBe('tool');
    expect(toolMessage.content).toEqual([
      { type: 'tool-approval-response', approvalId: 'ap-1', approved: false },
    ]);
    // A denied call carries NO tool-result: the SDK synthesizes the
    // execution-denied output itself.
    expect(toolMessage.content.some((p) => p.type === 'tool-result')).toBe(false);

    expect(store.getState().messages[1].toolCalls?.[0].status).toBe('denied');
    expect(store.getState().messages[1].content).toBe('Understood, leaving them alone.');
  });

  it("marks a call denied when the resumed stream emits 'tool-output-denied'", async () => {
    // The chunk the ticket never mentions. Without a named case for it the
    // card sits at 'pending' forever.
    vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(mockSSEResponse(gatedTurn()))
      .mockResolvedValue(
        mockSSEResponse(
          makeApprovalResumeSSEEvents({
            approvalId: 'ap-1',
            toolCallId: 'tc-del',
            approved: false,
            text: 'ok',
          }),
        ),
      );

    const { useChatStore: store } = await import('../chatStore');
    store.setState(INITIAL);

    await store.getState().sendMessage('delete the enemies');
    const msgId = store.getState().messages[1].id;
    await store.getState().resumeAfterApproval(msgId, [{ toolCallId: 'tc-del', approved: false }]);

    expect(store.getState().messages[1].toolCalls?.[0].status).toBe('denied');
  });

  // -------------------------------------------------------------------------
  // Guards
  // -------------------------------------------------------------------------
  it('ignores a resume for a message that is not the paused turn', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(mockSSEResponse(gatedTurn()));

    const { useChatStore: store } = await import('../chatStore');
    store.setState(INITIAL);

    await store.getState().sendMessage('delete the enemies');
    await store.getState().resumeAfterApproval('some-other-id', [
      { toolCallId: 'tc-del', approved: true },
    ]);

    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(executeToolCall).not.toHaveBeenCalled();
    expect(store.getState().pausedTurnState).not.toBeNull();
  });

  it('treats a blocked call with no decision as DENIED, never as approved', async () => {
    const fetchSpy = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(mockSSEResponse(gatedTurn()))
      .mockResolvedValue(
        mockSSEResponse(
          makeApprovalResumeSSEEvents({ approvalId: 'ap-1', toolCallId: 'tc-del', approved: false, text: 'ok' }),
        ),
      );

    const { useChatStore: store } = await import('../chatStore');
    store.setState(INITIAL);

    await store.getState().sendMessage('delete the enemies');
    const msgId = store.getState().messages[1].id;

    // Empty decision list — the caller answered nothing.
    await store.getState().resumeAfterApproval(msgId, []);

    expect(executeToolCall).not.toHaveBeenCalled();
    const toolMessage = requestBody(fetchSpy, 1).messages.at(-1) as {
      content: Array<Record<string, unknown>>;
    };
    expect(toolMessage.content[0]).toMatchObject({ approvalId: 'ap-1', approved: false });
    expect(store.getState().messages[1].toolCalls?.[0].status).toBe('denied');
  });

  // -------------------------------------------------------------------------
  // Fail-closed drain (arch#1 / sec#1)
  // -------------------------------------------------------------------------
  it('does NOT execute a destructive call when the stream is severed before the approval chunk', async () => {
    // The exact window the SDK leaves open: `tool-input-available` is emitted
    // BEFORE `tool-approval-request`, so a stream that dies in between (a
    // dropped connection, a truncated proxy response, a stripped chunk) hands
    // the client a fully-formed destructive call carrying no approvalId. The
    // drain must refuse it rather than treat "no gate arrived" as "not gated".
    vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(mockSSEResponse(gatedTurn({ severAfterInput: true })))
      .mockResolvedValue(mockSSEResponse(makeChatSSEEvents({ text: 'Stopped.' })));

    const { useChatStore: store } = await import('../chatStore');
    store.setState(INITIAL);

    await store.getState().sendMessage('delete the enemies');

    expect(executeToolCall).not.toHaveBeenCalled();

    const call = store.getState().messages[1].toolCalls?.find((t) => t.id === 'tc-del');
    expect(call?.status).toBe('error');
    expect(call?.error).toMatch(/ended before the server confirmed/i);
    // Nothing to approve — a truncated stream is not a pending decision.
    expect(store.getState().pausedTurnState).toBeNull();
  });

  it('does NOT execute an UNGATED destructive call even on a complete stream', async () => {
    // Second axis of the same failure: the stream finishes cleanly but the
    // server never issued an approval for a command the manifest marks
    // destructive. Every such command is `user-approval` in AGENT_TOOL_APPROVAL,
    // so an ungated one is a contradiction (downgraded server, forged stream).
    vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(
        mockSSEResponse(
          makeChatSSEEvents({
            toolCalls: [{ id: 'tc-raw', name: 'delete_entities', input: { entityIds: ['7'] } }],
          }),
        ),
      )
      .mockResolvedValue(mockSSEResponse(makeChatSSEEvents({ text: 'Stopped.' })));

    const { useChatStore: store } = await import('../chatStore');
    store.setState(INITIAL);

    await store.getState().sendMessage('delete the enemies');

    expect(executeToolCall).not.toHaveBeenCalled();
    const call = store.getState().messages[1].toolCalls?.find((t) => t.id === 'tc-raw');
    expect(call?.status).toBe('error');
    expect(call?.error).toMatch(/requires approval/i);
  });

  it('still executes a NON-destructive call on a complete ungated stream', async () => {
    // The counterweight: fail-closed must not become fail-always. Without this
    // the two tests above would pass against a drain that refuses everything.
    vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(
        mockSSEResponse(
          makeChatSSEEvents({ toolCalls: [{ id: 'tc-ok', name: 'get_scene_graph', input: {} }] }),
        ),
      )
      .mockResolvedValue(mockSSEResponse(makeChatSSEEvents({ text: 'Done.' })));

    const { useChatStore: store } = await import('../chatStore');
    store.setState(INITIAL);

    await store.getState().sendMessage('what is here');

    expect(executeToolCall).toHaveBeenCalledWith('get_scene_graph', {}, expect.any(Object));
    expect(store.getState().messages[1].toolCalls?.[0].status).toBe('success');
  });

  // -------------------------------------------------------------------------
  // Signature echo (sec#3)
  // -------------------------------------------------------------------------
  it('echoes the approval signature back on resume so the route can verify it', async () => {
    // `experimental_toolApprovalSecret` binds (approvalId, toolCallId, toolName,
    // input) into an HMAC on the request chunk. The route re-derives it before
    // streaming, so a client that drops the signature — or widens the input
    // under a signature minted for a narrower one — is rejected. That check is
    // only reachable if the store carries the signature through the pause.
    const fetchSpy = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(mockSSEResponse(gatedTurn({ signature: 'sig-abc123' })))
      .mockResolvedValue(
        mockSSEResponse(
          makeApprovalResumeSSEEvents({
            approvalId: 'ap-1',
            toolCallId: 'tc-del',
            approved: true,
            text: 'Deleted them.',
            echoResponse: true,
          }),
        ),
      );

    const { useChatStore: store } = await import('../chatStore');
    store.setState(INITIAL);

    await store.getState().sendMessage('delete the enemies');
    expect(
      store.getState().messages[1].toolCalls?.find((t) => t.id === 'tc-del')?.approvalSignature,
    ).toBe('sig-abc123');

    const msgId = store.getState().messages[1].id;
    await store.getState().resumeAfterApproval(msgId, [{ toolCallId: 'tc-del', approved: true }]);

    const assistant = requestBody(fetchSpy, 1).messages.at(-2) as {
      content: Array<Record<string, unknown>>;
    };
    expect(assistant.content).toContainEqual({
      type: 'tool-approval-request',
      approvalId: 'ap-1',
      toolCallId: 'tc-del',
      signature: 'sig-abc123',
    });
  });

  // -------------------------------------------------------------------------
  // Stranded pending calls (arch#4)
  // -------------------------------------------------------------------------
  it('promotes client-deferred calls to preview instead of stranding them at pending', async () => {
    // With approvalMode on, the ungated calls of a turn are deferred to the
    // client preview queue. If that turn ALSO carries a server-gated call the
    // loop pauses, and the preview queue is discarded — leaving every deferred
    // card spinning at 'pending' with no control that can ever resolve it.
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      mockSSEResponse(
        gatedTurn({ ungatedToolCall: { id: 'tc-q', name: 'spawn_entity', input: { entityType: 'cube' } } }),
      ),
    );

    const { useChatStore: store } = await import('../chatStore');
    store.setState({ ...INITIAL, approvalMode: true });

    await store.getState().sendMessage('spawn a cube, then delete the enemies');

    const toolCalls = store.getState().messages[1].toolCalls ?? [];
    expect(toolCalls.find((t) => t.id === 'tc-q')?.status).toBe('preview');
    expect(toolCalls.find((t) => t.id === 'tc-del')?.status).toBe('approval-required');
    expect(toolCalls.some((t) => t.status === 'pending')).toBe(false);
    expect(executeToolCall).not.toHaveBeenCalled();
  });

  it('abandons the paused turn when a new message is sent', async () => {
    vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(mockSSEResponse(gatedTurn()))
      .mockResolvedValue(mockSSEResponse(makeChatSSEEvents({ text: 'Sure.' })));

    const { useChatStore: store } = await import('../chatStore');
    store.setState(INITIAL);

    await store.getState().sendMessage('delete the enemies');
    expect(store.getState().pausedTurnState).not.toBeNull();

    const abandonedId = store.getState().messages[1].id;

    await store.getState().sendMessage('actually, never mind');
    expect(store.getState().pausedTurnState).toBeNull();

    // ux#2 — dropping only `pausedTurnState` left the old card reading
    // "Blocked — needs your approval" with Approve/Deny buttons that hit a
    // silent guard. The abandonment has to be visible ON the card.
    const abandoned = store
      .getState()
      .messages.find((m) => m.id === abandonedId)
      ?.toolCalls?.find((t) => t.id === 'tc-del');
    expect(abandoned?.status).toBe('error');
    expect(abandoned?.error).toMatch(/cancelled by a new message/i);
    expect(executeToolCall).not.toHaveBeenCalled();
  });

  it('reports a stale approval instead of silently ignoring it', async () => {
    // The guard above returns early for a message that is not the paused turn.
    // Returning early is right; returning SILENTLY is not — the user pressed
    // Approve and nothing at all happened.
    vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(mockSSEResponse(gatedTurn()))
      .mockResolvedValue(mockSSEResponse(makeChatSSEEvents({ text: 'Sure.' })));

    const { useChatStore: store } = await import('../chatStore');
    store.setState(INITIAL);

    await store.getState().sendMessage('delete the enemies');
    const staleId = store.getState().messages[1].id;
    await store.getState().sendMessage('actually, never mind');

    await store.getState().resumeAfterApproval(staleId, [{ toolCallId: 'tc-del', approved: true }]);

    expect(executeToolCall).not.toHaveBeenCalled();
    const call = store
      .getState()
      .messages.find((m) => m.id === staleId)
      ?.toolCalls?.find((t) => t.id === 'tc-del');
    expect(call?.status).toBe('error');
    expect(call?.error).toBeTruthy();
  });
});
