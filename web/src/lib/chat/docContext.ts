import type { DocEntry } from '@/lib/docs/docsIndex';
import { buildClientIndex, searchDocs } from '@/lib/docs/docsSearch';

/** Keywords that indicate a help/how-to intent rather than an action command */
const HELP_INTENT_PATTERNS = [
  /\bhow\b/i,
  /\bhelp\b/i,
  /\btutorial\b/i,
  /\bguide\b/i,
  /\bexplain\b/i,
  /\bwhat is\b/i,
  /\bwhat are\b/i,
  /\bshow me how\b/i,
  /\bcan i\b/i,
  /\bdoes .+ support\b/i,
  /\bhow do\b/i,
  /\bhow can\b/i,
  /\bhow to\b/i,
  /\bwhere (is|do|can)\b/i,
  /\bwhat('s| is) (the|a)\b/i,
];

const MAX_SNIPPET_LENGTH = 600;
const MAX_TOTAL_LENGTH = 2000;
const MAX_RESULTS = 3;

/** Detect whether a user message has help/how-to intent */
export function hasHelpIntent(message: string): boolean {
  return HELP_INTENT_PATTERNS.some((pattern) => pattern.test(message));
}

/**
 * Build a documentation context snippet for injection into the AI system prompt.
 *
 * Returns a formatted string starting with "[Documentation]\n..." when relevant
 * docs are found, or an empty string when no help intent is detected or no
 * results exceed the relevance threshold.
 *
 * Keeps total output under MAX_TOTAL_LENGTH chars to avoid bloating the prompt.
 */
export function buildDocContext(userMessage: string, docs: DocEntry[]): string {
  if (!hasHelpIntent(userMessage)) return '';
  if (docs.length === 0) return '';

  const index = buildClientIndex(docs);
  const results = searchDocs(userMessage, docs, index, MAX_RESULTS);

  if (results.length === 0) return '';

  // Filter out low-relevance results (score < 0.5 is usually noise)
  const relevant = results.filter((r) => r.score >= 0.5);
  if (relevant.length === 0) return '';

  const sections: string[] = ['[Documentation]'];
  let totalLength = sections[0].length;

  for (const result of relevant) {
    const header = `### ${result.title}`;
    const snippet = result.snippet.length > MAX_SNIPPET_LENGTH
      ? result.snippet.slice(0, MAX_SNIPPET_LENGTH) + '...'
      : result.snippet;
    const block = `${header}\n${snippet}`;

    if (totalLength + block.length + 2 > MAX_TOTAL_LENGTH) {
      // Include a truncated version if there's still room for a meaningful snippet
      const remaining = MAX_TOTAL_LENGTH - totalLength - header.length - 10;
      if (remaining > 80) {
        sections.push(`${header}\n${snippet.slice(0, remaining)}...`);
      }
      break;
    }

    sections.push(block);
    totalLength += block.length + 2; // +2 for the '\n\n' separator
  }

  // If nothing was added besides the header, return empty
  if (sections.length <= 1) return '';

  return sections.join('\n\n');
}
