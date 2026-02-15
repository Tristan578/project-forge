'use client';

import { useState, useEffect, useMemo, useCallback } from 'react';
import { BookOpen, Search, ChevronRight, ChevronDown, ArrowLeft, FileText } from 'lucide-react';
import { useWorkspaceStore } from '@/stores/workspaceStore';
import { loadDocsIndex, getCategories, getDocsByCategory, getDocByPath, type DocEntry } from '@/lib/docs/docsIndex';
import { buildClientIndex, searchDocs } from '@/lib/docs/docsSearch';

const CATEGORY_LABELS: Record<string, string> = {
  'getting-started': 'Getting Started',
  features: 'Features',
  guides: 'Guides',
  reference: 'Reference',
  root: 'Overview',
};

const CATEGORY_ORDER = ['root', 'getting-started', 'features', 'guides', 'reference'];

export function DocsPanel() {
  const [docs, setDocs] = useState<DocEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [activePath, setActivePath] = useState<string | null>(null);
  const [expandedCategories, setExpandedCategories] = useState<Set<string>>(new Set(['getting-started', 'features']));
  const [history, setHistory] = useState<string[]>([]);

  const docsPath = useWorkspaceStore((s) => s.docsPath);

  // Load docs on mount
  useEffect(() => {
    loadDocsIndex()
      .then((data) => {
        setDocs(data.docs);
        setLoading(false);
      })
      .catch((err) => {
        setError(err instanceof Error ? err.message : 'Failed to load docs');
        setLoading(false);
      });
  }, []);

  // Navigate when docsPath changes from external source (help buttons)
  const [prevDocsPath, setPrevDocsPath] = useState<string | null>(null);
  if (docsPath !== prevDocsPath) {
    setPrevDocsPath(docsPath);
    if (docsPath && docsPath !== activePath) {
      setActivePath(docsPath);
      setSearchQuery('');
    }
  }

  // Build search index
  const searchIndex = useMemo(() => {
    if (docs.length === 0) return null;
    return buildClientIndex(docs);
  }, [docs]);

  // Debounced search query
  const [debouncedQuery, setDebouncedQuery] = useState('');
  useEffect(() => {
    const timer = setTimeout(() => setDebouncedQuery(searchQuery), 200);
    return () => clearTimeout(timer);
  }, [searchQuery]);

  // Compute search results from debounced query (pure derivation)
  const computedResults = useMemo(() => {
    if (!debouncedQuery.trim() || !searchIndex) return [];
    return searchDocs(debouncedQuery, docs, searchIndex);
  }, [debouncedQuery, docs, searchIndex]);
  // Alias for template compatibility
  const searchResults = computedResults;

  const categories = useMemo(() => {
    const cats = getCategories(docs);
    return CATEGORY_ORDER.filter((c) => cats.includes(c));
  }, [docs]);

  const activeDoc = useMemo(() => {
    if (!activePath) return null;
    return getDocByPath(docs, activePath) ?? null;
  }, [docs, activePath]);

  const navigateTo = useCallback((path: string) => {
    setHistory((h) => [...h, activePath ?? ''].filter(Boolean));
    setActivePath(path);
    setSearchQuery('');
  }, [activePath]);

  const goBack = useCallback(() => {
    const prev = history[history.length - 1];
    setHistory((h) => h.slice(0, -1));
    setActivePath(prev ?? null);
  }, [history]);

  const toggleCategory = useCallback((cat: string) => {
    setExpandedCategories((prev) => {
      const next = new Set(prev);
      if (next.has(cat)) next.delete(cat);
      else next.add(cat);
      return next;
    });
  }, []);

  if (loading) {
    return (
      <div className="flex h-full items-center justify-center bg-zinc-900">
        <p className="text-xs text-zinc-500">Loading documentation...</p>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex h-full flex-col items-center justify-center bg-zinc-900 p-4">
        <BookOpen size={24} className="mb-2 text-zinc-600" />
        <p className="text-xs text-red-400">{error}</p>
        <p className="mt-1 text-[10px] text-zinc-600">Documentation is available when running the dev server</p>
      </div>
    );
  }

  // Document view
  if (activeDoc) {
    return (
      <div className="flex h-full flex-col bg-zinc-900 text-xs">
        {/* Header */}
        <div className="flex items-center gap-2 border-b border-zinc-800 px-2 py-1.5">
          <button
            onClick={goBack}
            className="rounded p-0.5 text-zinc-500 hover:bg-zinc-700 hover:text-zinc-300"
            title="Back"
          >
            <ArrowLeft size={14} />
          </button>
          <span className="text-[10px] text-zinc-600">{activeDoc.category}</span>
          <ChevronRight size={10} className="text-zinc-700" />
          <span className="truncate font-medium text-zinc-300">{activeDoc.title}</span>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto px-3 py-2">
          <div className="prose prose-invert prose-xs max-w-none">
            <MarkdownContent content={activeDoc.content} />
          </div>
        </div>
      </div>
    );
  }

  // Browse/search view
  return (
    <div className="flex h-full flex-col bg-zinc-900 text-xs">
      {/* Header */}
      <div className="flex items-center gap-1.5 border-b border-zinc-800 px-2 py-1.5">
        <BookOpen size={13} className="text-blue-400" />
        <span className="font-medium text-zinc-300">Documentation</span>
      </div>

      {/* Search */}
      <div className="border-b border-zinc-800 px-2 py-1">
        <div className="flex items-center gap-1 rounded bg-zinc-800 px-1.5 py-1">
          <Search size={11} className="text-zinc-500" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search docs..."
            className="flex-1 bg-transparent text-xs text-zinc-300 placeholder:text-zinc-600 outline-none"
          />
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto">
        {searchResults.length > 0 ? (
          <div className="px-1 py-1">
            {searchResults.map((result) => (
              <button
                key={result.path}
                onClick={() => navigateTo(result.path)}
                className="flex w-full flex-col rounded px-2 py-1.5 text-left hover:bg-zinc-800"
              >
                <div className="flex items-center gap-1">
                  <FileText size={11} className="text-blue-400" />
                  <span className="font-medium text-zinc-300">{result.title}</span>
                  <span className="text-[10px] text-zinc-600">({result.score})</span>
                </div>
                {result.matchSection && (
                  <span className="text-[10px] text-zinc-500">in: {result.matchSection}</span>
                )}
                <span className="mt-0.5 text-[10px] text-zinc-600 line-clamp-2">{result.snippet}</span>
              </button>
            ))}
          </div>
        ) : searchQuery ? (
          <div className="flex flex-col items-center gap-2 px-3 py-8 text-zinc-600">
            <Search size={24} />
            <span>No results for &quot;{searchQuery}&quot;</span>
          </div>
        ) : (
          <div className="py-1">
            {categories.map((cat) => {
              const catDocs = getDocsByCategory(docs, cat);
              const isExpanded = expandedCategories.has(cat);
              return (
                <div key={cat}>
                  <button
                    onClick={() => toggleCategory(cat)}
                    className="flex w-full items-center gap-1 px-2 py-1.5 text-left font-medium text-zinc-400 hover:text-zinc-300"
                  >
                    {isExpanded ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
                    {CATEGORY_LABELS[cat] ?? cat}
                    <span className="text-[10px] text-zinc-600">({catDocs.length})</span>
                  </button>
                  {isExpanded && (
                    <div className="ml-2">
                      {catDocs.map((doc) => (
                        <button
                          key={doc.path}
                          onClick={() => navigateTo(doc.path)}
                          className="flex w-full items-center gap-1.5 rounded px-2 py-1 text-left text-zinc-500 hover:bg-zinc-800 hover:text-zinc-300"
                        >
                          <FileText size={11} />
                          <span className="truncate">{doc.title}</span>
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

/** Simple markdown renderer — renders basic markdown as HTML-like elements */
function MarkdownContent({ content }: { content: string }) {
  const lines = content.split('\n');
  const elements: React.ReactNode[] = [];
  let inCodeBlock = false;
  let codeLines: string[] = [];
  let codeKey = 0;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    if (line.startsWith('```')) {
      if (inCodeBlock) {
        elements.push(
          <pre key={`code-${codeKey++}`} className="my-2 overflow-x-auto rounded bg-zinc-800 p-2 text-[10px] text-zinc-400">
            <code>{codeLines.join('\n')}</code>
          </pre>
        );
        codeLines = [];
        inCodeBlock = false;
      } else {
        inCodeBlock = true;
      }
      continue;
    }

    if (inCodeBlock) {
      codeLines.push(line);
      continue;
    }

    if (line.startsWith('# ')) {
      elements.push(<h1 key={i} className="mb-2 mt-4 text-base font-bold text-zinc-200">{line.slice(2)}</h1>);
    } else if (line.startsWith('## ')) {
      elements.push(<h2 key={i} className="mb-1.5 mt-3 text-sm font-semibold text-zinc-300">{line.slice(3)}</h2>);
    } else if (line.startsWith('### ')) {
      elements.push(<h3 key={i} className="mb-1 mt-2 text-xs font-semibold text-zinc-400">{line.slice(4)}</h3>);
    } else if (line.startsWith('- ') || line.startsWith('* ')) {
      elements.push(
        <div key={i} className="ml-3 flex gap-1 text-zinc-400">
          <span className="text-zinc-600">•</span>
          <span>{formatInline(line.slice(2))}</span>
        </div>
      );
    } else if (line.match(/^\d+\.\s/)) {
      const num = line.match(/^(\d+)\.\s(.*)/)!;
      elements.push(
        <div key={i} className="ml-3 flex gap-1 text-zinc-400">
          <span className="text-zinc-600">{num[1]}.</span>
          <span>{formatInline(num[2])}</span>
        </div>
      );
    } else if (line.trim() === '') {
      elements.push(<div key={i} className="h-2" />);
    } else {
      elements.push(<p key={i} className="text-zinc-400">{formatInline(line)}</p>);
    }
  }

  return <>{elements}</>;
}

/** Format inline markdown (bold, italic, code, links) */
function formatInline(text: string): React.ReactNode {
  // Simple regex-based inline formatting
  const parts: React.ReactNode[] = [];
  let remaining = text;
  let key = 0;

  while (remaining) {
    // Inline code
    const codeMatch = remaining.match(/^(.*?)`([^`]+)`(.*)/);
    if (codeMatch) {
      if (codeMatch[1]) parts.push(codeMatch[1]);
      parts.push(<code key={key++} className="rounded bg-zinc-800 px-1 py-0.5 text-[10px] text-blue-400">{codeMatch[2]}</code>);
      remaining = codeMatch[3];
      continue;
    }

    // Bold
    const boldMatch = remaining.match(/^(.*?)\*\*([^*]+)\*\*(.*)/);
    if (boldMatch) {
      if (boldMatch[1]) parts.push(boldMatch[1]);
      parts.push(<strong key={key++} className="font-semibold text-zinc-300">{boldMatch[2]}</strong>);
      remaining = boldMatch[3];
      continue;
    }

    parts.push(remaining);
    break;
  }

  return parts.length === 1 ? parts[0] : <>{parts}</>;
}
