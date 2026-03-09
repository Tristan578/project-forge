'use client';

import { useMemo, useCallback } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { useEditorStore } from '@/stores/editorStore';
import type { Components } from 'react-markdown';

interface MarkdownRendererProps {
  content: string;
}

/**
 * Renders markdown content with syntax-highlighted code blocks,
 * GFM support (tables, strikethrough, task lists), and entity chip integration.
 */
export function MarkdownRenderer({ content }: MarkdownRendererProps) {
  const sceneGraph = useEditorStore((s) => s.sceneGraph);
  const selectEntity = useEditorStore((s) => s.selectEntity);

  // Build entity name -> ID map for chip rendering
  const entityNameMap = useMemo(() => {
    const map = new Map<string, string>();
    for (const node of Object.values(sceneGraph.nodes)) {
      map.set(node.name.toLowerCase(), node.entityId);
    }
    return map;
  }, [sceneGraph.nodes]);

  const handleEntityClick = useCallback(
    (entityId: string) => {
      selectEntity(entityId, 'replace');
    },
    [selectEntity]
  );

  // Process a text string to replace entity names with clickable chips
  const processTextWithEntities = useCallback(
    (text: string): React.ReactNode[] => {
      if (entityNameMap.size === 0) return [text];

      const names = [...entityNameMap.keys()].sort((a, b) => b.length - a.length);
      if (names.length === 0) return [text];

      const escaped = names.map((n) => n.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
      const pattern = new RegExp(`\\b(${escaped.join('|')})\\b`, 'gi');

      const result: React.ReactNode[] = [];
      let lastIndex = 0;
      let keyIdx = 0;

      for (const match of text.matchAll(pattern)) {
        if (match.index > lastIndex) {
          result.push(text.slice(lastIndex, match.index));
        }
        const id = entityNameMap.get(match[0].toLowerCase());
        if (id) {
          result.push(
            <button
              key={`entity-${keyIdx++}`}
              onClick={() => handleEntityClick(id)}
              className="mx-0.5 inline-flex items-center rounded-full bg-purple-600/20 px-1.5 py-0.5 text-purple-300 hover:bg-purple-600/30 transition-colors"
              title={`Select ${match[0]} (${id})`}
            >
              {match[0]}
            </button>
          );
        } else {
          result.push(match[0]);
        }
        lastIndex = match.index + match[0].length;
      }

      if (lastIndex < text.length) {
        result.push(text.slice(lastIndex));
      }

      return result;
    },
    [entityNameMap, handleEntityClick]
  );

  const components: Components = useMemo(
    () => ({
      // Code blocks with language-based CSS classes for syntax highlighting
      code({ className, children, ...props }) {
        const match = /language-(\w+)/.exec(className || '');
        const isInline = !match;

        if (isInline) {
          return (
            <code
              className="rounded bg-zinc-700/50 px-1 py-0.5 text-[0.85em] text-zinc-200"
              {...props}
            >
              {children}
            </code>
          );
        }

        return (
          <div className="my-2 overflow-x-auto rounded-md border border-zinc-700 bg-zinc-900">
            <div className="flex items-center justify-between border-b border-zinc-700 px-3 py-1">
              <span className="text-[10px] uppercase tracking-wider text-zinc-500">
                {match[1]}
              </span>
            </div>
            <pre className="overflow-x-auto p-3">
              <code className={`text-[12px] leading-relaxed ${className || ''}`} {...props}>
                {children}
              </code>
            </pre>
          </div>
        );
      },

      // Paragraphs with entity chip processing
      p({ children }) {
        return <p className="mb-2 last:mb-0">{processChildren(children, processTextWithEntities)}</p>;
      },

      // Lists
      ul({ children }) {
        return <ul className="mb-2 ml-4 list-disc last:mb-0">{children}</ul>;
      },
      ol({ children }) {
        return <ol className="mb-2 ml-4 list-decimal last:mb-0">{children}</ol>;
      },
      li({ children }) {
        return <li className="mb-0.5">{processChildren(children, processTextWithEntities)}</li>;
      },

      // Headings
      h1({ children }) {
        return <h1 className="mb-2 text-base font-bold text-zinc-100">{children}</h1>;
      },
      h2({ children }) {
        return <h2 className="mb-1.5 text-sm font-bold text-zinc-200">{children}</h2>;
      },
      h3({ children }) {
        return <h3 className="mb-1 text-sm font-semibold text-zinc-200">{children}</h3>;
      },

      // Links
      a({ href, children }) {
        return (
          <a
            href={href}
            target="_blank"
            rel="noopener noreferrer"
            className="text-blue-400 underline hover:text-blue-300"
          >
            {children}
          </a>
        );
      },

      // Blockquotes
      blockquote({ children }) {
        return (
          <blockquote className="my-2 border-l-2 border-zinc-600 pl-3 text-zinc-400">
            {children}
          </blockquote>
        );
      },

      // Tables (GFM)
      table({ children }) {
        return (
          <div className="my-2 overflow-x-auto">
            <table className="min-w-full border-collapse text-xs">{children}</table>
          </div>
        );
      },
      th({ children }) {
        return (
          <th className="border border-zinc-700 bg-zinc-800 px-2 py-1 text-left font-medium text-zinc-300">
            {children}
          </th>
        );
      },
      td({ children }) {
        return (
          <td className="border border-zinc-700 px-2 py-1 text-zinc-400">{children}</td>
        );
      },

      // Horizontal rule
      hr() {
        return <hr className="my-3 border-zinc-700" />;
      },

      // Strong / emphasis
      strong({ children }) {
        return <strong className="font-semibold text-zinc-200">{children}</strong>;
      },
      em({ children }) {
        return <em className="italic text-zinc-300">{children}</em>;
      },
    }),
    [processTextWithEntities]
  );

  return (
    <ReactMarkdown remarkPlugins={[remarkGfm]} components={components}>
      {content}
    </ReactMarkdown>
  );
}

/**
 * Recursively process React children, replacing text nodes with entity-aware versions.
 */
function processChildren(
  children: React.ReactNode,
  processText: (text: string) => React.ReactNode[]
): React.ReactNode {
  if (children == null) return null;

  if (typeof children === 'string') {
    return processText(children);
  }

  if (Array.isArray(children)) {
    return children.map((child, i) => {
      if (typeof child === 'string') {
        const processed = processText(child);
        return processed.length === 1 && typeof processed[0] === 'string' ? (
          processed[0]
        ) : (
          <span key={i}>{processed}</span>
        );
      }
      return child;
    });
  }

  return children;
}
