import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/**
 * The matrix MUST resolve inside the deploy root — the same rule `commands.ts`
 * documents for the manifest. The canonical file is `docs/capability-matrix.md`
 * at the repo root, which sits above `apps/docs/` and is therefore absent on
 * Vercel (`rootDirectory: apps/docs`). `data/capability-matrix.md` is the
 * in-root copy; `web/src/lib/config/__tests__/capabilityMatrix.test.ts` fails
 * whenever the two are not byte-identical, so this page can never render a
 * stale matrix without the web unit gate going red first (#9720).
 */
export const CAPABILITY_MATRIX_PATH = process.env.CAPABILITY_MATRIX_PATH
  ? path.resolve(process.env.CAPABILITY_MATRIX_PATH)
  : path.resolve(__dirname, '../data/capability-matrix.md');

/** Where a bare `#1234` in the matrix points. GitHub redirects PR numbers. */
export const ISSUE_BASE_URL = 'https://github.com/Tristan578/project-forge/issues/';

/** The five statuses the matrix legend defines, in the order it lists them. */
export const MATRIX_STATUSES = [
  'proven',
  'implemented-unverified',
  'partial',
  'unavailable',
  'excluded',
] as const;
export type MatrixStatus = (typeof MATRIX_STATUSES)[number];

const STATUS_SET: ReadonlySet<string> = new Set(MATRIX_STATUSES);

export type InlineNode =
  | { type: 'text'; text: string }
  | { type: 'code'; text: string }
  | { type: 'strong'; text: string }
  | { type: 'link'; text: string; href: string }
  | { type: 'issue'; number: number; href: string };

export type Block =
  | { type: 'heading'; level: number; text: string }
  | { type: 'paragraph'; text: string }
  | { type: 'quote'; text: string }
  | { type: 'list'; items: string[] }
  | { type: 'table'; header: string[]; rows: string[][] };

export interface CapabilityMatrixDocument {
  /** The first `#` heading, lifted out of `blocks` so the page can own the h1. */
  title: string;
  blocks: Block[];
}

/**
 * The markdown subset the matrix is written in, and nothing more: inline code,
 * bold, `[text](href)` links and bare `#1234` issue references. A general
 * markdown renderer is a dependency this app does not otherwise need, and the
 * matrix is checked against exactly this shape by the web gate, so a parser
 * that understands only this shape cannot be surprised by it.
 */
const INLINE_RE = /`([^`]+)`|\*\*([^*]+)\*\*|\[([^\]]+)\]\(([^)\s]+)\)|(?<![\w/])#(\d+)\b/g;

export function parseInline(text: string): InlineNode[] {
  const nodes: InlineNode[] = [];
  let last = 0;
  for (const match of text.matchAll(INLINE_RE)) {
    const index = match.index ?? 0;
    if (index > last) nodes.push({ type: 'text', text: text.slice(last, index) });
    const [, code, strong, linkText, href, issue] = match;
    if (code !== undefined) {
      nodes.push({ type: 'code', text: code });
    } else if (strong !== undefined) {
      nodes.push({ type: 'strong', text: strong });
    } else if (linkText !== undefined && href !== undefined) {
      nodes.push({ type: 'link', text: linkText, href });
    } else {
      const number = Number(issue);
      nodes.push({ type: 'issue', number, href: `${ISSUE_BASE_URL}${number}` });
    }
    last = index + match[0].length;
  }
  if (last < text.length) nodes.push({ type: 'text', text: text.slice(last) });
  return nodes;
}

function splitTableRow(line: string): string[] {
  const parts = line.split('|').map((cell) => cell.trim());
  return parts.slice(1, parts.length - 1);
}

function isSeparatorRow(cells: string[]): boolean {
  return cells.length > 0 && cells.every((cell) => /^:?-{3,}:?$/.test(cell));
}

/**
 * Block-level parse of the same subset: ATX headings, `>` quotes, `-` lists,
 * pipe tables and paragraphs. Consecutive lines of one kind fold into one
 * block; a blank line or a line of another kind ends it.
 */
export function parseBlocks(markdown: string): Block[] {
  const blocks: Block[] = [];
  let paragraph: string[] = [];
  let quote: string[] = [];
  let list: string[] = [];
  let table: string[][] = [];

  const flush = () => {
    if (paragraph.length) blocks.push({ type: 'paragraph', text: paragraph.join(' ') });
    if (quote.length) blocks.push({ type: 'quote', text: quote.join(' ') });
    if (list.length) blocks.push({ type: 'list', items: list });
    if (table.length) {
      const [header, ...rows] = table;
      blocks.push({ type: 'table', header, rows });
    }
    paragraph = [];
    quote = [];
    list = [];
    table = [];
  };

  for (const raw of markdown.split(/\r?\n/)) {
    const line = raw.trim();
    if (line === '') {
      flush();
      continue;
    }
    const heading = /^(#{1,6})\s+(.*)$/.exec(line);
    if (heading) {
      flush();
      blocks.push({ type: 'heading', level: heading[1].length, text: heading[2].trim() });
      continue;
    }
    if (line.startsWith('|')) {
      if (paragraph.length || quote.length || list.length) flush();
      const cells = splitTableRow(line);
      if (!isSeparatorRow(cells)) table.push(cells);
      continue;
    }
    if (line.startsWith('>')) {
      if (paragraph.length || list.length || table.length) flush();
      quote.push(line.replace(/^>\s?/, ''));
      continue;
    }
    const item = /^[-*]\s+(.*)$/.exec(line);
    if (item) {
      if (paragraph.length || quote.length || table.length) flush();
      list.push(item[1]);
      continue;
    }
    if (quote.length || list.length || table.length) flush();
    paragraph.push(line);
  }
  flush();
  return blocks;
}

/**
 * The status a matrix cell starts with, or null for a cell that is not a
 * status (the row key, the Notes column, legend prose). The web gate requires
 * the token to be the whole leading word, so a prefix match is exact here.
 */
export function statusOf(cell: string): MatrixStatus | null {
  const token = cell.trim().split(' ')[0];
  return STATUS_SET.has(token) ? (token as MatrixStatus) : null;
}

export function parseCapabilityMatrix(markdown: string): CapabilityMatrixDocument {
  const blocks = parseBlocks(markdown);
  const titleIndex = blocks.findIndex((b) => b.type === 'heading' && b.level === 1);
  if (titleIndex < 0) return { title: 'Capability Matrix', blocks };
  const title = (blocks[titleIndex] as { text: string }).text;
  return { title, blocks: blocks.filter((_, i) => i !== titleIndex) };
}

/**
 * Null when the copy cannot be read. The page renders an explicit notice for
 * that case rather than an empty table, because an empty table would look
 * like "nothing is limited" — the opposite of what the file says.
 */
export function readCapabilityMatrix(
  matrixPath: string = CAPABILITY_MATRIX_PATH,
): CapabilityMatrixDocument | null {
  try {
    return parseCapabilityMatrix(fs.readFileSync(matrixPath, 'utf-8'));
  } catch (err) {
    console.error(`[docs] cannot read capability matrix at ${matrixPath}:`, err);
    return null;
  }
}
