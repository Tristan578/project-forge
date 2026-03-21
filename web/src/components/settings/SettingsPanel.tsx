'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { Settings, Coins, Key, CreditCard, X } from 'lucide-react';
import { TokenDashboard } from './TokenDashboard';
import { ApiKeyManager } from './ApiKeyManager';
import { BillingTab } from './BillingTab';

type Tab = 'tokens' | 'keys' | 'billing';

const TAB_ORDER: Tab[] = ['tokens', 'keys', 'billing'];

interface SettingsPanelProps {
  onClose: () => void;
}

export function SettingsPanel({ onClose }: SettingsPanelProps) {
  const [activeTab, setActiveTab] = useState<Tab>('tokens');
  const dialogRef = useRef<HTMLDivElement>(null);

  // Close on Escape + focus trap
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        onClose();
        return;
      }
      if (e.key === 'Tab') {
        const dialog = dialogRef.current;
        if (!dialog) return;
        const focusable = dialog.querySelectorAll<HTMLElement>(
          'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
        );
        if (focusable.length === 0) return;
        const first = focusable[0];
        const last = focusable[focusable.length - 1];
        if (e.shiftKey) {
          if (document.activeElement === first) { e.preventDefault(); last.focus(); }
        } else {
          if (document.activeElement === last) { e.preventDefault(); first.focus(); }
        }
      }
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [onClose]);

  // Auto-focus dialog on open
  useEffect(() => {
    dialogRef.current?.focus();
  }, []);

  const handleTabKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      const idx = TAB_ORDER.indexOf(activeTab);
      if (e.key === 'ArrowRight') {
        e.preventDefault();
        setActiveTab(TAB_ORDER[(idx + 1) % TAB_ORDER.length]);
      } else if (e.key === 'ArrowLeft') {
        e.preventDefault();
        setActiveTab(TAB_ORDER[(idx - 1 + TAB_ORDER.length) % TAB_ORDER.length]);
      } else if (e.key === 'Home') {
        e.preventDefault();
        setActiveTab(TAB_ORDER[0]);
      } else if (e.key === 'End') {
        e.preventDefault();
        setActiveTab(TAB_ORDER[TAB_ORDER.length - 1]);
      }
    },
    [activeTab]
  );

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/70" onClick={onClose}>
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="settings-dialog-title"
        tabIndex={-1}
        className="h-[600px] w-[500px] overflow-hidden rounded-lg border border-zinc-700 bg-zinc-900 shadow-2xl focus:outline-none"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between border-b border-zinc-700 px-4 py-3">
          <div className="flex items-center gap-2">
            <Settings size={18} className="text-zinc-400" />
            <h2 id="settings-dialog-title" className="font-semibold text-zinc-200">Settings</h2>
          </div>
          <button
            onClick={onClose}
            aria-label="Close"
            className="rounded p-0.5 text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800 transition-colors"
          >
            <X size={18} />
          </button>
        </div>

        {/* Tabs */}
        <div role="tablist" aria-label="Settings tabs" onKeyDown={handleTabKeyDown} className="flex border-b border-zinc-700">
          <button
            role="tab"
            id="settings-tab-tokens"
            aria-selected={activeTab === 'tokens'}
            aria-controls="settings-tabpanel-tokens"
            tabIndex={activeTab === 'tokens' ? 0 : -1}
            onClick={() => setActiveTab('tokens')}
            className={`flex items-center gap-1.5 px-4 py-2 text-sm transition-colors ${
              activeTab === 'tokens'
                ? 'border-b-2 border-blue-500 text-zinc-200'
                : 'text-zinc-400 hover:text-zinc-300'
            }`}
          >
            <Coins size={14} />
            Tokens
          </button>
          <button
            role="tab"
            id="settings-tab-keys"
            aria-selected={activeTab === 'keys'}
            aria-controls="settings-tabpanel-keys"
            tabIndex={activeTab === 'keys' ? 0 : -1}
            onClick={() => setActiveTab('keys')}
            className={`flex items-center gap-1.5 px-4 py-2 text-sm transition-colors ${
              activeTab === 'keys'
                ? 'border-b-2 border-blue-500 text-zinc-200'
                : 'text-zinc-400 hover:text-zinc-300'
            }`}
          >
            <Key size={14} />
            API Keys
          </button>
          <button
            role="tab"
            id="settings-tab-billing"
            aria-selected={activeTab === 'billing'}
            aria-controls="settings-tabpanel-billing"
            tabIndex={activeTab === 'billing' ? 0 : -1}
            onClick={() => setActiveTab('billing')}
            className={`flex items-center gap-1.5 px-4 py-2 text-sm transition-colors ${
              activeTab === 'billing'
                ? 'border-b-2 border-blue-500 text-zinc-200'
                : 'text-zinc-400 hover:text-zinc-300'
            }`}
          >
            <CreditCard size={14} />
            Billing
          </button>
        </div>

        {/* Content */}
        <div
          role="tabpanel"
          id={`settings-tabpanel-${activeTab}`}
          aria-labelledby={`settings-tab-${activeTab}`}
          className="h-[calc(100%-100px)] overflow-y-auto"
        >
          {activeTab === 'tokens' && <TokenDashboard />}
          {activeTab === 'keys' && <ApiKeyManager />}
          {activeTab === 'billing' && <BillingTab />}
        </div>
      </div>
    </div>
  );
}
