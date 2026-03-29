'use client';

import { useState, useCallback } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { User, Coins, Key, CreditCard, AlertTriangle, ArrowLeft } from 'lucide-react';
import { ProfileTab } from './ProfileTab';
import { TokenDashboard } from './TokenDashboard';
import { ApiKeyManager } from './ApiKeyManager';
import { BillingTab } from './BillingTab';
import { AccountTab } from './AccountTab';

type Tab = 'profile' | 'tokens' | 'keys' | 'billing' | 'account';

const TABS: { id: Tab; label: string; icon: React.ReactNode }[] = [
  { id: 'profile', label: 'Profile', icon: <User size={16} /> },
  { id: 'tokens', label: 'Tokens', icon: <Coins size={16} /> },
  { id: 'keys', label: 'API Keys', icon: <Key size={16} /> },
  { id: 'billing', label: 'Billing', icon: <CreditCard size={16} /> },
  { id: 'account', label: 'Account', icon: <AlertTriangle size={16} /> },
];

const VALID_TABS = new Set<string>(TABS.map((t) => t.id));

export function SettingsPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const tabParam = searchParams.get('tab');
  const initialTab: Tab = tabParam && VALID_TABS.has(tabParam) ? (tabParam as Tab) : 'profile';
  const [activeTab, setActiveTab] = useState<Tab>(initialTab);

  const handleTabChange = useCallback(
    (tab: Tab) => {
      setActiveTab(tab);
      const params = new URLSearchParams(searchParams.toString());
      if (tab === 'profile') {
        params.delete('tab');
      } else {
        params.set('tab', tab);
      }
      const qs = params.toString();
      router.replace(`/settings${qs ? `?${qs}` : ''}`, { scroll: false });
    },
    [router, searchParams]
  );

  const renderContent = () => {
    switch (activeTab) {
      case 'profile': return <ProfileTab />;
      case 'tokens': return <TokenDashboard />;
      case 'keys': return <ApiKeyManager />;
      case 'billing': return <BillingTab />;
      case 'account': return <AccountTab />;
    }
  };

  return (
    <div className="min-h-screen bg-zinc-950 text-zinc-200">
      {/* Header */}
      <div className="border-b border-zinc-800 bg-zinc-900">
        <div className="mx-auto flex max-w-5xl items-center gap-4 px-6 py-4">
          <button
            onClick={() => router.push('/dashboard')}
            className="rounded p-1.5 text-zinc-400 hover:bg-zinc-800 hover:text-zinc-200 transition-colors"
            aria-label="Back to dashboard"
          >
            <ArrowLeft size={20} />
          </button>
          <h1 className="text-xl font-semibold">Settings</h1>
        </div>
      </div>

      <div className="mx-auto max-w-5xl px-6 py-8">
        {/* Desktop: two-column layout */}
        <div className="hidden md:flex md:gap-8">
          {/* Sidebar tabs
               Note: These use <button> elements rather than <a> tags because the
               Settings page is a single-page component where tab changes update
               the URL via router.replace() (no full page navigation). The tabs
               are wrapped in a <nav> with aria-label for landmark semantics, and
               each button has visible focus styles and keyboard accessibility. */}
          <nav className="w-48 shrink-0 space-y-1" aria-label="Settings navigation">
            {TABS.map((tab) => (
              <button
                key={tab.id}
                onClick={() => handleTabChange(tab.id)}
                aria-current={activeTab === tab.id ? 'page' : undefined}
                className={`flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-sm font-medium transition-colors ${
                  activeTab === tab.id
                    ? 'bg-zinc-800 text-zinc-100'
                    : 'text-zinc-400 hover:bg-zinc-800/50 hover:text-zinc-200'
                }`}
              >
                {tab.icon}
                {tab.label}
              </button>
            ))}
          </nav>

          {/* Content */}
          <div className="min-w-0 flex-1 rounded-lg border border-zinc-800 bg-zinc-900">
            {renderContent()}
          </div>
        </div>

        {/* Mobile: horizontal tabs */}
        <div className="md:hidden">
          <div className="mb-4 flex gap-1 overflow-x-auto border-b border-zinc-800 pb-px">
            {TABS.map((tab) => (
              <button
                key={tab.id}
                onClick={() => handleTabChange(tab.id)}
                aria-current={activeTab === tab.id ? 'page' : undefined}
                className={`flex shrink-0 items-center gap-1.5 px-3 py-2 text-sm font-medium transition-colors ${
                  activeTab === tab.id
                    ? 'border-b-2 border-blue-500 text-zinc-100'
                    : 'text-zinc-400 hover:text-zinc-300'
                }`}
              >
                {tab.icon}
                {tab.label}
              </button>
            ))}
          </div>
          <div className="rounded-lg border border-zinc-800 bg-zinc-900">
            {renderContent()}
          </div>
        </div>
      </div>
    </div>
  );
}
