import { create } from 'zustand';

export interface ToolCallStatus {
  id: string;
  name: string;
  input: Record<string, unknown>;
  status: 'pending' | 'success' | 'error';
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
  timestamp: number;
}

export type ChatModel = 'claude-sonnet-4-5-20250929' | 'claude-haiku-4-5-20251001';

export type RightPanelTab = 'inspector' | 'chat' | 'script';

interface ChatState {
  messages: ChatMessage[];
  isStreaming: boolean;
  activeModel: ChatModel;
  rightPanelTab: RightPanelTab;
  error: string | null;
  abortController: AbortController | null;

  sendMessage: (text: string, images?: string[]) => Promise<void>;
  stopStreaming: () => void;
  setModel: (model: ChatModel) => void;
  setRightPanelTab: (tab: RightPanelTab) => void;
  clearChat: () => void;
  updateToolCall: (messageId: string, toolCallId: string, update: Partial<ToolCallStatus>) => void;
}

let messageCounter = 0;
function nextId(): string {
  return `msg_${Date.now()}_${++messageCounter}`;
}

export const useChatStore = create<ChatState>((set, get) => ({
  messages: [],
  isStreaming: false,
  activeModel: 'claude-sonnet-4-5-20250929',
  rightPanelTab: 'inspector',
  error: null,
  abortController: null,

  sendMessage: async (text: string, images?: string[]) => {
    const { messages, activeModel, isStreaming } = get();
    if (isStreaming) return;

    const userMessage: ChatMessage = {
      id: nextId(),
      role: 'user',
      content: text,
      images,
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
    });

    try {
      // Build scene context from editorStore (imported dynamically to avoid circular deps)
      const { useEditorStore } = await import('./editorStore');
      const editorState = useEditorStore.getState();

      const { buildSceneContext } = await import('../lib/chat/context');
      const sceneContext = buildSceneContext(editorState);

      // Prepare conversation history for API
      const allMessages = [...messages, userMessage];
      const apiMessages = allMessages
        .filter((m) => m.role !== 'system')
        .map((m) => {
          if (m.role === 'user' && m.images && m.images.length > 0) {
            return {
              role: m.role as 'user',
              content: [
                ...m.images.map((img) => ({
                  type: 'image' as const,
                  source: { type: 'base64' as const, media_type: 'image/png' as const, data: img.replace(/^data:image\/\w+;base64,/, '') },
                })),
                { type: 'text' as const, text: m.content },
              ],
            };
          }
          return { role: m.role as 'user' | 'assistant', content: m.content };
        });

      const response = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          messages: apiMessages,
          model: activeModel,
          sceneContext,
        }),
        signal: abortController.signal,
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
      // Accumulate partial JSON for tool inputs
      const toolInputBuffers: Record<string, string> = {};

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
            const state = get();
            const msgs = [...state.messages];
            const lastMsg = { ...msgs[msgs.length - 1] };

            switch (event.type) {
              case 'text_delta':
                lastMsg.content += event.text;
                break;

              case 'tool_start': {
                const tc: ToolCallStatus = {
                  id: event.id,
                  name: event.name,
                  input: {},
                  status: 'pending',
                  undoable: true,
                };
                lastMsg.toolCalls = [...(lastMsg.toolCalls || []), tc];
                toolInputBuffers[event.id] = '';
                break;
              }

              case 'tool_input_delta': {
                // Accumulate partial JSON for this tool call
                // Find the active tool call (last pending one)
                const pendingTc = (lastMsg.toolCalls || []).filter((t) => t.status === 'pending');
                if (pendingTc.length > 0) {
                  const activeTc = pendingTc[pendingTc.length - 1];
                  toolInputBuffers[activeTc.id] = (toolInputBuffers[activeTc.id] || '') + event.json;
                }
                break;
              }

              case 'content_block_stop': {
                // A content block finished — if it was a tool_use, parse input and execute
                const pending = (lastMsg.toolCalls || []).filter((t) => t.status === 'pending');
                if (pending.length > 0) {
                  const tc = pending[pending.length - 1];
                  const inputJson = toolInputBuffers[tc.id];
                  let parsedInput: Record<string, unknown> = {};
                  if (inputJson) {
                    try {
                      parsedInput = JSON.parse(inputJson);
                    } catch {
                      // Partial JSON — best effort
                    }
                  }

                  // Update tool call with parsed input
                  tc.input = parsedInput;

                  // Execute the tool call
                  const currentEditorState = (await import('./editorStore')).useEditorStore.getState();
                  const result = await executeToolCall(tc.name, parsedInput, currentEditorState);

                  // Update status
                  const updatedCalls = (lastMsg.toolCalls || []).map((t) =>
                    t.id === tc.id
                      ? {
                          ...t,
                          input: parsedInput,
                          status: result.success ? 'success' as const : 'error' as const,
                          result: result.result,
                          error: result.error,
                        }
                      : t
                  );
                  lastMsg.toolCalls = updatedCalls;
                  delete toolInputBuffers[tc.id];
                }
                break;
              }

              case 'error':
                set({ error: event.message });
                break;

              case 'usage':
                // Could log token usage here
                break;
            }

            msgs[msgs.length - 1] = lastMsg;
            set({ messages: msgs });
          } catch {
            // Skip malformed JSON lines
          }
        }
      }
    } catch (err: unknown) {
      if (err instanceof Error && err.name === 'AbortError') {
        // User cancelled — not an error
      } else {
        set({ error: err instanceof Error ? err.message : 'Chat request failed' });
      }
    } finally {
      set({ isStreaming: false, abortController: null });
    }
  },

  stopStreaming: () => {
    const { abortController } = get();
    if (abortController) {
      abortController.abort();
      set({ isStreaming: false, abortController: null });
    }
  },

  setModel: (model) => set({ activeModel: model }),

  setRightPanelTab: (tab) => set({ rightPanelTab: tab }),

  clearChat: () => set({ messages: [], error: null }),

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
}));
