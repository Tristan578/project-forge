import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

export interface ChangelogSection {
  heading: string;
  content: string[];
}

export function parseChangelog(markdown: string): ChangelogSection[] {
  const lines = markdown.split('\n');
  const sections: ChangelogSection[] = [];
  let current: ChangelogSection | null = null;

  for (const line of lines) {
    if (line.startsWith('## ')) {
      if (current) sections.push(current);
      current = { heading: line.replace('## ', ''), content: [] };
    } else if (current) {
      current.content.push(line);
    }
  }
  if (current) sections.push(current);
  return sections;
}

export function readChangelog(): ChangelogSection[] {
  // Try multiple paths: Vercel rootDirectory=web puts cwd at web/,
  // so ../CHANGELOG.md reaches the repo root. Also try cwd itself
  // for monorepo setups where cwd is the repo root.
  const candidates = [
    join(process.cwd(), '..', 'CHANGELOG.md'),
    join(process.cwd(), 'CHANGELOG.md'),
  ];

  for (const candidate of candidates) {
    if (existsSync(candidate)) {
      try {
        const raw = readFileSync(candidate, 'utf-8');
        return parseChangelog(raw).filter(
          (s) => s.content.some((line) => line.trim() !== '')
        );
      } catch {
        // File exists but can't be read — try next candidate
      }
    }
  }

  return [];
}
