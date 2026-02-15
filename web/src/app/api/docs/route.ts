import { NextResponse } from 'next/server';
import { readdir, readFile } from 'fs/promises';
import path from 'path';

interface DocEntry {
  path: string;
  title: string;
  content: string;
  category: string;
  sections: Array<{ heading: string; content: string }>;
}

const DOCS_ROOT = path.join(process.cwd(), '..', 'docs');

function extractTitle(content: string): string {
  const match = content.match(/^#\s+(.+)$/m);
  return match ? match[1].trim() : 'Untitled';
}

function extractSections(content: string): Array<{ heading: string; content: string }> {
  const sections: Array<{ heading: string; content: string }> = [];
  const lines = content.split('\n');
  let currentHeading = '';
  let currentContent: string[] = [];

  for (const line of lines) {
    const headingMatch = line.match(/^#{2,3}\s+(.+)$/);
    if (headingMatch) {
      if (currentHeading) {
        sections.push({ heading: currentHeading, content: currentContent.join('\n').trim() });
      }
      currentHeading = headingMatch[1].trim();
      currentContent = [];
    } else {
      currentContent.push(line);
    }
  }
  if (currentHeading) {
    sections.push({ heading: currentHeading, content: currentContent.join('\n').trim() });
  }
  return sections;
}

async function loadDocsRecursive(dir: string, basePath: string = ''): Promise<DocEntry[]> {
  const entries: DocEntry[] = [];

  try {
    const items = await readdir(dir, { withFileTypes: true });
    for (const item of items) {
      const fullPath = path.join(dir, item.name);
      if (item.isDirectory() && !item.name.startsWith('_') && !item.name.startsWith('.')) {
        const subEntries = await loadDocsRecursive(fullPath, basePath ? `${basePath}/${item.name}` : item.name);
        entries.push(...subEntries);
      } else if (item.isFile() && item.name.endsWith('.md')) {
        const content = await readFile(fullPath, 'utf-8');
        const docPath = basePath ? `${basePath}/${item.name.replace('.md', '')}` : item.name.replace('.md', '');
        const category = basePath.split('/')[0] || 'root';
        entries.push({
          path: docPath,
          title: extractTitle(content),
          content,
          category,
          sections: extractSections(content),
        });
      }
    }
  } catch {
    // Directory doesn't exist or isn't readable
  }

  return entries;
}

export async function GET() {
  try {
    const docs = await loadDocsRecursive(DOCS_ROOT);

    // Load _meta.json if it exists
    let meta: Record<string, unknown> = {};
    try {
      const metaContent = await readFile(path.join(DOCS_ROOT, '_meta.json'), 'utf-8');
      meta = JSON.parse(metaContent);
    } catch {
      // No meta file
    }

    return NextResponse.json({ docs, meta });
  } catch (err) {
    return NextResponse.json(
      { error: 'Failed to load documentation', details: err instanceof Error ? err.message : 'Unknown error' },
      { status: 500 }
    );
  }
}
