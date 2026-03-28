import { create } from 'zustand';
import { estimateMessageTokens } from '../lib/chat/tokenCounter';
import { showError } from '@/lib/toast';
import { AI_MODEL_PRIMARY, AI_MODEL_FAST } from '@/lib/ai/models';
import { readUIMessageStream, isToolUIPart, uiMessageChunkSchema } from 'ai';
import { parseJsonEventStream } from '@ai-sdk/provider-utils';
import type { UIMessage, UIMessageChunk } from 'ai';

export interface ToolCallStatus {
  id: string;
  name: string;
  input: Record<string, unknown>;
  status: 'pending' | 'success' | 'error' | 'preview' | 'rejected' | 'undone';
  result?: unknown;
  error?: string;
  undoable: boolean;
}

export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  images?: string[];
  toolCalls?: ToolCallStatus[];
  thinking?: string;
  tokenCost?: number;
  timestamp: number;
  feedback?: 'positive' | 'negative' | null;
  entityRefs?: Record<string, string>; // @DisplayName → entity ID
}

export type ChatModel = typeof AI_MODEL_PRIMARY | typeof AI_MODEL_FAST;

export type RightPanelTab = 'inspector' | 'chat' | 'script' | 'ui' | 'modify' | 'gdd' | 'review' | 'behavior';

export interface Conversation {
  id: string;
  name: string;
  messages: ChatMessage[];
  createdAt: number;
  updatedAt: number;
}

const MAX_LOOP_ITERATIONS = 10;
const PERSISTENCE_KEY = 'forge-chat-';
const CONVERSATIONS_KEY = 'forge-conversations';
const ACTIVE_CONVERSATION_KEY = 'forge-active-conversation';
const MAX_STORED_MESSAGES = 50;
const MAX_CONVERSATIONS = 20;

interface ChatState {
  messages: ChatMessage[];
  isStreaming: boolean;
  activeModel: ChatModel;
  rightPanelTab: RightPanelTab;
  error: string | null;
  abortController: AbortController | null;
  thinkingEnabled: boolean;
  loopIteration: number;
  sessionTokens: { input: number; output: number };
  hasUnreadMessages: boolean;
  approvalMode: boolean;
  showEntityPicker: boolean;
  entityPickerFilter: string;
  pendingEntityRefs: Record<string, string>; // @DisplayName → entity ID for current input
  conversations: Conversation[];
  activeConversationId: string | null;

  showTokenDepletedModal: boolean;
  setShowTokenDepletedModal: (show: boolean) => void;

  sendMessage: (text: string, images?: string[], entityRefs?: Record<string, string>) => Promise<void>;
  /**
   * Send a message and stream the response via the AI SDK UI message stream
   * protocol. This is the Phase 3 path — uses the rewritten /api/chat route
   * which returns toUIMessageStreamResponse() format.
   *
   * chatStore remains the single source of truth. The AI SDK stream is read
   * and translated back into ChatMessage updates.
   */
  sendMessageViaSDK: (text: string, images?: string[], entityRefs?: Record<string, string>) => Promise<void>;
  stopStreaming: () => void;
  setModel: (model: ChatModel) => void;
  setRightPanelTab: (tab: RightPanelTab) => void;
  setThinkingEnabled: (enabled: boolean) => void;
  setApprovalMode: (enabled: boolean) => void;
  approveToolCalls: (messageId: string) => Promise<void>;
  rejectToolCalls: (messageId: string) => void;
  setMessageFeedback: (messageId: string, feedback: 'positive' | 'negative' | null) => void;
  batchUndoMessage: (messageId: string) => void;
  clearChat: () => void;
  clearUnread: () => void;
  updateToolCall: (messageId: string, toolCallId: string, update: Partial<ToolCallStatus>) => void;
  saveConversation: (projectId: string) => void;
  loadConversation: (projectId: string) => void;
  setShowEntityPicker: (show: boolean) => void;
  setEntityPickerFilter: (filter: string) => void;
  addEntityRef: (displayName: string, entityId: string) => void;
  clearEntityRefs: () => void;
  createConversation: (name?: string) => string;
  switchConversation: (conversationId: string) => void;
  deleteConversation: (conversationId: string) => void;
  renameConversation: (conversationId: string, name: string) => void;
  loadConversations: () => void;
}

function nextId(): string {
  return crypto.randomUUID();
}

// ---------------------------------------------------------------------------
// Message index — O(1) lookup of a message's position in the messages array.
// Maintained by useChatStore.subscribe() after store creation.
// ---------------------------------------------------------------------------
/** messageId → index in useChatStore.getState().messages */
let msgIndexMap = new Map<string, number>();

function rebuildMsgIndex(msgs: ChatMessage[]): void {
  msgIndexMap = new Map<string, number>();
  for (let i = 0; i < msgs.length; i++) {
    msgIndexMap.set(msgs[i].id, i);
  }
}

// ---------------------------------------------------------------------------
// updateToolCall microtask batching — prevents a re-render per streaming delta
// ---------------------------------------------------------------------------
interface PendingToolUpdate {
  messageId: string;
  toolCallId: string;
  update: Partial<ToolCallStatus>;
}
let pendingToolUpdates: PendingToolUpdate[] = [];
let toolUpdateBatchScheduled = false;

interface DeferredTool {
  id: string;
  name: string;
  input: Record<string, unknown>;
}

interface StreamResult {
  stopReason: string;
  deferredTools: DeferredTool[];
}

/** Stream one API turn — returns the stop_reason and any deferred tools */
async function streamOneTurn(
  apiMessages: { role: string; content: unknown }[],
  model: string,
  sceneContext: string,
  thinking: boolean,
  signal: AbortSignal,
  onUpdate: (cb: (msg: ChatMessage) => ChatMessage) => void,
  onUsage: (input: number, output: number) => void,
  onError: (msg: string) => void,
  deferToolExecution: boolean = false,
): Promise<StreamResult> {
  const response = await fetch('/api/chat', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ messages: apiMessages, model, sceneContext, thinking }),
    signal,
  });

  if (!response.ok) {
    const errorData = await response.json().catch(() => ({ error: response.statusText }));
    throw new Error(errorData.error || `Chat request failed: ${response.status}`);
  }

  const reader = response.body?.getReader();
  if (!reader) throw new Error('No response body');

  const { executeToolCall } = await import('../lib/chat/executor');
  const decoder = new TextDecoder();
  let buffer = '';
  const toolInputBuffers: Record<string, string> = {};
  let stopReason = 'end_turn';
  const deferredTools: DeferredTool[] = [];

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split('\n');
    buffer = lines.pop() || '';

    for (const line of lines) {
      if (!line.startsWith('data: ')) continue;
      const data = line.slice(6);
      if (data === '[DONE]') continue;

      try {
        const event = JSON.parse(data);

        switch (event.type) {
          case 'text_delta':
            onUpdate((msg) => ({ ...msg, content: msg.content + event.text }));
            break;

          case 'thinking_start':
            // Thinking block starting
            break;

          case 'thinking_delta':
            onUpdate((msg) => ({ ...msg, thinking: (msg.thinking || '') + event.text }));
            break;

          case 'tool_start': {
            const tc: ToolCallStatus = {
              id: event.id,
              name: event.name,
              input: {},
              status: 'pending',
              undoable: true,
            };
            onUpdate((msg) => ({ ...msg, toolCalls: [...(msg.toolCalls || []), tc] }));
            toolInputBuffers[event.id] = '';
            break;
          }

          case 'tool_input_delta': {
            onUpdate((msg) => {
              const pending = (msg.toolCalls || []).filter((t) => t.status === 'pending');
              if (pending.length > 0) {
                const activeTc = pending[pending.length - 1];
                toolInputBuffers[activeTc.id] = (toolInputBuffers[activeTc.id] || '') + event.json;
              }
              return msg; // no state change yet
            });
            break;
          }

          case 'content_block_stop': {
            let toolToProcess: { id: string; name: string; inputJson: string } | null = null;

            onUpdate((msg) => {
              const pending = (msg.toolCalls || []).filter((t) => t.status === 'pending');
              if (pending.length > 0) {
                const tc = pending[pending.length - 1];
                const inputJson = toolInputBuffers[tc.id];
                if (inputJson !== undefined) {
                  toolToProcess = { id: tc.id, name: tc.name, inputJson };
                }
              }
              return msg;
            });

            if (toolToProcess) {
              const { id, name, inputJson } = toolToProcess;
              let parsedInput: Record<string, unknown> = {};
              if (inputJson) {
                try { parsedInput = JSON.parse(inputJson); } catch { /* partial */ }
              }

              if (deferToolExecution) {
                // Defer execution — just parse input, keep pending
                deferredTools.push({ id, name, input: parsedInput });
                onUpdate((msg) => ({
                  ...msg,
                  toolCalls: (msg.toolCalls || []).map((t) =>
                    t.id === id ? { ...t, input: parsedInput } : t
                  ),
                }));
              } else {
                // Execute immediately
                const currentEditorState = (await import('./editorStore')).useEditorStore.getState();
                const result = await executeToolCall(name, parsedInput, currentEditorState);

                onUpdate((msg) => ({
                  ...msg,
                  toolCalls: (msg.toolCalls || []).map((t) =>
                    t.id === id
                      ? {
                          ...t,
                          input: parsedInput,
                          status: result.success ? 'success' as const : 'error' as const,
                          result: result.result,
                          error: result.error,
                        }
                      : t
                  ),
                }));
              }
              delete toolInputBuffers[id];
            }
            break;
          }

          case 'usage':
            onUsage(event.inputTokens || 0, event.outputTokens || 0);
            break;

          case 'turn_complete':
            stopReason = event.stop_reason || 'end_turn';
            break;

          case 'error':
            onError(event.message);
            break;
        }
      } catch {
        // Skip malformed JSON
      }
    }
  }

  return { stopReason, deferredTools };
}

export const useChatStore = create<ChatState>((set, get) => ({
  messages: [],
  isStreaming: false,
  activeModel: AI_MODEL_PRIMARY,
  rightPanelTab: 'inspector',
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
  conversations: [],
  activeConversationId: null,
  showTokenDepletedModal: false,

  setShowTokenDepletedModal: (show) => set({ showTokenDepletedModal: show }),

  sendMessage: async (text: string, images?: string[], entityRefs?: Record<string, string>) => {
    const { messages, activeModel, isStreaming, thinkingEnabled, rightPanelTab } = get();
    if (isStreaming) return;

    // Check token balance before sending — show depletion modal if zero
    try {
      const { useUserStore } = await import('@/stores/userStore');
      const balance = useUserStore.getState().tokenBalance;
      if (balance !== null && balance.total === 0) {
        set({ showTokenDepletedModal: true });
        return;
      }
    } catch {
      // Non-critical — proceed if store unavailable
    }

    // Track AI chat usage
    try { const { trackAIChatMessageSent } = await import('@/lib/analytics/events'); trackAIChatMessageSent(activeModel); } catch { /* analytics non-critical */ }

    // Append entity reference context to the message if @-mentions were used
    let messageContent = text;
    if (entityRefs && Object.keys(entityRefs).length > 0) {
      const refList = Object.entries(entityRefs)
        .map(([name, id]) => `${name} (id: ${id})`)
        .join(', ');
      messageContent += `\n\n[Referenced entities: ${refList}]`;
    }

    const userMessage: ChatMessage = {
      id: nextId(),
      role: 'user',
      content: messageContent,
      images,
      entityRefs,
      timestamp: Date.now(),
    };

    const assistantMessage: ChatMessage = {
      id: nextId(),
      role: 'assistant',
      content: '',
      toolCalls: [],
      timestamp: Date.now(),
    };

    const abortController = new AbortController();

    set({
      messages: [...messages, userMessage, assistantMessage],
      isStreaming: true,
      error: null,
      abortController,
      loopIteration: 0,
      hasUnreadMessages: rightPanelTab !== 'chat',
    });

    try {
      const { useEditorStore } = await import('./editorStore');
      const editorState = useEditorStore.getState();
      const { buildSceneContext } = await import('../lib/chat/context');
      const sceneContext = buildSceneContext(editorState);

      // Build initial API messages from conversation history (with context truncation)
      const allMessages = [...messages, userMessage];
      const apiMessages = buildTruncatedApiMessages(allMessages);

      const assistantMsgId = assistantMessage.id;
      const turnTokens = { input: 0, output: 0 };

      // Helper to update the assistant message in state
      function updateAssistant(cb: (msg: ChatMessage) => ChatMessage) {
        const state = get();
        const msgs = state.messages.map((m) =>
          m.id === assistantMsgId ? cb(m) : m
        );
        set({ messages: msgs });
      }

      function handleUsage(input: number, output: number) {
        turnTokens.input += input;
        turnTokens.output += output;
      }

      function handleError(msg: string) {
        set({ error: msg });
      }

      // --- Agentic loop ---
      let iteration = 0;
      let currentApiMessages = apiMessages;
      const { approvalMode } = get();

      while (iteration < MAX_LOOP_ITERATIONS) {
        set({ loopIteration: iteration });

        const { stopReason, deferredTools } = await streamOneTurn(
          currentApiMessages,
          activeModel,
          sceneContext,
          thinkingEnabled,
          abortController.signal,
          updateAssistant,
          handleUsage,
          handleError,
          approvalMode, // defer tool execution in approval mode
        );

        // In approval mode with deferred tools:
        if (approvalMode && deferredTools.length > 0) {
          if (stopReason === 'end_turn') {
            // Final turn — set tools to 'preview' for user approval
            updateAssistant((msg) => ({
              ...msg,
              toolCalls: (msg.toolCalls || []).map((t) =>
                t.status === 'pending' ? { ...t, status: 'preview' as const } : t
              ),
            }));
            break; // Wait for user to approve/reject
          } else {
            // Mid-loop — execute deferred tools to continue the loop
            const { executeToolCall } = await import('../lib/chat/executor');
            for (const tool of deferredTools) {
              const currentEditorState = (await import('./editorStore')).useEditorStore.getState();
              const result = await executeToolCall(tool.name, tool.input, currentEditorState);
              updateAssistant((msg) => ({
                ...msg,
                toolCalls: (msg.toolCalls || []).map((t) =>
                  t.id === tool.id
                    ? {
                        ...t,
                        status: result.success ? 'success' as const : 'error' as const,
                        result: result.result,
                        error: result.error,
                      }
                    : t
                ),
              }));
            }
          }
        }

        // If Claude finished (end_turn) or max iterations, stop
        if (stopReason !== 'tool_use') break;

        iteration++;

        // Build follow-up messages with tool results
        const currentMsg = get().messages.find((m) => m.id === assistantMsgId);
        if (!currentMsg?.toolCalls?.length) break;

        // Construct the assistant content blocks for the API
        const assistantContentBlocks: unknown[] = [];
        if (currentMsg.content) {
          assistantContentBlocks.push({ type: 'text', text: currentMsg.content });
        }
        for (const tc of currentMsg.toolCalls) {
          assistantContentBlocks.push({
            type: 'tool_use',
            id: tc.id,
            name: tc.name,
            input: tc.input,
          });
        }

        // Construct tool_result blocks
        const toolResultBlocks = currentMsg.toolCalls.map((tc) => ({
          type: 'tool_result' as const,
          tool_use_id: tc.id,
          content: tc.status === 'error'
            ? `Error: ${tc.error || 'Unknown error'}`
            : String(tc.result || 'Success'),
          is_error: tc.status === 'error',
        }));

        // Append assistant + tool_result to conversation
        currentApiMessages = [
          ...currentApiMessages,
          { role: 'assistant', content: assistantContentBlocks },
          { role: 'user', content: toolResultBlocks },
        ];

        // Reset the assistant message content for the next turn's text
        // but keep existing tool calls (they accumulate across turns)
        updateAssistant((msg) => ({ ...msg, content: '' }));
      }

      // Store final token cost on the message
      const totalTokens = turnTokens.input + turnTokens.output;
      updateAssistant((msg) => ({ ...msg, tokenCost: totalTokens }));

      // Update session totals
      const prev = get().sessionTokens;
      set({
        sessionTokens: {
          input: prev.input + turnTokens.input,
          output: prev.output + turnTokens.output,
        },
      });
    } catch (err: unknown) {
      if (err instanceof Error && err.name === 'AbortError') {
        // User cancelled
      } else {
        const errorMessage = err instanceof Error ? err.message : 'Chat request failed';
        set({ error: errorMessage });
        showError(`AI chat error: ${errorMessage}`);
      }
    } finally {
      set({ isStreaming: false, abortController: null, loopIteration: 0 });

      // Sync current messages to the active conversation so they persist
      const { messages: finalMessages, activeConversationId: convId, conversations: convs } = get();
      if (convId) {
        const syncedConversations = convs.map((c) =>
          c.id === convId
            ? { ...c, messages: finalMessages.slice(-MAX_STORED_MESSAGES), updatedAt: Date.now() }
            : c
        );
        set({ conversations: syncedConversations });
        saveConversationsToStorage(syncedConversations, convId);
      }
    }
  },

  // ---------------------------------------------------------------------------
  // Phase 3: sendMessageViaSDK — AI SDK UI message stream transport
  // ---------------------------------------------------------------------------

  sendMessageViaSDK: async (text: string, images?: string[], entityRefs?: Record<string, string>) => {
    const { messages, activeModel, isStreaming, thinkingEnabled, rightPanelTab } = get();
    if (isStreaming) return;

    // Track AI chat usage
    try { const { trackAIChatMessageSent } = await import('@/lib/analytics/events'); trackAIChatMessageSent(activeModel); } catch { /* analytics non-critical */ }

    // Append entity reference context to the message if @-mentions were used
    let messageContent = text;
    if (entityRefs && Object.keys(entityRefs).length > 0) {
      const refList = Object.entries(entityRefs)
        .map(([name, id]) => `${name} (id: ${id})`)
        .join(', ');
      messageContent += `\n\n[Referenced entities: ${refList}]`;
    }

    const userMessage: ChatMessage = {
      id: nextId(),
      role: 'user',
      content: messageContent,
      images,
      entityRefs,
      timestamp: Date.now(),
    };

    const assistantMessage: ChatMessage = {
      id: nextId(),
      role: 'assistant',
      content: '',
      toolCalls: [],
      timestamp: Date.now(),
    };

    const abortController = new AbortController();

    set({
      messages: [...messages, userMessage, assistantMessage],
      isStreaming: true,
      error: null,
      abortController,
      loopIteration: 0,
      hasUnreadMessages: rightPanelTab !== 'chat',
    });

    const assistantMsgId = assistantMessage.id;

    function updateAssistant(cb: (msg: ChatMessage) => ChatMessage) {
      const state = get();
      const msgs = state.messages.map((m) =>
        m.id === assistantMsgId ? cb(m) : m
      );
      set({ messages: msgs });
    }

    try {
      const { useEditorStore } = await import('./editorStore');
      const editorState = useEditorStore.getState();
      const { buildSceneContext } = await import('../lib/chat/context');
      const sceneContext = buildSceneContext(editorState);

      // Build API messages from conversation history
      const allMessages = [...messages, userMessage];
      const apiMessages = buildTruncatedApiMessages(allMessages);

      const response = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          messages: apiMessages,
          model: activeModel,
          sceneContext,
          thinking: thinkingEnabled,
        }),
        signal: abortController.signal,
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({ error: response.statusText }));
        throw new Error(errorData.error || `Chat request failed: ${response.status}`);
      }

      if (!response.body) throw new Error('No response body');

      // Parse the AI SDK UI message stream.
      // The route returns raw SSE bytes (ReadableStream<Uint8Array>).
      // Step 1: parse bytes → UIMessageChunk via parseJsonEventStream + uiMessageChunkSchema.
      // Step 2: pass UIMessageChunk stream to readUIMessageStream → UIMessage snapshots.
      const chunkStream = parseJsonEventStream<UIMessageChunk>({
        stream: response.body as ReadableStream<Uint8Array>,
        schema: uiMessageChunkSchema,
      }).pipeThrough(
        new TransformStream({
          transform(parseResult, controller) {
            if (parseResult.success) {
              controller.enqueue(parseResult.value);
            }
          },
        })
      );

      const uiMessageStream = readUIMessageStream<UIMessage>({
        stream: chunkStream,
        onError: (err) => {
          const errMsg = err instanceof Error ? err.message : String(err);
          set({ error: errMsg });
        },
      });

      for await (const uiMsg of uiMessageStream) {
        // Translate UIMessage parts back into chatStore ChatMessage format
        let textContent = '';
        let thinkingContent = '';

        for (const part of uiMsg.parts ?? []) {
          if (part.type === 'text') {
            // AI SDK v6 TextUIPart
            textContent += part.text;
          } else if (part.type === 'reasoning') {
            // AI SDK v6 ReasoningUIPart (extended thinking)
            thinkingContent += part.text;
          } else if (isToolUIPart(part)) {
            // AI SDK v6: tool parts use type `tool-<toolName>` (static) or `dynamic-tool`.
            // Use isToolUIPart() helper — never check for removed `tool-invocation` type.
            const toolId = part.toolCallId;
            const toolName = part.type === 'dynamic-tool'
              ? part.toolName
              : part.type.slice('tool-'.length); // strip "tool-" prefix to get tool name

            if (part.state === 'input-streaming' || part.state === 'input-available') {
              // Tool input arriving — add to tool calls if not already present
              const toolInput = (part.input as Record<string, unknown>) ?? {};
              updateAssistant((msg) => {
                const existing = (msg.toolCalls || []).find((t) => t.id === toolId);
                if (existing) {
                  // Update input as it streams in
                  return {
                    ...msg,
                    toolCalls: (msg.toolCalls || []).map((t) =>
                      t.id === toolId ? { ...t, input: toolInput } : t
                    ),
                  };
                }
                return {
                  ...msg,
                  toolCalls: [
                    ...(msg.toolCalls || []),
                    {
                      id: toolId,
                      name: toolName,
                      input: toolInput,
                      status: 'pending' as const,
                      undoable: true,
                    },
                  ],
                };
              });
            } else if (part.state === 'output-available') {
              // Tool output available — execute tool client-side and update status
              const { executeToolCall } = await import('../lib/chat/executor');
              const currentEditorState = (await import('./editorStore')).useEditorStore.getState();
              const toolInput = (part.input as Record<string, unknown>) ?? {};
              const result = await executeToolCall(toolName, toolInput, currentEditorState);

              updateAssistant((msg) => ({
                ...msg,
                toolCalls: (msg.toolCalls || []).map((t) =>
                  t.id === toolId
                    ? {
                        ...t,
                        input: toolInput,
                        status: result.success ? 'success' as const : 'error' as const,
                        result: result.result,
                        error: result.error,
                      }
                    : t
                ),
              }));
            } else if (part.state === 'output-error') {
              // Tool errored on server side
              updateAssistant((msg) => ({
                ...msg,
                toolCalls: (msg.toolCalls || []).map((t) =>
                  t.id === toolId
                    ? { ...t, status: 'error' as const, error: part.errorText }
                    : t
                ),
              }));
            }
          }
        }

        // Update text + thinking content
        updateAssistant((msg) => ({
          ...msg,
          content: textContent || msg.content,
          ...(thinkingContent ? { thinking: thinkingContent } : {}),
        }));
      }
    } catch (err: unknown) {
      if (err instanceof Error && err.name === 'AbortError') {
        // User cancelled
      } else {
        const errorMessage = err instanceof Error ? err.message : 'Chat request failed';
        set({ error: errorMessage });
        showError(`AI chat error: ${errorMessage}`);
      }
    } finally {
      set({ isStreaming: false, abortController: null, loopIteration: 0 });

      // Sync current messages to the active conversation so they persist
      const { messages: finalMessages, activeConversationId: convId, conversations: convs } = get();
      if (convId) {
        const syncedConversations = convs.map((c) =>
          c.id === convId
            ? { ...c, messages: finalMessages.slice(-MAX_STORED_MESSAGES), updatedAt: Date.now() }
            : c
        );
        set({ conversations: syncedConversations });
        saveConversationsToStorage(syncedConversations, convId);
      }
    }
  },

  stopStreaming: () => {
    const { abortController } = get();
    if (abortController) {
      abortController.abort();
      set({ isStreaming: false, abortController: null, loopIteration: 0 });
    }
  },

  setModel: (model) => set({ activeModel: model }),

  setRightPanelTab: (tab) => {
    set({ rightPanelTab: tab });
    if (tab === 'chat') set({ hasUnreadMessages: false });
  },

  setThinkingEnabled: (enabled) => set({ thinkingEnabled: enabled }),

  clearChat: () => set({ messages: [], error: null, sessionTokens: { input: 0, output: 0 } }),

  clearUnread: () => set({ hasUnreadMessages: false }),

  updateToolCall: (messageId, toolCallId, update) => {
    pendingToolUpdates.push({ messageId, toolCallId, update });
    if (!toolUpdateBatchScheduled) {
      toolUpdateBatchScheduled = true;
      queueMicrotask(() => {
        toolUpdateBatchScheduled = false;
        const updates = pendingToolUpdates;
        pendingToolUpdates = [];

        // Group pending updates by messageId to avoid rescanning the full array
        // for each update. Each messageId gets at most one O(1) index lookup
        // and one targeted array splice — O(messages_touched) not O(N*updates).
        const updatesByMsg = new Map<string, PendingToolUpdate[]>();
        for (const u of updates) {
          const bucket = updatesByMsg.get(u.messageId);
          if (bucket) {
            bucket.push(u);
          } else {
            updatesByMsg.set(u.messageId, [u]);
          }
        }

        const msgs = get().messages.slice(); // shallow copy of the array
        let changed = false;
        for (const [msgId, msgUpdates] of updatesByMsg) {
          const idx = msgIndexMap.get(msgId);
          if (idx === undefined) continue; // message not found — skip
          const msg = msgs[idx];
          // Build a Map of toolCallId → merged update for this message
          const tcUpdates = new Map<string, Partial<ToolCallStatus>>();
          for (const u of msgUpdates) {
            const existing = tcUpdates.get(u.toolCallId);
            tcUpdates.set(u.toolCallId, existing ? { ...existing, ...u.update } : u.update);
          }
          const newToolCalls = (msg.toolCalls || []).map((tc) => {
            const u = tcUpdates.get(tc.id);
            return u ? { ...tc, ...u } : tc;
          });
          msgs[idx] = { ...msg, toolCalls: newToolCalls };
          changed = true;
        }
        if (changed) set({ messages: msgs });
      });
    }
  },

  saveConversation: (projectId: string) => {
    const { messages } = get();
    const toStore = messages.slice(-MAX_STORED_MESSAGES);
    const key = PERSISTENCE_KEY + projectId;
    const doSave = () => {
      try {
        localStorage.setItem(key, JSON.stringify(toStore));
      } catch {
        // localStorage full or unavailable
      }
    };
    if (typeof requestIdleCallback !== 'undefined') {
      requestIdleCallback(doSave, { timeout: 2000 });
    } else {
      setTimeout(doSave, 0);
    }
  },

  loadConversation: (projectId: string) => {
    try {
      const stored = localStorage.getItem(PERSISTENCE_KEY + projectId);
      if (stored) {
        const parsed = JSON.parse(stored) as ChatMessage[];
        set({ messages: parsed, error: null });
      }
    } catch {
      // Corrupt data
    }
  },

  setApprovalMode: (enabled) => set({ approvalMode: enabled }),

  approveToolCalls: async (messageId: string) => {
    // O(1) message lookup via index map (PF-870)
    const idx = msgIndexMap.get(messageId);
    if (idx === undefined) return;
    const messages = get().messages;
    const message = messages[idx];
    if (!message?.toolCalls) return;

    const previewTools = message.toolCalls.filter((tc) => tc.status === 'preview');
    if (previewTools.length === 0) return;

    const { executeToolCall } = await import('../lib/chat/executor');
    const { useEditorStore } = await import('./editorStore');

    type ExecutionResult = Awaited<ReturnType<typeof executeToolCall>>;
    const results = new Map<string, ExecutionResult>();
    for (const tc of previewTools) {
      const editorState = useEditorStore.getState();
      results.set(tc.id, await executeToolCall(tc.name, tc.input, editorState));
    }

    // Single set() with results applied to the targeted message only (PF-870)
    const msgs = get().messages.slice();
    const currentIdx = msgIndexMap.get(messageId);
    if (currentIdx === undefined) return; // message removed while awaiting
    const current = msgs[currentIdx];
    msgs[currentIdx] = {
      ...current,
      toolCalls: (current.toolCalls || []).map((t) => {
        const r = results.get(t.id);
        return r
          ? {
              ...t,
              status: r.success ? 'success' as const : 'error' as const,
              result: r.result,
              error: r.error,
            }
          : t;
      }),
    };
    set({ messages: msgs });
  },

  rejectToolCalls: (messageId: string) => {
    // O(1) message lookup via index map (PF-870)
    const idx = msgIndexMap.get(messageId);
    if (idx === undefined) return;
    const msgs = get().messages.slice();
    const msg = msgs[idx];
    msgs[idx] = {
      ...msg,
      toolCalls: (msg.toolCalls || []).map((tc) =>
        tc.status === 'preview' ? { ...tc, status: 'rejected' as const } : tc
      ),
    };
    set({ messages: msgs });
  },

  setMessageFeedback: (messageId: string, feedback: 'positive' | 'negative' | null) => {
    // O(1) message lookup via index map
    const idx = msgIndexMap.get(messageId);
    if (idx === undefined) return;
    const msgs = get().messages.slice();
    msgs[idx] = { ...msgs[idx], feedback };
    set({ messages: msgs });
  },

  batchUndoMessage: (messageId: string) => {
    // O(1) message lookup via index map
    const idx = msgIndexMap.get(messageId);
    if (idx === undefined) return;
    const message = get().messages[idx];
    if (!message?.toolCalls) return;

    const undoableCompleted = message.toolCalls.filter(
      (tc) => tc.status === 'success' && tc.undoable
    );
    if (undoableCompleted.length === 0) return;

    // Import editorStore and call undo N times
    import('./editorStore').then(({ useEditorStore }) => {
      const editorState = useEditorStore.getState();
      let undoneCount = 0;
      for (let i = 0; i < undoableCompleted.length; i++) {
        if (!editorState.canUndo) break;
        editorState.undo();
        undoneCount++;
      }

      if (undoneCount > 0) {
        // Mark all successful+undoable tool calls as undone (O(1) lookup)
        const toolIdsToUndo = new Set(
          undoableCompleted.slice(0, undoneCount).map((tc) => tc.id)
        );
        const currentIdx = msgIndexMap.get(messageId);
        if (currentIdx === undefined) return; // message removed while awaiting
        const msgs = get().messages.slice();
        const msg = msgs[currentIdx];
        msgs[currentIdx] = {
          ...msg,
          toolCalls: (msg.toolCalls || []).map((tc) =>
            toolIdsToUndo.has(tc.id)
              ? { ...tc, status: 'undone' as const }
              : tc
          ),
        };
        set({ messages: msgs });
      }
    });
  },

  setShowEntityPicker: (show) => set({ showEntityPicker: show }),
  setEntityPickerFilter: (filter) => set({ entityPickerFilter: filter }),
  addEntityRef: (displayName, entityId) => {
    const refs = { ...get().pendingEntityRefs, [displayName]: entityId };
    set({ pendingEntityRefs: refs });
  },
  clearEntityRefs: () => set({ pendingEntityRefs: {} }),

  createConversation: (name?: string) => {
    const { messages, conversations, activeConversationId } = get();
    const now = Date.now();
    const id = `conv_${now}_${Math.random().toString(36).slice(2, 8)}`;
    const newName = name || `Chat ${conversations.length + 1}`;

    // Save current messages to the active conversation before creating new one
    let updatedConversations = [...conversations];
    if (activeConversationId) {
      updatedConversations = updatedConversations.map((c) =>
        c.id === activeConversationId
          ? { ...c, messages: messages.slice(-MAX_STORED_MESSAGES), updatedAt: now }
          : c
      );
    } else if (messages.length > 0) {
      // Auto-create conversation for existing messages
      const autoId = `conv_${now - 1}_auto`;
      const autoName = messages[0]?.content?.slice(0, 30) || 'Untitled';
      updatedConversations.push({
        id: autoId,
        name: autoName,
        messages: messages.slice(-MAX_STORED_MESSAGES),
        createdAt: now - 1,
        updatedAt: now - 1,
      });
    }

    const newConv: Conversation = {
      id,
      name: newName,
      messages: [],
      createdAt: now,
      updatedAt: now,
    };

    // Keep within max conversations limit
    updatedConversations.push(newConv);
    if (updatedConversations.length > MAX_CONVERSATIONS) {
      updatedConversations = updatedConversations.slice(-MAX_CONVERSATIONS);
    }

    set({
      conversations: updatedConversations,
      activeConversationId: id,
      messages: [],
      error: null,
      sessionTokens: { input: 0, output: 0 },
    });

    saveConversationsToStorage(updatedConversations, id);
    return id;
  },

  switchConversation: (conversationId: string) => {
    const { messages, conversations, activeConversationId } = get();
    const now = Date.now();

    // Save current conversation first — handle null activeConversationId
    const updatedConversations = conversations.map((c) =>
      c.id === activeConversationId
        ? { ...c, messages: messages.slice(-MAX_STORED_MESSAGES), updatedAt: now }
        : c
    );

    // If there are unsaved messages with no active conversation, auto-create one
    if (!activeConversationId && messages.length > 0) {
      const autoId = `conv_${now}_auto`;
      const autoName = messages[0]?.content?.slice(0, 30) || 'Untitled';
      updatedConversations.push({
        id: autoId,
        name: autoName,
        messages: messages.slice(-MAX_STORED_MESSAGES),
        createdAt: now,
        updatedAt: now,
      });
    }

    // Load the target conversation
    const target = updatedConversations.find((c) => c.id === conversationId);
    if (!target) return;

    set({
      conversations: updatedConversations,
      activeConversationId: conversationId,
      messages: target.messages,
      error: null,
      sessionTokens: { input: 0, output: 0 },
    });

    saveConversationsToStorage(updatedConversations, conversationId);
  },

  deleteConversation: (conversationId: string) => {
    const { conversations, activeConversationId } = get();
    const updatedConversations = conversations.filter((c) => c.id !== conversationId);

    // If deleting the active conversation, switch to the latest or clear
    if (conversationId === activeConversationId) {
      const latest = updatedConversations[updatedConversations.length - 1];
      const newActiveId = latest?.id ?? null;
      set({
        conversations: updatedConversations,
        activeConversationId: newActiveId,
        messages: latest?.messages ?? [],
        error: null,
      });
      saveConversationsToStorage(updatedConversations, newActiveId);
    } else {
      set({ conversations: updatedConversations });
      saveConversationsToStorage(updatedConversations);
    }
  },

  renameConversation: (conversationId: string, name: string) => {
    const { conversations } = get();
    const updatedConversations = conversations.map((c) =>
      c.id === conversationId ? { ...c, name } : c
    );
    set({ conversations: updatedConversations });
    saveConversationsToStorage(updatedConversations);
  },

  loadConversations: () => {
    try {
      const stored = localStorage.getItem(CONVERSATIONS_KEY);
      if (stored) {
        const parsed = JSON.parse(stored) as Conversation[];
        // Restore persisted active conversation, falling back to most recently updated
        const persistedId = localStorage.getItem(ACTIVE_CONVERSATION_KEY);
        const restoredId = persistedId && parsed.some((c) => c.id === persistedId)
          ? persistedId
          : [...parsed].sort((a, b) => b.updatedAt - a.updatedAt)[0]?.id ?? null;
        const activeConv = restoredId ? parsed.find((c) => c.id === restoredId) : null;
        set({
          conversations: parsed,
          activeConversationId: restoredId,
          messages: activeConv?.messages ?? [],
        });
      }
    } catch {
      // Corrupt data
    }
  },
}));

// ---------------------------------------------------------------------------
// Keep msgIndexMap in sync with every messages array change.
// Zustand 5.x base subscribe receives (state, prevState). We compare array
// references so the rebuild only runs when messages actually changed.
// This is O(N) — no worse than the full messages.map() scans it replaces,
// but eliminates repeated O(N) scans inside each per-message operation.
// ---------------------------------------------------------------------------
useChatStore.subscribe((state, prevState) => {
  if (state.messages !== prevState.messages) {
    rebuildMsgIndex(state.messages);
  }
});

// ---------------------------------------------------------------------------
// Debounced localStorage persistence — avoids blocking the main thread when
// conversation state is updated repeatedly (e.g. during streaming).
// We keep the latest pending write args and flush them via requestIdleCallback
// (with a 2 s deadline) or setTimeout(0) as a fallback.
// ---------------------------------------------------------------------------
let _pendingSaveArgs: { conversations: Conversation[]; activeId?: string | null } | null = null;
let _saveScheduled = false;

/** @internal Exposed for tests to flush the pending save synchronously. */
export function flushConversationSaveForTesting() {
  flushConversationSave();
}

function flushConversationSave() {
  _saveScheduled = false;
  if (!_pendingSaveArgs) return;
  const { conversations, activeId } = _pendingSaveArgs;
  _pendingSaveArgs = null;
  try {
    const toStore = conversations.map((c) => ({
      ...c,
      messages: c.messages.slice(-MAX_STORED_MESSAGES),
    }));
    localStorage.setItem(CONVERSATIONS_KEY, JSON.stringify(toStore));
    if (activeId !== undefined) {
      if (activeId) {
        localStorage.setItem(ACTIVE_CONVERSATION_KEY, activeId);
      } else {
        localStorage.removeItem(ACTIVE_CONVERSATION_KEY);
      }
    }
  } catch {
    // localStorage full or unavailable
  }
}

function saveConversationsToStorage(conversations: Conversation[], activeId?: string | null) {
  // Overwrite any previously queued write — the latest state wins.
  _pendingSaveArgs = { conversations, activeId };
  if (!_saveScheduled) {
    _saveScheduled = true;
    if (typeof requestIdleCallback !== 'undefined') {
      requestIdleCallback(flushConversationSave, { timeout: 2000 });
    } else {
      setTimeout(flushConversationSave, 0);
    }
  }
}

// Flush pending saves on page unload to prevent data loss.
// Uses 'pagehide' (fires reliably on mobile + desktop) over 'beforeunload'.
if (typeof window !== 'undefined') {
  window.addEventListener('pagehide', flushConversationSave);
}

/** Convert ChatMessages to Anthropic API format */
function buildApiMessages(messages: ChatMessage[]): { role: string; content: unknown }[] {
  return messages
    .filter((m) => m.role !== 'system')
    .map((m) => {
      if (m.role === 'user' && m.images && m.images.length > 0) {
        return {
          role: m.role as 'user',
          content: [
            ...m.images.map((img) => ({
              type: 'image' as const,
              source: {
                type: 'base64' as const,
                media_type: 'image/png' as const,
                data: img.replace(/^data:image\/\w+;base64,/, ''),
              },
            })),
            { type: 'text' as const, text: m.content },
          ],
        };
      }
      return { role: m.role as 'user' | 'assistant', content: m.content };
    });
}

// System prompt + tools overhead estimate (tokens)
const SYSTEM_OVERHEAD_TOKENS = 6000;
// Max context window tokens, aligned with /api/chat MAX_INPUT_CHARS (600k chars ≈ 150k tokens)
const MAX_CONTEXT_TOKENS = 150000;

/**
 * Build API messages with context window truncation.
 * Drops oldest messages (preserving tool_use/tool_result pairs) to fit within budget.
 * Inserts a "[Earlier conversation summarized]" marker when messages are dropped.
 */
export function buildTruncatedApiMessages(
  messages: ChatMessage[],
  maxTokens: number = MAX_CONTEXT_TOKENS,
  systemOverhead: number = SYSTEM_OVERHEAD_TOKENS
): { role: string; content: unknown }[] {
  const allApiMessages = buildApiMessages(messages);
  const budget = maxTokens - systemOverhead;

  if (budget <= 0) return allApiMessages.slice(-2);

  // Estimate tokens for each message
  const tokenCounts: number[] = allApiMessages.map((m) =>
    estimateMessageTokens(m)
  );

  const totalTokens = tokenCounts.reduce((a: number, b: number) => a + b, 0);

  // If everything fits, return as-is
  if (totalTokens <= budget) return allApiMessages;

  // Drop oldest messages, but preserve tool_use/tool_result pairs
  // Always keep the last message (the current user message)
  let droppedCount = 0;
  let droppedTokens = 0;

  // Drop from the front until we fit (never drop the last message)
  let currentTokens = totalTokens;
  let i = 0;
  while (currentTokens > budget && i < allApiMessages.length - 1) {
    // If this is a tool_use message, also drop its paired tool_result
    if (isToolUseMessage(allApiMessages[i]) && i + 1 < allApiMessages.length && isToolResultMessage(allApiMessages[i + 1])) {
      currentTokens -= tokenCounts[i] + tokenCounts[i + 1];
      droppedTokens += tokenCounts[i] + tokenCounts[i + 1];
      droppedCount += 2;
      i += 2;
    } else {
      currentTokens -= tokenCounts[i];
      droppedTokens += tokenCounts[i];
      droppedCount += 1;
      i += 1;
    }
  }

  if (droppedCount === 0) return allApiMessages;

  // Build result with summary marker
  const remaining = allApiMessages.slice(i);
  const summaryContent = `[Earlier conversation summarized: ${droppedCount} messages (~${droppedTokens} tokens) were truncated to fit context window]`;

  if (remaining.length > 0 && remaining[0].role === 'assistant') {
    // First remaining is assistant — insert a user summary before it to maintain alternation
    return [
      { role: 'user' as const, content: summaryContent },
      ...remaining,
    ];
  }

  if (remaining.length > 0 && remaining[0].role === 'user') {
    // First remaining is user — merge summary into it to avoid two consecutive user messages
    let mergedContent: typeof remaining[0]['content'];
    if (typeof remaining[0].content === 'string') {
      mergedContent = `${summaryContent}\n\n${remaining[0].content}`;
    } else if (Array.isArray(remaining[0].content)) {
      // Content is an array (e.g., text + image blocks) — prepend summary as a text block
      mergedContent = [
        { type: 'text' as const, text: summaryContent },
        ...(remaining[0].content as Array<Record<string, unknown>>),
      ];
    } else {
      mergedContent = remaining[0].content;
    }
    const merged = { ...remaining[0], content: mergedContent };
    return [merged, ...remaining.slice(1)];
  }

  // Fallback: just prepend the summary as a user message
  return [{ role: 'user' as const, content: summaryContent }, ...remaining];
}

function isToolUseMessage(msg: { role: string; content: unknown }): boolean {
  if (msg.role !== 'assistant') return false;
  if (!Array.isArray(msg.content)) return false;
  return (msg.content as Array<{ type?: string }>).some((b) => b.type === 'tool_use');
}

function isToolResultMessage(msg: { role: string; content: unknown }): boolean {
  if (msg.role !== 'user') return false;
  if (!Array.isArray(msg.content)) return false;
  return (msg.content as Array<{ type?: string }>).some((b) => b.type === 'tool_result');
}
