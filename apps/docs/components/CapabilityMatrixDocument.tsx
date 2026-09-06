import type { CSSProperties, ReactNode } from 'react';
import {
  parseInline,
  statusOf,
  type Block,
  type CapabilityMatrixDocument as MatrixDoc,
  type MatrixStatus,
} from '../lib/capabilityMatrix';

/**
 * Renders `docs/capability-matrix.md` (via its in-root copy) on the docs site.
 *
 * Server-renderable: no hooks, no state. Styling follows the inline-style
 * convention of `app/mcp/[category]/page.tsx` rather than pulling in a
 * markdown renderer — the document is written in the small subset
 * `lib/capabilityMatrix.ts` parses, and the web unit gate keeps it there.
 */

const FOREGROUND = 'var(--foreground, #fafafa)';
const MUTED_TEXT = 'rgba(250,250,250,0.75)';
const BORDER = 'var(--border, #27272a)';
const SURFACE = 'var(--muted, #18181b)';

const STATUS_STYLE: Record<MatrixStatus, CSSProperties> = {
  proven: { background: 'rgba(34,197,94,0.15)', color: '#86efac', borderColor: 'rgba(34,197,94,0.4)' },
  'implemented-unverified': {
    background: 'rgba(59,130,246,0.15)',
    color: '#93c5fd',
    borderColor: 'rgba(59,130,246,0.4)',
  },
  partial: { background: 'rgba(245,158,11,0.15)', color: '#fcd34d', borderColor: 'rgba(245,158,11,0.4)' },
  unavailable: { background: 'rgba(239,68,68,0.15)', color: '#fca5a5', borderColor: 'rgba(239,68,68,0.4)' },
  excluded: { background: 'rgba(161,161,170,0.15)', color: '#d4d4d8', borderColor: 'rgba(161,161,170,0.4)' },
};

const codeStyle: CSSProperties = {
  fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
  fontSize: '0.875em',
  background: 'rgba(250,250,250,0.08)',
  padding: '0.1em 0.35em',
  borderRadius: '0.25rem',
};

const linkStyle: CSSProperties = { color: '#93c5fd', textDecoration: 'underline' };

export function Inline({ text }: { text: string }) {
  return (
    <>
      {parseInline(text).map((node, i) => {
        switch (node.type) {
          case 'code':
            return (
              <code key={i} style={codeStyle}>
                {node.text}
              </code>
            );
          case 'strong':
            return <strong key={i}>{node.text}</strong>;
          case 'link':
            return (
              <a key={i} href={node.href} style={linkStyle}>
                {node.text}
              </a>
            );
          case 'issue':
            return (
              <a key={i} href={node.href} style={linkStyle}>
                #{node.number}
              </a>
            );
          default:
            return <span key={i}>{node.text}</span>;
        }
      })}
    </>
  );
}

function StatusBadge({ status }: { status: MatrixStatus }) {
  return (
    <span
      data-status={status}
      style={{
        ...STATUS_STYLE[status],
        display: 'inline-block',
        border: '1px solid',
        borderRadius: '9999px',
        padding: '0.1rem 0.55rem',
        fontSize: '0.75rem',
        fontWeight: 600,
        whiteSpace: 'nowrap',
      }}
    >
      {status}
    </span>
  );
}

function Cell({ text }: { text: string }) {
  const status = statusOf(text);
  if (!status) return <Inline text={text} />;
  const rest = text.trim().slice(status.length).trim();
  return (
    <>
      <StatusBadge status={status} />
      {rest && (
        <span style={{ marginLeft: '0.35rem', fontSize: '0.8125rem', color: MUTED_TEXT }}>
          <Inline text={rest} />
        </span>
      )}
    </>
  );
}

const cellStyle: CSSProperties = {
  padding: '0.5rem 0.75rem',
  borderBottom: `1px solid ${BORDER}`,
  verticalAlign: 'top',
  textAlign: 'left',
  fontSize: '0.875rem',
  lineHeight: 1.5,
};

function Table({ header, rows }: { header: string[]; rows: string[][] }) {
  return (
    <div style={{ overflowX: 'auto', marginBottom: '1.5rem' }}>
      <table style={{ borderCollapse: 'collapse', width: '100%', minWidth: '48rem' }}>
        <thead>
          <tr>
            {header.map((cell, i) => (
              <th
                key={i}
                scope="col"
                style={{ ...cellStyle, color: FOREGROUND, fontWeight: 600, background: SURFACE }}
              >
                <Inline text={cell} />
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, r) => (
            <tr key={r}>
              {row.map((cell, c) => (
                <td key={c} style={{ ...cellStyle, color: MUTED_TEXT }}>
                  <Cell text={cell} />
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function renderBlock(block: Block, key: number): ReactNode {
  switch (block.type) {
    case 'heading': {
      // The document's `#` title is lifted out and rendered as the page h1 by
      // the component below, so a `##` section IS the h2 — mapping it one level
      // down skipped h2 entirely (axe `heading-order`, WCAG 1.3.1). Level as-is,
      // clamped so a stray `#` in the body cannot mint a second h1.
      const Tag = `h${Math.min(6, Math.max(2, block.level))}` as 'h2' | 'h3' | 'h4' | 'h5' | 'h6';
      return (
        <Tag
          key={key}
          style={{
            color: FOREGROUND,
            fontWeight: 600,
            fontSize: block.level <= 2 ? '1.375rem' : '1.125rem',
            margin: '2rem 0 0.75rem',
          }}
        >
          <Inline text={block.text} />
        </Tag>
      );
    }
    case 'paragraph':
      return (
        <p key={key} style={{ color: MUTED_TEXT, margin: '0 0 1rem', lineHeight: 1.6 }}>
          <Inline text={block.text} />
        </p>
      );
    case 'quote':
      return (
        <blockquote
          key={key}
          style={{
            margin: '0 0 1rem',
            padding: '0.75rem 1rem',
            borderLeft: '3px solid rgba(59,130,246,0.6)',
            background: 'rgba(59,130,246,0.08)',
            color: FOREGROUND,
          }}
        >
          <Inline text={block.text} />
        </blockquote>
      );
    case 'list':
      return (
        <ul key={key} style={{ color: MUTED_TEXT, margin: '0 0 1rem', paddingLeft: '1.5rem', lineHeight: 1.6 }}>
          {block.items.map((item, i) => (
            <li key={i} style={{ marginBottom: '0.5rem' }}>
              <Inline text={item} />
            </li>
          ))}
        </ul>
      );
    default:
      return <Table key={key} header={block.header} rows={block.rows} />;
  }
}

export function CapabilityMatrixDocument({ doc }: { doc: MatrixDoc }) {
  return (
    <article>
      <h1 style={{ fontSize: '1.875rem', fontWeight: 700, marginBottom: '0.5rem', color: FOREGROUND }}>
        {doc.title}
      </h1>
      {doc.blocks.map(renderBlock)}
    </article>
  );
}
