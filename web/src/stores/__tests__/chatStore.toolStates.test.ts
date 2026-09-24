/**
 * Tool-invocation lifecycle states, end to end from the wire (PF-950 / #8931).
 *
 * Two halves:
 *
 * 1. Parser transitions, driven by the canonical fixture bytes in
 *    `streamingTestUtils` — every `tool-*` chunk the parser names is exercised
 *    from the same helper the route is documented against, so a protocol rename
 *    on either side fails here rather than blanking a card in production.
 *
 * 2. A drift pin between the parser and the fixtures: the set of `tool-*` chunk
 *    types `chatStore.streamOneTurn` switches on must equal the set the fixture
 *    helpers can emit. Both sides are DERIVED from source at test time (never
 *    restated here), with a vacuity floor, so a chunk added to one side alone
 *    is a failing test, not a silent gap (lessons-learned #18).
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { AI_MODEL_PRIMARY } from '@/lib/ai/models';
import {
  mockSSEResponse,
  makeChatSSEEvents,
  makeApprovalRequestSSEEvents,
  makeApprovalResumeSSEEvents,
} from '@/test/utils/streamingTestUtils';
import { TOOL_CALL_STATUSES, type ToolCallStatusName } from '../chatStore';

// `streamOneTurn` imports the executor lazily (`await import('../lib/chat/executor')`),
// so the mock is registered per fresh module graph, the way chatStore.test.ts does it.
const executeToolCall = vi.fn();

const BASE_STATE = {
  messages: [],
  isStreaming: false,
  activeModel: AI_MODEL_PRIMARY,
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
};

async function freshStore() {
  vi.resetModules();
  vi.doMock('../../lib/chat/executor', () => ({ executeToolCall }));
  const { useChatStore } = await import('../chatStore');
  useChatStore.setState(BASE_STATE as never);
  return useChatStore;
}

describe('tool-invocation states from the wire (#8931)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    executeToolCall.mockResolvedValue({ success: true, result: { ok: true } });
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('pending → success: tool-input-start, tool-input-available, finish (local execution)', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      mockSSEResponse(makeChatSSEEvents({ toolCalls: [{ id: 'tc-ok', name: 'spawn_entity', input: { type: 'cube' } }] })),
    );
    const store = await freshStore();
    await store.getState().sendMessage('spawn a cube');
    const tc = store.getState().messages[1]?.toolCalls?.find((t) => t.id === 'tc-ok');
    expect(tc?.status).toBe('success');
    expect(tc?.input).toEqual({ type: 'cube' });
    expect(executeToolCall).toHaveBeenCalledTimes(1);
  });

  it('pending → error on tool-input-error, carrying the wire errorText', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      mockSSEResponse(
        makeChatSSEEvents({
          toolErrors: [{ id: 'tc-in', name: 'spawn_entity', phase: 'input', errorText: 'Schema validation failed' }],
        }),
      ),
    );
    const store = await freshStore();
    await store.getState().sendMessage('spawn something malformed');
    const tc = store.getState().messages[1]?.toolCalls?.find((t) => t.id === 'tc-in');
    expect(tc?.status).toBe('error');
    expect(tc?.error).toBe('Schema validation failed');
    expect(executeToolCall).not.toHaveBeenCalled();
    expect(store.getState().isStreaming).toBe(false);
  });

  it('pending → error on tool-output-error, carrying the wire errorText', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      mockSSEResponse(
        makeChatSSEEvents({
          toolErrors: [{ id: 'tc-out', name: 'web_search', phase: 'output', errorText: 'Provider timed out' }],
        }),
      ),
    );
    const store = await freshStore();
    await store.getState().sendMessage('search the web');
    const tc = store.getState().messages[1]?.toolCalls?.find((t) => t.id === 'tc-out');
    expect(tc?.status).toBe('error');
    expect(tc?.error).toBe('Provider timed out');
    expect(executeToolCall).not.toHaveBeenCalled();
  });

  it('an error chunk with no errorText still lands on error with a fixed fallback message', async () => {
    const events = makeChatSSEEvents({
      toolErrors: [{ id: 'tc-blank', name: 'spawn_entity', phase: 'output', errorText: '' }],
    });
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(mockSSEResponse(events));
    const store = await freshStore();
    await store.getState().sendMessage('x');
    const tc = store.getState().messages[1]?.toolCalls?.find((t) => t.id === 'tc-blank');
    expect(tc?.status).toBe('error');
    expect(tc?.error).toBe('Tool error');
  });

  it('a successful call and a failed call in one turn resolve independently', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      mockSSEResponse(
        makeChatSSEEvents({
          toolCalls: [{ id: 'tc-good', name: 'spawn_entity', input: { type: 'cube' } }],
          toolErrors: [{ id: 'tc-bad', name: 'spawn_entity', phase: 'input', errorText: 'bad input' }],
        }),
      ),
    );
    const store = await freshStore();
    await store.getState().sendMessage('two calls');
    const calls = store.getState().messages[1]?.toolCalls ?? [];
    expect(calls.find((t) => t.id === 'tc-good')?.status).toBe('success');
    expect(calls.find((t) => t.id === 'tc-bad')?.status).toBe('error');
    expect(executeToolCall).toHaveBeenCalledTimes(1);
  });

  it('pending → approval-required on tool-approval-request (server gate)', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      mockSSEResponse(
        makeApprovalRequestSSEEvents({
          toolCallId: 'tc-gate',
          approvalId: 'ap-1',
          toolName: 'despawn_entity',
          input: { entityId: 'e-1' },
        }),
      ),
    );
    const store = await freshStore();
    await store.getState().sendMessage('delete it');
    const tc = store.getState().messages[1]?.toolCalls?.find((t) => t.id === 'tc-gate');
    expect(tc?.status).toBe('approval-required');
    expect(tc?.approvalId).toBe('ap-1');
    expect(executeToolCall).not.toHaveBeenCalled();
  });

  it('approval-required → denied on tool-output-denied from the resumed stream', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    fetchSpy.mockResolvedValueOnce(
      mockSSEResponse(
        makeApprovalRequestSSEEvents({
          toolCallId: 'tc-gate',
          approvalId: 'ap-1',
          toolName: 'despawn_entity',
          input: { entityId: 'e-1' },
        }),
      ),
    );
    const store = await freshStore();
    await store.getState().sendMessage('delete it');
    expect(store.getState().messages[1]?.toolCalls?.find((t) => t.id === 'tc-gate')?.status).toBe('approval-required');

    fetchSpy.mockResolvedValueOnce(
      mockSSEResponse(makeApprovalResumeSSEEvents({ toolCallId: 'tc-gate', approvalId: 'ap-1', approved: false })),
    );
    const assistantId = store.getState().messages[1].id;
    await store.getState().resumeAfterApproval(assistantId, [{ toolCallId: 'tc-gate', approved: false, reason: 'no' }]);
    const tc = store.getState().messages[1]?.toolCalls?.find((t) => t.id === 'tc-gate');
    expect(tc?.status).toBe('denied');
    expect(executeToolCall).not.toHaveBeenCalled();
  });

  it('success → undone: batchUndoMessage undoes each undoable call and marks exactly those', async () => {
    // The only writer of 'undone' is batchUndoMessage, and its existing
    // coverage reached only the no-op branches (the editor store's canUndo is
    // false in a bare test), so the positive path had no test at all. The
    // editor store is mocked with two undos available; the message carries a
    // successful undoable call, a successful non-undoable one and an error,
    // so the slicing that pairs undo() calls with tool calls is observed.
    const undo = vi.fn();
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      mockSSEResponse(
        makeChatSSEEvents({
          toolCalls: [
            { id: 'tc-undoable', name: 'spawn_entity', input: { type: 'cube' } },
            { id: 'tc-fixed', name: 'spawn_entity', input: { type: 'sphere' } },
          ],
          toolErrors: [{ id: 'tc-broken', name: 'spawn_entity', phase: 'input', errorText: 'bad input' }],
        }),
      ),
    );
    vi.resetModules();
    vi.doMock('../../lib/chat/executor', () => ({ executeToolCall }));
    // Keep the real editor store (sendMessage reads scene context from it) and
    // override only the undo surface batchUndoMessage consults.
    vi.doMock('../editorStore', async (importOriginal) => {
      const actual = await importOriginal<typeof import('../editorStore')>();
      const real = actual.useEditorStore;
      const realGetState = real.getState;
      return {
        ...actual,
        useEditorStore: Object.assign(real, {
          getState: () => ({ ...realGetState(), canUndo: true, undo }),
        }),
      };
    });
    const { useChatStore } = await import('../chatStore');
    useChatStore.setState(BASE_STATE as never);
    await useChatStore.getState().sendMessage('two spawns');
    const assistantId = useChatStore.getState().messages[1].id;
    const before = useChatStore.getState().messages[1].toolCalls ?? [];
    expect(before.map((t) => [t.id, t.status])).toEqual([
      ['tc-undoable', 'success'],
      ['tc-fixed', 'success'],
      ['tc-broken', 'error'],
    ]);
    // Mark the second success as not undoable so the filter has something to skip.
    useChatStore.setState({
      messages: useChatStore.getState().messages.map((m) =>
        m.id === assistantId
          ? { ...m, toolCalls: (m.toolCalls ?? []).map((t) => (t.id === 'tc-fixed' ? { ...t, undoable: false } : t)) }
          : m,
      ),
    });

    useChatStore.getState().batchUndoMessage(assistantId);
    // batchUndoMessage resolves the editor store through a dynamic import.
    await vi.waitFor(() => {
      expect(useChatStore.getState().messages[1].toolCalls?.find((t) => t.id === 'tc-undoable')?.status).toBe('undone');
    });
    expect(undo).toHaveBeenCalledTimes(1);
    const after = useChatStore.getState().messages[1].toolCalls ?? [];
    expect(after.map((t) => [t.id, t.status])).toEqual([
      ['tc-undoable', 'undone'],
      ['tc-fixed', 'success'],
      ['tc-broken', 'error'],
    ]);
  });

  it('every state in TOOL_CALL_STATUSES is reached by some documented path', () => {
    // The states the wire produces are proven above; undone is proven by the
    // batchUndoMessage case above; the two remaining client-only states are
    // produced by store actions with their own suites (approvalMode →
    // preview/rejected in chatStore.test.ts). This pins that the list has not
    // grown a state nobody documented: extend BOTH this map and the docblock
    // on TOOL_CALL_STATUSES together.
    const reachedBy: Record<ToolCallStatusName, string> = {
      pending: 'tool-input-start',
      success: 'local execution after finish',
      error: 'tool-input-error | tool-output-error | failed local execution',
      preview: 'approvalMode (client-only)',
      rejected: 'rejectToolCalls (client-only)',
      undone: 'batchUndoMessage after a successful undoable call (client-only, proven above)',
      'approval-required': 'tool-approval-request',
      denied: 'tool-output-denied',
    };
    expect(Object.keys(reachedBy).sort()).toEqual([...TOOL_CALL_STATUSES].sort());
    expect(TOOL_CALL_STATUSES.length).toBe(8);
  });
});

describe('parser ↔ fixture drift pin (#8931)', () => {
  const webRoot = join(__dirname, '..', '..', '..');
  const storeSrc = readFileSync(join(webRoot, 'src', 'stores', 'chatStore.ts'), 'utf8');
  const fixtureSrc = readFileSync(join(webRoot, 'src', 'test', 'utils', 'streamingTestUtils.ts'), 'utf8');

  /** Chunk types the parser names in `case '...'` arms (executable text only). */
  const parserChunks = new Set(
    storeSrc
      .split('\n')
      .filter((line) => !line.trim().startsWith('//'))
      .flatMap((line) => [...line.matchAll(/case '(tool-[a-z-]+)'/g)].map((m) => m[1])),
  );
  /** Chunk types any fixture helper emits as `type: '...'` (executable text only). */
  const fixtureChunks = new Set(
    fixtureSrc
      .split('\n')
      .filter((line) => !line.trim().startsWith('//') && !line.trim().startsWith('*'))
      .flatMap((line) => [...line.matchAll(/type: '(tool-[a-z-]+)'/g)].map((m) => m[1])),
  );

  it('derived both sets (vacuity guard)', () => {
    expect(parserChunks.size).toBeGreaterThanOrEqual(6);
    expect(fixtureChunks.size).toBeGreaterThanOrEqual(6);
  });

  it('every tool chunk the parser handles is emitted by a fixture, so each arm is testable from canonical bytes', () => {
    const untestable = [...parserChunks].filter((c) => !fixtureChunks.has(c));
    expect(untestable, `parser arms with no fixture emitting them: ${untestable.join(', ')}`).toEqual([]);
  });

  it('every tool chunk a fixture emits is handled by the parser by name (never only by default:)', () => {
    const unhandled = [...fixtureChunks].filter((c) => !parserChunks.has(c));
    expect(unhandled, `fixture chunks the parser does not name: ${unhandled.join(', ')}`).toEqual([]);
  });
});
