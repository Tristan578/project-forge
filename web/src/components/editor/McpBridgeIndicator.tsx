'use client';

/**
 * The visible half of the MCP editor bridge (#9293).
 *
 * The bridge hands a process outside the browser the editor's command
 * handlers. Two things follow, and both live here rather than in the hook:
 *   - nothing attaches until the person at the keyboard says so. A URL is
 *     shareable and a token can be pasted by someone else, so `?mcp=<token>`
 *     is a request, not consent.
 *   - once attached, the tab says so permanently and offers one click to stop.
 *     An attached tab that looks exactly like an ordinary one is the failure
 *     mode worth designing against.
 *
 * Rendered only when the tab actually asked for the bridge, behind a lazy
 * import, so neither this component nor the hook is in the editor's eager
 * chunk on the ordinary path.
 */
import { useSyncExternalStore } from 'react';
import { Button } from '@spawnforge/ui';
import { useEditorBridge, type BridgeStatus } from '@/lib/mcp/useEditorBridge';
import {
  subscribeBridgeActivity,
  getLastBridgeActivity,
  noBridgeActivityOnServer,
  type BridgeOutcome,
} from '@/lib/mcp/bridgeActivity';

const OUTCOME: Record<BridgeOutcome, string> = {
  ran: 'ran',
  failed: 'failed',
  refused: 'refused',
};

const LABEL: Record<BridgeStatus, string> = {
  'off': 'MCP bridge off',
  'awaiting-consent': 'MCP bridge requested',
  'connecting': 'MCP bridge connecting',
  'attached': 'MCP bridge attached',
  'reconnecting': 'MCP bridge reconnecting',
  'refused': 'MCP bridge refused',
  'detached': 'MCP bridge detached',
};

const DOT: Record<BridgeStatus, string> = {
  'off': 'bg-neutral-500',
  'awaiting-consent': 'bg-amber-400',
  'connecting': 'bg-amber-400',
  'attached': 'bg-emerald-400',
  'reconnecting': 'bg-amber-400',
  'refused': 'bg-red-500',
  'detached': 'bg-neutral-500',
};

export function McpBridgeIndicator() {
  const { status, detail, approve, detach } = useEditorBridge();
  const activity = useSyncExternalStore(
    subscribeBridgeActivity,
    getLastBridgeActivity,
    noBridgeActivityOnServer,
  );
  if (status === 'off') return null;

  if (status === 'awaiting-consent') {
    return (
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="mcp-bridge-consent-title"
        className="fixed inset-0 z-[100] flex items-center justify-center bg-black/60 p-4"
      >
        <div className="max-w-md rounded-lg border border-neutral-700 bg-neutral-900 p-6 text-sm text-neutral-200 shadow-xl">
          <h2 id="mcp-bridge-consent-title" className="mb-2 text-base font-semibold text-white">
            Let an MCP client control this editor?
          </h2>
          <p className="mb-3">
            This tab was opened with an MCP bridge token. If you allow it, a program running on this
            machine can create, modify and delete objects in the open scene, exactly as if it were
            typing in the editor.
          </p>
          <p className="mb-4 text-neutral-400">
            It cannot spend generation tokens, publish or export the project, or author scripts.
            You can stop it at any time. If you did not start an MCP client yourself, choose Cancel.
          </p>
          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={detach}>
              Cancel
            </Button>
            <Button onClick={approve}>Allow this tab</Button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div
      role="status"
      aria-live="polite"
      title={detail ?? undefined}
      className="fixed bottom-3 left-3 z-50 flex items-center gap-2 rounded-full border border-neutral-700 bg-neutral-900/95 px-3 py-1.5 text-xs text-neutral-200 shadow-lg"
    >
      <span aria-hidden="true" className={`h-2 w-2 rounded-full ${DOT[status]}`} />
      <span>{LABEL[status]}</span>
      {activity && (
        <span className="text-neutral-400" data-testid="mcp-bridge-activity">
          {`${OUTCOME[activity.outcome]} ${activity.name}`}
        </span>
      )}
      {(status === 'attached' || status === 'connecting' || status === 'reconnecting') && (
        <button
          type="button"
          onClick={detach}
          className="rounded px-1.5 py-0.5 underline underline-offset-2 hover:bg-neutral-800 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-400"
        >
          Detach
        </button>
      )}
    </div>
  );
}
