'use client';

import { useCallback, useState } from 'react';
import { useEditorStore } from '@/stores/editorStore';

export function BridgeToolsSection() {
  const bridgeTools = useEditorStore((s) => s.bridgeTools);
  const setBridgeTool = useEditorStore((s) => s.setBridgeTool);
  const [discovering, setDiscovering] = useState(false);
  const [customPath, setCustomPath] = useState('');

  const handleDiscover = useCallback(async () => {
    setDiscovering(true);
    try {
      const res = await fetch('/api/bridges/discover', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          toolId: 'aseprite',
          customPath: customPath || undefined,
        }),
      });
      const data = await res.json();
      if (data.id) {
        setBridgeTool(data);
      }
    } catch {
      // Discovery failed — UI shows current state
    } finally {
      setDiscovering(false);
    }
  }, [customPath, setBridgeTool]);

  const statusColor = (status: string) => {
    switch (status) {
      case 'connected': return 'text-green-400';
      case 'not_found': return 'text-zinc-500';
      case 'error': return 'text-red-400';
      default: return 'text-zinc-500';
    }
  };

  const statusLabel = (status: string) => {
    switch (status) {
      case 'connected': return 'Connected';
      case 'not_found': return 'Not Found';
      case 'error': return 'Error';
      default: return 'Unknown';
    }
  };

  return (
    <div className="space-y-3">
      <h3 className="text-xs font-semibold uppercase tracking-wide text-zinc-500">
        Bridge Tools
      </h3>

      {Object.values(bridgeTools).length === 0 && (
        <p className="text-xs text-zinc-600">No tools discovered yet.</p>
      )}

      {Object.values(bridgeTools).map((tool) => (
        <div
          key={tool.id}
          className="flex items-center justify-between rounded bg-zinc-800/50 px-3 py-2"
        >
          <div>
            <span className="text-sm text-zinc-200">{tool.name}</span>
            {tool.activeVersion && (
              <span className="ml-2 text-xs text-zinc-500">v{tool.activeVersion}</span>
            )}
          </div>
          <span className={`text-xs ${statusColor(tool.status)}`}>
            {statusLabel(tool.status)}
          </span>
        </div>
      ))}

      <div className="space-y-2">
        <label className="block text-xs text-zinc-400">
          Custom path override (optional)
        </label>
        <input
          type="text"
          value={customPath}
          onChange={(e) => setCustomPath(e.target.value)}
          placeholder="/path/to/aseprite"
          className="w-full rounded bg-zinc-800 px-2 py-1 text-xs text-zinc-200 placeholder-zinc-600"
        />
      </div>

      <button
        onClick={handleDiscover}
        disabled={discovering}
        className="w-full rounded bg-blue-600 px-3 py-1.5 text-xs text-white hover:bg-blue-500 disabled:opacity-50"
      >
        {discovering ? 'Discovering...' : 'Discover Tools'}
      </button>
    </div>
  );
}
