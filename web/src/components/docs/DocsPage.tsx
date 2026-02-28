'use client';

import { useState, useEffect, useMemo, useCallback } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import {
  BookOpen,
  Search,
  ChevronRight,
  ChevronDown,
  ArrowLeft,
  FileText,
  Home,
} from 'lucide-react';
import {
  loadDocsIndex,
  getCategories,
  getDocsByCategory,
  getDocByPath,
  type DocEntry,
} from '@/lib/docs/docsIndex';
import { buildClientIndex, searchDocs } from '@/lib/docs/docsSearch';

const CATEGORY_LABELS: Record<string, string> = {
  'getting-started': 'Getting Started',
  features: 'Features',
  guides: 'Guides',
  reference: 'Reference',
  root: 'Overview',
};

const CATEGORY_ORDER = ['root', 'getting-started', 'features', 'guides', 'reference'];

export function DocsPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const pathParam = searchParams.get('path');

  const [docs, setDocs] = useState<DocEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [activePath, setActivePath] = useState<string | null>(pathParam);
  const [expandedCategories, setExpandedCategories] = useState<Set<string>>(
    new Set(CATEGORY_ORDER)
  );

  // Sync URL param to active path
  const [prevPathParam, setPrevPathParam] = useState<string | null>(pathParam);
  if (pathParam !== prevPathParam) {
    setPrevPathParam(pathParam);
    setActivePath(pathParam);
  }

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

  // Build search index
  const searchIndex = useMemo(() => {
    if (docs.length === 0) return null;
    return buildClientIndex(docs);
  }, [docs]);

  // Debounced search
  const [debouncedQuery, setDebouncedQuery] = useState('');
  useEffect(() => {
    const timer = setTimeout(() => setDebouncedQuery(searchQuery), 200);
    return () => clearTimeout(timer);
  }, [searchQuery]);

  const searchResults = useMemo(() => {
    if (!debouncedQuery.trim() || !searchIndex) return [];
    return searchDocs(debouncedQuery, docs, searchIndex);
  }, [debouncedQuery, docs, searchIndex]);

  const categories = useMemo(() => {
    const cats = getCategories(docs);
    return CATEGORY_ORDER.filter((c) => cats.includes(c));
  }, [docs]);

  const activeDoc = useMemo(() => {
    if (!activePath) return null;
    return getDocByPath(docs, activePath) ?? null;
  }, [docs, activePath]);

  const navigateTo = useCallback(
    (path: string) => {
      setActivePath(path);
      setSearchQuery('');
      const params = new URLSearchParams(searchParams.toString());
      params.set('path', path);
      router.replace(`/docs?${params.toString()}`, { scroll: false });
    },
    [router, searchParams]
  );

  const goHome = useCallback(() => {
    setActivePath(null);
    setSearchQuery('');
    router.replace('/docs', { scroll: false });
  }, [router]);

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
      <div className="flex min-h-screen items-center justify-center bg-zinc-950 text-zinc-400">
        Loading documentation...
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center bg-zinc-950 p-4">
        <BookOpen size={32} className="mb-3 text-zinc-600" />
        <p className="text-sm text-red-400">{error}</p>
        <p className="mt-2 text-xs text-zinc-600">
          Documentation is available when running the dev server.
        </p>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-zinc-950 text-zinc-200">
      {/* Header */}
      <div className="border-b border-zinc-800 bg-zinc-900">
        <div className="mx-auto flex max-w-7xl items-center gap-4 px-6 py-4">
          <button
            onClick={() => router.push('/dashboard')}
            className="rounded p-1.5 text-zinc-400 transition-colors hover:bg-zinc-800 hover:text-zinc-200"
            aria-label="Back to dashboard"
          >
            <ArrowLeft size={20} />
          </button>
          <div className="flex items-center gap-2">
            <BookOpen size={20} className="text-blue-400" />
            <h1 className="text-xl font-semibold">Documentation</h1>
          </div>
        </div>
      </div>

      <div className="mx-auto max-w-7xl px-6 py-8">
        {/* Desktop: two-column layout */}
        <div className="hidden md:flex md:gap-8">
          {/* Sidebar */}
          <nav className="w-64 shrink-0" aria-label="Documentation navigation">
            {/* Search */}
            <div className="mb-4">
              <div className="flex items-center gap-2 rounded-lg border border-zinc-800 bg-zinc-900 px-3 py-2">
                <Search size={14} className="text-zinc-500" />
                <input
                  type="text"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder="Search docs..."
                  className="flex-1 bg-transparent text-sm text-zinc-300 outline-none placeholder:text-zinc-600"
                />
              </div>
            </div>

            {/* Search results */}
            {searchResults.length > 0 ? (
              <div className="space-y-1">
                {searchResults.map((result) => (
                  <button
                    key={result.path}
                    onClick={() => navigateTo(result.path)}
                    className="flex w-full flex-col rounded-lg px-3 py-2 text-left transition-colors hover:bg-zinc-800"
                  >
                    <div className="flex items-center gap-1.5">
                      <FileText size={12} className="text-blue-400" />
                      <span className="text-sm font-medium text-zinc-300">{result.title}</span>
                    </div>
                    {result.matchSection && (
                      <span className="text-xs text-zinc-500">in: {result.matchSection}</span>
                    )}
                    <span className="mt-0.5 text-xs text-zinc-600 line-clamp-2">
                      {result.snippet}
                    </span>
                  </button>
                ))}
              </div>
            ) : searchQuery ? (
              <div className="flex flex-col items-center gap-2 py-8 text-zinc-600">
                <Search size={20} />
                <span className="text-sm">No results</span>
              </div>
            ) : (
              /* Category tree */
              <div className="space-y-1">
                {categories.map((cat) => {
                  const catDocs = getDocsByCategory(docs, cat);
                  const isExpanded = expandedCategories.has(cat);
                  return (
                    <div key={cat}>
                      <button
                        onClick={() => toggleCategory(cat)}
                        className="flex w-full items-center gap-1.5 rounded-lg px-3 py-2 text-left text-sm font-semibold text-zinc-400 transition-colors hover:text-zinc-300"
                      >
                        {isExpanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                        {CATEGORY_LABELS[cat] ?? cat}
                        <span className="text-xs text-zinc-600">({catDocs.length})</span>
                      </button>
                      {isExpanded && (
                        <div className="ml-2 space-y-0.5">
                          {catDocs.map((doc) => (
                            <button
                              key={doc.path}
                              onClick={() => navigateTo(doc.path)}
                              className={`flex w-full items-center gap-2 rounded-lg px-3 py-1.5 text-left text-sm transition-colors ${
                                activePath === doc.path
                                  ? 'bg-zinc-800 text-blue-400'
                                  : 'text-zinc-500 hover:bg-zinc-800/50 hover:text-zinc-300'
                              }`}
                            >
                              <FileText size={12} />
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
          </nav>

          {/* Content */}
          <div className="min-w-0 flex-1">
            {activeDoc ? (
              <DocContent doc={activeDoc} onNavigate={navigateTo} onBack={goHome} />
            ) : (
              <DocsHome docs={docs} categories={categories} onNavigate={navigateTo} />
            )}
          </div>
        </div>

        {/* Mobile layout */}
        <div className="md:hidden">
          {/* Search */}
          <div className="mb-4">
            <div className="flex items-center gap-2 rounded-lg border border-zinc-800 bg-zinc-900 px-3 py-2">
              <Search size={14} className="text-zinc-500" />
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Search docs..."
                className="flex-1 bg-transparent text-sm text-zinc-300 outline-none placeholder:text-zinc-600"
              />
            </div>
          </div>

          {searchResults.length > 0 ? (
            <div className="space-y-1">
              {searchResults.map((result) => (
                <button
                  key={result.path}
                  onClick={() => navigateTo(result.path)}
                  className="flex w-full flex-col rounded-lg border border-zinc-800 bg-zinc-900 px-4 py-3 text-left"
                >
                  <div className="flex items-center gap-1.5">
                    <FileText size={12} className="text-blue-400" />
                    <span className="text-sm font-medium text-zinc-300">{result.title}</span>
                  </div>
                  <span className="mt-1 text-xs text-zinc-600 line-clamp-2">{result.snippet}</span>
                </button>
              ))}
            </div>
          ) : activeDoc ? (
            <DocContent doc={activeDoc} onNavigate={navigateTo} onBack={goHome} />
          ) : (
            <DocsHome docs={docs} categories={categories} onNavigate={navigateTo} />
          )}
        </div>
      </div>
    </div>
  );
}

/** Document content view with breadcrumb and table of contents */
function DocContent({
  doc,
  onNavigate: _onNavigate,
  onBack,
}: {
  doc: DocEntry;
  onNavigate: (path: string) => void;
  onBack: () => void;
}) {
  return (
    <div className="rounded-lg border border-zinc-800 bg-zinc-900">
      {/* Breadcrumb */}
      <div className="flex items-center gap-2 border-b border-zinc-800 px-6 py-3">
        <button
          onClick={onBack}
          className="rounded p-1 text-zinc-500 transition-colors hover:bg-zinc-800 hover:text-zinc-300"
          title="Back to docs home"
        >
          <Home size={14} />
        </button>
        <ChevronRight size={12} className="text-zinc-700" />
        <span className="text-xs text-zinc-500">
          {CATEGORY_LABELS[doc.category] ?? doc.category}
        </span>
        <ChevronRight size={12} className="text-zinc-700" />
        <span className="text-sm font-medium text-zinc-300">{doc.title}</span>
      </div>

      {/* Table of contents (if sections exist) */}
      {doc.sections.length > 1 && (
        <div className="border-b border-zinc-800 px-6 py-3">
          <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-zinc-500">
            On this page
          </h3>
          <div className="space-y-1">
            {doc.sections.map((section, i) => (
              <a
                key={i}
                href={`#${slugify(section.heading)}`}
                className="block text-sm text-zinc-400 transition-colors hover:text-blue-400"
              >
                {section.heading}
              </a>
            ))}
          </div>
        </div>
      )}

      {/* Markdown content */}
      <div className="px-6 py-6">
        <div className="prose prose-invert max-w-none">
          <MarkdownContent content={doc.content} />
        </div>
      </div>
    </div>
  );
}

/** Docs home / landing page */
function DocsHome({
  docs,
  categories,
  onNavigate,
}: {
  docs: DocEntry[];
  categories: string[];
  onNavigate: (path: string) => void;
}) {
  // Find index doc
  const indexDoc = docs.find((d) => d.path === 'index');

  return (
    <div className="space-y-8">
      {/* Welcome */}
      <div className="rounded-lg border border-zinc-800 bg-zinc-900 px-6 py-8 text-center">
        <BookOpen size={36} className="mx-auto mb-3 text-blue-400" />
        <h2 className="text-2xl font-bold text-zinc-100">GenForge Documentation</h2>
        <p className="mx-auto mt-2 max-w-lg text-sm text-zinc-400">
          Learn how to create games with GenForge. Browse guides, explore features, and reference
          the scripting API.
        </p>
      </div>

      {/* Quick start from index doc */}
      {indexDoc && (
        <button
          onClick={() => onNavigate('index')}
          className="flex w-full items-center gap-3 rounded-lg border border-zinc-800 bg-zinc-900 px-6 py-4 text-left transition-colors hover:border-blue-500/30"
        >
          <FileText size={20} className="text-blue-400" />
          <div>
            <div className="text-sm font-semibold text-zinc-200">{indexDoc.title}</div>
            <div className="text-xs text-zinc-500">
              Start here for an overview of GenForge
            </div>
          </div>
        </button>
      )}

      {/* Category grid */}
      <div className="grid gap-4 sm:grid-cols-2">
        {categories
          .filter((c) => c !== 'root')
          .map((cat) => {
            const catDocs = getDocsByCategory(docs, cat);
            return (
              <div
                key={cat}
                className="rounded-lg border border-zinc-800 bg-zinc-900 px-5 py-4"
              >
                <h3 className="mb-3 text-sm font-semibold text-zinc-200">
                  {CATEGORY_LABELS[cat] ?? cat}
                </h3>
                <div className="space-y-1">
                  {catDocs.slice(0, 5).map((doc) => (
                    <button
                      key={doc.path}
                      onClick={() => onNavigate(doc.path)}
                      className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-sm text-zinc-400 transition-colors hover:bg-zinc-800 hover:text-zinc-200"
                    >
                      <FileText size={12} className="shrink-0" />
                      <span className="truncate">{doc.title}</span>
                    </button>
                  ))}
                  {catDocs.length > 5 && (
                    <p className="px-2 text-xs text-zinc-600">
                      + {catDocs.length - 5} more
                    </p>
                  )}
                </div>
              </div>
            );
          })}
      </div>
    </div>
  );
}

/** Simple URL-safe slug from heading text */
function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
}

/** Markdown renderer — renders markdown as React elements */
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
          <pre
            key={`code-${codeKey++}`}
            className="my-3 overflow-x-auto rounded-lg bg-zinc-800 p-4 text-sm text-zinc-400"
          >
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
      const text = line.slice(2);
      elements.push(
        <h1 key={i} id={slugify(text)} className="mb-4 mt-8 text-2xl font-bold text-zinc-100">
          {text}
        </h1>
      );
    } else if (line.startsWith('## ')) {
      const text = line.slice(3);
      elements.push(
        <h2 key={i} id={slugify(text)} className="mb-3 mt-6 text-xl font-semibold text-zinc-200">
          {text}
        </h2>
      );
    } else if (line.startsWith('### ')) {
      const text = line.slice(4);
      elements.push(
        <h3 key={i} id={slugify(text)} className="mb-2 mt-4 text-base font-semibold text-zinc-300">
          {text}
        </h3>
      );
    } else if (line.startsWith('- ') || line.startsWith('* ')) {
      elements.push(
        <div key={i} className="ml-4 flex gap-2 text-zinc-400">
          <span className="text-zinc-600">&#8226;</span>
          <span>{formatInline(line.slice(2))}</span>
        </div>
      );
    } else if (line.match(/^\d+\.\s/)) {
      const num = line.match(/^(\d+)\.\s(.*)/)!;
      elements.push(
        <div key={i} className="ml-4 flex gap-2 text-zinc-400">
          <span className="text-zinc-600">{num[1]}.</span>
          <span>{formatInline(num[2])}</span>
        </div>
      );
    } else if (line.trim() === '') {
      elements.push(<div key={i} className="h-3" />);
    } else {
      elements.push(
        <p key={i} className="leading-relaxed text-zinc-400">
          {formatInline(line)}
        </p>
      );
    }
  }

  return <>{elements}</>;
}

/** Format inline markdown (bold, code, links) */
function formatInline(text: string): React.ReactNode {
  const parts: React.ReactNode[] = [];
  let remaining = text;
  let key = 0;

  while (remaining) {
    // Links: [text](url)
    const linkMatch = remaining.match(/^(.*?)\[([^\]]+)\]\(([^)]+)\)(.*)/);
    if (linkMatch) {
      if (linkMatch[1]) parts.push(linkMatch[1]);
      parts.push(
        <a
          key={key++}
          href={linkMatch[3]}
          className="text-blue-400 underline underline-offset-2 hover:text-blue-300"
          target={linkMatch[3].startsWith('http') ? '_blank' : undefined}
          rel={linkMatch[3].startsWith('http') ? 'noopener noreferrer' : undefined}
        >
          {linkMatch[2]}
        </a>
      );
      remaining = linkMatch[4];
      continue;
    }

    // Inline code
    const codeMatch = remaining.match(/^(.*?)`([^`]+)`(.*)/);
    if (codeMatch) {
      if (codeMatch[1]) parts.push(codeMatch[1]);
      parts.push(
        <code
          key={key++}
          className="rounded bg-zinc-800 px-1.5 py-0.5 text-sm text-blue-400"
        >
          {codeMatch[2]}
        </code>
      );
      remaining = codeMatch[3];
      continue;
    }

    // Bold
    const boldMatch = remaining.match(/^(.*?)\*\*([^*]+)\*\*(.*)/);
    if (boldMatch) {
      if (boldMatch[1]) parts.push(boldMatch[1]);
      parts.push(
        <strong key={key++} className="font-semibold text-zinc-200">
          {boldMatch[2]}
        </strong>
      );
      remaining = boldMatch[3];
      continue;
    }

    parts.push(remaining);
    break;
  }

  return parts.length === 1 ? parts[0] : <>{parts}</>;
}
