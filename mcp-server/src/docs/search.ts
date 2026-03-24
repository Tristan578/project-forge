/**
 * Full-text keyword search engine for documentation.
 * Uses TF-IDF-style relevance scoring with no external dependencies.
 */

import type { DocIndex, DocEntry, DocSection, TopicMeta } from './loader.js';

export interface SearchResult {
  /** Document path (e.g. "features/physics") */
  path: string;
  /** Document title */
  title: string;
  /** Relevance score (higher = more relevant) */
  score: number;
  /** Matching section heading (if match is in a section) */
  matchSection?: string;
  /** Snippet of matching text */
  snippet: string;
}

export interface TermIndex {
  /** term → { docPath → frequency } */
  termFreqs: Map<string, Map<string, number>>;
  /** docPath → total term count */
  docLengths: Map<string, number>;
  /** Total number of documents */
  docCount: number;
}

/**
 * Apply simple suffix stemming to reduce inflected forms to a common root.
 * Exported for testing.
 * Handles the most common English suffixes without a full stemmer dependency.
 * Examples: "running" → "run", "animations" → "anim", "physics" → "physic"
 */
export function stem(term: string): string {
  if (term.length < 4) return term;

  // -tion / -sion → remove (e.g. "animation" → "animat")
  if (term.endsWith('tion') && term.length > 6) return term.slice(0, -4);
  if (term.endsWith('sion') && term.length > 6) return term.slice(0, -4);

  // -ing → remove, handle doubling (e.g. "running" → "run", "moving" → "mov")
  if (term.endsWith('ing') && term.length > 5) {
    const root = term.slice(0, -3);
    // Undo consonant doubling: "running" → "runn" → "run"
    if (root.length > 2 && root[root.length - 1] === root[root.length - 2]) {
      return root.slice(0, -1);
    }
    return root;
  }

  // -ed → remove, handle doubling (e.g. "added" → "add")
  if (term.endsWith('ed') && term.length > 4) {
    const root = term.slice(0, -2);
    if (root.length > 2 && root[root.length - 1] === root[root.length - 2]) {
      return root.slice(0, -1);
    }
    return root;
  }

  // -es / -s → remove (e.g. "animations" → "animation", "scripts" → "script")
  if (term.endsWith('ies') && term.length > 5) return term.slice(0, -3) + 'y';
  if (term.endsWith('es') && term.length > 4) return term.slice(0, -2);
  if (term.endsWith('s') && term.length > 4 && !term.endsWith('ss')) return term.slice(0, -1);

  // -ly → remove (e.g. "smoothly" → "smooth")
  if (term.endsWith('ly') && term.length > 5) return term.slice(0, -2);

  return term;
}

/**
 * Split text into lowercase words after stripping markdown and punctuation.
 * Does NOT stem — suitable for substring searches in snippet/section extraction.
 */
function tokenizeRaw(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/`[^`]*`/g, ' ')
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/[#*_|>\-=~]/g, ' ')
    .replace(/[^\w\s]/g, ' ')
    .split(/\s+/)
    .filter(t => t.length > 1);
}

/**
 * Tokenize text into lowercase terms, removing markdown syntax and punctuation,
 * then apply suffix stemming so inflected forms match their root.
 */
function tokenize(text: string): string[] {
  return tokenizeRaw(text).map(stem);
}

/**
 * Tokenize text into lowercase terms, removing markdown syntax and punctuation,
 * then apply suffix stemming so inflected forms match their root.
 */
function tokenize(text: string): string[] {
  return tokenizeRaw(text).map(stem);
}

/**
 * Build a term frequency index from all documents and their metadata.
 */
export function buildIndex(docIndex: DocIndex): TermIndex {
  const termFreqs = new Map<string, Map<string, number>>();
  const docLengths = new Map<string, number>();

  for (const [path, doc] of docIndex.docs) {
    const meta = docIndex.meta.get(path);

    // Tokenize document content
    const contentTerms = tokenize(doc.content);

    // Add tag terms with a boost (count each tag multiple times)
    const tagTerms: string[] = [];
    if (meta?.tags) {
      for (const tag of meta.tags) {
        const tagTokens = tokenize(tag);
        // Tags get 3x boost
        for (let i = 0; i < 3; i++) {
          tagTerms.push(...tagTokens);
        }
      }
    }

    // Title terms get 2x boost
    const titleTerms = tokenize(doc.title);
    const boostedTitleTerms: string[] = [];
    for (let i = 0; i < 2; i++) {
      boostedTitleTerms.push(...titleTerms);
    }

    const allTerms = [...contentTerms, ...tagTerms, ...boostedTitleTerms];
    docLengths.set(path, allTerms.length);

    for (const term of allTerms) {
      let docFreqs = termFreqs.get(term);
      if (!docFreqs) {
        docFreqs = new Map<string, number>();
        termFreqs.set(term, docFreqs);
      }
      docFreqs.set(path, (docFreqs.get(path) ?? 0) + 1);
    }
  }

  return {
    termFreqs,
    docLengths,
    docCount: docIndex.docs.size,
  };
}

/**
 * Extract a snippet from the document near the first occurrence of any query term.
 */
function extractSnippet(doc: DocEntry, queryTerms: string[], maxLength: number = 200): string {
  const lowerContent = doc.content.toLowerCase();
  let bestPos = -1;

  // Find the earliest occurrence of any query term
  for (const term of queryTerms) {
    const pos = lowerContent.indexOf(term);
    if (pos !== -1 && (bestPos === -1 || pos < bestPos)) {
      bestPos = pos;
    }
  }

  if (bestPos === -1) {
    // No direct match found — return the start of the content
    return doc.content.slice(0, maxLength).replace(/\n/g, ' ').trim() + '...';
  }

  // Extract a window around the match
  const start = Math.max(0, bestPos - 40);
  const end = Math.min(doc.content.length, bestPos + maxLength - 40);
  let snippet = doc.content.slice(start, end).replace(/\n/g, ' ').trim();

  if (start > 0) snippet = '...' + snippet;
  if (end < doc.content.length) snippet = snippet + '...';

  return snippet;
}

/**
 * Find which section a query term appears in.
 */
function findMatchSection(doc: DocEntry, queryTerms: string[]): string | undefined {
  for (const section of doc.sections) {
    const lowerContent = section.content.toLowerCase();
    const lowerHeading = section.heading.toLowerCase();
    for (const term of queryTerms) {
      if (lowerContent.includes(term) || lowerHeading.includes(term)) {
        return section.heading;
      }
    }
  }
  return undefined;
}

/**
 * Return a phrase-match bonus for a document.
 * If the stemmed query terms appear as a consecutive sequence anywhere in the
 * document content (after the same tokenize pass), return a multiplier > 1.
 * Multi-term queries with a phrase hit score 2× higher than term-only matches.
 */
function phraseBonus(doc: DocEntry, queryTerms: string[]): number {
  if (queryTerms.length < 2) return 1;

  const contentTokens = tokenize(doc.content);
  const firstTerm = queryTerms[0];

  for (let i = 0; i < contentTokens.length - queryTerms.length + 1; i++) {
    if (contentTokens[i] === firstTerm) {
      let matched = true;
      for (let j = 1; j < queryTerms.length; j++) {
        if (contentTokens[i + j] !== queryTerms[j]) {
          matched = false;
          break;
        }
      }
      if (matched) return 2.0;
    }
  }

  return 1;
}

/**
 * Search documents using TF-IDF scoring with phrase-match bonus.
 */
export function search(
  query: string,
  docIndex: DocIndex,
  termIndex: TermIndex,
  maxResults: number = 10
): SearchResult[] {
  const queryTerms = tokenize(query);
  if (queryTerms.length === 0) return [];

  const scores = new Map<string, number>();

  // Average document length for BM25-style normalization
  let totalLength = 0;
  for (const len of termIndex.docLengths.values()) {
    totalLength += len;
  }
  const avgLength = totalLength / Math.max(termIndex.docCount, 1);

  for (const term of queryTerms) {
    const docFreqs = termIndex.termFreqs.get(term);
    if (!docFreqs) continue;

    // IDF: log(N / df)
    const idf = Math.log((termIndex.docCount + 1) / (docFreqs.size + 0.5));

    for (const [docPath, tf] of docFreqs) {
      const docLen = termIndex.docLengths.get(docPath) ?? 1;

      // BM25-style TF normalization
      const k1 = 1.2;
      const b = 0.75;
      const normalizedTf = (tf * (k1 + 1)) / (tf + k1 * (1 - b + b * (docLen / avgLength)));

      const termScore = normalizedTf * idf;
      scores.set(docPath, (scores.get(docPath) ?? 0) + termScore);
    }
  }

  // Apply phrase-match bonus before sorting
  for (const [docPath, baseScore] of scores) {
    const doc = docIndex.docs.get(docPath);
    if (!doc) continue;
    const bonus = phraseBonus(doc, queryTerms);
    if (bonus > 1) {
      scores.set(docPath, baseScore * bonus);
    }
  }

  // Sort by score descending
  const results: SearchResult[] = [];
  const sortedEntries = [...scores.entries()].sort((a, b) => b[1] - a[1]);

  // For snippet/section extraction use unstemmed terms so substring searches
  // find the original words ("entities") rather than their stems ("entity").
  const rawQueryTerms = tokenizeRaw(query);

  for (const [path, score] of sortedEntries.slice(0, maxResults)) {
    const doc = docIndex.docs.get(path);
    if (!doc) continue;

    results.push({
      path,
      title: doc.title,
      score: Math.round(score * 100) / 100,
      matchSection: findMatchSection(doc, rawQueryTerms),
      snippet: extractSnippet(doc, rawQueryTerms),
    });
  }

  return results;
}
