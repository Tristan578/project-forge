'use client';

import { useEffect, useState } from 'react';
import { Key, Plus, Trash2, Eye, EyeOff, Copy, Check } from 'lucide-react';

type Provider = 'anthropic' | 'meshy' | 'hyper3d' | 'elevenlabs' | 'suno';

interface ProviderStatus {
  provider: Provider;
  configured: boolean;
  createdAt: string;
}

interface McpApiKey {
  id: string;
  name: string;
  prefix: string;
  scopes: string[];
  lastUsed: string | null;
  createdAt: string;
}

const PROVIDERS: { id: Provider; label: string; placeholder: string }[] = [
  { id: 'anthropic', label: 'Anthropic (Claude)', placeholder: 'sk-ant-...' },
  { id: 'meshy', label: 'Meshy', placeholder: 'msy_...' },
  { id: 'hyper3d', label: 'Hyper3D / Rodin', placeholder: 'hd_...' },
  { id: 'elevenlabs', label: 'ElevenLabs', placeholder: 'xi_...' },
  { id: 'suno', label: 'Suno', placeholder: 'suno_...' },
];

export function ApiKeyManager() {
  const [providerKeys, setProviderKeys] = useState<ProviderStatus[]>([]);
  const [mcpKeys, setMcpKeys] = useState<McpApiKey[]>([]);
  const [keyInputs, setKeyInputs] = useState<Record<string, string>>({});
  const [showInputs, setShowInputs] = useState<Record<string, boolean>>({});
  const [newMcpKey, setNewMcpKey] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    fetch('/api/keys')
      .then((res) => res.json())
      .then((data) => setProviderKeys(data.providers ?? []))
      .catch(() => {});

    fetch('/api/keys/api-key')
      .then((res) => res.json())
      .then((data) => setMcpKeys(data.keys ?? []))
      .catch(() => {});
  }, []);

  const isConfigured = (provider: Provider) =>
    providerKeys.some((p) => p.provider === provider && p.configured);

  const saveKey = async (provider: Provider) => {
    const key = keyInputs[provider];
    if (!key) return;

    await fetch(`/api/keys/${provider}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ key }),
    });

    setProviderKeys((prev) => [
      ...prev.filter((p) => p.provider !== provider),
      { provider, configured: true, createdAt: new Date().toISOString() },
    ]);
    setKeyInputs((prev) => ({ ...prev, [provider]: '' }));
    setShowInputs((prev) => ({ ...prev, [provider]: false }));
  };

  const removeKey = async (provider: Provider) => {
    await fetch(`/api/keys/${provider}`, { method: 'DELETE' });
    setProviderKeys((prev) => prev.filter((p) => p.provider !== provider));
  };

  const generateMcpKey = async () => {
    const res = await fetch('/api/keys/api-key', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: `Key ${mcpKeys.length + 1}` }),
    });
    const data = await res.json();
    setNewMcpKey(data.key);
    setMcpKeys((prev) => [...prev, data]);
  };

  const revokeMcpKey = async (id: string) => {
    await fetch(`/api/keys/api-key/${id}`, { method: 'DELETE' });
    setMcpKeys((prev) => prev.filter((k) => k.id !== id));
  };

  const copyKey = () => {
    if (newMcpKey) {
      navigator.clipboard.writeText(newMcpKey);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  return (
    <div className="space-y-6 p-4">
      {/* BYOK Provider Keys */}
      <div>
        <h3 className="mb-3 flex items-center gap-2 font-semibold text-[var(--color-text-primary)]">
          <Key size={18} />
          Provider API Keys (BYOK)
        </h3>
        <p className="mb-3 text-xs text-[var(--color-text-secondary)]">
          Add your own API keys to use AI features without spending tokens.
        </p>
        <div className="space-y-2">
          {PROVIDERS.map(({ id, label, placeholder }) => (
            <div
              key={id}
              className="flex items-center gap-2 rounded-md bg-[var(--color-bg-tertiary)] p-2"
            >
              <span className="min-w-[140px] text-sm text-[var(--color-text-primary)]">
                {label}
              </span>
              {isConfigured(id) ? (
                <>
                  <span className="flex-1 text-xs text-green-400">Configured</span>
                  <button
                    onClick={() => removeKey(id)}
                    className="text-red-400 hover:text-red-300"
                    title="Remove key"
                  >
                    <Trash2 size={14} />
                  </button>
                </>
              ) : showInputs[id] ? (
                <>
                  <input
                    type="password"
                    value={keyInputs[id] ?? ''}
                    onChange={(e) =>
                      setKeyInputs((prev) => ({ ...prev, [id]: e.target.value }))
                    }
                    placeholder={placeholder}
                    className="flex-1 rounded border border-[var(--color-border)] bg-[var(--color-bg-primary)] px-2 py-1 text-xs text-[var(--color-text-primary)]"
                  />
                  <button
                    onClick={() => saveKey(id)}
                    className="rounded bg-[var(--color-accent)] px-2 py-1 text-xs text-white"
                  >
                    Save
                  </button>
                </>
              ) : (
                <button
                  onClick={() => setShowInputs((prev) => ({ ...prev, [id]: true }))}
                  className="text-xs text-[var(--color-accent)] hover:underline"
                >
                  Add Key
                </button>
              )}
            </div>
          ))}
        </div>
      </div>

      {/* MCP API Keys */}
      <div>
        <h3 className="mb-3 flex items-center gap-2 font-semibold text-[var(--color-text-primary)]">
          <Key size={18} />
          MCP API Keys
        </h3>
        <p className="mb-3 text-xs text-[var(--color-text-secondary)]">
          API keys for connecting Claude Desktop or other MCP clients to your editor.
        </p>

        {newMcpKey && (
          <div className="mb-3 rounded-md border border-yellow-600 bg-yellow-900/20 p-3">
            <p className="mb-1 text-xs font-semibold text-yellow-400">
              Save this key now — it won&apos;t be shown again!
            </p>
            <div className="flex items-center gap-2">
              <code className="flex-1 rounded bg-[var(--color-bg-primary)] px-2 py-1 text-xs text-[var(--color-text-primary)]">
                {newMcpKey}
              </code>
              <button onClick={copyKey} className="text-yellow-400 hover:text-yellow-300">
                {copied ? <Check size={14} /> : <Copy size={14} />}
              </button>
            </div>
          </div>
        )}

        <div className="space-y-2">
          {mcpKeys.map((key) => (
            <div
              key={key.id}
              className="flex items-center gap-2 rounded-md bg-[var(--color-bg-tertiary)] p-2"
            >
              <span className="text-sm text-[var(--color-text-primary)]">{key.name}</span>
              <code className="text-xs text-[var(--color-text-secondary)]">{key.prefix}...</code>
              <span className="flex-1" />
              {key.lastUsed && (
                <span className="text-xs text-[var(--color-text-secondary)]">
                  Last used: {new Date(key.lastUsed).toLocaleDateString()}
                </span>
              )}
              <button
                onClick={() => revokeMcpKey(key.id)}
                className="text-red-400 hover:text-red-300"
                title="Revoke key"
              >
                <Trash2 size={14} />
              </button>
            </div>
          ))}
        </div>

        <button
          onClick={generateMcpKey}
          className="mt-2 flex items-center gap-1 rounded-md bg-[var(--color-accent)] px-3 py-1.5 text-xs font-medium text-white hover:opacity-90"
        >
          <Plus size={14} />
          Generate API Key
        </button>
      </div>
    </div>
  );
}
