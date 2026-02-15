'use client';

import { useState } from 'react';
import { Settings, Coins, Key, CreditCard, X } from 'lucide-react';
import { TokenDashboard } from './TokenDashboard';
import { ApiKeyManager } from './ApiKeyManager';
import { BillingTab } from './BillingTab';

type Tab = 'tokens' | 'keys' | 'billing';

interface SettingsPanelProps {
  onClose: () => void;
}

export function SettingsPanel({ onClose }: SettingsPanelProps) {
  const [activeTab, setActiveTab] = useState<Tab>('tokens');

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/70">
      <div className="h-[600px] w-[500px] overflow-hidden rounded-lg border border-zinc-700 bg-zinc-900 shadow-2xl">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-zinc-700 px-4 py-3">
          <div className="flex items-center gap-2">
            <Settings size={18} className="text-zinc-400" />
            <h2 className="font-semibold text-zinc-200">Settings</h2>
          </div>
          <button
            onClick={onClose}
            className="rounded p-0.5 text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800 transition-colors"
          >
            <X size={18} />
          </button>
        </div>

        {/* Tabs */}
        <div className="flex border-b border-zinc-700">
          <button
            onClick={() => setActiveTab('tokens')}
            className={`flex items-center gap-1.5 px-4 py-2 text-sm transition-colors ${
              activeTab === 'tokens'
                ? 'border-b-2 border-blue-500 text-zinc-200'
                : 'text-zinc-500 hover:text-zinc-300'
            }`}
          >
            <Coins size={14} />
            Tokens
          </button>
          <button
            onClick={() => setActiveTab('keys')}
            className={`flex items-center gap-1.5 px-4 py-2 text-sm transition-colors ${
              activeTab === 'keys'
                ? 'border-b-2 border-blue-500 text-zinc-200'
                : 'text-zinc-500 hover:text-zinc-300'
            }`}
          >
            <Key size={14} />
            API Keys
          </button>
          <button
            onClick={() => setActiveTab('billing')}
            className={`flex items-center gap-1.5 px-4 py-2 text-sm transition-colors ${
              activeTab === 'billing'
                ? 'border-b-2 border-blue-500 text-zinc-200'
                : 'text-zinc-500 hover:text-zinc-300'
            }`}
          >
            <CreditCard size={14} />
            Billing
          </button>
        </div>

        {/* Content */}
        <div className="h-[calc(100%-100px)] overflow-y-auto">
          {activeTab === 'tokens' && <TokenDashboard />}
          {activeTab === 'keys' && <ApiKeyManager />}
          {activeTab === 'billing' && <BillingTab />}
        </div>
      </div>
    </div>
  );
}
