'use client';

import { useState, useEffect, useMemo, useCallback } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { Button, Input } from '@spawnforge/ui';
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
      <div className="flex min-h-screen items-center justify-center bg-[var(--sf-bg-app)] text-[var(--sf-text)]">
        Loading documentation...
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center bg-[var(--sf-bg-app)] p-4">
        <BookOpen size={32} className="mb-3 text-[var(--sf-text)]" />
        <p className="text-sm text-[var(--sf-status-down-indicator)]">{error}</p>
        <p className="mt-2 text-xs text-[var(--sf-text)]">
          Documentation is available when running the dev server.
        </p>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[var(--sf-bg-app)] text-[var(--sf-text)]">
      {/* Header */}
      <div className="border-b border-[var(--sf-border)] bg-[var(--sf-bg-surface)]">
        <div className="mx-auto flex max-w-7xl items-center gap-4 px-6 py-4">
          <Button variant="ghost" size="sm"
            onClick={() => router.push('/dashboard')}
            className="rounded p-1.5 text-[var(--sf-text)] transition-colors hover:bg-[var(--sf-bg-elevated)] hover:text-[var(--sf-text)]"
            aria-label="Back to dashboard"
          >
            <ArrowLeft size={20} />
          </Button>
          <div className="flex items-center gap-2">
            <BookOpen size={20} className="text-[var(--sf-text)]" />
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
              <div className="flex items-center gap-2 rounded-lg border border-[var(--sf-border)] bg-[var(--sf-bg-surface)] px-3 py-2">
                <Search size={14} className="text-[var(--sf-text)]" />
                <Input aria-label="Search documentation"
                  type="text"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder="Search docs..."
                  className="min-w-0 flex-1 bg-transparent text-sm text-[var(--sf-text)] placeholder:text-[var(--sf-text)]"
                />
              </div>
            </div>

            {/* Search results */}
            {searchResults.length > 0 ? (
              <div className="space-y-1">
                {searchResults.map((result) => (
                  <Button variant="ghost" size="sm"
                    key={result.path}
                    onClick={() => navigateTo(result.path)}
                    className="h-auto min-h-[44px] justify-start whitespace-normal flex w-full flex-col rounded-lg px-3 py-2 text-left transition-colors hover:bg-[var(--sf-bg-elevated)]"
                  >
                    <div className="flex items-center gap-1.5">
                      <FileText size={12} className="text-[var(--sf-text)]" />
                      <span className="text-sm font-medium text-[var(--sf-text)]">{result.title}</span>
                    </div>
                    {result.matchSection && (
                      <span className="text-xs text-[var(--sf-text)]">in: {result.matchSection}</span>
                    )}
                    <span className="mt-0.5 text-xs text-[var(--sf-text)]">
                      {result.snippet}
                    </span>
                  </Button>
                ))}
              </div>
            ) : searchQuery ? (
              <div className="flex flex-col items-center gap-2 py-8 text-[var(--sf-text)]">
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
                      <Button variant="ghost" size="sm"
                        aria-expanded={isExpanded}
                        onClick={() => toggleCategory(cat)}
                        className="h-auto min-h-[44px] justify-start whitespace-normal flex w-full items-center gap-1.5 rounded-lg px-3 py-2 text-left text-sm font-semibold text-[var(--sf-text)] transition-colors hover:text-[var(--sf-text)]"
                      >
                        {isExpanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                        {CATEGORY_LABELS[cat] ?? cat}
                        <span className="text-xs text-[var(--sf-text)]">({catDocs.length})</span>
                      </Button>
                      {isExpanded && (
                        <div className="ml-2 space-y-0.5">
                          {catDocs.map((doc) => (
                            <Button variant="ghost" size="sm"
                              key={doc.path}
                              aria-current={activePath === doc.path ? 'page' : undefined}
                              onClick={() => navigateTo(doc.path)}
                              className={`h-auto min-h-[44px] justify-start whitespace-normal flex w-full items-center gap-2 rounded-lg px-3 py-1.5 text-left text-sm transition-colors ${
                                activePath === doc.path
                                  ? 'bg-[var(--sf-bg-elevated)] text-[var(--sf-text)]'
                                  : 'text-[var(--sf-text)] hover:bg-[var(--sf-bg-elevated)]/50 hover:text-[var(--sf-text)]'
                              }`}
                            >
                              <FileText size={12} />
                              <span className="min-w-0 break-words">{doc.title}</span>
                            </Button>
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
          <div role="region" aria-label="Documentation content" className="min-w-0 flex-1">
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
            <div className="flex items-center gap-2 rounded-lg border border-[var(--sf-border)] bg-[var(--sf-bg-surface)] px-3 py-2">
              <Search size={14} className="text-[var(--sf-text)]" />
              <Input aria-label="Search documentation"
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Search docs..."
                className="min-w-0 flex-1 bg-transparent text-sm text-[var(--sf-text)] placeholder:text-[var(--sf-text)]"
              />
            </div>
          </div>

          {searchResults.length > 0 ? (
            <div className="space-y-1">
              {searchResults.map((result) => (
                <Button variant="ghost" size="sm"
                  key={result.path}
                  onClick={() => navigateTo(result.path)}
                  className="h-auto min-h-[44px] justify-start whitespace-normal flex w-full flex-col rounded-lg border border-[var(--sf-border)] bg-[var(--sf-bg-surface)] px-4 py-3 text-left"
                >
                  <div className="flex items-center gap-1.5">
                    <FileText size={12} className="text-[var(--sf-text)]" />
                    <span className="text-sm font-medium text-[var(--sf-text)]">{result.title}</span>
                  </div>
                  <span className="mt-1 text-xs text-[var(--sf-text)]">{result.snippet}</span>
                </Button>
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
    <div className="rounded-lg border border-[var(--sf-border)] bg-[var(--sf-bg-surface)]">
      {/* Breadcrumb */}
      <div className="flex items-center gap-2 border-b border-[var(--sf-border)] px-6 py-3">
        <Button variant="ghost" size="sm"
          onClick={onBack}
          className="rounded p-1 text-[var(--sf-text)] transition-colors hover:bg-[var(--sf-bg-elevated)] hover:text-[var(--sf-text)]"
          aria-label="Back to docs home"
          title="Back to docs home"
        >
          <Home size={14} />
        </Button>
        <ChevronRight size={12} className="text-[var(--sf-text)]" />
        <span className="text-xs text-[var(--sf-text)]">
          {CATEGORY_LABELS[doc.category] ?? doc.category}
        </span>
        <ChevronRight size={12} className="text-[var(--sf-text)]" />
        <span className="text-sm font-medium text-[var(--sf-text)]">{doc.title}</span>
      </div>

      {/* Table of contents (if sections exist) */}
      {doc.sections.length > 1 && (
        <div className="border-b border-[var(--sf-border)] px-6 py-3">
          <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-[var(--sf-text)]">
            On this page
          </h3>
          <div className="space-y-1">
            {doc.sections.map((section, i) => (
              <a
                key={i}
                href={`#${slugify(section.heading)}`}
                className="block min-h-[24px] rounded text-sm text-[var(--sf-text)] underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--sf-accent)]"
              >
                {section.heading}
              </a>
            ))}
          </div>
        </div>
      )}

      {/* Markdown content */}
      <div className="px-6 py-6">
        <div className="max-w-none break-words">
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
      <div className="rounded-lg border border-[var(--sf-border)] bg-[var(--sf-bg-surface)] px-6 py-8 text-center">
        <BookOpen size={36} className="mx-auto mb-3 text-[var(--sf-text)]" />
        <h2 className="text-2xl font-bold text-[var(--sf-text)]">SpawnForge Documentation</h2>
        <p className="mx-auto mt-2 max-w-lg text-sm text-[var(--sf-text)]">
          Learn how to create games with SpawnForge. Browse guides, explore features, and reference
          the scripting API.
        </p>
      </div>

      {/* Quick start from index doc */}
      {indexDoc && (
        <Button variant="ghost" size="sm"
          onClick={() => onNavigate('index')}
          className="h-auto min-h-[44px] justify-start whitespace-normal flex w-full items-center gap-3 rounded-lg border border-[var(--sf-border)] bg-[var(--sf-bg-surface)] px-6 py-4 text-left transition-colors hover:border-[var(--sf-accent)]/30"
        >
          <FileText size={20} className="text-[var(--sf-text)]" />
          <div>
            <div className="text-sm font-semibold text-[var(--sf-text)]">{indexDoc.title}</div>
            <div className="text-xs text-[var(--sf-text)]">
              Start here for an overview of SpawnForge
            </div>
          </div>
        </Button>
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
                className="rounded-lg border border-[var(--sf-border)] bg-[var(--sf-bg-surface)] px-5 py-4"
              >
                <h3 className="mb-3 text-sm font-semibold text-[var(--sf-text)]">
                  {CATEGORY_LABELS[cat] ?? cat}
                </h3>
                <div className="space-y-1">
                  {catDocs.slice(0, 5).map((doc) => (
                    <Button variant="ghost" size="sm"
                      key={doc.path}
                      onClick={() => onNavigate(doc.path)}
                      className="h-auto min-h-[44px] justify-start whitespace-normal flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-sm text-[var(--sf-text)] transition-colors hover:bg-[var(--sf-bg-elevated)] hover:text-[var(--sf-text)]"
                    >
                      <FileText size={12} className="shrink-0" />
                      <span className="min-w-0 break-words">{doc.title}</span>
                    </Button>
                  ))}
                  {catDocs.length > 5 && (
                    <p className="px-2 text-xs text-[var(--sf-text)]">
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
            className="my-3 overflow-x-auto rounded-lg bg-[var(--sf-bg-elevated)] p-4 text-sm text-[var(--sf-text)]"
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
        <h1 key={i} id={slugify(text)} className="mb-4 mt-8 text-2xl font-bold text-[var(--sf-text)]">
          {text}
        </h1>
      );
    } else if (line.startsWith('## ')) {
      const text = line.slice(3);
      elements.push(
        <h2 key={i} id={slugify(text)} className="mb-3 mt-6 text-xl font-semibold text-[var(--sf-text)]">
          {text}
        </h2>
      );
    } else if (line.startsWith('### ')) {
      const text = line.slice(4);
      elements.push(
        <h3 key={i} id={slugify(text)} className="mb-2 mt-4 text-base font-semibold text-[var(--sf-text)]">
          {text}
        </h3>
      );
    } else if (line.startsWith('- ') || line.startsWith('* ')) {
      elements.push(
        <div key={i} className="ml-4 flex gap-2 text-[var(--sf-text)]">
          <span className="text-[var(--sf-text)]">&#8226;</span>
          <span>{formatInline(line.slice(2))}</span>
        </div>
      );
    } else if (line.match(/^\d+\.\s/)) {
      const num = line.match(/^(\d+)\.\s(.*)/)!;
      elements.push(
        <div key={i} className="ml-4 flex gap-2 text-[var(--sf-text)]">
          <span className="text-[var(--sf-text)]">{num[1]}.</span>
          <span>{formatInline(num[2])}</span>
        </div>
      );
    } else if (line.trim() === '') {
      elements.push(<div key={i} className="h-3" />);
    } else {
      elements.push(
        <p key={i} className="leading-relaxed text-[var(--sf-text)]">
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
          className="text-[var(--sf-text)] underline underline-offset-2 hover:text-[var(--sf-text)]"
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
          className="rounded bg-[var(--sf-bg-elevated)] px-1.5 py-0.5 text-sm text-[var(--sf-text)]"
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
        <strong key={key++} className="font-semibold text-[var(--sf-text)]">
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
