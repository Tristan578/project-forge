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
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60">
      <div className="h-[600px] w-[500px] overflow-hidden rounded-lg bg-[var(--color-bg-secondary)] shadow-xl">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-[var(--color-border)] px-4 py-3">
          <div className="flex items-center gap-2">
            <Settings size={18} className="text-[var(--color-text-secondary)]" />
            <h2 className="font-semibold text-[var(--color-text-primary)]">Settings</h2>
          </div>
          <button
            onClick={onClose}
            className="text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)]"
          >
            <X size={18} />
          </button>
        </div>

        {/* Tabs */}
        <div className="flex border-b border-[var(--color-border)]">
          <button
            onClick={() => setActiveTab('tokens')}
            className={`flex items-center gap-1.5 px-4 py-2 text-sm ${
              activeTab === 'tokens'
                ? 'border-b-2 border-[var(--color-accent)] text-[var(--color-text-primary)]'
                : 'text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)]'
            }`}
          >
            <Coins size={14} />
            Tokens
          </button>
          <button
            onClick={() => setActiveTab('keys')}
            className={`flex items-center gap-1.5 px-4 py-2 text-sm ${
              activeTab === 'keys'
                ? 'border-b-2 border-[var(--color-accent)] text-[var(--color-text-primary)]'
                : 'text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)]'
            }`}
          >
            <Key size={14} />
            API Keys
          </button>
          <button
            onClick={() => setActiveTab('billing')}
            className={`flex items-center gap-1.5 px-4 py-2 text-sm ${
              activeTab === 'billing'
                ? 'border-b-2 border-[var(--color-accent)] text-[var(--color-text-primary)]'
                : 'text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)]'
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
