/**
 * @vitest-environment node
 */
import { describe, it, expect } from 'vitest';
import {
  ISSUE_BASE_URL,
  MATRIX_STATUSES,
  hasMatrixRows,
  parseBlocks,
  parseCapabilityMatrix,
  parseInline,
  statusOf,
} from '../capabilityMatrix';

// The shipped artifact (the real data/capability-matrix.json and the way the
// loader depends on it) is covered by capabilityMatrixArtifact.test.ts. This
// file pins the parser against synthetic input only.

describe('parseInline', () => {
  it('returns one text node for plain text', () => {
    expect(parseInline('plain words')).toEqual([{ type: 'text', text: 'plain words' }]);
  });

  it('returns nothing for an empty string', () => {
    expect(parseInline('')).toEqual([]);
  });

  it('splits inline code, bold, links and issue references out of surrounding text', () => {
    const nodes = parseInline('Run `jq` — **bold** — see [the gate](https://example.test/x) and #9117.');
    expect(nodes).toEqual([
      { type: 'text', text: 'Run ' },
      { type: 'code', text: 'jq' },
      { type: 'text', text: ' — ' },
      { type: 'strong', text: 'bold' },
      { type: 'text', text: ' — see ' },
      { type: 'link', text: 'the gate', href: 'https://example.test/x' },
      { type: 'text', text: ' and ' },
      { type: 'issue', number: 9117, href: `${ISSUE_BASE_URL}9117` },
      { type: 'text', text: '.' },
    ]);
  });

  it('does not turn a # inside code or inside a link into an issue reference', () => {
    expect(parseInline('`#9117`')).toEqual([{ type: 'code', text: '#9117' }]);
    expect(parseInline('[#9117](https://example.test/9117)')).toEqual([
      { type: 'link', text: '#9117', href: 'https://example.test/9117' },
    ]);
  });

  it('does not treat a # glued to a word or a path as an issue reference', () => {
    expect(parseInline('dashboard#api-key and PF-330#1')).toEqual([
      { type: 'text', text: 'dashboard#api-key and PF-330#1' },
    ]);
  });

  it('keeps the issue number numeric', () => {
    const [node] = parseInline('#42');
    expect(node).toEqual({ type: 'issue', number: 42, href: `${ISSUE_BASE_URL}42` });
  });
});

describe('parseBlocks', () => {
  it('parses headings at every level', () => {
    expect(parseBlocks('# One\n## Two\n###### Six')).toEqual([
      { type: 'heading', level: 1, text: 'One' },
      { type: 'heading', level: 2, text: 'Two' },
      { type: 'heading', level: 6, text: 'Six' },
    ]);
  });

  it('folds consecutive lines into one paragraph and splits on blank lines', () => {
    expect(parseBlocks('a\nb\n\nc')).toEqual([
      { type: 'paragraph', text: 'a b' },
      { type: 'paragraph', text: 'c' },
    ]);
  });

  it('parses a block quote', () => {
    expect(parseBlocks('> **Measured on:** today\n> and more')).toEqual([
      { type: 'quote', text: '**Measured on:** today and more' },
    ]);
  });

  it('parses a bulleted list with either marker', () => {
    expect(parseBlocks('- one\n* two')).toEqual([{ type: 'list', items: ['one', 'two'] }]);
  });

  it('parses a pipe table and drops the separator row', () => {
    expect(parseBlocks('| A | B |\n|---|:---:|\n| 1 | 2 |\n| 3 | 4 |')).toEqual([
      { type: 'table', header: ['A', 'B'], rows: [['1', '2'], ['3', '4']] },
    ]);
  });

  it('ends a paragraph when a table, quote or list starts without a blank line', () => {
    expect(parseBlocks('intro\n| A |\n|---|\n| 1 |\nafter\n> q\n- item\ntail')).toEqual([
      { type: 'paragraph', text: 'intro' },
      { type: 'table', header: ['A'], rows: [['1']] },
      { type: 'paragraph', text: 'after' },
      { type: 'quote', text: 'q' },
      { type: 'list', items: ['item'] },
      { type: 'paragraph', text: 'tail' },
    ]);
  });

  it('ends a list, quote or table when a paragraph line follows', () => {
    expect(parseBlocks('- item\nplain')).toEqual([
      { type: 'list', items: ['item'] },
      { type: 'paragraph', text: 'plain' },
    ]);
    expect(parseBlocks('> q\nplain')).toEqual([
      { type: 'quote', text: 'q' },
      { type: 'paragraph', text: 'plain' },
    ]);
    expect(parseBlocks('| A |\n|---|\nplain')).toEqual([
      { type: 'table', header: ['A'], rows: [] },
      { type: 'paragraph', text: 'plain' },
    ]);
  });

  it('tolerates CRLF line endings', () => {
    expect(parseBlocks('a\r\n\r\nb')).toEqual([
      { type: 'paragraph', text: 'a' },
      { type: 'paragraph', text: 'b' },
    ]);
  });

  it('returns nothing for an empty document', () => {
    expect(parseBlocks('')).toEqual([]);
  });
});

describe('statusOf', () => {
  it.each(MATRIX_STATUSES)('recognises %s with or without an issue suffix', (status) => {
    expect(statusOf(status)).toBe(status);
    expect(statusOf(`${status} (#9117, #9522)`)).toBe(status);
  });

  it('returns null for a row key, a note, or a look-alike', () => {
    expect(statusOf('`commands:scene`')).toBeNull();
    expect(statusOf('Editor viewport camera.')).toBeNull();
    expect(statusOf('provenance')).toBeNull();
    expect(statusOf('')).toBeNull();
  });
});

describe('parseCapabilityMatrix', () => {
  it('lifts the first h1 out as the title', () => {
    const doc = parseCapabilityMatrix('# Title\n\nbody\n\n# Not the title');
    expect(doc.title).toBe('Title');
    expect(doc.blocks).toEqual([
      { type: 'paragraph', text: 'body' },
      { type: 'heading', level: 1, text: 'Not the title' },
    ]);
  });

  it('falls back to a default title when there is no h1', () => {
    const doc = parseCapabilityMatrix('## Only a section');
    expect(doc.title).toBe('Capability Matrix');
    expect(doc.blocks).toHaveLength(1);
  });
});

describe('hasMatrixRows', () => {
  it('is true only when a table carries a generation: or commands: row', () => {
    const withRow = parseCapabilityMatrix('| A | B |\n|---|---|\n| `commands:scene` | proven |');
    const legendOnly = parseCapabilityMatrix('| Status | Meaning |\n|---|---|\n| `proven` | verified |');
    expect(hasMatrixRows(withRow)).toBe(true);
    expect(hasMatrixRows(legendOnly)).toBe(false);
    expect(hasMatrixRows(parseCapabilityMatrix(''))).toBe(false);
  });
});
