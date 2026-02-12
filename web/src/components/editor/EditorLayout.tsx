'use client';

import { Sidebar } from './Sidebar';
import { CanvasArea } from './CanvasArea';
import { AssetPanel } from './AssetPanel';
import { AudioMixerPanel } from './AudioMixerPanel';
import { SceneHierarchy } from './SceneHierarchy';
import { InspectorPanel } from './InspectorPanel';
import { ScriptEditorPanel } from './ScriptEditorPanel';
import { PlayControls } from './PlayControls';
import { SceneToolbar } from './SceneToolbar';
import { TokenBalance } from '../settings/TokenBalance';
import { ChatPanel } from '../chat/ChatPanel';
import { useChatStore, type RightPanelTab } from '@/stores/chatStore';
import { useEditorStore } from '@/stores/editorStore';
import { UserButton } from '@clerk/nextjs';

function RightPanelTabs({ activeTab, onTabChange }: { activeTab: RightPanelTab; onTabChange: (tab: RightPanelTab) => void }) {
  return (
    <div className="flex border-b border-zinc-800">
      <button
        onClick={() => onTabChange('inspector')}
        className={`flex-1 px-2 py-1.5 text-[10px] font-medium uppercase tracking-wider transition-colors ${
          activeTab === 'inspector'
            ? 'border-b border-blue-500 text-zinc-200'
            : 'text-zinc-600 hover:text-zinc-400'
        }`}
      >
        Inspector
      </button>
      <button
        onClick={() => onTabChange('chat')}
        className={`flex-1 px-2 py-1.5 text-[10px] font-medium uppercase tracking-wider transition-colors ${
          activeTab === 'chat'
            ? 'border-b border-purple-500 text-zinc-200'
            : 'text-zinc-600 hover:text-zinc-400'
        }`}
      >
        AI Chat
      </button>
      <button
        onClick={() => onTabChange('script')}
        className={`flex-1 px-2 py-1.5 text-[10px] font-medium uppercase tracking-wider transition-colors ${
          activeTab === 'script'
            ? 'border-b border-green-500 text-zinc-200'
            : 'text-zinc-600 hover:text-zinc-400'
        }`}
      >
        Script
      </button>
    </div>
  );
}

export function EditorLayout() {
  const rightPanelTab = useChatStore((s) => s.rightPanelTab);
  const setRightPanelTab = useChatStore((s) => s.setRightPanelTab);
  const mixerPanelOpen = useEditorStore((s) => s.mixerPanelOpen);

  return (
    <div className="grid h-screen w-screen grid-cols-[56px_240px_1fr_280px] grid-rows-[32px_1fr_160px] bg-zinc-950">
      {/* Top bar */}
      <div className="col-span-4 flex items-center justify-between border-b border-zinc-800 bg-zinc-900 px-3">
        <div className="flex items-center gap-3">
          <span className="text-xs font-semibold text-zinc-400">Project Forge</span>
          <SceneToolbar />
        </div>
        <PlayControls />
        <div className="flex items-center gap-3">
          <TokenBalance />
          <UserButton afterSignOutUrl="/sign-in" />
        </div>
      </div>

      {/* Tool sidebar */}
      <Sidebar />

      {/* Scene hierarchy panel */}
      <div className="border-r border-zinc-800 bg-zinc-900 overflow-hidden">
        <SceneHierarchy />
      </div>

      {/* Main canvas */}
      <CanvasArea />

      {/* Right panel: Inspector / Chat tabs */}
      <div className="flex flex-col border-l border-zinc-800 bg-zinc-900 overflow-hidden">
        <RightPanelTabs activeTab={rightPanelTab} onTabChange={setRightPanelTab} />
        <div className="flex-1 overflow-hidden">
          {rightPanelTab === 'inspector' ? <InspectorPanel /> : rightPanelTab === 'script' ? <ScriptEditorPanel /> : <ChatPanel />}
        </div>
      </div>

      {/* Bottom panel: Asset panel or Audio mixer */}
      <div className="col-span-4">
        {mixerPanelOpen ? <AudioMixerPanel /> : <AssetPanel />}
      </div>
    </div>
  );
}
