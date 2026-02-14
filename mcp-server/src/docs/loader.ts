/**
 * Documentation loader — reads and indexes markdown files from docs/ at startup.
 */

import { readFileSync, readdirSync, existsSync, statSync } from 'fs';
import { join, relative, sep } from 'path';

export interface DocSection {
  /** Heading text (e.g. "Using MCP Commands") */
  heading: string;
  /** Level (2 = ##, 3 = ###, etc.) */
  level: number;
  /** The text content under this heading */
  content: string;
}

export interface DocEntry {
  /** Path relative to docs/ without extension (e.g. "features/physics") */
  path: string;
  /** Document title (first # heading) */
  title: string;
  /** Full raw markdown content */
  content: string;
  /** Parsed sections (split by ## headings) */
  sections: DocSection[];
}

export interface TopicMeta {
  title: string;
  tags: string[];
  related?: string[];
  commands?: string[];
}

export interface DocIndex {
  /** All loaded documents keyed by path */
  docs: Map<string, DocEntry>;
  /** Topic metadata from _meta.json */
  meta: Map<string, TopicMeta>;
}

/**
 * Recursively find all .md files in a directory.
 */
function findMarkdownFiles(dir: string, base: string): string[] {
  const results: string[] = [];
  if (!existsSync(dir)) return results;

  const entries = readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = join(dir, entry.name);
    if (entry.isDirectory() && !entry.name.startsWith('_') && entry.name !== 'scripts') {
      results.push(...findMarkdownFiles(fullPath, base));
    } else if (entry.isFile() && entry.name.endsWith('.md')) {
      results.push(fullPath);
    }
  }
  return results;
}

/**
 * Parse a markdown file into sections split by ## headings.
 */
function parseSections(content: string): { title: string; sections: DocSection[] } {
  const lines = content.split('\n');
  let title = '';
  const sections: DocSection[] = [];
  let currentHeading = '';
  let currentLevel = 0;
  let currentLines: string[] = [];

  for (const line of lines) {
    const headingMatch = line.match(/^(#{1,4})\s+(.+)$/);
    if (headingMatch) {
      const level = headingMatch[1].length;
      const text = headingMatch[2].trim();

      // First H1 is the title
      if (level === 1 && !title) {
        title = text;
        continue;
      }

      // Flush previous section
      if (currentHeading) {
        sections.push({
          heading: currentHeading,
          level: currentLevel,
          content: currentLines.join('\n').trim(),
        });
      }

      currentHeading = text;
      currentLevel = level;
      currentLines = [];
    } else {
      currentLines.push(line);
    }
  }

  // Flush last section
  if (currentHeading) {
    sections.push({
      heading: currentHeading,
      level: currentLevel,
      content: currentLines.join('\n').trim(),
    });
  }

  return { title: title || 'Untitled', sections };
}

/**
 * Load all documentation from the docs/ directory.
 */
export function loadDocs(docsDir: string): DocIndex {
  const docs = new Map<string, DocEntry>();
  const meta = new Map<string, TopicMeta>();

  // Load _meta.json if it exists
  const metaPath = join(docsDir, '_meta.json');
  if (existsSync(metaPath)) {
    try {
      const raw = readFileSync(metaPath, 'utf-8');
      const parsed = JSON.parse(raw) as { topics: Record<string, TopicMeta> };
      for (const [path, topicMeta] of Object.entries(parsed.topics)) {
        meta.set(path, topicMeta);
      }
    } catch {
      // Ignore parse errors
    }
  }

  // Find all markdown files
  const files = findMarkdownFiles(docsDir, docsDir);

  for (const filePath of files) {
    const content = readFileSync(filePath, 'utf-8');
    const relPath = relative(docsDir, filePath)
      .replace(/\\/g, '/')  // Normalize Windows paths
      .replace(/\.md$/, '');

    const { title, sections } = parseSections(content);

    docs.set(relPath, {
      path: relPath,
      title,
      content,
      sections,
    });
  }

  return { docs, meta };
}

/**
 * Get the docs directory path, walking up from mcp-server/src/docs/ to find project root.
 */
export function getDocsDir(): string {
  // Try relative to this file's location (mcp-server/src/docs/)
  // The project root docs/ is at ../../docs/ from mcp-server/
  const candidates = [
    join(__dirname, '..', '..', '..', 'docs'),       // From dist/docs/
    join(__dirname, '..', '..', '..', '..', 'docs'),  // From src/docs/ (dev)
    join(process.cwd(), 'docs'),                       // From project root
    join(process.cwd(), '..', 'docs'),                 // From mcp-server/
  ];

  for (const candidate of candidates) {
    if (existsSync(candidate) && statSync(candidate).isDirectory()) {
      return candidate;
    }
  }

  // Fallback: return the cwd-based path even if it doesn't exist yet
  return join(process.cwd(), 'docs');
}
