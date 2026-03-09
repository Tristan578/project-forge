import { create } from 'zustand';
import { estimateMessageTokens } from '../lib/chat/tokenCounter';

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

export type ChatModel = 'claude-sonnet-4-5-20250929' | 'claude-haiku-4-5-20251001';

export type RightPanelTab = 'inspector' | 'chat' | 'script' | 'ui';

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

  sendMessage: (text: string, images?: string[], entityRefs?: Record<string, string>) => Promise<void>;
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

let messageCounter = 0;
function nextId(): string {
  return `msg_${Date.now()}_${++messageCounter}`;
}

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
  activeModel: 'claude-sonnet-4-5-20250929',
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

  sendMessage: async (text: string, images?: string[], entityRefs?: Record<string, string>) => {
    const { messages, activeModel, isStreaming, thinkingEnabled, rightPanelTab } = get();
    if (isStreaming) return;

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
        set({ error: err instanceof Error ? err.message : 'Chat request failed' });
      }
    } finally {
      set({ isStreaming: false, abortController: null, loopIteration: 0 });

      // Sync current messages to the active conversation so they persist
      const { messages: finalMessages, activeConversationId: activeId, conversations: convs } = get();
      if (activeId) {
        const syncedConversations = convs.map((c) =>
          c.id === activeId
            ? { ...c, messages: finalMessages.slice(-MAX_STORED_MESSAGES), updatedAt: Date.now() }
            : c
        );
        set({ conversations: syncedConversations });
        saveConversationsToStorage(syncedConversations);
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
    const msgs = get().messages.map((msg) => {
      if (msg.id !== messageId) return msg;
      return {
        ...msg,
        toolCalls: (msg.toolCalls || []).map((tc) =>
          tc.id === toolCallId ? { ...tc, ...update } : tc
        ),
      };
    });
    set({ messages: msgs });
  },

  saveConversation: (projectId: string) => {
    try {
      const { messages } = get();
      const toStore = messages.slice(-MAX_STORED_MESSAGES);
      localStorage.setItem(PERSISTENCE_KEY + projectId, JSON.stringify(toStore));
    } catch {
      // localStorage full or unavailable
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
    const { messages } = get();
    const message = messages.find((m) => m.id === messageId);
    if (!message?.toolCalls) return;

    const previewTools = message.toolCalls.filter((tc) => tc.status === 'preview');
    if (previewTools.length === 0) return;

    const { executeToolCall } = await import('../lib/chat/executor');

    for (const tc of previewTools) {
      const currentEditorState = (await import('./editorStore')).useEditorStore.getState();
      const result = await executeToolCall(tc.name, tc.input, currentEditorState);

      const msgs = get().messages.map((msg) => {
        if (msg.id !== messageId) return msg;
        return {
          ...msg,
          toolCalls: (msg.toolCalls || []).map((t) =>
            t.id === tc.id
              ? {
                  ...t,
                  status: result.success ? 'success' as const : 'error' as const,
                  result: result.result,
                  error: result.error,
                }
              : t
          ),
        };
      });
      set({ messages: msgs });
    }
  },

  rejectToolCalls: (messageId: string) => {
    const msgs = get().messages.map((msg) => {
      if (msg.id !== messageId) return msg;
      return {
        ...msg,
        toolCalls: (msg.toolCalls || []).map((tc) =>
          tc.status === 'preview' ? { ...tc, status: 'rejected' as const } : tc
        ),
      };
    });
    set({ messages: msgs });
  },

  setMessageFeedback: (messageId: string, feedback: 'positive' | 'negative' | null) => {
    const msgs = get().messages.map((msg) =>
      msg.id === messageId ? { ...msg, feedback } : msg
    );
    set({ messages: msgs });
  },

  batchUndoMessage: (messageId: string) => {
    const { messages } = get();
    const message = messages.find((m) => m.id === messageId);
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
        // Mark all successful+undoable tool calls as undone
        const toolIdsToUndo = new Set(
          undoableCompleted.slice(0, undoneCount).map((tc) => tc.id)
        );
        const msgs = get().messages.map((msg) => {
          if (msg.id !== messageId) return msg;
          return {
            ...msg,
            toolCalls: (msg.toolCalls || []).map((tc) =>
              toolIdsToUndo.has(tc.id)
                ? { ...tc, status: 'undone' as const }
                : tc
            ),
          };
        });
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

    saveConversationsToStorage(updatedConversations);
    return id;
  },

  switchConversation: (conversationId: string) => {
    const { messages, conversations, activeConversationId } = get();
    const now = Date.now();

    // Save current conversation first
    let updatedConversations = conversations.map((c) =>
      c.id === activeConversationId
        ? { ...c, messages: messages.slice(-MAX_STORED_MESSAGES), updatedAt: now }
        : c
    );

    // If there's no active conversation but there are unsaved messages,
    // auto-create a conversation to preserve them
    if (!activeConversationId && messages.length > 0) {
      const autoId = `conv_${now}_auto`;
      const autoName = messages[0]?.content?.slice(0, 30) || 'Untitled';
      updatedConversations = [...updatedConversations, {
        id: autoId,
        name: autoName,
        messages: messages.slice(-MAX_STORED_MESSAGES),
        createdAt: now,
        updatedAt: now,
      }];
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

    saveConversationsToStorage(updatedConversations);
  },

  deleteConversation: (conversationId: string) => {
    const { conversations, activeConversationId } = get();
    const updatedConversations = conversations.filter((c) => c.id !== conversationId);

    // If deleting the active conversation, switch to the latest or clear
    if (conversationId === activeConversationId) {
      const latest = updatedConversations[updatedConversations.length - 1];
      set({
        conversations: updatedConversations,
        activeConversationId: latest?.id ?? null,
        messages: latest?.messages ?? [],
        error: null,
      });
    } else {
      set({ conversations: updatedConversations });
    }

    saveConversationsToStorage(updatedConversations);
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
        // Restore the most recently updated conversation so state survives page reload
        const sorted = [...parsed].sort((a, b) => b.updatedAt - a.updatedAt);
        const mostRecent = sorted[0];
        set({
          conversations: parsed,
          activeConversationId: mostRecent?.id ?? null,
          messages: mostRecent?.messages ?? [],
        });
      }
    } catch {
      // Corrupt data
    }
  },
}));

function saveConversationsToStorage(conversations: Conversation[]) {
  try {
    // Store only metadata + limited messages
    const toStore = conversations.map((c) => ({
      ...c,
      messages: c.messages.slice(-MAX_STORED_MESSAGES),
    }));
    localStorage.setItem(CONVERSATIONS_KEY, JSON.stringify(toStore));
  } catch {
    // localStorage full or unavailable
  }
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
// Max context tokens — must stay within server-side MAX_INPUT_CHARS (600k chars / ~4 chars per token = 150k tokens).
// Use 140k to leave headroom and avoid 413 errors from the server.
const MAX_CONTEXT_TOKENS = 140000;

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

  // Drop oldest messages, but preserve tool_use/tool_result pairs.
  // Always keep the last message (the current user message).
  let droppedCount = 0;
  let droppedTokens = 0;

  // Mark tool_result messages that are paired with a preceding tool_use.
  // These cannot be dropped independently — only together with their tool_use.
  const pairedToolResult = new Set<number>();
  for (let i = 0; i < allApiMessages.length - 1; i++) {
    if (isToolUseMessage(allApiMessages[i]) && isToolResultMessage(allApiMessages[i + 1])) {
      pairedToolResult.add(i + 1);
    }
  }

  // Drop from the front until we fit
  let currentTokens = totalTokens;
  let i = 0;
  while (currentTokens > budget && i < allApiMessages.length - 1) {
    // Skip paired tool_result messages — they are dropped with their tool_use
    if (pairedToolResult.has(i)) {
      i++;
      continue;
    }

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
