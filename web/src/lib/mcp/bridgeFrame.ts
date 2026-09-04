/**
 * Executing one inbound relay frame (#9293).
 *
 * Split out of useEditorBridge so it can be reached through a dynamic import:
 * it pulls in the chat executor's handler registry and the 351-entry command
 * manifest, neither of which belongs in the editor's eager chunk for the
 * overwhelming majority of tabs that never opt into the bridge.
 */
import { useEditorStore } from '@/stores/editorStore';
import { executeToolCall } from '@/lib/chat/executor';
import { bridgeVerdict } from './bridgeAllowlist';

interface CommandFrame {
  type: 'command';
  requestId: string;
  name: string;
  payload?: Record<string, unknown>;
}

function isCommandFrame(value: unknown): value is CommandFrame {
  return (
    typeof value === 'object' &&
    value !== null &&
    (value as CommandFrame).type === 'command' &&
    typeof (value as CommandFrame).requestId === 'string' &&
    typeof (value as CommandFrame).name === 'string'
  );
}

/**
 * Handle one inbound frame. Every `command` frame is answered with exactly one
 * `command_result` carrying its requestId; anything else is ignored, and
 * nothing throws out of the socket handler.
 */
export async function handleBridgeFrame(
  raw: string,
  send: (frame: Record<string, unknown>) => void,
): Promise<void> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return; // malformed: ignore, never throw out of the socket handler
  }
  if (!isCommandFrame(parsed)) return;
  const { requestId, name } = parsed;
  const verdict = bridgeVerdict(name);
  if (!verdict.allowed) {
    send({ type: 'command_result', requestId, error: verdict.reason });
    return;
  }
  const result = await executeToolCall(name, parsed.payload ?? {}, useEditorStore.getState());
  if (result.success) {
    send({ type: 'command_result', requestId, result });
  } else {
    send({ type: 'command_result', requestId, error: result.error ?? `'${name}' failed` });
  }
}
